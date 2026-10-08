import type { DependencyRequest, ResolvedDependency } from './dependencyResolver';
import { satisfiesVersionSpec } from './versionUtils';

export interface PlacedDependency extends ResolvedDependency {
  path: string;
  children: Record<string, string>;
  isDev: boolean;
  isDevOptional?: boolean;
}

export function parseDependencySpec(name: string, spec: string): { name: string; version: string } {
  if (!spec.startsWith('npm:')) return { name, version: spec };
  const alias = spec.slice(4);
  const separator = alias.lastIndexOf('@');
  if (separator <= 0) return { name: alias, version: 'latest' };
  return { name: alias.slice(0, separator), version: alias.slice(separator + 1) };
}

export function assertPackageName(name: string): void {
  if (
    !/^(?:@[^\s/@]+\/)?[^\s/@]+$/.test(name) ||
    name.split('/').some(part => part === '.' || part === '..' || part.includes('\\'))
  ) {
    throw new Error(`Invalid package name '${name}'`);
  }
}

export function moduleLocations(parent: string, name: string): string[] {
  assertPackageName(name);
  const locations: string[] = [];
  let current = parent;
  while (current) {
    locations.push(`${current}/node_modules/${name}`);
    const separator = current.lastIndexOf('/node_modules/');
    if (separator < 0) current = '';
    else current = current.slice(0, separator);
  }
  locations.push(`node_modules/${name}`);
  return locations;
}

export function packageNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

export function buildDependencyTree(
  dependencies: ResolvedDependency[],
  requests: DependencyRequest[]
): PlacedDependency[] {
  const graph = new Map<string, ResolvedDependency>();
  for (const dependency of dependencies) {
    const name = dependency.installName ?? dependency.packageInfo.name;
    graph.set(
      `${name}@${dependency.packageInfo.name}@${dependency.packageInfo.version}`,
      dependency
    );
  }
  const placements = new Map<string, PlacedDependency>();
  const roots: Array<{ path: string; request: DependencyRequest }> = [];
  const create = (dependency: ResolvedDependency, path: string): PlacedDependency => {
    const placed: PlacedDependency = {
      ...dependency,
      path,
      children: {},
      isDirect: false,
      isOptional: true,
      isDev: true,
      isDevOptional: true,
    };
    placements.set(path, placed);
    return placed;
  };
  for (const request of requests) {
    assertPackageName(request.name);
    const spec = parseDependencySpec(request.name, request.version);
    const dependency = dependencies.find(item => {
      const name = item.installName ?? item.packageInfo.name;
      return (
        name === request.name &&
        item.packageInfo.name === spec.name &&
        satisfiesVersionSpec(item.packageInfo.version, spec.version)
      );
    });
    if (!dependency) {
      if (request.isOptional) continue;
      throw new Error(`Missing resolved dependency '${request.name}@${request.version}'`);
    }
    const path = `node_modules/${request.name}`;
    if (!placements.has(path)) create(dependency, path);
    roots.push({ path, request });
  }
  const queue = Array.from(placements.values());
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index];
    for (const [name, key] of Object.entries(parent.dependencyKeys ?? {})) {
      const dependency = graph.get(key);
      if (!dependency) throw new Error(`Missing dependency edge '${key}'`);
      const locations = moduleLocations(parent.path, name);
      let destination = '';
      let existing: PlacedDependency | undefined;
      let highestVacant = locations.length - 1;
      for (let locationIndex = 0; locationIndex < locations.length; locationIndex += 1) {
        const location = locations[locationIndex];
        const visible = placements.get(location);
        if (!visible) continue;
        if (
          visible.packageInfo.name === dependency.packageInfo.name &&
          visible.packageInfo.version === dependency.packageInfo.version
        ) {
          existing = visible;
          destination = location;
        } else {
          highestVacant = locationIndex - 1;
        }
        break;
      }
      if (!existing) {
        for (let locationIndex = highestVacant; locationIndex >= 0; locationIndex -= 1) {
          const candidate = locations[locationIndex];
          let shadowsDependency = false;
          for (const placed of placements.values()) {
            const linked = placed.children[name];
            if (!linked) continue;
            const search = moduleLocations(placed.path, name);
            const candidateIndex = search.indexOf(candidate);
            if (candidateIndex >= 0 && candidateIndex < search.indexOf(linked)) {
              shadowsDependency = true;
              break;
            }
          }
          if (!shadowsDependency) {
            destination = candidate;
            break;
          }
        }
        if (!destination)
          throw new Error(`Conflicting dependency placement '${parent.path}/${name}'`);
        existing = create(dependency, destination);
        queue.push(existing);
      }
      parent.children[name] = destination;
    }
  }
  markDependencyFlags(placements, roots);
  return Array.from(placements.values());
}

export function markDependencyFlags(
  placements: Map<string, PlacedDependency>,
  roots: Array<{ path: string; request: DependencyRequest }>
): void {
  const queue: Array<{ path: string; optional: boolean; dev: boolean }> = [];
  for (const { path, request } of roots) {
    const root = placements.get(path);
    if (!root) continue;
    root.isDirect = true;
    queue.push({ path, optional: request.isOptional === true, dev: request.isDev === true });
  }
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    const key = `${state.path}:${state.optional}:${state.dev}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const placed = placements.get(state.path);
    if (!placed) continue;
    placed.isOptional &&= state.optional;
    placed.isDev &&= state.dev;
    placed.isDevOptional &&= state.dev || state.optional;
    for (const [name, path] of Object.entries(placed.children)) {
      queue.push({
        path,
        optional: state.optional || Boolean(placed.packageInfo.optionalDependencies?.[name]),
        dev: state.dev,
      });
    }
  }
}

export function pruneFailedOptionalPackages(
  plan: PlacedDependency[],
  failed: Set<string>
): Set<string> {
  const blocked = new Set(failed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const placed of plan) {
      if (!placed.isOptional || blocked.has(placed.path)) continue;
      for (const [name, path] of Object.entries(placed.children)) {
        if (!placed.packageInfo.optionalDependencies?.[name] && blocked.has(path)) {
          blocked.add(placed.path);
          changed = true;
          break;
        }
      }
    }
  }
  const byPath = new Map(plan.map(placed => [placed.path, placed]));
  const reachable = new Set<string>();
  const queue = plan.filter(placed => placed.isDirect).map(placed => placed.path);
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    if (blocked.has(path) || reachable.has(path)) continue;
    reachable.add(path);
    const placed = byPath.get(path);
    if (placed) queue.push(...Object.values(placed.children));
  }
  for (const placed of plan) {
    if (!reachable.has(placed.path)) blocked.add(placed.path);
  }
  return blocked;
}
