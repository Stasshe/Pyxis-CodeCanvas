import { beforeEach, describe, expect, it } from 'vitest';
import { fileRepository } from '@/engine/core/fileRepository';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { setupTestProject } from '../../_helpers/testProject';

describe('NodeRuntime process exit handling', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('NodeRuntimeExitTest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  it('process.exit stops further execution and preserves the exit code', async () => {
    await fileRepository.createFile(
      projectId,
      '/exit.js',
      [
        "console.log('before exit');",
        'process.exit(3);',
        "console.log('after exit');",
      ].join('\n'),
      'file'
    );

    const output: string[] = [];
    const errors: string[] = [];
    const entryPath = `/projects/${projectName}/exit.js`;

    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: entryPath,
      debugConsole: {
        log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        clear: () => {},
      },
    });

    await runtime.execute(entryPath, []);
    await runtime.waitForEventLoop();

    expect(runtime.getExitCode()).toBe(3);
    expect(output.join('\n')).toContain('before exit');
    expect(output.join('\n')).not.toContain('after exit');
    expect(errors).toHaveLength(0);
  });

  it('propagates process.exit from required modules without swallowing it as non-fatal', async () => {
    await fileRepository.createFile(
      projectId,
      '/dep.js',
      [
        "console.log('dep start');",
        'process.exit(7);',
        "console.log('dep after exit');",
      ].join('\n'),
      'file'
    );

    await fileRepository.createFile(
      projectId,
      '/main.js',
      [
        "require('./dep');",
        "console.log('main after require');",
      ].join('\n'),
      'file'
    );

    const output: string[] = [];
    const errors: string[] = [];
    const entryPath = `/projects/${projectName}/main.js`;

    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: entryPath,
      debugConsole: {
        log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        clear: () => {},
      },
    });

    await runtime.execute(entryPath, []);
    await runtime.waitForEventLoop();

    const combined = [...output, ...errors].join('\n');

    expect(runtime.getExitCode()).toBe(7);
    expect(combined).toContain('dep start');
    expect(combined).not.toContain('dep after exit');
    expect(combined).not.toContain('main after require');
    expect(combined).not.toContain('Module execution failed');
  });

  it('waits for module.exports.__promise before completing execution', async () => {
    await fileRepository.createFile(
      projectId,
      '/async-entry.js',
      [
        'module.exports.__promise = Promise.resolve().then(() => {',
        "  console.log('async version output');",
        '});',
      ].join('\n'),
      'file'
    );

    const output: string[] = [];
    const errors: string[] = [];
    const entryPath = `/projects/${projectName}/async-entry.js`;

    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: entryPath,
      debugConsole: {
        log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        clear: () => {},
      },
    });

    await runtime.execute(entryPath, []);
    await runtime.waitForEventLoop();

    expect(runtime.getExitCode()).toBe(0);
    expect(output.join('\n')).toContain('async version output');
    expect(errors).toHaveLength(0);
  });

  it('waits for unreturned async fs work before completing the event loop', async () => {
    await fileRepository.createFile(
      projectId,
      '/async-fs-entry.js',
      [
        "const { readdir } = require('fs');",
        "const { promisify } = require('util');",
        'const ls = promisify(readdir);',
        '(async () => {',
        "  await ls('.');",
        "  console.log('async fs output');",
        '})();',
      ].join('\n'),
      'file'
    );

    const output: string[] = [];
    const errors: string[] = [];
    const entryPath = `/projects/${projectName}/async-fs-entry.js`;

    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: entryPath,
      debugConsole: {
        log: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => output.push(args.map(String).join(' ')),
        clear: () => {},
      },
    });

    await runtime.execute(entryPath, []);
    await runtime.waitForEventLoop();

    expect(runtime.getExitCode()).toBe(0);
    expect(output.join('\n')).toContain('async fs output');
    expect(errors).toHaveLength(0);
  });
});
