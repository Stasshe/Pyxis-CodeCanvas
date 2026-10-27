import { resolvePath } from '@/engine/core/fs/index';
import type { FsApi } from '@/engine/core/fs/types';

type DependencyGraph = Map<string, { dependencies: string[]; dependents: string[] }>;

export async function analyzeDependencies(fs: FsApi, rootPath: string): Promise<DependencyGraph> {
  const graph: DependencyGraph = new Map();
  const modulesPath = resolvePath(rootPath, 'node_modules');
  if (!(await fs.exists(modulesPath))) return graph;
  const prefix = `${modulesPath}/`;
  const files = (await fs.walk(modulesPath)).filter(
    file =>
      file.type === 'file' && file.path.startsWith(prefix) && file.path.endsWith('/package.json')
  );
  const packages = new Map<string, PackageJson>();
  for (const file of files) {
    try {
      const content = await fs.readText(file.path);
      const packageJson = JSON.parse(content) as PackageJson;
      if (packageJson.name) packages.set(packageJson.name, packageJson);
    } catch (error) {
      console.warn(`[dependencyGraph] parse error in ${file.path}:`, error);
    }
  }
  for (const [name, packageJson] of packages) {
    graph.set(name, { dependencies: Object.keys(packageJson.dependencies ?? {}), dependents: [] });
  }
  for (const [name, info] of graph) {
    for (const dependency of info.dependencies) graph.get(dependency)?.dependents.push(name);
  }
  return graph;
}

export async function getRootDependencies(fs: FsApi, rootPath: string): Promise<Set<string>> {
  const path = resolvePath(rootPath, 'package.json');
  if (!(await fs.exists(path))) return new Set<string>();
  const packageJson = JSON.parse(await fs.readText(path)) as PackageJson;
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
}

export function findOrphanedPackages(
  packageToRemove: string,
  graph: DependencyGraph,
  rootDependencies: Set<string>
): string[] {
  const toRemove = new Set<string>([packageToRemove]);
  const processed = new Set<string>();
  const queue = [packageToRemove];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || processed.has(current)) continue;
    processed.add(current);
    const info = graph.get(current);
    if (!info) continue;
    for (const dependency of info.dependencies) {
      if (rootDependencies.has(dependency) || toRemove.has(dependency)) continue;
      const dependencyInfo = graph.get(dependency);
      if (!dependencyInfo) continue;
      const remaining = dependencyInfo.dependents.filter(name => !toRemove.has(name));
      if (remaining.length === 0) {
        toRemove.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return Array.from(toRemove).filter(name => name !== packageToRemove);
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
