import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('stream builtin', () => {
  let fixture: NodeRuntimeFixture;
  const output: string[] = [];

  beforeEach(async () => {
    output.length = 0;
    fixture = await createNodeRuntimeFixture('/tmp/stream-module-tests', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: () => {},
      warn: () => {},
      clear: () => {},
    });
  });

  afterEach(() => {
    fixture.close();
  });

  it('exports a callable Stream constructor and attached stream classes', async () => {
    const entry = `${fixture.rootPath}/entry.js`;
    await fixture.writeFile(
      entry,
      [
        "const Stream = require('stream');",
        "const util = require('util');",
        'function SendStream() { Stream.call(this); }',
        'util.inherits(SendStream, Stream);',
        'const sendStream = new SendStream();',
        'const readable = new Stream.Readable({ read() {} });',
        'const writable = new Stream.Writable({ write(chunk, encoding, callback) { callback(); } });',
        'console.log(typeof Stream, sendStream instanceof Stream,',
        '  readable instanceof Stream.Readable, writable instanceof Stream.Writable,',
        '  Stream.Stream === Stream, typeof Stream.Duplex, typeof Stream.Transform,',
        '  typeof Stream.PassThrough);',
      ].join('\n')
    );

    await fixture.runtime.execute(entry);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(['function true true true true function function function']);
  });

  it('exposes process stdout as a Writable and preserves binary writes through callbacks', async () => {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const runtime = await createNodeRuntimeFixture(
      '/tmp/stream-stdio-tests',
      undefined,
      '/tmp/stream-stdio-tests',
      undefined,
      undefined,
      {
        onStdout: data => stdout.push(Buffer.from(data)),
        onStderr: data => stderr.push(Buffer.from(data)),
      }
    );
    try {
      const entry = `${runtime.rootPath}/entry.js`;
      await runtime.writeFile(
        entry,
        [
          "const { Writable } = require('stream');",
          'if (!(process.stdout instanceof Writable)) throw new Error("stdout is not a Writable");',
          'process.stdout.write(Buffer.from([0, 255, 128]), error => {',
          '  if (error) throw error;',
          '  process.stderr.write(Buffer.from([254]));',
          '});',
        ].join('\n')
      );
      await runtime.runtime.execute(entry);
      await runtime.runtime.waitForEventLoop();

      expect(Buffer.concat(stdout.map(data => Buffer.from(data)))).toEqual(
        Buffer.from([0, 255, 128])
      );
      expect(Buffer.concat(stderr.map(data => Buffer.from(data)))).toEqual(Buffer.from([254]));
    } finally {
      runtime.close();
    }
  });

  it('converts readable streams between Node and WHATWG APIs', async () => {
    const entry = `${fixture.rootPath}/entry.js`;
    await fixture.writeFile(
      entry,
      [
        "const { Readable } = require('node:stream');",
        "const { ReadableStream } = require('node:stream/web');",
        'async function text(stream) {',
        '  let value = "";',
        '  for await (const chunk of stream) value += chunk.toString();',
        '  return value;',
        '}',
        'async function run() {',
        '  const webReadable = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("from web")); controller.close(); } });',
        '  const nodeReadable = Readable.fromWeb(webReadable);',
        '  const webOutput = Readable.toWeb(Readable.from(["to ", "web"]));',
        '  const reader = webOutput.getReader();',
        '  let webText = "";',
        '  while (true) { const result = await reader.read(); if (result.done) break; webText += typeof result.value === "string" ? result.value : new TextDecoder().decode(result.value); }',
        '  console.log(await text(nodeReadable), webText);',
        '}',
        'run();',
      ].join('\n')
    );

    await fixture.runtime.execute(entry);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(['from web to web']);
  });
});
