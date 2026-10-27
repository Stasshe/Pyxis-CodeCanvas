import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmNetwork } from '@/engine/system/npm/install/npmNetwork';
import { RegistryClient } from '@/engine/system/npm/install/registryClient';
import { FSError } from '@/engine/core/fs/errors';
import { setupTestProject } from '../../../../_helpers/testProject';

afterEach(() => vi.unstubAllGlobals());

function metadata(latest: string, headers: HeadersInit = {}): Response {
  return new Response(
    JSON.stringify({
      name: 'registry-fixture',
      'dist-tags': { latest },
      versions: {
        [latest]: {
          dependencies: { dep: '^1.0.0' },
          peerDependencies: { host: '^1.0.0' },
          peerDependenciesMeta: { host: { optional: true } },
          dist: { tarball: `https://example.test/${latest}.tgz`, integrity: 'ignored' },
          readme: 'ignored',
        },
      },
      readme: 'ignored',
    }),
    { headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(headers)) } }
  );
}

function installResponse(latest: string, cacheControl: string, etag = '"v1"'): Response {
  return metadata(latest, { 'Cache-Control': cacheControl, ETag: etag });
}

function setupFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const requests: Request[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (!response) throw new Error('Unexpected registry request');
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('npm registry metadata cache', () => {
  it('persists fresh abbreviated metadata and uses it across clients', async () => {
    const { repo } = await setupTestProject('RegistryFreshCache');
    const fetchMock = setupFetch([installResponse('1.2.3', 'public, max-age=60')]);
    const first = await new RegistryClient(repo).getPackument('registry-fixture');
    const exists = vi.spyOn(repo, 'exists');
    const second = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(first['dist-tags']?.latest).toBe('1.2.3');
    expect(second.versions['1.2.3'].dist?.tarball).toBe('https://example.test/1.2.3.tgz');
    expect(second.versions['1.2.3'].peerDependencies).toEqual({ host: '^1.0.0' });
    expect(second.versions['1.2.3'].peerDependenciesMeta).toEqual({ host: { optional: true } });
    expect('readme' in second.versions['1.2.3']).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exists).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0][1];
    expect(new Headers(request?.headers).get('Accept')).toBe('application/vnd.npm.install-v1+json');
  });

  it('revalidates stale metadata by ETag and refreshes its lifetime on 304', async () => {
    const { repo } = await setupTestProject('RegistryEtagCache');
    const fetchMock = setupFetch([
      installResponse('1.0.0', 'max-age=0', '"etag-1"'),
      new Response(null, {
        status: 304,
        headers: { 'Cache-Control': 'max-age=60', ETag: '"etag-1"' },
      }),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    const refreshed = await new RegistryClient(repo).getPackument('registry-fixture');
    const cached = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(refreshed['dist-tags']?.latest).toBe('1.0.0');
    expect(cached['dist-tags']?.latest).toBe('1.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const revalidationRequest = fetchMock.mock.calls[1][1];
    expect(new Headers(revalidationRequest?.headers).get('If-None-Match')).toBe('"etag-1"');
  });

  it('replaces stale latest metadata after a successful response', async () => {
    const { repo } = await setupTestProject('RegistryLatestCache');
    setupFetch([
      installResponse('1.0.0', 'max-age=0', '"etag-1"'),
      installResponse('2.0.0', 'max-age=60', '"etag-2"'),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    const latest = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(latest['dist-tags']?.latest).toBe('2.0.0');
  });

  it('uses Date and Age when deciding whether metadata is stale', async () => {
    const { repo } = await setupTestProject('RegistryDateAgeCache');
    const oldDate = new Date(Date.now() - 120000).toUTCString();
    const fetchMock = setupFetch([
      metadata('1.0.0', {
        'Cache-Control': 'max-age=60',
        Age: '0',
        Date: oldDate,
        ETag: '"etag-1"',
      }),
      installResponse('2.0.0', 'max-age=60', '"etag-2"'),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    const latest = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(latest['dist-tags']?.latest).toBe('2.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses Age when a cached response is older than max-age', async () => {
    const { repo } = await setupTestProject('RegistryAgeCache');
    const fetchMock = setupFetch([
      metadata('1.0.0', {
        'Cache-Control': 'max-age=60',
        Age: '90',
        Date: new Date().toUTCString(),
        ETag: '"etag-1"',
      }),
      installResponse('2.0.0', 'max-age=60', '"etag-2"'),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    const latest = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(latest['dist-tags']?.latest).toBe('2.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('revalidates no-cache responses even when max-age is positive', async () => {
    const { repo } = await setupTestProject('RegistryNoCache');
    const fetchMock = setupFetch([
      installResponse('1.0.0', 'no-cache, max-age=60'),
      new Response(null, { status: 304, headers: { ETag: '"v1"' } }),
      installResponse('1.0.0', 'max-age=60'),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    await new RegistryClient(repo).getPackument('registry-fixture');
    await new RegistryClient(repo).getPackument('registry-fixture');

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces filesystem cache read failures', async () => {
    const { repo } = await setupTestProject('RegistryCacheReadFailure');
    const fetchMock = setupFetch([installResponse('1.0.0', 'max-age=60')]);
    await new RegistryClient(repo).getPackument('registry-fixture');
    vi.spyOn(repo, 'readText').mockRejectedValue(new FSError('EIO', '/cache/entry.json'));

    await expect(new RegistryClient(repo).getPackument('registry-fixture')).rejects.toThrow('EIO');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates the registry cache directory once per client', async () => {
    const { repo } = await setupTestProject('RegistryCacheDirectory');
    setupFetch([installResponse('1.0.0', 'max-age=60'), installResponse('2.0.0', 'max-age=60')]);
    const mkdir = vi.spyOn(repo, 'mkdir');
    const client = new RegistryClient(repo);

    await Promise.all([
      client.getPackument('registry-fixture-a'),
      client.getPackument('registry-fixture-b'),
    ]);

    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it('retries cache directory creation after a failed write', async () => {
    const { repo } = await setupTestProject('RegistryCacheDirectoryRetry');
    const fetchMock = setupFetch([
      installResponse('1.0.0', 'max-age=60'),
      installResponse('2.0.0', 'max-age=60'),
    ]);
    const mkdir = vi
      .spyOn(repo, 'mkdir')
      .mockRejectedValueOnce(new FSError('EIO', '/cache/registry'));
    const client = new RegistryClient(repo);

    await expect(client.getPackument('registry-fixture')).rejects.toThrow('EIO');
    await expect(client.getPackument('registry-fixture')).resolves.toMatchObject({
      'dist-tags': { latest: '2.0.0' },
    });

    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('removes null cache entries and fetches fresh metadata', async () => {
    const { repo } = await setupTestProject('RegistryNullCache');
    const fetchMock = setupFetch([
      installResponse('1.0.0', 'max-age=60'),
      installResponse('2.0.0', 'max-age=60'),
    ]);
    await new RegistryClient(repo).getPackument('registry-fixture');
    const cacheFile = (await repo.walk('/home/pyxis/.npm/registry'))[0];
    await repo.writeFile(cacheFile.path, 'null');

    const refreshed = await new RegistryClient(repo).getPackument('registry-fixture');

    expect(refreshed['dist-tags']?.latest).toBe('2.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests for the same package', async () => {
    const { repo } = await setupTestProject('RegistryInFlight');
    let releaseResponse: (response: Response) => void = () => {};
    const pendingResponse = new Promise<Response>(resolve => {
      releaseResponse = resolve;
    });
    const fetchMock = vi.fn(() => pendingResponse);
    vi.stubGlobal('fetch', fetchMock);
    const client = new RegistryClient(repo);

    const first = client.getPackument('registry-fixture');
    const second = client.getPackument('registry-fixture');
    releaseResponse(installResponse('1.0.0', 'max-age=60'));

    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops cache entries that forbid storage', async () => {
    const { repo } = await setupTestProject('RegistryNoStore');
    const fetchMock = setupFetch([
      installResponse('1.0.0', 'no-store'),
      installResponse('1.0.0', 'max-age=60'),
    ]);

    await new RegistryClient(repo).getPackument('registry-fixture');
    expect(await repo.exists('/home/pyxis/.npm/registry')).toBe(false);
    await new RegistryClient(repo).getPackument('registry-fixture');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await repo.exists('/home/pyxis/.npm/registry')).toBe(true);
  });
});

describe('npm network concurrency', () => {
  it('bounds concurrent metadata and tarball operations through a shared gate', async () => {
    const network = new NpmNetwork(2);
    let active = 0;
    let maximum = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        network.run(async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          active -= 1;
        })
      )
    );
    expect(maximum).toBe(2);
  });
});
