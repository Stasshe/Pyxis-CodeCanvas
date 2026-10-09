import {
  ServerResponse as NativeServerResponse,
  METHODS as NODE_METHODS,
  STATUS_CODES as NODE_STATUS_CODES,
} from 'node:http';
import type { Socket } from 'node:net';
import { Duplex, Writable } from 'node:stream';
import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHTTPModule,
  createHTTPSModule,
  IncomingMessage,
  ServerResponse,
} from '@/engine/system/runtime/nodejs/modules/httpModule';

class MemoryDuplex extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString();
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function finished(stream: NodeJS.EventEmitter): Promise<void> {
  return new Promise(resolve => stream.once('finish', resolve));
}

interface ParsedResponse {
  statusLine: string;
  headers: Record<string, string[]>;
  body: Buffer;
}

function parseResponse(wire: Buffer): ParsedResponse {
  const headerEnd = wire.indexOf('\r\n\r\n');
  const headerLines = wire.subarray(0, headerEnd).toString().split('\r\n');
  const statusLine = headerLines.shift() ?? '';
  const headers: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    const name = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    const existing = headers[name] ?? [];
    existing.push(value);
    headers[name] = existing;
  }
  let body = wire.subarray(headerEnd + 4);
  const transferEncoding = headers['transfer-encoding']?.join(', ').toLowerCase();
  if (transferEncoding?.includes('chunked')) body = decodeChunks(body);
  return { statusLine, headers, body };
}

function decodeChunks(wire: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < wire.byteLength) {
    const sizeEnd = wire.indexOf('\r\n', offset);
    const size = Number.parseInt(wire.subarray(offset, sizeEnd).toString(), 16);
    if (size === 0) break;
    const chunkStart = sizeEnd + 2;
    chunks.push(wire.subarray(chunkStart, chunkStart + size));
    offset = chunkStart + size + 2;
  }
  return Buffer.concat(chunks);
}

function expectSameResponse(actual: Buffer, expected: Buffer): void {
  const actualResponse = parseResponse(actual);
  const expectedResponse = parseResponse(expected);
  expect(actualResponse.statusLine).toBe(expectedResponse.statusLine);
  expect(actualResponse.headers).toEqual(expectedResponse.headers);
  expect(actualResponse.body).toEqual(expectedResponse.body);
}

describe('HTTP module', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('matches Node HTTP method and status tables', () => {
    const http = createHTTPModule();
    expect(http.METHODS).toEqual(NODE_METHODS);
    expect(http.STATUS_CODES).toEqual(NODE_STATUS_CODES);
  });

  it('matches Node ServerResponse wire bytes and finish lifecycle', async () => {
    const actualSocket = new MemoryDuplex();
    const expectedSocket = new MemoryDuplex();
    const actual = new ServerResponse();
    const expected = new NativeServerResponse({ method: 'GET' } as NodeJS.IncomingMessage);
    actual.sendDate = false;
    expected.sendDate = false;
    actual.assignSocket(actualSocket);
    expected.assignSocket(expectedSocket as Socket);

    actual.statusCode = 201;
    actual.setHeader('Content-Type', 'text/plain');
    const actualFinished = finished(actual);
    actual.write('created ');
    actual.end('resource');
    expected.statusCode = 201;
    expected.setHeader('Content-Type', 'text/plain');
    const expectedFinished = finished(expected);
    expected.write('created ');
    expected.end('resource');
    await Promise.all([actualFinished, expectedFinished]);

    expectSameResponse(actualSocket.bytes(), expectedSocket.bytes());
    expect(actual.writableFinished).toBe(true);
  });

  it('matches Node length framing for end with and without a final body chunk', async () => {
    const actualBodySocket = new MemoryDuplex();
    const expectedBodySocket = new MemoryDuplex();
    const actualBodyResponse = new ServerResponse();
    const expectedBodyResponse = new NativeServerResponse({
      method: 'GET',
    } as NodeJS.IncomingMessage);
    actualBodyResponse.sendDate = false;
    expectedBodyResponse.sendDate = false;
    actualBodyResponse.assignSocket(actualBodySocket);
    expectedBodyResponse.assignSocket(expectedBodySocket as Socket);
    const actualBodyFinished = finished(actualBodyResponse);
    actualBodyResponse.end('done');
    const expectedBodyFinished = finished(expectedBodyResponse);
    expectedBodyResponse.end('done');
    await Promise.all([actualBodyFinished, expectedBodyFinished]);
    expectSameResponse(actualBodySocket.bytes(), expectedBodySocket.bytes());
    expect(actualBodyResponse.getHeader('content-length')).toBeUndefined();

    const actualEmptySocket = new MemoryDuplex();
    const expectedEmptySocket = new MemoryDuplex();
    const actualEmptyResponse = new ServerResponse();
    const expectedEmptyResponse = new NativeServerResponse({
      method: 'GET',
    } as NodeJS.IncomingMessage);
    actualEmptyResponse.sendDate = false;
    expectedEmptyResponse.sendDate = false;
    actualEmptyResponse.assignSocket(actualEmptySocket);
    expectedEmptyResponse.assignSocket(expectedEmptySocket as Socket);
    const actualEmptyFinished = finished(actualEmptyResponse);
    actualEmptyResponse.end();
    const expectedEmptyFinished = finished(expectedEmptyResponse);
    expectedEmptyResponse.end();
    await Promise.all([actualEmptyFinished, expectedEmptyFinished]);
    expectSameResponse(actualEmptySocket.bytes(), expectedEmptySocket.bytes());
    expect(actualEmptyResponse.getHeader('content-length')).toBeUndefined();
  });

  it('keeps automatic wire headers out of response header getters', async () => {
    const socket = new MemoryDuplex();
    const response = new ServerResponse();
    response.assignSocket(socket);
    const responseFinished = finished(response);
    response.end('body');
    expect(response.getHeader('content-length')).toBeUndefined();
    expect(response.getHeader('date')).toBeUndefined();
    expect(response.getHeader('connection')).toBeUndefined();
    await responseFinished;
    const parsed = parseResponse(socket.bytes());
    expect(parsed.headers['content-length']).toEqual(['4']);
    expect(parsed.headers.connection).toEqual(['keep-alive']);
    expect(parsed.headers.date).toHaveLength(1);
  });

  it('retains header values and serializes appended cookies separately', async () => {
    const socket = new MemoryDuplex();
    const response = new ServerResponse();
    response.assignSocket(socket);
    response.sendDate = false;
    response.setHeader('Set-Cookie', ['session=one', 'theme=dark']);
    response.appendHeader('Set-Cookie', 'language=ja');
    response.setHeader('X-Retry-After', 4);
    expect(response.getHeader('set-cookie')).toEqual(['session=one', 'theme=dark', 'language=ja']);
    expect(response.getHeader('x-retry-after')).toBe(4);
    expect(Object.getPrototypeOf(response.getHeaders())).toBeNull();

    const responseFinished = finished(response);
    response.writeHead(422, { 'Content-Length': 0 });
    response.end();
    await responseFinished;
    expect(socket.text()).toContain('HTTP/1.1 422 Unprocessable Entity\r\n');
    expect(socket.text()).toContain(
      'Set-Cookie: session=one\r\nSet-Cookie: theme=dark\r\nSet-Cookie: language=ja\r\n'
    );
  });

  it('suppresses bodies for HEAD and 204 responses', async () => {
    const headSocket = new MemoryDuplex();
    const headRequest = new IncomingMessage();
    headRequest.method = 'HEAD';
    const headResponse = new ServerResponse(headRequest);
    headResponse.assignSocket(headSocket);
    headResponse.sendDate = false;
    const headFinished = finished(headResponse);
    headResponse.write('not sent');
    headResponse.end();
    await headFinished;
    expect(headSocket.text()).toContain('HTTP/1.1 200 OK\r\n');
    expect(headSocket.text()).not.toContain('Transfer-Encoding: chunked');
    expect(headSocket.text()).not.toContain('not sent');

    const noContentSocket = new MemoryDuplex();
    const noContentResponse = new ServerResponse();
    noContentResponse.assignSocket(noContentSocket);
    noContentResponse.sendDate = false;
    const noContentFinished = finished(noContentResponse);
    noContentResponse.statusCode = 204;
    noContentResponse.end('not sent');
    await noContentFinished;
    expect(noContentSocket.text()).toContain('HTTP/1.1 204 No Content\r\n');
    expect(noContentSocket.text()).not.toContain('Transfer-Encoding: chunked');
    expect(noContentSocket.text()).not.toContain('not sent');
  });

  it('streams binary response chunks through IncomingMessage', async () => {
    const message = new IncomingMessage();
    const chunks: Buffer[] = [];
    message.on('data', (chunk: Buffer) => chunks.push(chunk));
    const ended = new Promise<void>(resolve => message.once('end', resolve));
    message.push(Buffer.from([0, 255]));
    message.push(null);
    await ended;
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0, 255]));
  });

  it('sends request bytes on end and tracks response body completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { forEach: vi.fn() },
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array([0, 255]) })
            .mockResolvedValueOnce({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    let trackedRequest: Promise<void> | undefined;
    const http = createHTTPSModule(() => <T>(promise: Promise<T>): Promise<T> => {
      trackedRequest = promise.then(() => undefined);
      return promise;
    });
    const request = http.request({ hostname: 'service.test', method: 'POST' });
    request.write(Buffer.from([9, 0, 255, 9]).subarray(1, 3));
    const received = new Promise<IncomingMessage>(resolve => request.on('response', resolve));
    let endCallbackCalled = false;
    request.end(() => {
      endCallbackCalled = true;
    });
    await vi.waitFor(() => expect(endCallbackCalled).toBe(true));
    const response = await received;
    expect(trackedRequest).toBeDefined();
    await trackedRequest;
    const requestBody = fetchMock.mock.calls[0][1].body as Blob;
    expect([...new Uint8Array(await requestBody.arrayBuffer())]).toEqual([0, 255]);
    expect(response.complete).toBe(true);
  });

  it('uses HTTPS for https.get and aborts fetch on request abort', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const https = createHTTPSModule();
    const request = https.get('https://service.test/path');
    request.on('error', () => {});
    request.abort();
    await Promise.resolve();
    expect(fetchMock.mock.calls[0][0]).toBe('https://service.test/path');
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('normalizes URL, options, and callback overloads and sends mutable headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { forEach: vi.fn() },
      body: null,
    });
    vi.stubGlobal('fetch', fetchMock);
    const http = createHTTPModule();
    let callbackResponse: IncomingMessage | undefined;
    const request = http.request(
      new URL('http://service.test/original'),
      { method: 'POST', path: '/override', headers: { 'x-initial': 'one' } },
      response => {
        callbackResponse = response;
      }
    );
    expect(request).toBeInstanceOf(Writable);
    request.setHeader('x-added', 'two');
    request.removeHeader('x-initial');
    request.end('body');
    await vi.waitFor(() => expect(callbackResponse).toBeDefined());
    expect(fetchMock.mock.calls[0][0]).toBe('http://service.test/override');
    expect(fetchMock.mock.calls[0][1].headers.get('x-added')).toBe('two');
    expect(fetchMock.mock.calls[0][1].headers.has('x-initial')).toBe(false);
    expect(() => request.setHeader('x-late', 'no')).toThrow('after they are sent');
  });

  it('uses HTTP by default and rejects protocol mismatches synchronously', () => {
    expect(() => createHTTPModule().request('https://service.test')).toThrow('Expected http:');
    expect(() => createHTTPSModule().request('http://service.test')).toThrow('Expected https:');
  });

  it('emits timeout without aborting fetch and clears the timer after abort', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = createHTTPModule().request('http://service.test');
    const timedOut = new Promise<void>(resolve => request.once('timeout', resolve));
    const errored = new Promise<void>(resolve => request.once('error', () => resolve()));
    request.setTimeout(1);
    request.end();
    await timedOut;
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
    request.abort();
    await errored;
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('rejects invalid header names and CRLF in values', () => {
    const response = new ServerResponse();
    expect(() => response.setHeader('bad header', 'value')).toThrow('header field name');
    expect(() => response.setHeader('X-Value', 'one\r\ntwo')).toThrow('header content');
  });

  it('rejects createServer instead of returning a server that never handles requests', () => {
    expect(() => createHTTPModule().createServer()).toThrow('http.createServer is unavailable');
  });
});
