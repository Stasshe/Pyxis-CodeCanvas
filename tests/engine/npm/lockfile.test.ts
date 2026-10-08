import { Buffer } from 'node:buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackageLock } from '@/engine/cmd/global/npmOperations/install/lockfile';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import { WorkerNpmCommands } from '@/engine/cmd/global/npmOperations/worker';
import type { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import { ModuleFileSystem } from '@/engine/runtime/module/moduleFileSystem';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import { createNpmRuntimeFixture } from '../../_helpers/npmRuntime';
import { setupTestProject } from '../../_helpers/testProject';

interface FixturePackage {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  bin?: string;
  tarball: string;
  integrity: string;
  bytes: Uint8Array<ArrayBuffer>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixturePackage(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
  bin?: string
): Promise<FixturePackage> {
  const archive = tarStream.pack();
  const chunks: Buffer[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.entry(
    { name: 'package/package.json' },
    Buffer.from(JSON.stringify({ name, version, dependencies, bin }))
  );
  archive.entry({ name: 'package/index.js' }, Buffer.from(`module.exports = '${version}';`));
  if (bin) archive.entry({ name: `package/${bin}` }, Buffer.from('console.log("fixture bin");'));
  archive.finalize();
  await finished;
  const bytes = pako.gzip(Buffer.concat(chunks)).slice();
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  return {
    name,
    version,
    dependencies,
    bin,
    tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
    integrity: `sha512-${Buffer.from(digest).toString('base64')}`,
    bytes,
  };
}

async function setup() {
  const { repo, rootPath } = await setupTestProject('NpmLockfile');
  const fixtures = await Promise.all([
    fixturePackage('fixture-parent', '1.0.0', { 'fixture-shared': '1.0.0' }, 'cli.js'),
    fixturePackage('fixture-shared', '1.0.0', {}, 'cli.js'),
    fixturePackage('fixture-shared', '2.0.0'),
    fixturePackage('fixture-shared', '3.0.0'),
  ]);
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const tarball = fixtures.find(pkg => pkg.tarball === url);
      if (tarball) return new Response(tarball.bytes.slice().buffer);
      const packages = fixtures.filter(pkg => `https://registry.npmjs.org/${pkg.name}` === url);
      if (packages.length === 0) return new Response('Package not found', { status: 404 });
      return new Response(
        JSON.stringify({
          name: packages[0].name,
          'dist-tags': { latest: packages.at(-1)!.version },
          versions: Object.fromEntries(
            packages.map(pkg => [
              pkg.version,
              {
                dependencies: pkg.dependencies,
                bin: pkg.bin,
                dist: { tarball: pkg.tarball, integrity: pkg.integrity },
              },
            ])
          ),
        }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } }
      );
    })
  );
  const manifest = {
    name: 'lockfile-project',
    version: '1.0.0',
    dependencies: { 'fixture-parent': '1.0.0', 'fixture-shared': '2.0.0' },
  };
  await repo.writeFile(`${rootPath}/package.json`, JSON.stringify(manifest));
  return { repo, rootPath, fixtures, requests, manifest };
}

async function lockfile(repo: FsCore, rootPath: string): Promise<PackageLock> {
  return JSON.parse(await repo.readText(`${rootPath}/package-lock.json`)) as PackageLock;
}

describe('npm package-lock installation', () => {
  it('locks conflicting versions at the paths where Node resolves them', async () => {
    const { repo, rootPath, fixtures } = await setup();
    await new WorkerNpmCommands(repo, rootPath).install();
    const lock = await lockfile(repo, rootPath);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[''].dependencies).toEqual({
      'fixture-parent': '1.0.0',
      'fixture-shared': '2.0.0',
    });
    expect(lock.packages['node_modules/fixture-shared'].version).toBe('2.0.0');
    const nested = 'node_modules/fixture-parent/node_modules/fixture-shared';
    expect(lock.packages[nested].version).toBe('1.0.0');
    expect(lock.packages[nested].integrity).toBe(fixtures[1].integrity);
    expect(lock.packages[nested].resolved).toBe(fixtures[1].tarball);
    expect(await repo.readText(`${rootPath}/${nested}/index.js`)).toContain("'1.0.0'");
    expect(await repo.readText(`${rootPath}/node_modules/fixture-shared/index.js`)).toContain(
      "'2.0.0'"
    );
  });

  it('rebuilds the locked tree and executable shims using only cached tarballs', async () => {
    const { repo, rootPath } = await setup();
    await new WorkerNpmCommands(repo, rootPath).install();
    const original = await lockfile(repo, rootPath);
    await repo.rm(`${rootPath}/node_modules`, { recursive: true });
    const network = vi.fn(async () => {
      throw new Error('Lockfile replay must not fetch registry metadata or tarballs');
    });
    vi.stubGlobal('fetch', network);

    await new WorkerNpmCommands(repo, rootPath).install();

    expect(network).not.toHaveBeenCalled();
    expect(await lockfile(repo, rootPath)).toEqual(original);
    expect(
      await repo.readText(
        `${rootPath}/node_modules/fixture-parent/node_modules/fixture-shared/index.js`
      )
    ).toContain("'1.0.0'");
    expect(await repo.readText(`${rootPath}/node_modules/.bin/fixture-parent`)).toContain(
      '../fixture-parent/cli.js'
    );
    expect(
      await repo.readText(
        `${rootPath}/node_modules/fixture-parent/node_modules/.bin/fixture-shared`
      )
    ).toContain('../fixture-shared/cli.js');
  });

  it('updates the lock and tree when a root dependency changes', async () => {
    const { repo, rootPath, manifest, fixtures, requests } = await setup();
    await new WorkerNpmCommands(repo, rootPath).install();
    manifest.dependencies['fixture-shared'] = '3.0.0';
    await repo.writeFile(`${rootPath}/package.json`, JSON.stringify(manifest));
    requests.length = 0;
    const resolution = vi.spyOn(NpmInstall.prototype, 'resolvePackageInfo');

    await new WorkerNpmCommands(repo, rootPath).install();

    const lock = await lockfile(repo, rootPath);
    expect(lock.packages[''].dependencies?.['fixture-shared']).toBe('3.0.0');
    expect(lock.packages['node_modules/fixture-shared'].version).toBe('3.0.0');
    expect(lock.packages['node_modules/fixture-parent/node_modules/fixture-shared'].version).toBe(
      '1.0.0'
    );
    expect(requests).toContain(fixtures[3].tarball);
    expect(resolution.mock.calls).toEqual([['fixture-shared', '3.0.0']]);
    expect(await repo.readText(`${rootPath}/node_modules/fixture-shared/index.js`)).toContain(
      "'3.0.0'"
    );
  });

  it('preserves an imported native lock including foreign optional entries and metadata', async () => {
    const { repo, rootPath, manifest } = await setup();
    await new WorkerNpmCommands(repo, rootPath).install();
    const imported = await lockfile(repo, rootPath);
    const optionalDependencies = { 'fixture-linux': '1.0.0' };
    imported.packages[''].optionalDependencies = optionalDependencies;
    imported.packages['node_modules/fixture-parent'].optionalDependencies = optionalDependencies;
    imported.packages['node_modules/fixture-linux'] = {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/fixture-linux/-/fixture-linux-1.0.0.tgz',
      optional: true,
      os: ['linux'],
    };
    const rawLock = `${JSON.stringify({ ...imported, license: 'ISC' }, null, 4)}\n`;
    await repo.writeFile(`${rootPath}/package-lock.json`, rawLock);
    await repo.writeFile(
      `${rootPath}/package.json`,
      JSON.stringify({ ...manifest, optionalDependencies })
    );
    await repo.rm(`${rootPath}/node_modules`, { recursive: true });
    await repo.rm(`${NPM_CACHE_PATH}/registry`, { recursive: true });
    const network = vi.fn(async () => {
      throw new Error('Imported lock must replay without registry metadata');
    });
    vi.stubGlobal('fetch', network);

    await new WorkerNpmCommands(repo, rootPath).install();

    expect(network).not.toHaveBeenCalled();
    expect(await repo.readText(`${rootPath}/package-lock.json`)).toBe(rawLock);
    expect(await repo.exists(`${rootPath}/node_modules/fixture-linux`)).toBe(false);
    expect(
      await repo.readText(
        `${rootPath}/node_modules/fixture-parent/node_modules/fixture-shared/index.js`
      )
    ).toContain("'1.0.0'");
  });

  it('installs named cowsay with each requester resolving its required string-width major', async () => {
    const { repo, rootPath } = await setupTestProject('CowsayLockfile');
    await repo.writeFile(
      `${rootPath}/package.json`,
      JSON.stringify({ name: 'cowsay-project', version: '1.0.0', dependencies: {} })
    );

    await new WorkerNpmCommands(repo, rootPath).install('cowsay', ['--version=1.6.0']);

    const fixture = await createNpmRuntimeFixture(repo, rootPath);
    try {
      const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(fixture.bridge));
      const cowsayWidth = await resolver.resolve(
        'string-width/package.json',
        `${rootPath}/node_modules/cowsay/index.js`
      );
      const yargsWidth = await resolver.resolve(
        'string-width/package.json',
        `${rootPath}/node_modules/yargs/index.js`
      );
      expect(cowsayWidth).toBeDefined();
      expect(yargsWidth).toBeDefined();
      const cowsayManifest = JSON.parse(await repo.readText(cowsayWidth!.path)) as {
        version: string;
      };
      const yargsManifest = JSON.parse(await repo.readText(yargsWidth!.path)) as {
        version: string;
      };
      expect(cowsayManifest.version).toMatch(/^2\./);
      expect(yargsManifest.version).toMatch(/^4\./);
      expect(cowsayWidth!.path).not.toBe(yargsWidth!.path);
      expect(await repo.readText(`${rootPath}/node_modules/.bin/cowsay`)).toContain('require(');
    } finally {
      fixture.close();
    }
  }, 120_000);
});
