import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmInstall } from '@/engine/system/npm/npmInstall';
import { setupTestProject } from '@tests/_helpers/testProject';

afterEach(() => vi.unstubAllGlobals());

describe('npm package resolution', () => {
  it('resolves versions and tags without a latest dist-tag', async () => {
    const { repo, rootPath } = await setupTestProject('NpmPackageResolution');
    const firstTarball = 'https://example.test/oracle-1.0.0.tgz';
    const secondTarball = 'https://example.test/oracle-1.1.0.tgz';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'latest-oracle',
              'dist-tags': { beta: '1.0.0' },
              versions: {
                '1.0.0': { dist: { tarball: firstTarball } },
                '1.1.0': { dist: { tarball: secondTarball } },
              },
            })
          )
      )
    );

    const installer = new NpmInstall(rootPath, repo);
    await expect(installer.resolvePackageInfo('latest-oracle', '1.0.0')).resolves.toMatchObject({
      name: 'latest-oracle',
      version: '1.0.0',
      tarball: firstTarball,
    });
    await expect(installer.resolvePackageInfo('latest-oracle', 'beta')).resolves.toMatchObject({
      version: '1.0.0',
      tarball: firstTarball,
    });
    await expect(installer.resolvePackageInfo('latest-oracle', '^1.0.0')).resolves.toMatchObject({
      version: '1.1.0',
      tarball: secondTarball,
    });
    await expect(installer.resolvePackageInfo('latest-oracle', 'latest')).rejects.toThrow(
      "No download URL found for 'latest-oracle@latest'"
    );
    await expect(installer.resolvePackageInfo('latest-oracle', 'next')).rejects.toThrow(
      "No download URL found for 'latest-oracle@next'"
    );
  });

  it('rejects packuments without a package name', async () => {
    const { repo, rootPath } = await setupTestProject('NpmUnnamedPackageResolution');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ versions: { '1.0.0': {} } })))
    );

    await expect(
      new NpmInstall(rootPath, repo).resolvePackageInfo('unnamed-oracle', '1.0.0')
    ).rejects.toThrow("Invalid package data for 'unnamed-oracle'");
  });

  it('resolves exact versions when packument metadata omits dist-tags', async () => {
    const { repo, rootPath } = await setupTestProject('NpmUntaggedPackageResolution');
    const tarball = 'https://example.test/untagged-oracle-1.0.0.tgz';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: 'untagged-oracle',
              versions: { '1.0.0': { dist: { tarball } } },
            })
          )
      )
    );

    await expect(
      new NpmInstall(rootPath, repo).resolvePackageInfo('untagged-oracle', '1.0.0')
    ).resolves.toMatchObject({ name: 'untagged-oracle', version: '1.0.0', tarball });
  });
});
