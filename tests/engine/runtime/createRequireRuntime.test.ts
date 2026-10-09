import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('module.createRequire runtime integration', () => {
  let fixture: NodeRuntimeFixture;
  const output: string[] = [];
  const errors: string[] = [];

  beforeEach(async () => {
    output.length = 0;
    errors.length = 0;
    fixture = await createNodeRuntimeFixture('/tmp/create-require-tests', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
      warn: (...args) => output.push(args.map(String).join(' ')),
      clear: () => {},
    });
    await fixture.writeFile(`${fixture.rootPath}/relative.cjs`, "module.exports = 'relative';");
    await fixture.writeFile(
      `${fixture.rootPath}/feature/node_modules/fixture-pkg/package.json`,
      JSON.stringify({ name: 'fixture-pkg', main: 'index.cjs' })
    );
    await fixture.writeFile(
      `${fixture.rootPath}/feature/node_modules/fixture-pkg/index.cjs`,
      "module.exports = 'package';"
    );
  });

  afterEach(() => fixture.close());

  it('loads relative and package modules from the supplied ESM URL', async () => {
    const source = [
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      "console.log(require('../relative.cjs'), require('fixture-pkg'));",
    ].join('\n');
    const entry = `${fixture.rootPath}/feature/main.mjs`;
    await fixture.writeFile(entry, source);

    await fixture.runtime.execute(entry, []);
    await fixture.runtime.waitForEventLoop();

    expect(output.join('\n')).toContain('relative package');
    expect(errors).toEqual([]);
  });
  it('resolves packages from explicit require.resolve paths', async () => {
    const searchRoot = `${fixture.rootPath}/search`;
    const firstRoot = `${fixture.rootPath}/first`;
    const callerPackage = `${fixture.rootPath}/node_modules/shared-pkg`;
    const explicitPackage = `${searchRoot}/node_modules/shared-pkg`;
    await fixture.writeFile(
      `${searchRoot}/node_modules/explicit-pkg/package.json`,
      JSON.stringify({ name: 'explicit-pkg', main: 'index.cjs' })
    );
    await fixture.writeFile(`${searchRoot}/node_modules/explicit-pkg/index.cjs`, '');
    await fixture.writeFile(
      `${callerPackage}/package.json`,
      JSON.stringify({ name: 'shared-pkg', main: 'index.cjs' })
    );
    await fixture.writeFile(`${callerPackage}/index.cjs`, '');
    await fixture.writeFile(
      `${fixture.rootPath}/package.json`,
      JSON.stringify({
        name: 'self-package',
        exports: { '.': './relative.cjs' },
        imports: { '#local': './relative.cjs' },
      })
    );
    await fixture.writeFile(
      `${explicitPackage}/package.json`,
      JSON.stringify({ name: 'shared-pkg', main: 'index.cjs' })
    );
    await fixture.writeFile(`${explicitPackage}/index.cjs`, '');
    const entry = `${fixture.rootPath}/resolve-paths.cjs`;
    await fixture.writeFile(
      entry,
      `console.log(require.resolve('explicit-pkg', { paths: ['${searchRoot}'] }));\n` +
        `console.log(require.resolve('explicit-pkg', { paths: ['${firstRoot}', '${searchRoot}'] }));\n` +
        `console.log(require.resolve('shared-pkg', { paths: ['${searchRoot}'] }));\n` +
        `console.log(require.resolve('shared-pkg'));\n` +
        `console.log(require.resolve('self-package', { paths: [] }));\n` +
        `console.log(require.resolve('#local', { paths: [] }));\n` +
        `console.log(require.resolve('./relative.cjs', { paths: ['${fixture.rootPath}'] }));\n` +
        `console.log(require.resolve('${fixture.rootPath}/relative.cjs', { paths: [] }));\n` +
        `console.log(require.resolve('node:fs', { paths: 'invalid' }));\n` +
        `try { require.resolve('explicit-pkg', { paths: [] }); } catch (error) { console.log(error.code); }\n` +
        `try { require.resolve('explicit-pkg', { paths: 'invalid' }); } catch (error) { console.log(error.code); }\n` +
        `try { require.resolve('explicit-pkg', { paths: [1] }); } catch (error) { console.log(error.code); }`
    );

    await fixture.runtime.execute(entry);

    expect(output).toEqual([
      `${searchRoot}/node_modules/explicit-pkg/index.cjs`,
      `${searchRoot}/node_modules/explicit-pkg/index.cjs`,
      `${searchRoot}/node_modules/shared-pkg/index.cjs`,
      `${callerPackage}/index.cjs`,
      `${fixture.rootPath}/relative.cjs`,
      `${fixture.rootPath}/relative.cjs`,
      `${fixture.rootPath}/relative.cjs`,
      `${fixture.rootPath}/relative.cjs`,
      'node:fs',
      'MODULE_NOT_FOUND',
      'ERR_INVALID_ARG_VALUE',
      'ERR_INVALID_ARG_TYPE',
    ]);
    expect(errors).toEqual([]);
  });
  it('uses Node resolution error codes for require and import failures', async () => {
    const commonJsEntry = `${fixture.rootPath}/missing.cjs`;
    await fixture.writeFile(
      commonJsEntry,
      `try { require.resolve('missing-pkg', { paths: [] }); } catch (error) { console.log(error.code, error.requireStack[0] === __filename); }\n` +
        `try { require('missing-pkg'); } catch (error) { console.log(error.code, error.requireStack[0] === __filename); }`
    );
    await fixture.runtime.execute(commonJsEntry);

    const esmEntry = `${fixture.rootPath}/missing.mjs`;
    await fixture.writeFile(
      esmEntry,
      `try { import.meta.resolve('missing-pkg'); } catch (error) { console.log(error.code, error.message.includes('imported from')); }\n` +
        `try { await import('missing-pkg'); } catch (error) { console.log(error.code, error.message.includes('imported from')); }`
    );
    await fixture.runtime.execute(esmEntry);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual([
      'MODULE_NOT_FOUND true',
      'MODULE_NOT_FOUND true',
      'ERR_MODULE_NOT_FOUND true',
      'ERR_MODULE_NOT_FOUND true',
    ]);
    expect(errors).toEqual([]);
  });
  it('shares live cache and reloads deleted modules', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/counter.cjs`,
      'global.counter = (global.counter || 0) + 1; module.exports = global.counter;'
    );
    const entry = `${fixture.rootPath}/main.cjs`;
    await fixture.writeFile(
      entry,
      `
      const { createRequire } = require('node:module');
      const other = createRequire(__filename);
      const filename = require.resolve('./counter.cjs');
      console.log(require.main === module, require.cache === other.cache);
      console.log(require('./counter.cjs'), require.cache[filename].loaded);
      delete other.cache[filename];
      console.log(other('./counter.cjs'));
      require('node:fs').writeFileSync(filename, "module.exports = 'updated';");
      delete require.cache[filename];
      console.log(require('./counter.cjs'));
      require.cache[filename] = { exports: 'replacement' };
      console.log(require('./counter.cjs'));
      require.cache.fs = { exports: 'override' };
      console.log(require('fs'), typeof require('node:fs').readFileSync);
      console.log(require.resolve.paths('node:fs'), require.resolve('node:fs'));
    `
    );
    await fixture.runtime.execute(entry);
    expect(output).toEqual([
      'true true',
      '1 true',
      '2',
      'updated',
      'replacement',
      'override function',
      'null node:fs',
    ]);
    expect(errors).toEqual([]);
  });

  it('uses registered extension handlers when loading files', async () => {
    await fixture.writeFile(`${fixture.rootPath}/custom.txt`, 'ignored content');
    await fixture.writeFile(`${fixture.rootPath}/alias.sjs`, "module.exports = 'alias';");
    const entry = `${fixture.rootPath}/extensions.cjs`;
    await fixture.writeFile(
      entry,
      `
      require.extensions['.txt'] = (loaded, filename) => {
        loaded._compile("module.exports = 'custom';", filename);
      };
      console.log(require('./custom.txt'));
      require.extensions['.sjs'] = require.extensions['.js'];
      console.log(require('./alias'));
    `
    );
    await fixture.runtime.execute(entry);
    expect(output).toEqual(['custom', 'alias']);
    expect(errors).toEqual([]);
  });
  it('resolves import metadata using URL paths and import package conditions', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/conditional/package.json`,
      JSON.stringify({ exports: { import: './import.mjs', require: './require.cjs' } })
    );
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/conditional/import.mjs`,
      'export default 1;'
    );
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/conditional/require.cjs`,
      'module.exports = 2;'
    );
    const entry = `${fixture.rootPath}/meta #%.mjs`;
    await fixture.writeFile(
      entry,
      `
      console.log(import.meta.filename, import.meta.dirname);
      console.log(import.meta.url);
      console.log(import.meta.resolve('./missing.mjs'));
      console.log(import.meta.resolve('conditional'));
      console.log(import.meta.resolve('fs'));
      console.log(import.meta.resolve('data:text/javascript,export default 1'));
      try { import.meta.resolve('./a%2Fb.js'); } catch (error) { console.log(error.code); }
    `
    );
    await fixture.runtime.execute(entry);
    expect(output).toEqual([
      `${entry} ${fixture.rootPath}`,
      `file://${fixture.rootPath}/meta%20%23%25.mjs`,
      `file://${fixture.rootPath}/missing.mjs`,
      `file://${fixture.rootPath}/node_modules/conditional/import.mjs`,
      'node:fs',
      'data:text/javascript,export default 1',
      'ERR_INVALID_MODULE_SPECIFIER',
    ]);
    expect(errors).toEqual([]);
  });
});
