import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('reuses an asynchronously prepared resolution without synchronous filesystem calls', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/src/cached.js`, 'module.exports = 1');
    const currentFilePath = `${rootPath}/src/main.js`;
    await resolver.resolve('./cached', currentFilePath);
    vi.mocked(fixture.bridge.sync).mockClear();

    expect(resolver.resolveSync('./cached', currentFilePath)?.path).toBe(
      `${rootPath}/src/cached.js`
    );
    expect(fixture.bridge.sync).not.toHaveBeenCalled();
  });

  it('does not guess mjs, cjs or TypeScript extensions for require', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    for (const extension of ['mjs', 'cjs', 'ts']) {
      await fixture.writeFile(
        `${rootPath}/src/only-${extension}.${extension}`,
        'module.exports = 1'
      );
      expect(resolver.resolveSync(`./only-${extension}`, `${rootPath}/src/main.js`)).toBeNull();
      await expect(
        resolver.resolve(`./only-${extension}`, `${rootPath}/src/main.js`)
      ).resolves.toBeNull();
    }
  });

  it('requires exact relative import paths and does not load directory indexes', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/src/file.js`, 'module.exports = 1');
    await fixture.writeFile(`${rootPath}/src/folder/index.js`, 'module.exports = 1');
    const parent = `${rootPath}/src/main.mjs`;
    expect(resolver.resolveSync('./file', parent, 'import')).toBeNull();
    expect(resolver.resolveSync('./folder', parent, 'import')).toBeNull();
    await expect(resolver.resolve('./file.js', parent, 'import')).resolves.toMatchObject({
      path: `${rootPath}/src/file.js`,
    });
  });

  it('resolves a required directory main field before index files', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/src/folder/package.json`,
      JSON.stringify({ main: './entry' })
    );
    await fixture.writeFile(`${rootPath}/src/folder/entry.js`, 'module.exports = 1');
    await fixture.writeFile(`${rootPath}/src/folder/index.js`, 'module.exports = 2');
    expect(resolver.resolveSync('./folder', `${rootPath}/src/main.js`)?.path).toBe(
      `${rootPath}/src/folder/entry.js`
    );
    await expect(resolver.resolve('./folder', `${rootPath}/src/main.js`)).resolves.toMatchObject({
      path: `${rootPath}/src/folder/entry.js`,
    });
  });

  it('honors condition insertion order and ignores inactive conditions', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/ordered/package.json`,
      JSON.stringify({
        exports: {
          browser: './browser.js',
          node: { import: './import.mjs' },
          default: './default.js',
          require: './require.js',
        },
      })
    );
    for (const name of ['browser.js', 'import.mjs', 'default.js', 'require.js'])
      await fixture.writeFile(`${rootPath}/node_modules/ordered/${name}`, 'module.exports = 1');
    const parent = `${rootPath}/src/main.js`;
    expect(resolver.resolveSync('ordered', parent)?.path).toBe(
      `${rootPath}/node_modules/ordered/default.js`
    );
    await expect(resolver.resolve('ordered', parent, 'import')).resolves.toMatchObject({
      path: `${rootPath}/node_modules/ordered/import.mjs`,
    });
  });

  it('keeps import and require resolution caches separate', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/dual/package.json`,
      JSON.stringify({ exports: { import: './module.mjs', require: './common.cjs' } })
    );
    await fixture.writeFile(`${rootPath}/node_modules/dual/module.mjs`, 'export default 1');
    await fixture.writeFile(`${rootPath}/node_modules/dual/common.cjs`, 'module.exports = 1');
    const parent = `${rootPath}/src/main.js`;
    await resolver.resolve('dual', parent, 'import');
    expect(resolver.resolveSync('dual', parent)?.path).toBe(
      `${rootPath}/node_modules/dual/common.cjs`
    );
    expect(resolver.resolveSync('dual', parent, 'import')?.path).toBe(
      `${rootPath}/node_modules/dual/module.mjs`
    );
  });

  it('resolves root package imports, wildcard trailers, external targets and self references', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/package.json`,
      JSON.stringify({
        name: 'self',
        exports: './source/self.js',
        imports: { '#local/*.js': './source/*.js', '#external': 'dependency' },
      })
    );
    await fixture.writeFile(`${rootPath}/source/self.js`, 'module.exports = 1');
    await fixture.writeFile(`${rootPath}/source/one.js`, 'module.exports = 2');
    await fixture.writeFile(`${rootPath}/node_modules/dependency/index.js`, 'module.exports = 3');
    const parent = `${rootPath}/source/main.js`;
    await expect(resolver.resolve('#local/one.js', parent)).resolves.toMatchObject({
      path: `${rootPath}/source/one.js`,
    });
    expect(resolver.resolveSync('#external', parent)?.path).toBe(
      `${rootPath}/node_modules/dependency/index.js`
    );
    expect(resolver.resolveSync('self', parent)?.path).toBe(`${rootPath}/source/self.js`);
  });

  it('chooses the most specific export pattern and preserves null blockers', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/pattern/package.json`,
      JSON.stringify({
        exports: {
          './*': './generic/*.js',
          './feature/*': './specific/*.js',
          './feature/private/*': null,
        },
      })
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/pattern/specific/one.js`,
      'module.exports = 1'
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/pattern/generic/feature/private/one.js`,
      'module.exports = 2'
    );
    const parent = `${rootPath}/src/main.js`;
    expect(resolver.resolveSync('pattern/feature/one', parent)?.path).toBe(
      `${rootPath}/node_modules/pattern/specific/one.js`
    );
    await expect(resolver.resolve('pattern/feature/private/one', parent)).resolves.toBeNull();
  });

  it('does not extend export targets or fall back to package main', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/exact/package.json`,
      JSON.stringify({ exports: './entry', main: './entry.js' })
    );
    await fixture.writeFile(`${rootPath}/node_modules/exact/entry.js`, 'module.exports = 1');
    const parent = `${rootPath}/src/main.js`;
    expect(resolver.resolveSync('exact', parent)).toBeNull();
    await expect(resolver.resolve('exact', parent)).resolves.toBeNull();
  });

  it('rejects exports that escape the package directory', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(
      `${rootPath}/node_modules/invalid/package.json`,
      JSON.stringify({ exports: './%2e%2e/private.js' })
    );
    expect(() => resolver.resolveSync('invalid', `${rootPath}/src/main.js`)).toThrow(
      'Invalid package target segment'
    );
    await expect(resolver.resolve('invalid', `${rootPath}/src/main.js`)).rejects.toThrow(
      'Invalid package target segment'
    );
  });

  it('finds nearest type scopes for scoped packages and stops at node_modules', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/package.json`, JSON.stringify({ type: 'module' }));
    await fixture.writeFile(
      `${rootPath}/node_modules/@scope/tool/package.json`,
      JSON.stringify({ type: 'commonjs' })
    );
    expect(await resolver.packageType(`${rootPath}/node_modules/@scope/tool/src/main.js`)).toBe(
      'commonjs'
    );
    expect(resolver.packageTypeSync(`${rootPath}/node_modules/untyped/main.js`)).toBeUndefined();
    expect(await resolver.packageType(`${rootPath}/source/main.js`)).toBe('module');
  });

  it('does not retain absent type scopes when a package file is created later', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    expect(await resolver.packageType(`${rootPath}/source/main.js`)).toBeUndefined();
    await fixture.writeFile(`${rootPath}/package.json`, JSON.stringify({ type: 'module' }));
    expect(resolver.packageTypeSync(`${rootPath}/source/main.js`)).toBe('module');
  });

  it('rejects invalid primitive targets, numeric conditions and empty target segments', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    const targets = [42, { '0': './entry.js', default: './entry.js' }, './folder//entry.js'];
    for (const [index, exports] of targets.entries()) {
      await fixture.writeFile(
        `${rootPath}/node_modules/invalid-${index}/package.json`,
        JSON.stringify({ exports })
      );
      expect(() =>
        resolver.resolveSync(`invalid-${index}`, `${rootPath}/source/main.js`)
      ).toThrow();
      await expect(
        resolver.resolve(`invalid-${index}`, `${rootPath}/source/main.js`)
      ).rejects.toThrow();
    }
  });

  it('canonicalizes linked files before determining their package type', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/package.json`, '{"type":"commonjs"}');
    await fixture.writeFile(`${rootPath}/target/package.json`, '{"type":"module"}');
    const target = `${rootPath}/target/file.js`;
    await fixture.writeFile(target, 'export const value = 1;');
    await fixture.fs.symlink('./target/file.js', `${rootPath}/linked.js`);
    const asynchronous = await resolver.resolve('./linked.js', `${rootPath}/entry.js`);
    expect(asynchronous?.path).toBe(target);
    expect(await resolver.packageType(asynchronous!.path)).toBe('module');
    const linked = resolver.resolveSync('../linked.js', `${rootPath}/other/entry.js`);
    expect(linked?.path).toBe(target);
    expect(resolver.packageTypeSync(linked!.path)).toBe('module');
  });

  it('rejects encoded file URL separators before resolving filesystem paths', async () => {
    const { fixture, resolver, rootPath } = await createResolver();
    await fixture.writeFile(`${rootPath}/source/file.js`, 'module.exports = 1');
    for (const separator of ['%2f', '%5C']) {
      await expect(
        resolver.resolve(
          `file://${rootPath}/source${separator}file.js`,
          `${rootPath}/main.js`,
          'import'
        )
      ).rejects.toThrow('Invalid encoded separator');
    }
  });
});
