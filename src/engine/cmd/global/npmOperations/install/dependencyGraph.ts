import { fileRepository } from '@/engine/core/fileRepository';

type DependencyGraph = Map<string, { dependencies: string[]; dependents: string[] }>;

export async function analyzeDependencies(
  projectId: string,
  snapshotFiles?: Array<any>
): Promise<DependencyGraph> {
  const graph: DependencyGraph = new Map();
  try {
    const files =
      snapshotFiles ?? (await fileRepository.getFilesByPrefix(projectId, '/node_modules/'));
    const pkgFiles = files.filter(
      (f: any) => f.path.startsWith('/node_modules/') && f.path.endsWith('package.json')
    );
    for (const f of pkgFiles) {
      try {
        const pj = JSON.parse(f.content);
        if (pj.name) graph.set(pj.name, { dependencies: [], dependents: [] });
      } catch (err) {
        console.warn(`[dependencyGraph] parse error in ${f.path}:`, err);
      }
    }
    for (const f of pkgFiles) {
      try {
        const pj = JSON.parse(f.content);
        const deps = Object.keys(pj.dependencies || {});
        const info = graph.get(pj.name);
        if (info) {
          info.dependencies = deps;
          for (const dep of deps) {
            graph.get(dep)?.dependents.push(pj.name);
          }
        }
      } catch (err) {
        console.warn(`[dependencyGraph] deps resolution error in ${f.path}:`, err);
      }
    }
  } catch (error) {
    console.warn('[dependencyGraph] analyzeDependencies error:', error);
  }
  return graph;
}

export async function getRootDependencies(
  projectId: string,
  snapshotFiles?: Array<any>
): Promise<Set<string>> {
  const rootDeps = new Set<string>();
  try {
    const pkgFile = snapshotFiles
      ? snapshotFiles.find((f: any) => f.path === '/package.json')
      : await fileRepository.getFileByPath(projectId, '/package.json');
    if (!pkgFile) return rootDeps;
    const pj = JSON.parse(pkgFile.content);
    for (const dep of [
      ...Object.keys(pj.dependencies || {}),
      ...Object.keys(pj.devDependencies || {}),
    ]) {
      rootDeps.add(dep);
    }
  } catch (error) {
    console.warn('[dependencyGraph] getRootDependencies error:', error);
  }
  return rootDeps;
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
    const current = queue.shift()!;
    if (processed.has(current)) continue;
    processed.add(current);

    const info = graph.get(current);
    if (!info) continue;

    for (const dep of info.dependencies) {
      if (rootDependencies.has(dep) || toRemove.has(dep)) continue;
      const depInfo = graph.get(dep);
      if (!depInfo) continue;
      const otherDependents = depInfo.dependents.filter(d => !toRemove.has(d) && graph.has(d));
      if (otherDependents.length === 0) {
        toRemove.add(dep);
        queue.push(dep);
      }
    }
  }

  return Array.from(toRemove).filter(p => p !== packageToRemove);
}
