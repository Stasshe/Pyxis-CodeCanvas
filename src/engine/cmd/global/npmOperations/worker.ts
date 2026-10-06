import { resolvePath } from '@/engine/core/fs';
import type { FsApi } from '@/engine/core/fs/types';
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
    installer.startBatchProcessing();
    try {
      if (!packageName) {
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
        const names = Object.keys(dependencies);
        if (names.length === 0)
          return 'up to date, audited 0 packages in 0.1s\n\nfound 0 vulnerabilities';
        let installed = 0;
        const failures: string[] = [];
        for (const name of names) {
          const version = dependencies[name];
          if (!version) continue;
          try {
            await installer.installWithDependencies(name, version, { isDirect: true });
            installed += 1;
          } catch (error) {
            let message = String(error);
            if (error instanceof Error) message = error.message;
            failures.push(`${name}@${version}: ${message}`);
          }
        }
        await this.ensureBins(installer, names);
        const elapsed = secondsSince(started);
        let output = '';
        if (failures.length > 0)
          output = `${failures.map(failure => `npm WARN ${failure}`).join('\n')}\n\n`;
        if (installed === 0)
          return `${output}up to date, audited ${names.length} packages in ${elapsed}s\n\nfound 0 vulnerabilities`;
        return `${output}added ${installed} packages, and audited ${names.length} packages in ${elapsed}s\n\nfound 0 vulnerabilities`;
      }
      const isDev = flags.includes('--save-dev') || flags.includes('-D');
      let requestedVersion = 'latest';
      for (const flag of flags) {
        if (flag.startsWith('--version=')) requestedVersion = flag.slice('--version='.length);
      }
      const wasDeclared = Boolean(
        packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName]
      );
      const packageInfo = await this.fetchPackageInfo(packageName, requestedVersion);
      const dependencies = packageJson.dependencies ?? {};
      const devDependencies = packageJson.devDependencies ?? {};
      if (isDev) devDependencies[packageName] = `^${packageInfo.version}`;
      else dependencies[packageName] = `^${packageInfo.version}`;
      packageJson.dependencies = dependencies;
      packageJson.devDependencies = devDependencies;
      await this.writePackage(packageJson);
      const wasInstalled = await this.fs.exists(
        this.path(`node_modules/${packageName}/package.json`)
      );
      await installer.installWithDependencies(packageName, packageInfo.version, { isDirect: true });
      await installer.ensureBinsForPackage(packageName);
      let result = 'added';
      if (wasDeclared && wasInstalled) result = 'up to date';
      return `${result} 1 package, and audited 1 package in ${secondsSince(started)}s\n\nfound 0 vulnerabilities`;
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      throw new Error(`npm install failed: ${message}`);
    } finally {
      await installer.finishBatchProcessing();
    }
  }

  async uninstall(packageName: string): Promise<string> {
    const started = Date.now();
    const packageJson = await this.readPackage();
    if (!packageJson) return 'npm ERR! Cannot find package.json';
    const dependencies = packageJson.dependencies ?? {};
    const devDependencies = packageJson.devDependencies ?? {};
    const found = Boolean(dependencies[packageName] || devDependencies[packageName]);
    delete dependencies[packageName];
    delete devDependencies[packageName];
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

  private async ensureBins(installer: NpmInstall, names: string[]): Promise<void> {
    for (const name of names) await installer.ensureBinsForPackage(name);
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

  private async fetchPackageInfo(
    packageName: string,
    requestedVersion: string
  ): Promise<{ version: string }> {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const value = (await response.json()) as RegistryPackage;
    let version = requestedVersion;
    if (requestedVersion === 'latest') version = value['dist-tags']?.latest ?? '';
    if (requestedVersion !== 'latest' && !value.versions?.[requestedVersion]) {
      version = value['dist-tags']?.latest ?? '';
    }
    if (!version) throw new Error(`Invalid package data for '${packageName}'`);
    return { version };
  }
}

interface RegistryPackage {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, object>;
}

function secondsSince(started: number): string {
  return ((Date.now() - started) / 1000).toFixed(1);
}
