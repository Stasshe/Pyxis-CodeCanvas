import { NPM_NETWORK_CONCURRENCY } from './npmNetwork';
import type { PackageInfo } from './types';
import { satisfiesVersionSpec } from './versionUtils';

export interface DependencyRequest {
  name: string;
  version: string;
  isDirect: boolean;
  isOptional?: boolean;
  isDev?: boolean;
}

interface DependencyState extends DependencyRequest {
  key: string;
  status: 'queued' | 'running' | 'resolved' | 'failed';
  children: Set<string>;
  requiredChildren: Set<string>;
  peerChildren: Set<string>;
  packageInfo?: PackageInfo;
  errorMessage?: string;
}

export interface ResolvedDependency {
  packageInfo: PackageInfo;
  isDirect: boolean;
  isOptional: boolean;
  installName?: string;
  dependencyKeys?: Record<string, string>;
  peerDependencyKeys?: Record<string, string>;
  requestKeys?: string[];
}

export type PackageInfoResolver = (name: string, version: string) => Promise<PackageInfo>;
export type OptionalDependencyFailure = (name: string, version: string, message: string) => void;

const TARGET_OS = 'browser';
const TARGET_CPU = 'x64';

export async function resolveDependencyPlan(
  roots: DependencyRequest[],
  resolvePackageInfo: PackageInfoResolver,
  concurrency = NPM_NETWORK_CONCURRENCY,
  onOptionalFailure: OptionalDependencyFailure = () => {}
): Promise<ResolvedDependency[]> {
  if (roots.length === 0) return [];
  const states = new Map<string, DependencyState>();
  const orderedStates: DependencyState[] = [];
  const queue: DependencyState[] = [];
  const waitingWorkers: Array<() => void> = [];
  const rootKeys = new Set<string>();
  let failure: Error | undefined;
  let activeJobs = 0;
  let completed = false;

  const wakeWorkers = (): void => {
    for (const wake of waitingWorkers.splice(0)) wake();
  };

  const promoteRequired = (state: DependencyState): void => {
    if (!state.isOptional) return;
    state.isOptional = false;
    if (state.status === 'failed') {
      failure = new Error(state.errorMessage ?? 'Dependency resolution failed');
      return;
    }
    for (const childKey of state.requiredChildren) {
      const child = states.get(childKey);
      if (child) promoteRequired(child);
    }
  };

  const enqueue = (request: DependencyRequest): DependencyState => {
    const key = `${request.name}@${request.version}`;
    const existing = states.get(key);
    if (existing) {
      existing.isDirect ||= request.isDirect;
      if (request.isOptional !== true) promoteRequired(existing);
      return existing;
    }
    const state: DependencyState = {
      ...request,
      key,
      status: 'queued',
      children: new Set(),
      requiredChildren: new Set(),
      peerChildren: new Set(),
    };
    states.set(key, state);
    orderedStates.push(state);
    queue.push(state);
    wakeWorkers();
    return state;
  };

  for (const root of roots) {
    const state = enqueue(root);
    rootKeys.add(state.key);
  }

  const resolveNext = async (): Promise<void> => {
    while (!failure && !completed) {
      const state = queue.shift();
      if (!state) {
        await new Promise<void>(resolve => waitingWorkers.push(resolve));
        continue;
      }
      if (state.status !== 'queued') continue;
      activeJobs += 1;
      state.status = 'running';
      let packageInfo: PackageInfo;
      try {
        packageInfo = await resolvePackageInfo(state.name, state.version);
      } catch (error) {
        state.status = 'failed';
        state.errorMessage = String(error);
        if (error instanceof Error) state.errorMessage = error.message;
        if (state.isOptional) {
          onOptionalFailure(state.name, state.version, state.errorMessage);
        } else {
          failure = new Error(state.errorMessage);
        }
        activeJobs -= 1;
        if (queue.length === 0 && activeJobs === 0) completed = true;
        wakeWorkers();
        continue;
      }

      if (!supportsRuntimePlatform(packageInfo)) {
        const target = `${TARGET_OS}/${TARGET_CPU}`;
        state.status = 'failed';
        state.errorMessage = `Package '${state.name}@${packageInfo.version}' is incompatible with ${target}`;
        if (state.isOptional) {
          onOptionalFailure(state.name, state.version, state.errorMessage);
        } else {
          failure = new Error(state.errorMessage);
        }
        activeJobs -= 1;
        if (queue.length === 0 && activeJobs === 0) completed = true;
        wakeWorkers();
        continue;
      }

      state.packageInfo = packageInfo;
      state.status = 'resolved';
      const optionalDependencies = packageInfo.optionalDependencies ?? {};
      const requiredDependencies = packageInfo.dependencies ?? {};
      for (const [name, version] of Object.entries(requiredDependencies)) {
        if (optionalDependencies[name]) continue;
        const child = enqueue({
          name,
          version,
          isDirect: false,
          isOptional: state.isOptional === true,
        });
        state.children.add(child.key);
        state.requiredChildren.add(child.key);
      }
      for (const [name, version] of Object.entries(optionalDependencies)) {
        const child = enqueue({ name, version, isDirect: false, isOptional: true });
        state.children.add(child.key);
      }
      for (const [name, version] of Object.entries(packageInfo.peerDependencies ?? {})) {
        const optional = packageInfo.peerDependenciesMeta?.[name]?.optional === true;
        const compatible = Array.from(states.values()).find(candidate => {
          const info = candidate.packageInfo;
          return (
            candidate.name === name &&
            info !== undefined &&
            satisfiesVersionSpec(info.version, version)
          );
        });
        if (compatible) {
          if (!optional) {
            state.peerChildren.add(compatible.key);
            state.requiredChildren.add(compatible.key);
            if (!state.isOptional) promoteRequired(compatible);
          }
          continue;
        }
        if (optional) continue;
        const child = enqueue({
          name,
          version,
          isDirect: false,
          isOptional: state.isOptional === true,
        });
        state.peerChildren.add(child.key);
        state.requiredChildren.add(child.key);
      }
      activeJobs -= 1;
      if (queue.length === 0 && activeJobs === 0) completed = true;
      wakeWorkers();
    }
  };

  const workerCount = Math.max(1, concurrency);
  await Promise.all(Array.from({ length: workerCount }, () => resolveNext()));
  if (failure) throw failure;

  const blocked = new Set<string>();
  const reverseRequiredEdges = new Map<string, Set<string>>();
  for (const state of orderedStates) {
    for (const childKey of state.requiredChildren) {
      let parents = reverseRequiredEdges.get(childKey);
      if (!parents) {
        parents = new Set();
        reverseRequiredEdges.set(childKey, parents);
      }
      parents.add(state.key);
    }
    if (state.status === 'failed') blocked.add(state.key);
  }
  const blockedQueue = Array.from(blocked);
  for (let index = 0; index < blockedQueue.length; index += 1) {
    const childKey = blockedQueue[index];
    const parents = reverseRequiredEdges.get(childKey);
    if (!parents) continue;
    for (const parentKey of parents) {
      const parent = states.get(parentKey);
      if (!parent || !parent.isOptional || blocked.has(parentKey)) continue;
      blocked.add(parentKey);
      blockedQueue.push(parentKey);
    }
  }

  const reachable = new Set<string>();
  const reachQueue = Array.from(rootKeys);
  for (let index = 0; index < reachQueue.length; index += 1) {
    const key = reachQueue[index];
    const state = states.get(key);
    if (!state || state.status !== 'resolved' || blocked.has(key) || reachable.has(key)) continue;
    reachable.add(key);
    for (const childKey of state.children) reachQueue.push(childKey);
    for (const childKey of state.peerChildren) reachQueue.push(childKey);
  }

  const packagesByVersion = new Map<string, ResolvedDependency>();
  for (const state of orderedStates) {
    if (!state.packageInfo || !reachable.has(state.key)) continue;
    const key = `${state.name}@${state.packageInfo.name}@${state.packageInfo.version}`;
    const resolved = packagesByVersion.get(key);
    if (resolved) {
      resolved.isDirect ||= state.isDirect;
      resolved.isOptional &&= state.isOptional === true;
      const requestKeys = resolved.requestKeys ?? [];
      if (!requestKeys.includes(state.version)) requestKeys.push(state.version);
      resolved.requestKeys = requestKeys;
      continue;
    }
    const dependencyKeys: Record<string, string> = {};
    const peerDependencyKeys: Record<string, string> = {};
    for (const childKey of state.children) {
      const child = states.get(childKey);
      if (child?.packageInfo && reachable.has(childKey)) {
        dependencyKeys[child.name] =
          `${child.name}@${child.packageInfo.name}@${child.packageInfo.version}`;
      }
    }
    for (const childKey of state.peerChildren) {
      const child = states.get(childKey);
      if (child?.packageInfo && reachable.has(childKey)) {
        peerDependencyKeys[child.name] =
          `${child.name}@${child.packageInfo.name}@${child.packageInfo.version}`;
      }
    }
    packagesByVersion.set(key, {
      packageInfo: state.packageInfo,
      installName: state.name,
      dependencyKeys,
      peerDependencyKeys,
      requestKeys: [state.version],
      isDirect: state.isDirect,
      isOptional: state.isOptional === true,
    });
  }
  return Array.from(packagesByVersion.values());
}

export function supportsRuntimePlatform(packageInfo: PackageInfo): boolean {
  return matchesPlatform(packageInfo.os, TARGET_OS) && matchesPlatform(packageInfo.cpu, TARGET_CPU);
}

function matchesPlatform(constraints: string[] | undefined, target: string): boolean {
  if (!constraints || constraints.length === 0) return true;
  let hasPositiveConstraint = false;
  let positiveMatch = false;
  for (const constraint of constraints) {
    if (constraint === 'any') {
      hasPositiveConstraint = true;
      positiveMatch = true;
      continue;
    }
    if (constraint.startsWith('!')) {
      const excluded = constraint.slice(1);
      if (excluded === 'any' || excluded === target) return false;
      continue;
    }
    hasPositiveConstraint = true;
    if (constraint === target) positiveMatch = true;
  }
  if (!hasPositiveConstraint) return true;
  return positiveMatch;
}
