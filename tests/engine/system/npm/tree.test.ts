import { describe, expect, it } from 'vitest';
import {
  type DependencyRequest,
  resolveDependencyPlan,
} from '@/engine/system/npm/install/dependencyResolver';
import {
  createLockfile,
  findLockedPackage,
  replayLockedTree,
} from '@/engine/system/npm/install/lockfile';
import {
  buildDependencyTree,
  moduleLocations,
  type PlacedDependency,
  parseDependencySpec,
  pruneFailedOptionalPackages,
} from '@/engine/system/npm/install/tree';
import type { PackageInfo } from '@/engine/system/npm/install/types';
import { satisfiesVersionSpec } from '@/engine/system/npm/install/versionSpec';

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
    const found = fixtures.find(
      pkg => pkg.name === spec.name && satisfiesVersionSpec(pkg.version, spec.version)
    );
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

  it('places required peers beside their dependent and reuses a compatible root host', async () => {
    const plugin = info('plugin', '1.0.0');
    plugin.peerDependencies = { host: '^1.0.0' };
    const plan = await tree(
      [plugin, info('host', '1.0.0')],
      [
        { name: 'plugin', version: '1.0.0', isDirect: true },
        { name: 'host', version: '1.0.0', isDirect: true },
      ]
    );
    expect(plan.map(placed => placed.path)).toEqual(['node_modules/plugin', 'node_modules/host']);
    expect(plan.find(placed => placed.packageInfo.name === 'plugin')?.children.host).toBe(
      'node_modules/host'
    );
  });

  it('places a nested peer as a sibling and rejects a visible incompatible root host', async () => {
    const plugin = info('plugin', '1.0.0');
    plugin.peerDependencies = { host: '^1.0.0' };
    const nested = await tree(
      [
        info('app', '1.0.0', { plugin: '1.0.0' }),
        plugin,
        info('plugin', '2.0.0'),
        info('host', '1.0.0'),
      ],
      [
        { name: 'app', version: '1.0.0', isDirect: true },
        { name: 'plugin', version: '2.0.0', isDirect: true },
      ]
    );
    expect(
      nested.find(
        placed => placed.packageInfo.name === 'plugin' && placed.packageInfo.version === '1.0.0'
      )?.children.host
    ).toBe('node_modules/app/node_modules/host');

    const nestedConflict = await tree(
      [
        info('app', '1.0.0', { plugin: '1.0.0' }),
        plugin,
        info('plugin', '2.0.0'),
        info('host', '1.0.0'),
        info('host', '2.0.0'),
      ],
      [
        { name: 'app', version: '1.0.0', isDirect: true },
        { name: 'plugin', version: '2.0.0', isDirect: true },
        { name: 'host', version: '2.0.0', isDirect: true },
      ]
    );
    expect(
      nestedConflict.find(
        placed => placed.packageInfo.name === 'plugin' && placed.packageInfo.version === '1.0.0'
      )?.children.host
    ).toBe('node_modules/app/node_modules/host');

    await expect(
      tree(
        [plugin, info('host', '1.0.0'), info('host', '2.0.0')],
        [
          { name: 'plugin', version: '1.0.0', isDirect: true },
          { name: 'host', version: '2.0.0', isDirect: true },
        ]
      )
    ).rejects.toThrow('ERESOLVE');
  });

  it('does not install an absent optional peer and rejects an incompatible present one', async () => {
    const plugin = info('plugin', '1.0.0');
    plugin.peerDependencies = { host: '^1.0.0' };
    plugin.peerDependenciesMeta = { host: { optional: true } };
    const absent = await tree([plugin], [{ name: 'plugin', version: '1.0.0', isDirect: true }]);
    expect(absent.map(placed => placed.packageInfo.name)).toEqual(['plugin']);

    await expect(
      tree(
        [plugin, info('host', '2.0.0')],
        [
          { name: 'plugin', version: '1.0.0', isDirect: true },
          { name: 'host', version: '2.0.0', isDirect: true },
        ]
      )
    ).rejects.toThrow('ERESOLVE');
  });

  it('keeps optional peer roots optional and promotes hosts of required peers', async () => {
    const optionalPeer = info('optional-peer', '1.0.0');
    optionalPeer.peerDependencies = { host: '^1.0.0' };
    optionalPeer.peerDependenciesMeta = { host: { optional: true } };
    const optionalPlan = await tree(
      [optionalPeer, info('host', '1.0.0')],
      [
        { name: 'optional-peer', version: '1.0.0', isDirect: true },
        { name: 'host', version: '1.0.0', isDirect: true, isOptional: true },
      ]
    );
    expect(optionalPlan.find(placed => placed.packageInfo.name === 'host')?.isOptional).toBe(true);

    const requiredPeer = info('required-peer', '1.0.0');
    requiredPeer.peerDependencies = { host: '^1.0.0' };
    const requiredPlan = await tree(
      [requiredPeer, info('host', '1.0.0')],
      [
        { name: 'required-peer', version: '1.0.0', isDirect: true },
        { name: 'host', version: '1.0.0', isDirect: true, isOptional: true },
      ]
    );
    expect(requiredPlan.find(placed => placed.packageInfo.name === 'host')?.isOptional).toBe(false);
  });

  it('replays dist-tags only while the root manifest still anchors the exact request', async () => {
    const packageInfo = info('tagged', '1.2.0');
    const requests = [{ name: 'tagged', version: 'beta', isDirect: true }];
    const graph = await resolveDependencyPlan(requests, async () => packageInfo);
    const plan = buildDependencyTree(graph, requests);
    const manifest = { dependencies: { tagged: 'beta' } };
    const lock = createLockfile(manifest, plan);

    expect(replayLockedTree(lock, manifest)).toHaveLength(1);
    expect(replayLockedTree(lock, { dependencies: { tagged: 'latest' } })).toBeUndefined();
    expect(findLockedPackage(lock, 'tagged', 'beta')).toBeUndefined();
  });

  it('replays required and optional peer constraints from the locked placement', async () => {
    const plugin = info('plugin', '1.0.0');
    plugin.peerDependencies = { host: '^1.0.0' };
    const manifest = { dependencies: { plugin: '1.0.0' } };
    const plan = await tree(
      [plugin, info('host', '1.0.0')],
      [{ name: 'plugin', version: '1.0.0', isDirect: true }]
    );
    const lock = createLockfile(manifest, plan);
    const replayed = replayLockedTree(lock, manifest);
    expect(replayed?.find(placed => placed.packageInfo.name === 'plugin')?.children.host).toBe(
      plan.find(placed => placed.packageInfo.name === 'plugin')?.children.host
    );

    const missingRequiredPeer = createLockfile(manifest, plan);
    delete missingRequiredPeer.packages['node_modules/host'];
    expect(replayLockedTree(missingRequiredPeer, manifest)).toBeUndefined();

    const optionalPlugin = info('optional-plugin', '1.0.0');
    optionalPlugin.peerDependencies = { host: '^1.0.0' };
    optionalPlugin.peerDependenciesMeta = { host: { optional: true } };
    const optionalManifest = { dependencies: { 'optional-plugin': '1.0.0' } };
    const optionalPlan = await tree(
      [optionalPlugin],
      [{ name: 'optional-plugin', version: '1.0.0', isDirect: true }]
    );
    const optionalLock = createLockfile(optionalManifest, optionalPlan);
    expect(replayLockedTree(optionalLock, optionalManifest)).toHaveLength(1);

    const incompatibleHost = info('host', '2.0.0');
    const inconsistentPlan: PlacedDependency[] = [
      {
        packageInfo: optionalPlugin,
        path: 'node_modules/optional-plugin',
        children: {},
        isDirect: true,
        isOptional: false,
        isDev: false,
      },
      {
        packageInfo: incompatibleHost,
        path: 'node_modules/host',
        children: {},
        isDirect: true,
        isOptional: false,
        isDev: false,
      },
    ];
    const inconsistentManifest = {
      dependencies: { 'optional-plugin': '1.0.0', host: '2.0.0' },
    };
    const inconsistentLock = createLockfile(inconsistentManifest, inconsistentPlan);
    expect(replayLockedTree(inconsistentLock, inconsistentManifest)).toBeUndefined();
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
