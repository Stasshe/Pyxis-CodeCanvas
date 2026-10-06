import { afterEach, describe, expect, it } from 'vitest';
import { isBuiltInModule } from '@/engine/runtime/module/builtinModules';
import { ModuleFileSystem } from '@/engine/runtime/module/moduleFileSystem';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import { createNodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('ModuleResolver', () => {
  const fixtures: Awaited<ReturnType<typeof createNodeRuntimeFixture>>[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.close();
  });

  it('recognizes only implemented Node built-ins', () => {
    expect(isBuiltInModule('node:assert')).toBe(true);
    expect(isBuiltInModule('node:worker_threads')).toBe(false);
  });

  async function createResolver() {
    const rootPath = '/tmp/module-resolver';
    const fixture = await createNodeRuntimeFixture(rootPath);
    fixtures.push(fixture);
    const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(fixture.bridge));
    return { fixture, resolver, rootPath };
  }

  it('resolves a package entry from its main field', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/sample/package.json`,
      JSON.stringify({ main: 'lib/index.js' })
    );
    await fixture.writeFile(`${rootPath}/node_modules/sample/lib/index.js`, 'module.exports = 1');

    const result = await resolver.resolve('sample', `${rootPath}/src/main.js`);

    expect(result?.path).toBe(`${rootPath}/node_modules/sample/lib/index.js`);
  });

  it('resolves scoped packages and conditional require exports synchronously', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/@scope/tool/package.json`,
      JSON.stringify({ exports: { '.': { import: './esm.js', require: './cjs.js' } } })
    );
    await fixture.writeFile(`${rootPath}/node_modules/@scope/tool/cjs.js`, 'module.exports = 1');

    const result = resolver.resolveSync('@scope/tool', `${rootPath}/src/main.js`);

    expect(result?.path).toBe(`${rootPath}/node_modules/@scope/tool/cjs.js`);
  });

  it('resolves wildcard exports in sync and async resolution', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/wildcard-package/package.json`,
      JSON.stringify({ exports: { './features/*': './dist/*.js' } })
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/wildcard-package/dist/one.js`,
      'module.exports = 1'
    );
    const currentFilePath = `${rootPath}/src/main.js`;

    expect(resolver.resolveSync('wildcard-package/features/one', currentFilePath)?.path).toBe(
      `${rootPath}/node_modules/wildcard-package/dist/one.js`
    );
    await expect(
      resolver.resolve('wildcard-package/features/one', currentFilePath)
    ).resolves.toMatchObject({
      path: `${rootPath}/node_modules/wildcard-package/dist/one.js`,
    });
  });

  it('blocks package subpaths excluded by exports', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/private-package/package.json`,
      JSON.stringify({ exports: { '.': './index.js' } })
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/private-package/index.js`,
      'module.exports = 1'
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/private-package/secret.js`,
      'module.exports = 2'
    );
    const currentFilePath = `${rootPath}/src/main.js`;

    expect(resolver.resolveSync('private-package/secret', currentFilePath)).toBeNull();
    await expect(resolver.resolve('private-package/secret', currentFilePath)).resolves.toBeNull();
  });

  it('searches parent node_modules directories for nested dependencies', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/parent/node_modules/nested/package.json`,
      JSON.stringify({ main: 'entry' })
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/parent/node_modules/nested/entry.js`,
      'module.exports = 1'
    );

    const result = resolver.resolveSync('nested', `${rootPath}/node_modules/parent/lib/index.js`);

    expect(result?.path).toBe(`${rootPath}/node_modules/parent/node_modules/nested/entry.js`);
  });

  it('resolves extensionless files and directory indexes synchronously', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/src/math.js`, 'module.exports = 1');
    await fixture.writeFile(`${rootPath}/src/widgets/index.js`, 'module.exports = 2');

    expect(resolver.resolveSync('./math', `${rootPath}/src/main.js`)?.path).toBe(
      `${rootPath}/src/math.js`
    );
    expect(resolver.resolveSync('./widgets', `${rootPath}/src/main.js`)?.path).toBe(
      `${rootPath}/src/widgets/index.js`
    );
  });

  it('does not cache a missing path before it is created', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    expect(resolver.resolveSync('./created-later', `${rootPath}/src/main.js`)).toBeNull();
    await fixture.writeFile(`${rootPath}/src/created-later.js`, 'module.exports = true');

    expect(resolver.resolveSync('./created-later', `${rootPath}/src/main.js`)?.path).toBe(
      `${rootPath}/src/created-later.js`
    );
  });
});
