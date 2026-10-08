import { describe, expect, it } from 'vitest';
import { BatchFileWriter } from '@/engine/cmd/global/npmOperations/install/batchWriter';
import { setupTestProject } from '../../_helpers/testProject';

describe('package source writes', () => {
  it('preserves JavaScript module source during immediate and batched writes', async () => {
    const { repo, rootPath } = await setupTestProject('PackageSourceTest');
    const writer = new BatchFileWriter(repo);
    const source = 'import value from "dependency";\nexport default value;\n';
    const immediatePath = `${rootPath}/immediate.mjs`;
    const batchPath = `${rootPath}/batch.mjs`;

    await writer.execute(immediatePath, 'file', source);
    writer.start();
    await writer.execute(batchPath, 'file', source);
    await writer.finish();

    expect(await repo.readFile(immediatePath)).toEqual(new TextEncoder().encode(source));
    expect(await repo.readFile(batchPath)).toEqual(new TextEncoder().encode(source));
  });
});
