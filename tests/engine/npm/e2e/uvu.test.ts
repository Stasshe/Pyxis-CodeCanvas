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

  afterEach(() => fixture.close());

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

  it('prints the installed version from its bin entry', async () => {
    const shimPath = `${rootPath}/node_modules/.bin/uvu`;
    const shim = await repo.readText(shimPath);
    expect(shim).toContain('require(');

    const capture = collectOutput();
    fixture.close();
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
});
