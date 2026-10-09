import { Buffer } from 'node:buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmInstall } from '@/engine/system/npm/npmInstall';
import type { FsCore } from '@/engine/core/fs/core';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import { HOME_DIR } from '@/engine/core/paths';
import { setupTestProject } from '@tests/_helpers/testProject';

const tarballUrl = 'https://registry.npmjs.org/cache-fixture/-/cache-fixture-1.0.0.tgz';

afterEach(() => vi.unstubAllGlobals());

async function packageTarball(
  name: string,
  nestedEntries = false
): Promise<Uint8Array<ArrayBuffer>> {
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
    if (nestedEntries) {
      archive.entry({ name: 'package/deep/child/value.txt' }, Buffer.from('first'));
      archive.entry({ name: 'package/deep', type: 'directory' });
      archive.entry({ name: 'package/deep/child', type: 'directory' });
      archive.entry({ name: 'package/deep/empty', type: 'directory' });
      archive.entry({ name: 'package/deep/child/value.txt' }, Buffer.from('last'));
    }
    archive.finalize();
  });
  return pako.gzip(tar).slice();
}

async function integrity(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', bytes);
  return `sha512-${Buffer.from(digest).toString('base64')}`;
}

function registryMetadata(name: string, url: string): Response {
  return new Response(
    JSON.stringify({
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: url }, dependencies: {} } },
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } }
  );
}

async function cachePath(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${HOME_DIR}/.npm/${key}.tgz`;
}

async function install(repo: FsCore, rootPath: string, name: string): Promise<void> {
  const installer = new NpmInstall(rootPath, repo);
  await installer.installWithDependencies(name, 'latest');
}

describe('npm tarball cache', () => {
  it('creates missing archive parents and preserves repeated directories and empty directories', async () => {
    const { repo, rootPath } = await setupTestProject('NpmArchiveDirectories');
    const tarball = await packageTarball('cache-fixture', true);
    const path = await cachePath(tarballUrl);
    await repo.mkdir(NPM_CACHE_PATH, { recursive: true });
    await repo.writeFile(path, tarball);

    await new NpmInstall(rootPath, repo).downloadAndInstallPackage(
      'cache-fixture',
      '1.0.0',
      tarballUrl
    );

    const packagePath = `${rootPath}/node_modules/cache-fixture`;
    expect(await repo.readText(`${packagePath}/deep/child/value.txt`)).toBe('last');
    expect((await repo.stat(`${packagePath}/deep/empty`)).type).toBe('folder');
    expect(await repo.readFile(path)).toEqual(tarball);
  });

  it('reuses exact tarball bytes and fresh metadata across workspaces', async () => {
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

    expect(requests.filter(url => url === 'https://registry.npmjs.org/cache-fixture')).toHaveLength(
      1
    );
    expect(requests.filter(url => url === tarballUrl)).toHaveLength(1);
    expect((await repo.stat(NPM_CACHE_PATH)).type).toBe('folder');
    expect(await repo.readFile(await cachePath(tarballUrl))).toEqual(tarball);
    expect(await repo.readText(`${secondRoot}/node_modules/cache-fixture/index.js`)).toContain(
      'cached package'
    );
  });

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

  it('removes a partially extracted package when the tar ends after its manifest', async () => {
    const { repo, rootPath } = await setupTestProject('NpmTruncatedTar');
    const tar = pako.inflate(await packageTarball('cache-fixture'));
    const sourceLength = Buffer.byteLength('module.exports = "cached package";');
    const sourceHeaderEnd = 3 * 512;
    const truncated = pako.gzip(tar.subarray(0, sourceHeaderEnd + sourceLength - 1)).slice();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === 'https://registry.npmjs.org/cache-fixture') {
          return registryMetadata('cache-fixture', tarballUrl);
        }
        return new Response(truncated.buffer);
      })
    );

    await expect(install(repo, rootPath, 'cache-fixture')).rejects.toThrow();
    expect(await repo.exists(`${rootPath}/node_modules/cache-fixture`)).toBe(false);
    expect(await repo.exists(await cachePath(tarballUrl))).toBe(false);
  });

  it('removes partial package files after a write error and retains a valid cached tarball', async () => {
    const { repo, rootPath } = await setupTestProject('NpmCachedWriteFailure');
    const tarball = await packageTarball('cache-fixture');
    const path = await cachePath(tarballUrl);
    await repo.writeFile(path, tarball);
    const original = repo.writeFile.bind(repo);
    const write = vi
      .spyOn(repo, 'writeFile')
      .mockImplementation(async (filePath, content, emit) => {
        if (filePath === `${rootPath}/node_modules/cache-fixture/index.js`) {
          throw new Error('Package write failed');
        }
        await original(filePath, content, emit);
      });

    try {
      const installer = new NpmInstall(rootPath, repo);
      await expect(
        installer.downloadAndInstallPackage('cache-fixture', '1.0.0', tarballUrl)
      ).rejects.toThrow('Package write failed');
      expect(await repo.exists(`${rootPath}/node_modules/cache-fixture`)).toBe(false);
      expect(await repo.readFile(path)).toEqual(tarball);
    } finally {
      write.mockRestore();
    }
  });

  it('verifies downloaded tarball integrity before writing package files or cache bytes', async () => {
    const { repo, rootPath } = await setupTestProject('NpmDownloadedIntegrity');
    const tarball = await packageTarball('cache-fixture');
    const expected = await integrity(new Uint8Array([0]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(tarball.slice().buffer))
    );
    const writes = vi.spyOn(repo, 'writeFile');
    try {
      await expect(
        new NpmInstall(rootPath, repo).downloadAndInstallPackage(
          'cache-fixture',
          '1.0.0',
          tarballUrl,
          undefined,
          expected
        )
      ).rejects.toThrow('integrity mismatch');
      expect(writes).not.toHaveBeenCalled();
      expect(await repo.exists(`${rootPath}/node_modules/cache-fixture`)).toBe(false);
      expect(await repo.exists(await cachePath(tarballUrl))).toBe(false);
    } finally {
      writes.mockRestore();
    }
  });

  it('evicts a cached integrity mismatch while preserving existing package files', async () => {
    const { repo, rootPath } = await setupTestProject('NpmCachedIntegrity');
    const path = await cachePath(tarballUrl);
    const expected = await integrity(await packageTarball('cache-fixture'));
    await repo.writeFile(path, await packageTarball('tampered-fixture'));
    const packagePath = `${rootPath}/node_modules/cache-fixture`;
    await repo.mkdir(packagePath, { recursive: true });
    await repo.writeFile(`${packagePath}/keep.txt`, 'existing package');

    await expect(
      new NpmInstall(rootPath, repo).downloadAndInstallPackage(
        'cache-fixture',
        '1.0.0',
        tarballUrl,
        undefined,
        expected
      )
    ).rejects.toThrow('integrity mismatch');

    expect(await repo.exists(path)).toBe(false);
    expect(await repo.readText(`${packagePath}/keep.txt`)).toBe('existing package');
  });

  it('installs and caches tarball bytes that match their declared integrity', async () => {
    const { repo, rootPath } = await setupTestProject('NpmValidIntegrity');
    const tarball = await packageTarball('cache-fixture');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(tarball.slice().buffer))
    );

    await new NpmInstall(rootPath, repo).downloadAndInstallPackage(
      'cache-fixture',
      '1.0.0',
      tarballUrl,
      undefined,
      await integrity(tarball)
    );

    expect(await repo.readFile(await cachePath(tarballUrl))).toEqual(tarball);
    expect(await repo.readText(`${rootPath}/node_modules/cache-fixture/index.js`)).toContain(
      'cached package'
    );
  });
});
