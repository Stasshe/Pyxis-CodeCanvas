import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import type { FsCore } from '@/engine/core/fs/core';
import { ModuleFileSystem } from '@/engine/runtime/module/moduleFileSystem';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import type { NodeRuntimeFixture } from '../../../_helpers/nodeRuntime';
import { createNpmRuntimeFixture } from '../../../_helpers/npmRuntime';
import { setupTestProject } from '../../../_helpers/testProject';

interface OutputCapture {
  debugConsole: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    clear: () => void;
  };
  output: string[];
  errors: string[];
}

interface SuiteResult {
  output: string[];
  errors: string[];
  exitCode: number;
}

function collectOutput(): OutputCapture {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    debugConsole: {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
      warn: (...args) => output.push(args.map(String).join(' ')),
      clear: () => {},
    },
    output,
    errors,
  };
}

async function runUvuSuite(
  fixture: NodeRuntimeFixture,
  repo: FsCore,
  rootPath: string,
  source: string,
  expectedExitCode: number
): Promise<SuiteResult> {
  const capture = collectOutput();
  await fixture.close();
  const runtimeFixture = await createNpmRuntimeFixture(repo, rootPath, capture.debugConsole);
  try {
    const scriptPath = `${rootPath}/uvu-suite.cjs`;
    await runtimeFixture.writeFile(
      scriptPath,
      [
        "const { suite, exec } = require('uvu');",
        "const assert = require('assert');",
        "const test = suite('installed uvu suite');",
        source,
        'test.run();',
        `module.exports.__promise = exec().then(() => {`,
        `  assert.strictEqual(process.exitCode || 0, ${expectedExitCode});`,
        '  process.exit(process.exitCode || 0);',
        '});',
      ].join('\n')
    );
    await runtimeFixture.runtime.execute(scriptPath);
    await runtimeFixture.runtime.waitForEventLoop();

    return {
      output: capture.output,
      errors: capture.errors,
      exitCode: runtimeFixture.runtime.getExitCode(),
    };
  } finally {
    await runtimeFixture.close();
  }
}

describe('uvu npm runtime integration', () => {
  let repo: FsCore;
  let rootPath: string;
  let fixture: NodeRuntimeFixture;

  beforeEach(async () => {
    const project = await setupTestProject('UvuE2ETest');
    repo = project.repo;
    rootPath = project.rootPath;
    const installer = new NpmInstall(rootPath, repo);
    await installer.installWithDependencies('uvu', 'latest');
    await installer.ensureBinsForPackage('uvu');
    await installer.ensureBinsForPackage('sade');
    fixture = await createNpmRuntimeFixture(repo, rootPath);
  });

  afterEach(async () => {
    await fixture.close();
    // Runtime globals share the host, so clear uvu's test-owned controls.
    Reflect.deleteProperty(globalThis, 'UVU_QUEUE');
  });

  it('resolves uvu package.json from its installed bin entry', async () => {
    const pkg = JSON.parse(await repo.readText(`${rootPath}/node_modules/uvu/package.json`)) as {
      bin: string | Record<string, string>;
    };
    const binEntry = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin)[0];
    const currentFile = `${rootPath}/node_modules/uvu/${binEntry.replace(/^\.\//, '')}`;
    const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(fixture.bridge));

    const result = await resolver.resolve('./package', currentFile);

    expect(result?.path).toBe(`${rootPath}/node_modules/uvu/package.json`);
  }, 60_000);

  it('prints the installed version through its executable symlink', async () => {
    const shimPath = `${rootPath}/node_modules/.bin/uvu`;
    expect(await repo.readlink(shimPath)).toMatch(/^\.\.\/uvu\//);

    const capture = collectOutput();
    await fixture.close();
    fixture = await createNpmRuntimeFixture(repo, rootPath, capture.debugConsole);

    await fixture.runtime.execute(shimPath, ['--version']);
    await fixture.runtime.waitForEventLoop();

    expect(fixture.runtime.getExitCode()).toBe(0);
    const allOutput = [...capture.output, ...capture.errors].join('\n');
    const pkg = JSON.parse(await repo.readText(`${rootPath}/node_modules/uvu/package.json`)) as {
      version: string;
    };
    expect(allOutput).toContain(pkg.version);
    expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(allOutput).not.toContain("Cannot find module './package'");
    expect(allOutput).not.toContain('Cannot find module');
    expect(allOutput).not.toContain('Module execution failed');
    expect(allOutput).not.toMatch(/ERROR:/i);
    expect(capture.errors).toHaveLength(0);
  }, 120_000);

  it('resolves package.json during dependency preload', async () => {
    await fixture.writeFile(
      `${rootPath}/node_modules/test-pkg/package.json`,
      JSON.stringify({ name: 'test-pkg', version: '1.0.0', main: 'index.js' })
    );
    await fixture.writeFile(
      `${rootPath}/node_modules/test-pkg/index.js`,
      "const pkg = require('./package');\nmodule.exports = { name: pkg.name };"
    );
    const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(fixture.bridge));

    const result = await resolver.resolve(
      './package',
      `${rootPath}/node_modules/test-pkg/index.js`
    );

    expect(result?.path).toBe(`${rootPath}/node_modules/test-pkg/package.json`);
  }, 60_000);

  it('runs an installed uvu suite and awaits its exported exec promise', async () => {
    const result = await runUvuSuite(
      fixture,
      repo,
      rootPath,
      [
        "test('first assertion', () => assert.strictEqual(2 + 2, 4));",
        "test('async assertion', async () => assert.strictEqual(await Promise.resolve('ready'), 'ready'));",
      ].join('\n'),
      0
    );

    expect(result.exitCode).toBe(0);
    expect(result.output.join('\n')).toContain('(2 / 2)');
    expect(result.output.join('\n')).toContain('Total:     2');
    expect(result.output.join('\n')).toContain('Passed:    2');
    expect(result.errors).toHaveLength(0);
  }, 120_000);

  it('reports failed installed uvu assertions and preserves the failure exit code', async () => {
    const result = await runUvuSuite(
      fixture,
      repo,
      rootPath,
      [
        "test('passing assertion', () => assert.strictEqual('uvu', 'uvu'));",
        "test('failing assertion', () => assert.strictEqual('actual', 'expected'));",
      ].join('\n'),
      1
    );

    expect(result.exitCode).toBe(1);
    expect(result.output.join('\n')).toContain('(1 / 2)');
    expect(result.output.join('\n')).toContain('Total:     2');
    expect(result.output.join('\n')).toContain('Passed:    1');
    expect(result.output.join('\n')).toContain('failing assertion');
    expect(result.errors).toHaveLength(0);
  }, 120_000);
});
