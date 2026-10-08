import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { FsCore } from '@/engine/core/fs/core';

const requireFromTests = createRequire(path.join(process.cwd(), 'tests/package.json'));

interface LocalPackageJson {
  dependencies?: Record<string, string>;
}

interface PackageEntry {
  path: string;
  content: string | Uint8Array;
  type: 'file' | 'folder';
}

function resolvePackageJson(packageName: string, fromDir?: string): string {
  const resolver = fromDir ? createRequire(path.join(fromDir, 'package.json')) : requireFromTests;
  return resolver.resolve(`${packageName}/package.json`);
}

async function readPackageJson(packageJsonPath: string): Promise<LocalPackageJson> {
  const source = await fs.readFile(packageJsonPath, 'utf8');
  return JSON.parse(source) as LocalPackageJson;
}

async function collectPackageFiles(sourceDir: string, targetDir: string): Promise<PackageEntry[]> {
  const entries: PackageEntry[] = [{ path: targetDir, content: '', type: 'folder' }];

  async function walk(currentSourceDir: string, currentTargetDir: string): Promise<void> {
    const dirEntries = await fs.readdir(currentSourceDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name === 'node_modules') continue;
      const sourcePath = path.join(currentSourceDir, entry.name);
      const targetPath = `${currentTargetDir}/${entry.name}`;
      if (entry.isDirectory()) {
        entries.push({ path: targetPath, content: '', type: 'folder' });
        await walk(sourcePath, targetPath);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const bytes = new Uint8Array(await fs.readFile(sourcePath));
      entries.push({ path: targetPath, content: bytes, type: 'file' });
    }
  }

  await walk(sourceDir, targetDir);
  return entries;
}

async function createEntries(repo: FsCore, entries: PackageEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.type === 'folder') await repo.mkdir(entry.path, { recursive: true });
    else await repo.writeFile(entry.path, entry.content);
  }
}

export async function installLocalTestPackage(
  repo: FsCore,
  rootPath: string,
  packageName: string,
  installed = new Set<string>()
): Promise<void> {
  if (installed.has(packageName)) return;
  installed.add(packageName);
  const packageJsonPath = resolvePackageJson(packageName);
  const sourceDir = await fs.realpath(path.dirname(packageJsonPath));
  const packageJson = await readPackageJson(packageJsonPath);

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    const dependencyPackageJsonPath = resolvePackageJson(dependencyName, sourceDir);
    const dependencyDir = await fs.realpath(path.dirname(dependencyPackageJsonPath));
    await installLocalTestPackageFromDir(repo, rootPath, dependencyName, dependencyDir, installed);
  }

  await installLocalTestPackageFromDir(repo, rootPath, packageName, sourceDir, installed);
}

async function installLocalTestPackageFromDir(
  repo: FsCore,
  rootPath: string,
  packageName: string,
  sourceDir: string,
  installed: Set<string>
): Promise<void> {
  if (installed.has(`${packageName}:${sourceDir}`)) return;
  installed.add(`${packageName}:${sourceDir}`);
  const targetDir = `${rootPath}/node_modules/${packageName}`;
  const entries = await collectPackageFiles(sourceDir, targetDir);
  await createEntries(repo, entries);
}
