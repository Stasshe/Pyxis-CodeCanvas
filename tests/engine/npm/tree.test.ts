import { describe, expect, it } from 'vitest';
import {
  type DependencyRequest,
  resolveDependencyPlan,
} from '@/engine/cmd/global/npmOperations/install/dependencyResolver';
import { createLockfile } from '@/engine/cmd/global/npmOperations/install/lockfile';
import {
  buildDependencyTree,
  moduleLocations,
  parseDependencySpec,
  pruneFailedOptionalPackages,
} from '@/engine/cmd/global/npmOperations/install/tree';
import type { PackageInfo } from '@/engine/cmd/global/npmOperations/install/types';

function info(
  name: string,
  version: string,
  dependencies: Record<string, string> = {}
): PackageInfo {
  return { name, version, dependencies, tarball: `https://example.test/${name}-${version}.tgz` };
}

async function tree(fixtures: PackageInfo[], requests: DependencyRequest[]) {
  const graph = await resolveDependencyPlan(requests, async (name, version) => {
    const spec = parseDependencySpec(name, version);
    const found = fixtures.find(pkg => pkg.name === spec.name && pkg.version === spec.version);
    if (!found) throw new Error(`Missing fixture ${name}@${version}`);
    return found;
  });
  return buildDependencyTree(graph, requests);
}

describe('node_modules dependency placement', () => {
  it('keeps root versions fixed and resolves a conflicting dependency at the nearest nested path', async () => {
    const plan = await tree(
      [
        info('parent', '1.0.0', { shared: '1.0.0' }),
        info('shared', '1.0.0'),
        info('shared', '2.0.0'),
      ],
      [
        { name: 'parent', version: '1.0.0', isDirect: true },
        { name: 'shared', version: '2.0.0', isDirect: true },
      ]
    );
    expect(plan.map(placed => placed.path)).toEqual([
      'node_modules/parent',
      'node_modules/shared',
      'node_modules/parent/node_modules/shared',
    ]);
    expect(plan[0].children.shared).toBe('node_modules/parent/node_modules/shared');
    expect(plan[1].packageInfo.version).toBe('2.0.0');
  });

  it('hoists shared dependencies and closes cyclic dependencies through visible packages', async () => {
    const plan = await tree(
      [
        info('a', '1.0.0', { b: '1.0.0', shared: '1.0.0' }),
        info('b', '1.0.0', { a: '1.0.0', shared: '1.0.0' }),
        info('shared', '1.0.0'),
      ],
      [{ name: 'a', version: '1.0.0', isDirect: true }]
    );
    expect(plan).toHaveLength(3);
    expect(plan.find(placed => placed.packageInfo.name === 'b')?.children.a).toBe('node_modules/a');
    expect(plan.find(placed => placed.packageInfo.name === 'b')?.children.shared).toBe(
      'node_modules/shared'
    );
  });

  it('keeps npm alias directory names and propagates production reachability through development roots', async () => {
    const optional = info('optional', '1.0.0');
    const dev = info('dev', '1.0.0', { shared: '1.0.0' });
    dev.optionalDependencies = { optional: '1.0.0' };
    const plan = await tree(
      [info('actual', '1.0.0', { shared: '1.0.0' }), dev, info('shared', '1.0.0'), optional],
      [
        { name: 'alias', version: 'npm:actual@1.0.0', isDirect: true },
        { name: 'dev', version: '1.0.0', isDirect: true, isDev: true },
      ]
    );
    expect(plan.find(placed => placed.path === 'node_modules/alias')?.packageInfo.name).toBe(
      'actual'
    );
    expect(plan.find(placed => placed.path === 'node_modules/shared')?.isDev).toBe(false);
    expect(plan.find(placed => placed.path === 'node_modules/dev')?.isDev).toBe(true);
    expect(plan.find(placed => placed.path === 'node_modules/optional')).toMatchObject({
      isDev: true,
      isOptional: true,
    });
  });

  it('keeps every dependency edge visible after placing conflicting nested branches', async () => {
    const plan = await tree(
      [
        info('root', '1.0.0', { branch: '1.0.0', other: '1.0.0', shared: '1.0.0' }),
        info('branch', '1.0.0', { shared: '2.0.0', child: '1.0.0' }),
        info('other', '1.0.0', { child: '2.0.0', shared: '1.0.0' }),
        info('child', '1.0.0', { shared: '1.0.0' }),
        info('child', '2.0.0', { shared: '2.0.0' }),
        info('shared', '1.0.0'),
        info('shared', '2.0.0'),
      ],
      [{ name: 'root', version: '1.0.0', isDirect: true }]
    );
    const byPath = new Map(plan.map(placed => [placed.path, placed]));
    for (const parent of plan) {
      for (const [name, path] of Object.entries(parent.children)) {
        expect(moduleLocations(parent.path, name).find(candidate => byPath.has(candidate))).toBe(
          path
        );
      }
    }
  });
  it('marks a dependency shared by required development and optional production branches as devOptional', async () => {
    const production = info('production', '1.0.0');
    production.optionalDependencies = { shared: '1.0.0' };
    const plan = await tree(
      [production, info('development', '1.0.0', { shared: '1.0.0' }), info('shared', '1.0.0')],
      [
        { name: 'production', version: '1.0.0', isDirect: true },
        { name: 'development', version: '1.0.0', isDirect: true, isDev: true },
      ]
    );
    const lock = createLockfile({}, plan);
    expect(lock.packages['node_modules/shared']).toMatchObject({ devOptional: true });
    expect(lock.packages['node_modules/shared'].dev).toBeUndefined();
    expect(lock.packages['node_modules/shared'].optional).toBeUndefined();
  });
  it('prunes failed optional placements and their unreachable children without removing another version', async () => {
    const production = info('production', '1.0.0');
    production.optionalDependencies = { branch: '1.0.0' };
    const plan = await tree(
      [
        production,
        info('branch', '1.0.0', { shared: '1.0.0', leaf: '1.0.0' }),
        info('shared', '1.0.0'),
        info('shared', '2.0.0'),
        info('leaf', '1.0.0'),
      ],
      [
        { name: 'production', version: '1.0.0', isDirect: true },
        { name: 'shared', version: '2.0.0', isDirect: true },
      ]
    );
    const nested = 'node_modules/branch/node_modules/shared';
    const skipped = pruneFailedOptionalPackages(plan, new Set([nested]));
    expect(skipped).toEqual(new Set([nested, 'node_modules/branch', 'node_modules/leaf']));
    expect(skipped.has('node_modules/shared')).toBe(false);
    expect(skipped.has('node_modules/production')).toBe(false);
  });
});
