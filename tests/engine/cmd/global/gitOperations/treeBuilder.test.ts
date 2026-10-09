import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubAPI } from '@/engine/cmd/global/gitOperations/github/GitHubAPI';
import { TreeBuilder } from '@/engine/cmd/global/gitOperations/github/TreeBuilder';
import { createGitFs } from '@/engine/core/fs/git';
import type { FsApi } from '@/engine/core/fs/types';

const gitMocks = vi.hoisted(() => ({
  readCommit: vi.fn(),
  readTree: vi.fn(),
  readBlob: vi.fn(),
}));
vi.mock('isomorphic-git', () => ({ default: gitMocks }));

const core: FsApi = {
  readFile: vi.fn(),
  readText: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
  walk: vi.fn(),
  exists: vi.fn(),
};

interface BlobPayload {
  content: string;
  encoding: string;
}

describe('GitHub tree blob uploads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads exact bytes for misleading text extensions, BOMs, and subviews', async () => {
    const invalidText = Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4);
    const bom = Buffer.from([239, 187, 191, 104, 105]);
    const sourceBytes = [invalidText, bom];
    gitMocks.readCommit.mockResolvedValue({ commit: { tree: 'local-tree' } });
    gitMocks.readTree.mockResolvedValue({
      tree: [
        { path: 'binary.txt', mode: '100644', type: 'blob', oid: 'blob-1' },
        { path: 'bom.js', mode: '100644', type: 'blob', oid: 'blob-2' },
      ],
    });
    gitMocks.readBlob
      .mockResolvedValueOnce({ blob: invalidText })
      .mockResolvedValueOnce({ blob: bom });
    const payloads: BlobPayload[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.endsWith('/git/blobs')) {
        if (typeof options?.body !== 'string') throw new Error('Missing blob JSON body');
        const payload: BlobPayload = JSON.parse(options.body);
        payloads.push(payload);
      }
      return new Response(JSON.stringify({ sha: `remote-${payloads.length}` }), { status: 201 });
    });

    const builder = new TreeBuilder(
      createGitFs(core),
      '/project',
      new GitHubAPI('token', 'owner', 'repo')
    );
    await builder.buildTree('commit');

    expect(payloads).toHaveLength(2);
    for (const [index, payload] of payloads.entries()) {
      expect(payload.encoding).toBe('base64');
      expect(Buffer.from(payload.content, 'base64')).toEqual(sourceBytes[index]);
    }
  });
});
