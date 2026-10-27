import { resolvePath } from '@/engine/core/fs/index';
import type { FsApi } from '@/engine/core/fs/types';
import { rootDependencyRequests } from './install/lockfile';
import type { InstallProgressCallback, InstallResult, PackageInfo } from './install/types';
import { NpmInstall } from './npmInstall';

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  keywords?: string[];
  author?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface InstallPackageRequest {
  name: string;
  version?: string;
}

export class WorkerNpmCommands {
  constructor(
    private readonly fs: FsApi,
    private readonly rootPath: string
  ) {}

  private path(path: string): string {
    return resolvePath(this.rootPath, path);
  }

  private async readPackage(): Promise<PackageJson | null> {
    const path = this.path('package.json');
    if (!(await this.fs.exists(path))) return null;
    return JSON.parse(await this.fs.readText(path)) as PackageJson;
  }

  private async writePackage(packageJson: PackageJson): Promise<void> {
    await this.fs.writeFile(this.path('package.json'), JSON.stringify(packageJson, null, 2));
  }

  async install(
    packageName?: string,
    flags: string[] = [],
    onProgress?: InstallProgressCallback
  ): Promise<string> {
    const version = flags.find(flag => flag.startsWith('--version='))?.slice('--version='.length);
    const packages: InstallPackageRequest[] = [];
    if (packageName) packages.push({ name: packageName, version });
    return this.installPackages(packages, flags, onProgress);
  }

  async installPackages(
    packages: InstallPackageRequest[],
    flags: string[] = [],
    onProgress?: InstallProgressCallback
  ): Promise<string> {
    const started = Date.now();
    const packageJson = (await this.readPackage()) ?? this.defaultPackageJson(this.projectName());
    if (!(await this.fs.exists(this.path('package.json')))) await this.writePackage(packageJson);
    const installer = new NpmInstall(this.rootPath, this.fs);
    if (onProgress) installer.setInstallProgressCallback(onProgress);
    try {
      if (packages.length === 0) {
        const requests = rootDependencyRequests(packageJson);
        const result = await installer.installDependencies(requests, 'node_modules', packageJson);
        return installSummary(result, started);
      }
      const isDev = flags.includes('--save-dev') || flags.includes('-D');
      const dependencies = packageJson.dependencies ?? {};
      const devDependencies = packageJson.devDependencies ?? {};
      const resolvedPackages: Array<{ request: InstallPackageRequest; packageInfo: PackageInfo }> =
        [];
      for (const request of packages) {
        const requestedVersion = request.version ?? 'latest';
        const packageInfo = await installer.resolvePackageInfo(request.name, requestedVersion);
        resolvedPackages.push({ request, packageInfo });
        let savedVersion = `^${packageInfo.version}`;
        if (requestedVersion.startsWith('npm:'))
          savedVersion = `npm:${packageInfo.name}@^${packageInfo.version}`;
        if (isDev) {
          delete dependencies[request.name];
          devDependencies[request.name] = savedVersion;
        } else {
          delete devDependencies[request.name];
          dependencies[request.name] = savedVersion;
        }
        if (packageJson.optionalDependencies) delete packageJson.optionalDependencies[request.name];
      }
      packageJson.dependencies = dependencies;
      packageJson.devDependencies = devDependencies;
      await this.writePackage(packageJson);
      const requests = rootDependencyRequests(packageJson);
      for (const { request, packageInfo } of resolvedPackages) {
        const dependencyRequest = requests.find(item => item.name === request.name);
        if (!dependencyRequest) continue;
        dependencyRequest.version = packageInfo.version;
        if (request.version?.startsWith('npm:'))
          dependencyRequest.version = `npm:${packageInfo.name}@${packageInfo.version}`;
      }
      const result = await installer.installDependencies(requests, 'node_modules', packageJson);
      return installSummary(result, started);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      throw new Error(`npm install failed: ${message}`);
    }
  }

  async uninstall(packageName: string): Promise<string> {
    const started = Date.now();
    const packageJson = await this.readPackage();
    if (!packageJson) return 'npm ERR! Cannot find package.json';
    const dependencies = packageJson.dependencies ?? {};
    const devDependencies = packageJson.devDependencies ?? {};
    const optionalDependencies = packageJson.optionalDependencies ?? {};
    const found = Boolean(
      dependencies[packageName] || devDependencies[packageName] || optionalDependencies[packageName]
    );
    delete dependencies[packageName];
    delete devDependencies[packageName];
    delete optionalDependencies[packageName];
    if (!found) return `npm WARN ${packageName} is not a dependency of ${this.projectName()}`;
    packageJson.dependencies = dependencies;
    packageJson.devDependencies = devDependencies;
    await this.writePackage(packageJson);
    const installer = new NpmInstall(this.rootPath, this.fs);
    const removed = await installer.uninstallWithDependencies(packageName);
    return `removed ${removed.length} packages in ${secondsSince(started)}s`;
  }

  async list(projectName: string): Promise<string> {
    const packageJson = await this.readPackage();
    if (!packageJson) return 'npm ERR! Cannot find package.json';
    const dependencies = packageJson.dependencies ?? {};
    const devDependencies = packageJson.devDependencies ?? {};
    const entries = [
      ...Object.entries(dependencies).map(([name, version]) => ({ name, version, dev: false })),
      ...Object.entries(devDependencies).map(([name, version]) => ({ name, version, dev: true })),
    ];
    if (entries.length === 0) return `${projectName}@${packageJson.version}\n(empty)`;
    const lines: string[] = [];
    entries.forEach(({ name, version, dev }, index) => {
      let connector = '├── ';
      if (index === entries.length - 1) connector = '└── ';
      let suffix = '';
      if (dev) suffix = ' (dev)';
      lines.push(`${connector}${name}@${version}${suffix}`);
    });
    return `${projectName}@${packageJson.version}\n${lines.join('\n')}`;
  }

  async init(force = false, projectName: string): Promise<string> {
    if ((await this.readPackage()) && !force)
      return "package.json already exists. Use 'npm init --force' to overwrite.";
    const packageJson = this.defaultPackageJson(projectName);
    await this.writePackage(packageJson);
    return `Wrote to /package.json:\n\n${JSON.stringify(packageJson, null, 2)}`;
  }

  private defaultPackageJson(projectName = 'project'): PackageJson {
    return {
      name: projectName,
      version: '1.0.0',
      description: '',
      main: 'index.js',
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
      keywords: [],
      author: '',
      license: 'ISC',
      dependencies: {},
      devDependencies: {},
    };
  }

  private projectName(): string {
    const segments = this.rootPath.split('/').filter(Boolean);
    return segments.at(-1) ?? 'root';
  }
}

function secondsSince(started: number): string {
  return ((Date.now() - started) / 1000).toFixed(1);
}

function packages(count: number): string {
  if (count === 1) return '1 package';
  return `${count} packages`;
}

function installSummary(result: InstallResult, started: number): string {
  let action = 'up to date';
  if (result.installed > 0) action = `added ${packages(result.installed)}`;
  return `${action}, checked ${packages(result.packageCount + 1)} in ${secondsSince(started)}s`;
}
