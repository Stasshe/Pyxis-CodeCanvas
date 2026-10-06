import { describe, expect, it } from 'vitest';
import { ModuleCode } from '@/engine/runtime/module/moduleCode';

describe('ModuleCode', () => {
  it('uses collision-resistant content versions for persistent transpile cache keys', async () => {
    const first = JSON.stringify({
      filePath: '/project/module.mjs',
      content: "export default 'Aa'",
    });
    const second = JSON.stringify({
      filePath: '/project/module.mjs',
      content: "export default 'BB'",
    });

    await expect(ModuleCode.contentVersion(first)).resolves.not.toBe(
      await ModuleCode.contentVersion(second)
    );
  });
});
