import { resolvePath } from '@/engine/core/fs';
import type { FsApi } from '@/engine/core/fs/types';
import { rootDependencyRequests } from './install/lockfile';
import type { InstallProgressCallback } from './install/types';
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
    const started = Date.now();
    const packageJson = (await this.readPackage()) ?? this.defaultPackageJson(this.projectName());
    if (!(await this.fs.exists(this.path('package.json')))) await this.writePackage(packageJson);
    const installer = new NpmInstall(this.rootPath, this.fs);
    if (onProgress) installer.setInstallProgressCallback(onProgress);
    try {
      if (!packageName) {
        const requests = rootDependencyRequests(packageJson);
        const names = requests.map(request => request.name);
        const installed = await installer.installDependencies(
          requests,
          'node_modules',
          packageJson
        );
        const elapsed = secondsSince(started);
        if (installed === 0) {
          return `up to date, audited ${names.length} packages in ${elapsed}s\n\nfound 0 vulnerabilities`;
        }
        return `added ${installed} packages, and audited ${names.length} packages in ${elapsed}s\n\nfound 0 vulnerabilities`;
      }
      const isDev = flags.includes('--save-dev') || flags.includes('-D');
      let requestedVersion = 'latest';
      for (const flag of flags) {
        if (flag.startsWith('--version=')) requestedVersion = flag.slice('--version='.length);
      }
      const packageInfo = await installer.resolvePackageInfo(packageName, requestedVersion);
      const dependencies = packageJson.dependencies ?? {};
      const devDependencies = packageJson.devDependencies ?? {};
      if (isDev) {
        delete dependencies[packageName];
        devDependencies[packageName] = `^${packageInfo.version}`;
      } else {
        delete devDependencies[packageName];
        dependencies[packageName] = `^${packageInfo.version}`;
      }
      packageJson.dependencies = dependencies;
      packageJson.devDependencies = devDependencies;
      if (packageJson.optionalDependencies) delete packageJson.optionalDependencies[packageName];
      await this.writePackage(packageJson);
      const requests = rootDependencyRequests(packageJson);
      const requested = requests.find(request => request.name === packageName);
      if (requested) requested.version = packageInfo.version;
      const installed = await installer.installDependencies(requests, 'node_modules', packageJson);
      const audited = requests.length;
      if (installed === 0)
        return `up to date, audited ${audited} packages in ${secondsSince(started)}s\n\nfound 0 vulnerabilities`;
      return `added ${installed} packages, and audited ${audited} packages in ${secondsSince(started)}s\n\nfound 0 vulnerabilities`;
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
    let removedCount = removed.length;
    if (removedCount === 0) removedCount = 1;
    else removedCount += 1;
    return `removed ${removedCount} packages in ${secondsSince(started)}s\n\nfound 0 vulnerabilities`;
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
