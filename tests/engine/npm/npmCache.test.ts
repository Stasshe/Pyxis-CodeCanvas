import { Buffer } from 'node:buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import type { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { setupTestProject } from '../../_helpers/testProject';

const tarballUrl = 'https://registry.npmjs.org/cache-fixture/-/cache-fixture-1.0.0.tgz';

afterEach(() => vi.unstubAllGlobals());

async function packageTarball(name: string): Promise<Uint8Array> {
  const tar = await new Promise<Uint8Array>((resolve, reject) => {
    const archive = tarStream.pack();
    const chunks: Uint8Array[] = [];
    archive.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => {
      const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    });
    const manifest = Buffer.from(JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    archive.entry(
      { name: 'package/package.json', type: 'file', size: manifest.byteLength },
      manifest
    );
    const source = Buffer.from('module.exports = "cached package";');
    archive.entry({ name: 'package/index.js', type: 'file', size: source.byteLength }, source);
    archive.finalize();
  });
  return pako.gzip(tar).slice();
}

function registryMetadata(name: string, url: string): Response {
  return new Response(
    JSON.stringify({
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: url }, dependencies: {} } },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

async function cachePath(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${HOME_DIR}/.npm/${key}.tgz`;
}

async function install(repo: FsCore, rootPath: string, name: string): Promise<void> {
  const installer = new NpmInstall(rootPath, repo);
  installer.startBatchProcessing();
  try {
    await installer.installWithDependencies(name, 'latest');
  } finally {
    await installer.finishBatchProcessing();
  }
}

describe('npm tarball cache', () => {
  it.each([
    { name: 'native decompression', usePako: false },
    { name: 'pako fallback', usePako: true },
  ])(
    'reuses exact tarball bytes across workspaces while fetching current metadata ($name)',
    async ({ usePako }) => {
      if (usePako) vi.stubGlobal('DecompressionStream', undefined);
      const { repo, rootPath } = await setupTestProject('NpmCacheFirst');
      await repo.rm(NPM_CACHE_PATH, { recursive: true });
      const secondRoot = '/tmp/NpmCacheSecond';
      await repo.mkdir(secondRoot, { recursive: true });
      const tarball = await packageTarball('cache-fixture');
      const requests: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          requests.push(url);
          if (url === 'https://registry.npmjs.org/cache-fixture') {
            return registryMetadata('cache-fixture', tarballUrl);
          }
          if (url === tarballUrl) return new Response(tarball.slice().buffer);
          return new Response('unexpected URL', { status: 404 });
        })
      );

      await install(repo, rootPath, 'cache-fixture');
      await install(repo, secondRoot, 'cache-fixture');

      expect(
        requests.filter(url => url === 'https://registry.npmjs.org/cache-fixture')
      ).toHaveLength(2);
      expect(requests.filter(url => url === tarballUrl)).toHaveLength(1);
      expect((await repo.stat(NPM_CACHE_PATH)).type).toBe('folder');
      expect(await repo.readFile(await cachePath(tarballUrl))).toEqual(tarball);
      expect(await repo.readText(`${secondRoot}/node_modules/cache-fixture/index.js`)).toContain(
        'cached package'
      );
    }
  );

  it('uses separate cache keys for distinct scoped tarball URLs', async () => {
    const { repo, rootPath } = await setupTestProject('NpmScopedCache');
    const packages = [
      {
        name: '@scope/one',
        registryUrl: 'https://registry.npmjs.org/@scope/one',
        tarballUrl: 'https://registry.npmjs.org/@scope/one/-/one-1.0.0.tgz',
      },
      {
        name: '@scope/two',
        registryUrl: 'https://registry.npmjs.org/@scope/two',
        tarballUrl: 'https://registry.npmjs.org/@scope/two/-/two-1.0.0.tgz',
      },
    ];
    const metadataByUrl = new Map(
      packages.map(pkg => [pkg.registryUrl, registryMetadata(pkg.name, pkg.tarballUrl)])
    );
    const tarballByUrl = new Map(
      await Promise.all(packages.map(async pkg => [pkg.tarballUrl, await packageTarball(pkg.name)]))
    );
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        const metadata = metadataByUrl.get(url);
        if (metadata) return metadata;
        const tarball = tarballByUrl.get(url);
        if (tarball) return new Response(tarball.slice().buffer);
        return new Response('unexpected URL', { status: 404 });
      })
    );

    await install(repo, rootPath, '@scope/one');
    await install(repo, rootPath, '@scope/two');

    const [firstPath, secondPath] = await Promise.all(
      packages.map(pkg => cachePath(pkg.tarballUrl))
    );
    expect(firstPath).not.toBe(secondPath);
    expect(await repo.exists(firstPath)).toBe(true);
    expect(await repo.exists(secondPath)).toBe(true);
    expect(requests.filter(url => packages.some(pkg => pkg.tarballUrl === url))).toHaveLength(2);
  });

  it('does not persist an invalid downloaded archive and evicts a corrupt cached archive', async () => {
    const { repo, rootPath } = await setupTestProject('NpmInvalidCache');
    const path = await cachePath(tarballUrl);
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://registry.npmjs.org/cache-fixture') {
          return registryMetadata('cache-fixture', tarballUrl);
        }
        return new Response(new Uint8Array([1, 2, 3]).buffer);
      })
    );

    await expect(install(repo, rootPath, 'cache-fixture')).rejects.toThrow('Failed to extract');
    expect(await repo.exists(path)).toBe(false);

    await repo.mkdir(`${HOME_DIR}/.npm`, { recursive: true });
    await repo.mkdir(`${rootPath}/node_modules/cache-fixture`, { recursive: true });
    await repo.writeFile(
      `${rootPath}/node_modules/cache-fixture/keep.txt`,
      'preserve existing package files'
    );
    await repo.writeFile(path, new Uint8Array([4, 5, 6]));
    await expect(install(repo, rootPath, 'cache-fixture')).rejects.toThrow('Failed to extract');

    expect(await repo.exists(path)).toBe(false);
    expect(await repo.readText(`${rootPath}/node_modules/cache-fixture/keep.txt`)).toBe(
      'preserve existing package files'
    );
    expect(requests.filter(url => url === tarballUrl)).toHaveLength(1);
  });

  it('rejects invalid gzip data when the pako decompression fallback is used', async () => {
    const { repo, rootPath } = await setupTestProject('NpmInvalidPakoCache');
    const path = await cachePath(tarballUrl);
    vi.stubGlobal('DecompressionStream', undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://registry.npmjs.org/cache-fixture') {
          return registryMetadata('cache-fixture', tarballUrl);
        }
        return new Response(new Uint8Array([1, 2, 3]).buffer);
      })
    );

    await expect(install(repo, rootPath, 'cache-fixture')).rejects.toThrow('Failed to extract');
    expect(await repo.exists(path)).toBe(false);
  });
});
