import type { DependencyRequest } from './dependencyResolver';
import { supportsRuntimePlatform } from './dependencyResolver';
import {
  markDependencyFlags,
  moduleLocations,
  type PlacedDependency,
  packageNameFromPath,
  parseDependencySpec,
  pruneFailedOptionalPackages,
} from './tree';
import type { PackageInfo } from './types';
import { isVersionRange, matchesLockedVersion, satisfiesVersionSpec } from './versionUtils';

export interface RootManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface LockedPackage extends RootManifest {
  resolved?: string;
  integrity?: string;
  optional?: boolean;
  dev?: boolean;
  devOptional?: boolean;
  bin?: string | Record<string, string>;
  os?: string[];
  cpu?: string[];
}

export interface PackageLock {
  name?: string;
  version?: string;
  lockfileVersion: number;
  requires: boolean;
  packages: Record<string, LockedPackage>;
}

export function rootDependencyRequests(manifest: RootManifest): DependencyRequest[] {
  const requests: DependencyRequest[] = [];
  const regular = manifest.dependencies ?? {};
  const optional = manifest.optionalDependencies ?? {};
  for (const [name, version] of Object.entries(regular)) {
    if (!optional[name]) requests.push({ name, version, isDirect: true });
  }
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
    if (!regular[name] && !optional[name])
      requests.push({ name, version, isDirect: true, isDev: true });
  }
  for (const [name, version] of Object.entries(optional))
    requests.push({ name, version, isDirect: true, isOptional: true });
  return requests;
}

export function parseLockfile(content: string): PackageLock {
  const lock = JSON.parse(content) as PackageLock;
  if (lock.lockfileVersion !== 3 || !lock.packages || !lock.packages['']) {
    throw new Error('package-lock.json must contain a version 3 packages tree');
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (
      !/^(?:node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')
    ) {
      throw new Error(`Invalid package-lock.json package path '${path}'`);
    }
    if (!entry.version || !entry.resolved)
      throw new Error(`Incomplete package-lock.json entry '${path}'`);
  }
  return lock;
}

function infoFromEntry(path: string, entry: LockedPackage): PackageInfo {
  if (!entry.version || !entry.resolved)
    throw new Error(`Incomplete package-lock.json entry '${path}'`);
  return {
    name: entry.name ?? packageNameFromPath(path),
    version: entry.version,
    tarball: entry.resolved,
    integrity: entry.integrity,
    dependencies: entry.dependencies,
    optionalDependencies: entry.optionalDependencies,
    peerDependencies: entry.peerDependencies,
    peerDependenciesMeta: entry.peerDependenciesMeta,
    bin: entry.bin,
    os: entry.os,
    cpu: entry.cpu,
  };
}

function sameDependencies(
  left: Record<string, string> = {},
  right: Record<string, string> = {}
): boolean {
  const names = Object.keys(left);
  return (
    names.length === Object.keys(right).length && names.every(name => left[name] === right[name])
  );
}

export function replayLockedTree(
  lock: PackageLock,
  manifest: RootManifest
): PlacedDependency[] | undefined {
  const root = lock.packages[''];
  if (
    !sameDependencies(root.dependencies, manifest.dependencies) ||
    !sameDependencies(root.devDependencies, manifest.devDependencies) ||
    !sameDependencies(root.optionalDependencies, manifest.optionalDependencies)
  )
    return undefined;
  const placements = new Map<string, PlacedDependency>();
  const failed = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const packageInfo = infoFromEntry(path, entry);
    placements.set(path, {
      path,
      packageInfo,
      installName: packageNameFromPath(path),
      children: {},
      isDirect: false,
      isOptional: true,
      isDev: true,
      isDevOptional: true,
    });
    if (!supportsRuntimePlatform(packageInfo)) failed.add(path);
  }
  for (const placed of placements.values()) {
    const dependencies = {
      ...placed.packageInfo.dependencies,
      ...placed.packageInfo.optionalDependencies,
    };
    for (const [name, version] of Object.entries(dependencies)) {
      const spec = parseDependencySpec(name, version);
      const path = moduleLocations(placed.path, name).find(candidate => placements.has(candidate));
      const child = placements.get(path ?? '');
      if (
        !child ||
        child.packageInfo.name !== spec.name ||
        !matchesLockedVersion(child.packageInfo.version, spec.version)
      ) {
        if (placed.packageInfo.optionalDependencies?.[name]) continue;
        return undefined;
      }
      placed.children[name] = child.path;
    }
    for (const [name, spec] of Object.entries(placed.packageInfo.peerDependencies ?? {})) {
      const optional = placed.packageInfo.peerDependenciesMeta?.[name]?.optional === true;
      const locations = moduleLocations(placed.path, name).slice(1);
      const path = locations.find(candidate => placements.has(candidate));
      const peer = placements.get(path ?? '');
      if (!peer) {
        if (optional) continue;
        return undefined;
      }
      const expected = parseDependencySpec(name, spec);
      if (
        peer.packageInfo.name !== expected.name ||
        !satisfiesVersionSpec(peer.packageInfo.version, spec)
      )
        return undefined;
      placed.children[name] = peer.path;
    }
  }
  const roots = rootDependencyRequests(manifest).map(request => ({
    path: `node_modules/${request.name}`,
    request,
  }));
  for (const { path, request } of roots) {
    const placed = placements.get(path);
    const spec = parseDependencySpec(request.name, request.version);
    if (
      !placed ||
      placed.packageInfo.name !== spec.name ||
      !matchesLockedVersion(placed.packageInfo.version, spec.version)
    ) {
      if (request.isOptional) continue;
      return undefined;
    }
  }
  markDependencyFlags(placements, roots);
  for (const path of failed) {
    const placed = placements.get(path);
    if (placed && !placed.isOptional)
      throw new Error(
        `Package '${placed.packageInfo.name}@${placed.packageInfo.version}' is incompatible with browser/x64`
      );
  }
  const plan = Array.from(placements.values());
  const skipped = pruneFailedOptionalPackages(plan, failed);
  return plan.filter(placed => !skipped.has(placed.path));
}

export function findLockedPackage(
  lock: PackageLock | undefined,
  name: string,
  version: string
): PackageInfo | undefined {
  if (!lock) return undefined;
  const spec = parseDependencySpec(name, version);
  if (!isVersionRange(spec.version)) return undefined;
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || packageNameFromPath(path) !== name) continue;
    const info = infoFromEntry(path, entry);
    if (info.name === spec.name && satisfiesVersionSpec(info.version, spec.version)) return info;
  }
  return undefined;
}

export function createLockfile(manifest: RootManifest, plan: PlacedDependency[]): PackageLock {
  const root: LockedPackage = {};
  if (manifest.name) root.name = manifest.name;
  if (manifest.version) root.version = manifest.version;
  if (manifest.dependencies) root.dependencies = manifest.dependencies;
  if (manifest.devDependencies) root.devDependencies = manifest.devDependencies;
  if (manifest.optionalDependencies) root.optionalDependencies = manifest.optionalDependencies;
  const packages: Record<string, LockedPackage> = { '': root };
  for (const placed of plan.slice().sort((left, right) => left.path.localeCompare(right.path))) {
    const info = placed.packageInfo;
    const entry: LockedPackage = { version: info.version, resolved: info.tarball };
    if (info.name !== packageNameFromPath(placed.path)) entry.name = info.name;
    if (info.integrity) entry.integrity = info.integrity;
    if (info.dependencies) entry.dependencies = info.dependencies;
    if (info.optionalDependencies) entry.optionalDependencies = info.optionalDependencies;
    if (info.peerDependencies) entry.peerDependencies = info.peerDependencies;
    if (info.peerDependenciesMeta) entry.peerDependenciesMeta = info.peerDependenciesMeta;
    if (info.bin) entry.bin = info.bin;
    if (info.os) entry.os = info.os;
    if (info.cpu) entry.cpu = info.cpu;
    if (placed.isOptional) entry.optional = true;
    if (placed.isDev) entry.dev = true;
    if (!placed.isDev && !placed.isOptional && placed.isDevOptional) entry.devOptional = true;
    packages[placed.path] = entry;
  }
  return {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}
