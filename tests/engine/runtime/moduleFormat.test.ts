import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

const hostTimeout = globalThis.setTimeout;

describe('NodeRuntime module formats', () => {
  let fixture: NodeRuntimeFixture;
  let output: string[];
  let errors: string[];

  beforeEach(async () => {
    output = [];
    errors = [];
    fixture = await createNodeRuntimeFixture('/tmp/runtime-tests', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
      warn: (...args) => output.push(args.map(String).join(' ')),
      clear: () => {},
    });
  });

  afterEach(() => {
    fixture.close();
    expect(globalThis.setTimeout).toBe(hostTimeout);
  });

  async function run(name: string, source: string): Promise<void> {
    const path = `${fixture.rootPath}/${name}`;
    await fixture.writeFile(path, source);
    await fixture.runtime.execute(path, []);
    await fixture.runtime.waitForEventLoop();
  }

  it('transforms erased type-only declarations in explicitly CommonJS TypeScript', async () => {
    await run(
      'types.cts',
      'import type Shape from "missing-types"; export interface Item { value: number } const value: number = 3; console.log(value);'
    );
    expect(output.join('\n')).toContain('3');
    expect(errors).toHaveLength(0);
  });

  it('preserves local process and filename declarations in ESM source and required modules', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/local.mjs`,
      'const process = { version: "local" }; const __filename = "source name"; export default `${process.version} ${__filename}`;'
    );
    await run(
      'local-bindings.mjs',
      'import value from "./local.mjs"; const __filename = "entry name"; console.log(value, __filename);'
    );
    expect(output.join('\n')).toContain('local source name entry name');
    expect(errors).toHaveLength(0);
  });

  it('applies explicit mjs and cjs formats before enclosing package type', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/package.json`,
      JSON.stringify({ type: 'commonjs' })
    );
    await run('module.mjs', 'export const value = 1; console.log(value);');
    expect(fixture.runtime.getExitCode()).toBe(0);
    fixture.close();
    fixture = await createNodeRuntimeFixture(
      fixture.rootPath,
      undefined,
      undefined,
      undefined,
      fixture.fs
    );
    await expect(run('invalid.cjs', 'export const value = 1;')).rejects.toThrow(
      'ES module syntax is not allowed'
    );
  });

  it('honors a type commonjs package for js files instead of syntax-based conversion', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/package.json`,
      JSON.stringify({ type: 'commonjs' })
    );
    await expect(run('invalid-type.js', 'export const value = 1;')).rejects.toThrow(
      'ES module syntax is not allowed'
    );
  });
});
