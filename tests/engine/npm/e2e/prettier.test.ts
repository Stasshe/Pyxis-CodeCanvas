import { beforeAll, describe, expect, it } from 'vitest';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import type { FsCore } from '@/engine/core/fs/core';
import { ModuleFileSystem } from '@/engine/runtime/module/moduleFileSystem';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import type { MemoryFs } from '../../../_helpers/memoryFs';
import { createNodeRuntimeFixture } from '../../../_helpers/nodeRuntime';
import { loadNpmRuntimeFs } from '../../../_helpers/npmRuntime';
import { setupTestProject } from '../../../_helpers/testProject';

type DebugConsole = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  clear: () => void;
};

interface CollectedOutput {
  debugConsole: DebugConsole;
  output: string[];
  errors: string[];
  all(): string;
}

function collectOutput(): CollectedOutput {
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
    all: () => [...output, ...errors].join('\n'),
  };
}

async function writeRuntimeFile(fs: MemoryFs, path: string, content: string): Promise<void> {
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(path, new TextEncoder().encode(content));
}

async function readRuntimeFile(fs: MemoryFs, path: string): Promise<string> {
  return new TextDecoder().decode(await fs.readFile(path));
}

async function runPrettier(
  runtimeFs: MemoryFs,
  rootPath: string,
  binPath: string,
  args: string[],
  cwd = rootPath
): Promise<{ output: string[]; errors: string[]; all: string; exitCode: number }> {
  const collected = collectOutput();
  const fixture = await createNodeRuntimeFixture(
    rootPath,
    collected.debugConsole,
    cwd,
    undefined,
    runtimeFs
  );
  try {
    await fixture.runtime.execute(binPath, args);
    await fixture.runtime.waitForEventLoop();
    return {
      output: collected.output,
      errors: collected.errors,
      all: collected.all(),
      exitCode: fixture.runtime.getExitCode(),
    };
  } finally {
    await fixture.close();
  }
}

describe('Prettier npm runtime integration', () => {
  let repo: FsCore;
  let rootPath: string;
  let runtimeFs: MemoryFs;
  let binPath: string;
  let packageVersion: string;

  beforeAll(async () => {
    const project = await setupTestProject('PrettierE2ETest');
    repo = project.repo;
    rootPath = project.rootPath;

    const installer = new NpmInstall(rootPath, repo);
    await installer.installWithDependencies('prettier', 'latest');
    await installer.ensureBinsForPackage('prettier');

    const packagePath = `${rootPath}/node_modules/prettier/package.json`;
    const pkg = JSON.parse(await repo.readText(packagePath)) as {
      name: string;
      version: string;
      bin: string | Record<string, string>;
    };
    packageVersion = pkg.version;
    const binEntry = (typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin)[0]).replace(
      /^\.\//,
      ''
    );
    binPath = `${rootPath}/node_modules/prettier/${binEntry}`;
    runtimeFs = await loadNpmRuntimeFs(repo, rootPath);
  }, 120_000);

  it('installs package metadata and a relative executable symlink', async () => {
    const pkg = JSON.parse(
      await repo.readText(`${rootPath}/node_modules/prettier/package.json`)
    ) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('prettier');
    expect(pkg.version).toBe(packageVersion);

    expect(await repo.readlink(`${rootPath}/node_modules/.bin/prettier`)).toBe(
      `../prettier/${binPath.slice(`${rootPath}/node_modules/prettier/`.length)}`
    );
  });

  it('resolves Prettier through the runtime module resolver', async () => {
    const fixture = await createNodeRuntimeFixture(
      rootPath,
      undefined,
      rootPath,
      undefined,
      runtimeFs
    );
    try {
      const resolver = new ModuleResolver(rootPath, new ModuleFileSystem(fixture.bridge));
      const result = await resolver.resolve('prettier', `${rootPath}/index.js`);
      expect(result?.path).toContain('/node_modules/prettier/');
    } finally {
      await fixture.close();
    }
  });

  it('prints the installed version from its bin entry', async () => {
    const result = await runPrettier(runtimeFs, rootPath, binPath, ['--version']);
    expect(result.all).not.toContain('Cannot find module');
    expect(result.all).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.output.some(line => line.trim() === packageVersion)).toBe(true);
  }, 60_000);

  it('exposes the format API through require', async () => {
    const entry = `${rootPath}/test-prettier-api.js`;
    await writeRuntimeFile(
      runtimeFs,
      entry,
      "const p = require('prettier'); console.log(typeof p.format);"
    );
    const result = await runPrettier(runtimeFs, rootPath, entry, []);
    expect(result.all).not.toContain('Cannot find module');
    expect(result.output.some(line => line.includes('function'))).toBe(true);
  }, 60_000);

  it('formats one source file in place', async () => {
    const path = `${rootPath}/src/fmt-test.js`;
    const unformatted = 'const x={a:1,b:2,c:3};function foo(){return x;}';
    await writeRuntimeFile(runtimeFs, path, unformatted);
    const result = await runPrettier(runtimeFs, rootPath, binPath, ['src/fmt-test.js', '--write']);

    expect(result.all).not.toContain('Cannot find module');
    const formatted = await readRuntimeFile(runtimeFs, path);
    expect(formatted).not.toBe(unformatted);
    expect(formatted).toContain('function foo()');
  }, 90_000);

  it('formats multiple files and reports paths relative to cwd', async () => {
    const files = new Map([
      [`${rootPath}/src/multi/a.js`, 'const a={x:1};'],
      [`${rootPath}/src/multi/b.js`, 'function bar(  ){return 42;}'],
    ]);
    for (const [path, content] of files) await writeRuntimeFile(runtimeFs, path, content);
    const result = await runPrettier(runtimeFs, rootPath, binPath, ['src/multi/', '--write']);

    expect(result.all).not.toContain('Cannot find module');
    for (const [path, original] of files) {
      expect(await readRuntimeFile(runtimeFs, path)).not.toBe(original);
    }

    const pathLines = result.output.filter(line => line.includes('a.js') || line.includes('b.js'));
    expect(pathLines.every(line => !line.startsWith('../') && !line.includes('../../'))).toBe(true);
  }, 90_000);

  it('reports unchanged files on a repeated write', async () => {
    const path = `${rootPath}/src/already-fmt.js`;
    await writeRuntimeFile(runtimeFs, path, 'const z = { a: 1 };\n');
    await runPrettier(runtimeFs, rootPath, binPath, ['src/already-fmt.js', '--write']);
    const result = await runPrettier(runtimeFs, rootPath, binPath, [
      'src/already-fmt.js',
      '--write',
    ]);

    expect(result.output.join('\n')).toContain('unchanged');
  }, 90_000);

  it('returns a nonzero status for unformatted files in check mode', async () => {
    await writeRuntimeFile(runtimeFs, `${rootPath}/src/check-bad.js`, 'const q={x:1,y:2};');
    const result = await runPrettier(runtimeFs, rootPath, binPath, ['src/check-bad.js', '--check']);

    expect(result.all).not.toContain('Cannot find module');
    expect(result.exitCode).not.toBe(0);
  }, 60_000);

  it('returns zero for formatted files in check mode', async () => {
    const path = `${rootPath}/src/check-good.js`;
    await writeRuntimeFile(runtimeFs, path, 'const q = { x: 1, y: 2 };\n');
    await runPrettier(runtimeFs, rootPath, binPath, ['src/check-good.js', '--write']);
    const result = await runPrettier(runtimeFs, rootPath, binPath, [
      'src/check-good.js',
      '--check',
    ]);

    expect(result.all).not.toContain('Cannot find module');
    expect(result.exitCode).toBe(0);
  }, 90_000);

  it('formats TypeScript and CSS files', async () => {
    const tsPath = `${rootPath}/src/hello.ts`;
    const cssPath = `${rootPath}/src/style.css`;
    await writeRuntimeFile(runtimeFs, tsPath, 'const fn=(x:number):string=>{return String(x);}');
    await writeRuntimeFile(runtimeFs, cssPath, '.foo{color:red;margin:0}');

    await runPrettier(runtimeFs, rootPath, binPath, ['src/hello.ts', '--write']);
    await runPrettier(runtimeFs, rootPath, binPath, ['src/style.css', '--write']);

    const formattedTs = await readRuntimeFile(runtimeFs, tsPath);
    const formattedCss = await readRuntimeFile(runtimeFs, cssPath);
    expect(formattedTs).toContain('number');
    expect(formattedTs).toContain('string');
    expect(formattedCss).not.toBe('.foo{color:red;margin:0}');
    expect(formattedCss).toContain('color');
  }, 90_000);
});
