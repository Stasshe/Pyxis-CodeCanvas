import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileRepository } from '@/engine/core/fileRepository';
import { transformEsmToCjs } from '@/engine/runtime/transpiler/esmTransformer';

const requireFromTests = createRequire(path.join(process.cwd(), 'tests/package.json'));
const textDecoder = new TextDecoder('utf-8', { fatal: false });

function isBinaryBuffer(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true;
  }

  const len = Math.min(buf.length, 512);
  let nonPrintable = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c > 126) nonPrintable++;
  }
  return nonPrintable / Math.max(1, len) > 0.3;
}

function toRepositoryContent(buf: Uint8Array): string {
  if (isBinaryBuffer(buf)) {
    return `base64:${Buffer.from(buf).toString('base64')}`;
  }
  return textDecoder.decode(buf);
}

function resolvePackageJson(packageName: string, fromDir?: string): string {
  const resolver = fromDir ? createRequire(path.join(fromDir, 'package.json')) : requireFromTests;
  return resolver.resolve(`${packageName}/package.json`);
}

async function readPackageJson(packageJsonPath: string): Promise<any> {
  return JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
}

async function collectPackageFiles(
  sourceDir: string,
  targetDir: string
): Promise<Array<{ path: string; content: string; type: 'file' | 'folder' }>> {
  const entries: Array<{ path: string; content: string; type: 'file' | 'folder' }> = [
    { path: targetDir, content: '', type: 'folder' },
  ];

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

      const data = new Uint8Array(await fs.readFile(sourcePath));
      let content = toRepositoryContent(data);
      if (targetPath.endsWith('.mjs') && content && !content.startsWith('base64:')) {
        content = await transformEsmToCjs(content, targetPath);
      }
      entries.push({ path: targetPath, content, type: 'file' });
    }
  }

  await walk(sourceDir, targetDir);
  return entries;
}

async function createEntries(
  projectId: string,
  entries: Array<{ path: string; content: string; type: 'file' | 'folder' }>
): Promise<void> {
  const folders = entries.filter(entry => entry.type === 'folder');
  for (const folder of folders) {
    await fileRepository.createFile(projectId, folder.path, '', 'folder');
  }

  const files = entries.filter(entry => entry.type === 'file');
  const batchSize = 500;
  for (let i = 0; i < files.length; i += batchSize) {
    await fileRepository.createFilesBulk(projectId, files.slice(i, i + batchSize) as any, true);
  }
}

export async function installLocalTestPackage(
  projectId: string,
  packageName: string,
  installed = new Set<string>()
): Promise<void> {
  if (installed.has(packageName)) return;
  installed.add(packageName);

  const packageJsonPath = resolvePackageJson(packageName);
  const sourceDir = await fs.realpath(path.dirname(packageJsonPath));
  const packageJson = await readPackageJson(packageJsonPath);

  for (const dependencyName of Object.keys(packageJson.dependencies || {})) {
    const dependencyPackageJsonPath = resolvePackageJson(dependencyName, sourceDir);
    const dependencyDir = await fs.realpath(path.dirname(dependencyPackageJsonPath));
    await installLocalTestPackageFromDir(projectId, dependencyName, dependencyDir, installed);
  }

  await installLocalTestPackageFromDir(projectId, packageName, sourceDir, installed);
}

async function installLocalTestPackageFromDir(
  projectId: string,
  packageName: string,
  sourceDir: string,
  installed: Set<string>
): Promise<void> {
  if (installed.has(`${packageName}:${sourceDir}`)) return;
  installed.add(`${packageName}:${sourceDir}`);

  const targetDir = `/node_modules/${packageName}`;
  const parentDir = path.posix.dirname(targetDir);
  if (parentDir !== '/node_modules') {
    await fileRepository.createFile(projectId, parentDir, '', 'folder');
  }

  const entries = await collectPackageFiles(sourceDir, targetDir);
  await createEntries(projectId, entries);
}
