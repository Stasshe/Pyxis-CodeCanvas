import { describe, expect, it } from 'vitest';
import { resolveDependencyPlan } from '@/engine/cmd/global/npmOperations/install/dependencyResolver';
import type { PackageInfo } from '@/engine/cmd/global/npmOperations/install/types';

function packageInfo(name: string, dependencies: Record<string, string> = {}): PackageInfo {
  return {
    name,
    version: '1.0.0',
    dependencies,
    tarball: `https://example.test/${name}.tgz`,
  };
}

describe('dependency graph discovery', () => {
  it('uses all fifteen bounded metadata slots without exceeding the shared network limit', async () => {
    let active = 0;
    let peak = 0;
    let release: () => void = () => {};
    let reportStarted: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      reportStarted = resolve;
    });
    const requests = Array.from({ length: 16 }, (_, index) => ({
      name: `package-${index}`,
      version: '1.0.0',
      isDirect: true,
    }));
    const pending = resolveDependencyPlan(requests, async name => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 15) reportStarted();
      await gate;
      active -= 1;
      return packageInfo(name);
    });
    await started;
    expect(active).toBe(15);
    release();
    expect(await pending).toHaveLength(16);
    expect(peak).toBe(15);
  });

  it('resolves overlapping roots with a cycle without waiting on ancestor promises', async () => {
    const packages = new Map([
      ['a', packageInfo('a', { b: '^1.0.0' })],
      ['b', packageInfo('b', { a: '^1.0.0' })],
    ]);
    const requested: string[] = [];
    const plan = await resolveDependencyPlan(
      [
        { name: 'a', version: '^1.0.0', isDirect: true },
        { name: 'b', version: '^1.0.0', isDirect: true },
      ],
      async name => {
        requested.push(name);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        const info = packages.get(name);
        if (!info) throw new Error(`Missing fixture package ${name}`);
        return info;
      }
    );

    expect(plan.map(pkg => pkg.packageInfo.name).sort()).toEqual(['a', 'b']);
    expect(requested.sort()).toEqual(['a', 'b']);
  });

  it('resolves a shared diamond dependency once', async () => {
    const packages = new Map([
      ['root', packageInfo('root', { left: '^1.0.0', right: '^1.0.0' })],
      ['left', packageInfo('left', { shared: '^1.0.0' })],
      ['right', packageInfo('right', { shared: '^1.0.0' })],
      ['shared', packageInfo('shared')],
    ]);
    const requested: string[] = [];
    const plan = await resolveDependencyPlan(
      [{ name: 'root', version: '^1.0.0', isDirect: true }],
      async name => {
        requested.push(name);
        const info = packages.get(name);
        if (!info) throw new Error(`Missing fixture package ${name}`);
        return info;
      }
    );

    expect(plan.map(pkg => pkg.packageInfo.name)).toEqual(['root', 'left', 'right', 'shared']);
    expect(requested.filter(name => name === 'shared')).toHaveLength(1);
  });

  it('adds a required peer to the resolved graph and leaves an absent optional peer out', async () => {
    const plugin = packageInfo('plugin');
    plugin.peerDependencies = { host: '^1.0.0', telemetry: '^2.0.0' };
    plugin.peerDependenciesMeta = { telemetry: { optional: true } };
    const requested: string[] = [];
    const plan = await resolveDependencyPlan(
      [{ name: 'plugin', version: '1.0.0', isDirect: true }],
      async name => {
        requested.push(name);
        if (name === 'plugin') return plugin;
        if (name === 'host') return packageInfo('host');
        throw new Error(`Unexpected peer request ${name}`);
      }
    );

    expect(requested.sort()).toEqual(['host', 'plugin']);
    expect(plan.find(item => item.packageInfo.name === 'plugin')?.peerDependencyKeys).toEqual({
      host: 'host@host@1.0.0',
    });
  });

  it('skips failed optional dependencies while reporting the failure', async () => {
    const root = packageInfo('root');
    root.optionalDependencies = { unavailable: '^1.0.0' };
    const warnings: string[] = [];
    const plan = await resolveDependencyPlan(
      [{ name: 'root', version: '^1.0.0', isDirect: true }],
      async name => {
        if (name === 'unavailable') throw new Error('not published');
        return root;
      },
      4,
      (name, version, message) => warnings.push(`${name}@${version}: ${message}`)
    );

    expect(plan.map(pkg => pkg.packageInfo.name)).toEqual(['root']);
    expect(warnings).toEqual(['unavailable@^1.0.0: not published']);
  });

  it('uses npm platform constraints and accepts any target', async () => {
    const packages = new Map([
      ['browser-only', { ...packageInfo('browser-only'), os: ['browser'], cpu: ['any'] }],
      ['excluded', { ...packageInfo('excluded'), os: ['!linux'] }],
      ['wrong-cpu', { ...packageInfo('wrong-cpu'), cpu: ['arm64'] }],
      ['native-only', { ...packageInfo('native-only'), os: ['darwin'] }],
    ]);
    const plan = await resolveDependencyPlan(
      [
        { name: 'browser-only', version: '1', isDirect: true },
        { name: 'excluded', version: '1', isDirect: true },
      ],
      async name => packages.get(name) ?? packageInfo(name)
    );

    expect(plan.map(item => item.packageInfo.name)).toEqual(['browser-only', 'excluded']);
    const warnings: string[] = [];
    const optionalPlan = await resolveDependencyPlan(
      [{ name: 'native-only', version: '1', isDirect: false, isOptional: true }],
      async name => packages.get(name) ?? packageInfo(name),
      4,
      (name, version, message) => warnings.push(`${name}@${version}: ${message}`)
    );
    expect(optionalPlan).toEqual([]);
    expect(warnings).toEqual([
      "native-only@1: Package 'native-only@1.0.0' is incompatible with browser/x64",
    ]);
    await expect(
      resolveDependencyPlan([{ name: 'wrong-cpu', version: '1', isDirect: true }], async name => {
        const info = packages.get(name);
        if (!info) throw new Error(`Missing fixture package ${name}`);
        return info;
      })
    ).rejects.toThrow('incompatible with browser/x64');
  });

  it('deduplicates aliases that resolve to the same package version and preserves directness', async () => {
    const resolvedPackage = packageInfo('shared-name');
    const plan = await resolveDependencyPlan(
      [
        { name: 'shared-name', version: 'latest', isDirect: true },
        { name: 'shared-name', version: '^1.0.0', isDirect: false, isOptional: true },
      ],
      async () => resolvedPackage
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      packageInfo: resolvedPackage,
      installName: 'shared-name',
      dependencyKeys: {},
      peerDependencyKeys: {},
      requestKeys: ['latest', '^1.0.0'],
      isDirect: true,
      isOptional: false,
    });
  });

  it('settles started metadata requests before reporting a required failure', async () => {
    let slowRequestSettled = false;
    await expect(
      resolveDependencyPlan(
        [{ name: 'root', version: '1', isDirect: true }],
        async name => {
          if (name === 'root') return packageInfo('root', { failure: '1', slow: '1' });
          if (name === 'failure') throw new Error('required metadata failed');
          await new Promise<void>(resolve => setTimeout(resolve, 10));
          slowRequestSettled = true;
          return packageInfo('slow');
        },
        2
      )
    ).rejects.toThrow('required metadata failed');
    expect(slowRequestSettled).toBe(true);
  });

  it('omits an optional package when its required child cannot resolve', async () => {
    const packages = new Map([
      ['root', packageInfo('root')],
      ['optional-parent', packageInfo('optional-parent', { missing: '1' })],
      ['reachable-only-through-parent', packageInfo('reachable-only-through-parent')],
    ]);
    const root = packages.get('root');
    if (!root) throw new Error('Missing root fixture');
    root.optionalDependencies = { 'optional-parent': '1' };
    const parent = packages.get('optional-parent');
    if (!parent) throw new Error('Missing optional parent fixture');
    parent.dependencies = { 'reachable-only-through-parent': '1', missing: '1' };
    const plan = await resolveDependencyPlan(
      [{ name: 'root', version: '1', isDirect: true }],
      async name => {
        const info = packages.get(name);
        if (!info) throw new Error(`Missing fixture package ${name}`);
        return info;
      },
      3
    );

    expect(plan.map(item => item.packageInfo.name)).toEqual(['root']);
  });

  it('promotes an optional branch and its required children when a required path arrives later', async () => {
    const packages = new Map([
      ['root', packageInfo('root', { 'required-parent': '1' })],
      ['required-parent', packageInfo('required-parent', { 'optional-parent': '1' })],
      ['optional-parent', packageInfo('optional-parent', { unavailable: '1' })],
    ]);
    const root = packages.get('root');
    if (!root) throw new Error('Missing root fixture');
    root.optionalDependencies = { 'optional-parent': '1' };
    const requested: string[] = [];

    await expect(
      resolveDependencyPlan(
        [{ name: 'root', version: '1', isDirect: true }],
        async name => {
          requested.push(name);
          const info = packages.get(name);
          if (info) return info;
          await new Promise<void>(resolve => setTimeout(resolve, 5));
          throw new Error('required child missing');
        },
        4
      )
    ).rejects.toThrow('required child missing');
    expect(requested).toContain('unavailable');
  });
});
