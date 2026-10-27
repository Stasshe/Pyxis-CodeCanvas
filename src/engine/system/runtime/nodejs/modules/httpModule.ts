/** Browser-compatible HTTP client APIs and an in-memory server response surface. */

import { Readable, Writable } from 'node:stream';
import { Buffer } from 'buffer';

interface RequestOptions {
  host?: string;
  hostname?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string | number | readonly string[]>;
  auth?: string;
  timeout?: number;
  family?: number;
  localAddress?: string;
  localPort?: number;
  socketPath?: string;
  setHost?: boolean;
  protocol?: string;
}

type RequestInput = RequestOptions | URL | string;
type RequestCallback = (response: IncomingMessage) => void;
type TrackIO = <T>(promise: Promise<T>) => Promise<T>;
type HeaderValue = string | number | readonly string[];

interface HttpSocket {
  write(chunk: Uint8Array, callback?: (error?: Error | null) => void): boolean;
  end(chunk?: Uint8Array, callback?: () => void): this;
  destroy(error?: Error): this;
  writable: boolean;
  destroyed: boolean;
}

const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a Teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

function parsePort(port: string): number | undefined {
  if (port.length === 0) return undefined;
  return Number(port);
}

function optionsFromUrl(url: URL): RequestOptions {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: parsePort(url.port),
    path: url.pathname + url.search,
    method: 'GET',
  };
}

function normalizeOptions(input: RequestInput, overrides?: RequestOptions): RequestOptions {
  let base: RequestOptions;
  if (typeof input === 'string') base = optionsFromUrl(new URL(input));
  else if (input instanceof URL) base = optionsFromUrl(input);
  else base = input;
  if (!overrides) return base;
  return { ...base, ...overrides, headers: { ...base.headers, ...overrides.headers } };
}

function requestArguments(
  optionsOrCallback?: RequestOptions | RequestCallback,
  callback?: RequestCallback
): { options?: RequestOptions; callback?: RequestCallback } {
  if (typeof optionsOrCallback === 'function') return { callback: optionsOrCallback };
  return { options: optionsOrCallback, callback };
}

function validateHeader(name: string, value: HeaderValue): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
    throw new TypeError(`Invalid character in header field name: ${name}`);
  }
  let values: readonly string[];
  if (Array.isArray(value)) values = value;
  else values = [String(value)];
  for (const item of values) {
    if (/[\r\n]/.test(String(item)))
      throw new TypeError(`Invalid character in header content: ${name}`);
  }
}

export class IncomingMessage extends Readable {
  statusCode = 200;
  statusMessage = 'OK';
  headers: Record<string, string> = Object.create(null) as Record<string, string>;
  rawHeaders: string[] = [];
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  complete = false;
  url?: string;
  method?: string;
  trailers: Record<string, string> = Object.create(null) as Record<string, string>;
  rawTrailers: string[] = [];
  socket: HttpSocket | undefined;
  res: ServerResponse | undefined;

  constructor(socket?: HttpSocket) {
    super();
    this.socket = socket;
  }

  get connection(): HttpSocket | undefined {
    return this.socket;
  }

  set connection(socket: HttpSocket | undefined) {
    this.socket = socket;
  }

  _read(): void {}
}

export class OutgoingMessage extends Writable {
  statusCode = 200;
  private explicitStatusMessage: string | undefined;
  sendDate = true;
  headersSent = false;
  private readonly headers = new Map<string, { name: string; value: HeaderValue }>();
  private socketTransport: HttpSocket | undefined;
  private headersCommitted = false;
  private useChunkedEncoding = false;
  private automaticContentLength: number | undefined;

  constructor() {
    super();
  }

  get socket(): HttpSocket | undefined {
    return this.socketTransport;
  }

  get connection(): HttpSocket | undefined {
    return this.socketTransport;
  }

  get finished(): boolean {
    return this.writableFinished;
  }

  get statusMessage(): string {
    if (this.explicitStatusMessage !== undefined) return this.explicitStatusMessage;
    return STATUS_CODES[this.statusCode] ?? 'unknown';
  }

  set statusMessage(value: string) {
    validateHeader('statusMessage', value);
    this.explicitStatusMessage = value;
  }

  end(
    chunkOrCallback?: string | Uint8Array | (() => void),
    encodingOrCallback?: BufferEncoding | (() => void),
    callback?: () => void
  ): this {
    let chunk: string | Uint8Array | undefined;
    let encoding: BufferEncoding | undefined;
    if (typeof chunkOrCallback === 'function') callback = chunkOrCallback;
    else chunk = chunkOrCallback;
    if (typeof encodingOrCallback === 'function') callback = encodingOrCallback;
    else encoding = encodingOrCallback;
    if (
      !this.headersCommitted &&
      this.writableLength === 0 &&
      !this.hasHeader('content-length') &&
      !this.hasHeader('transfer-encoding') &&
      this.statusCode !== 204 &&
      this.statusCode !== 304
    ) {
      let length = 0;
      if (typeof chunk === 'string') length = Buffer.from(chunk, encoding).byteLength;
      if (chunk instanceof Uint8Array) length = chunk.byteLength;
      this.automaticContentLength = length;
    }
    if (chunk === undefined) {
      if (callback) return super.end(callback);
      return super.end();
    }
    if (encoding === undefined) {
      if (callback) return super.end(chunk, callback);
      return super.end(chunk);
    }
    if (callback) return super.end(chunk, encoding, callback);
    return super.end(chunk, encoding);
  }

  assignSocket(socket: HttpSocket): void {
    this.socketTransport = socket;
  }

  setHeader(name: string, value: HeaderValue): this {
    this.assertHeadersMutable();
    validateHeader(name, value);
    const normalizedName = name.toLowerCase();
    this.headers.set(normalizedName, { name, value });
    return this;
  }

  getHeader(name: string): HeaderValue | undefined {
    return this.headers.get(name.toLowerCase())?.value;
  }

  getHeaders(): Record<string, HeaderValue> {
    const result = Object.create(null) as Record<string, HeaderValue>;
    for (const [name, header] of this.headers) result[name] = header.value;
    return result;
  }

  appendHeader(name: string, value: HeaderValue): this {
    this.assertHeadersMutable();
    validateHeader(name, value);
    const existing = this.headers.get(name.toLowerCase());
    if (!existing) return this.setHeader(name, value);
    let previous: readonly string[];
    if (Array.isArray(existing.value)) previous = existing.value;
    else previous = [String(existing.value)];
    let appended: readonly string[];
    if (Array.isArray(value)) appended = value;
    else appended = [String(value)];
    this.headers.set(name.toLowerCase(), {
      name: existing.name,
      value: [...previous, ...appended],
    });
    return this;
  }

  getHeaderNames(): string[] {
    return [...this.headers.keys()];
  }
  hasHeader(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.assertHeadersMutable();
    this.headers.delete(name.toLowerCase());
  }

  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, HeaderValue>,
    suppliedHeaders?: Record<string, HeaderValue>
  ): this {
    this.assertHeadersMutable();
    this.statusCode = statusCode;
    let headers = suppliedHeaders;
    if (typeof statusMessageOrHeaders === 'string') this.statusMessage = statusMessageOrHeaders;
    if (typeof statusMessageOrHeaders === 'object') headers = statusMessageOrHeaders;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    }
    this.commitHeaders();
    return this;
  }

  flushHeaders(): void {
    this.commitHeaders();
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.commitHeaders();
    if (!this.canWriteBody()) {
      callback();
      return;
    }
    let body = chunk;
    if (this.useChunkedEncoding) {
      body = Buffer.concat([
        Buffer.from(`${chunk.byteLength.toString(16)}\r\n`),
        chunk,
        Buffer.from('\r\n'),
      ]);
    }
    const socket = this.requireSocket();
    socket.write(body, callback);
  }

  _final(callback: (error?: Error | null) => void): void {
    this.commitHeaders();
    const socket = this.requireSocket();
    if (this.useChunkedEncoding && this.canWriteBody()) socket.write(Buffer.from('0\r\n\r\n'));
    if (this.shouldCloseConnection()) socket.end(undefined, () => callback());
    else callback();
  }

  private assertHeadersMutable(): void {
    if (this.headersSent) throw new Error('Cannot set headers after they are sent');
  }

  private requireSocket(): HttpSocket {
    if (!this.socketTransport) throw new Error('Response socket has not been assigned');
    if (!this.socketTransport.writable || this.socketTransport.destroyed)
      throw new Error('Response socket is not writable');
    return this.socketTransport;
  }

  private shouldCloseConnection(): boolean {
    const explicitConnection = this.headers.get('connection')?.value;
    if (explicitConnection === undefined) return this.defaultConnection() === 'close';
    const connection = explicitConnection;
    if (typeof connection === 'string')
      return connection.toLowerCase().split(',').includes('close');
    if (Array.isArray(connection)) {
      return connection.some(value => value.toLowerCase().split(',').includes('close'));
    }
    return false;
  }

  private commitHeaders(): void {
    if (this.headersCommitted) return;
    const socket = this.requireSocket();
    const wireHeaders = new Map(this.headers);
    if (this.sendDate && !wireHeaders.has('date'))
      wireHeaders.set('date', { name: 'Date', value: new Date().toUTCString() });
    if (!wireHeaders.has('connection'))
      wireHeaders.set('connection', { name: 'Connection', value: this.defaultConnection() });
    if (this.automaticContentLength !== undefined && !wireHeaders.has('content-length'))
      wireHeaders.set('content-length', {
        name: 'Content-Length',
        value: this.automaticContentLength,
      });
    if (
      this.canWriteBody() &&
      !wireHeaders.has('content-length') &&
      !wireHeaders.has('transfer-encoding')
    ) {
      wireHeaders.set('transfer-encoding', { name: 'Transfer-Encoding', value: 'chunked' });
    }
    const transferEncoding = wireHeaders.get('transfer-encoding')?.value;
    if (typeof transferEncoding === 'string' && transferEncoding.toLowerCase().includes('chunked'))
      this.useChunkedEncoding = true;
    if (Array.isArray(transferEncoding)) {
      this.useChunkedEncoding = transferEncoding.some(value =>
        value.toLowerCase().includes('chunked')
      );
    }
    const lines = [`HTTP/1.1 ${this.statusCode} ${this.statusMessage}`];
    for (const header of wireHeaders.values()) {
      if (header.name.toLowerCase() === 'set-cookie' && Array.isArray(header.value)) {
        for (const cookie of header.value) lines.push(`${header.name}: ${cookie}`);
      } else {
        let value: string;
        if (Array.isArray(header.value)) value = header.value.join(', ');
        else value = String(header.value);
        lines.push(`${header.name}: ${value}`);
      }
    }
    lines.push('', '');
    socket.write(Buffer.from(lines.join('\r\n')));
    this.headersCommitted = true;
    this.headersSent = true;
  }

  protected canWriteBody(): boolean {
    return true;
  }

  protected defaultConnection(): string {
    return 'keep-alive';
  }
}

export class ServerResponse extends OutgoingMessage {
  req: IncomingMessage | undefined;

  constructor(request?: IncomingMessage) {
    super();
    this.req = request;
    if (request) request.res = this;
  }

  protected override canWriteBody(): boolean {
    if (this.statusCode >= 100 && this.statusCode < 200) return false;
    if (this.statusCode === 204 || this.statusCode === 304) return false;
    if (this.req?.method === 'HEAD') return false;
    return true;
  }

  protected override defaultConnection(): string {
    if (this.req?.headers.connection?.toLowerCase() === 'close') return 'close';
    return 'keep-alive';
  }
}

class ClientRequest extends Writable {
  private readonly options: RequestOptions;
  private readonly body: Buffer[] = [];
  private readonly requestHeaders = new Map<string, { name: string; value: HeaderValue }>();
  private aborted = false;
  private ended = false;
  private completed = false;
  private readonly trackIO: TrackIO | undefined;
  private readonly expectedProtocol: string;
  private readonly abortController = new AbortController();
  private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private timeoutDuration: number | undefined;

  constructor(
    options: RequestInput,
    callback?: (response: IncomingMessage) => void,
    trackIO?: TrackIO,
    expectedProtocol = 'http:'
  ) {
    super({ autoDestroy: false });
    this.trackIO = trackIO;
    this.expectedProtocol = expectedProtocol;
    this.options = normalizeOptions(options);
    for (const [name, value] of Object.entries(this.options.headers ?? {}))
      this.setHeader(name, value);
    const protocol = this.options.protocol ?? expectedProtocol;
    if (protocol !== expectedProtocol)
      throw new TypeError(`Protocol ${protocol} is unsupported. Expected ${expectedProtocol}`);
    if (callback) this.once('response', callback);
    if (this.options.timeout !== undefined && this.options.timeout > 0)
      this.timeoutDuration = this.options.timeout;
  }

  setHeader(name: string, value: HeaderValue): this {
    if (this.ended || this.writableEnded) throw new Error('Cannot set headers after they are sent');
    validateHeader(name, value);
    this.requestHeaders.set(name.toLowerCase(), { name, value });
    return this;
  }

  getHeader(name: string): HeaderValue | undefined {
    return this.requestHeaders.get(name.toLowerCase())?.value;
  }

  removeHeader(name: string): void {
    if (this.ended || this.writableEnded)
      throw new Error('Cannot remove headers after they are sent');
    this.requestHeaders.delete(name.toLowerCase());
  }

  override destroy(error?: Error): this {
    if (!this.aborted && !this.completed) {
      this.aborted = true;
      this.abortController.abort();
      this.clearTimeout();
      this.emit('abort');
    }
    return super.destroy(error);
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.body.push(Buffer.from(chunk));
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.ended = true;
    this.startTimeout();
    const request = this.sendRequest();
    this.trackIO?.(request);
    void request;
    callback();
  }

  abort(): void {
    this.destroy();
  }

  setTimeout(timeout: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback);
    this.timeoutDuration = undefined;
    if (timeout > 0) this.timeoutDuration = timeout;
    this.startTimeout();
    return this;
  }

  private startTimeout(): void {
    this.clearTimeout();
    if (!this.ended || this.timeoutDuration === undefined) return;
    this.timeoutTimer = setTimeout(() => {
      if (!this.completed) {
        this.emit('timeout');
      }
      this.timeoutTimer = undefined;
    }, this.timeoutDuration);
  }

  private clearTimeout(): void {
    if (this.timeoutTimer === undefined) return;
    clearTimeout(this.timeoutTimer);
    this.timeoutTimer = undefined;
  }

  private async sendRequest(): Promise<void> {
    if (this.aborted) return;
    const protocol = this.options.protocol ?? this.expectedProtocol;
    const hostname = this.options.hostname ?? this.options.host ?? 'localhost';
    let defaultPort = 80;
    if (this.expectedProtocol === 'https:') defaultPort = 443;
    let port = defaultPort;
    if (this.options.port !== undefined) port = Number(this.options.port);
    const path = this.options.path ?? '/';
    const method = this.options.method ?? 'GET';
    let portPart = '';
    if (port !== defaultPort) portPart = `:${port}`;
    const url = `${protocol}//${hostname}${portPart}${path}`;
    try {
      let requestBody: Blob | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const bytes = Buffer.concat(this.body);
        const bodyBuffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(bodyBuffer).set(bytes);
        requestBody = new Blob([bodyBuffer]);
      }
      const headers = new Headers();
      for (const header of this.requestHeaders.values()) {
        if (Array.isArray(header.value)) {
          for (const value of header.value) headers.append(header.name, String(value));
        } else {
          headers.set(header.name, String(header.value));
        }
      }
      if (this.options.auth && !headers.has('authorization')) {
        const credentials = Buffer.from(this.options.auth).toString('base64');
        headers.set('authorization', `Basic ${credentials}`);
      }
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: this.abortController.signal,
      });
      const message = new IncomingMessage();
      message.statusCode = response.status;
      message.statusMessage = response.statusText;
      response.headers.forEach((value, key) => {
        message.headers[key] = value;
      });
      this.emit('response', message);
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          if (result.value) message.push(Buffer.from(result.value));
        }
      }
      message.complete = true;
      message.push(null);
      this.completed = true;
      this.destroy();
    } catch (error) {
      let requestError: Error;
      if (error instanceof Error) requestError = error;
      else requestError = new Error(String(error));
      this.emit('error', requestError);
    } finally {
      this.clearTimeout();
    }
  }
}

export function createHTTPModule(getTrackIO?: () => TrackIO | undefined) {
  const unsupportedServer = (): never => {
    throw new Error('http.createServer is unavailable in the browser runtime');
  };
  const request = (
    input: RequestInput,
    optionsOrCallback?: RequestOptions | RequestCallback,
    callback?: RequestCallback
  ): ClientRequest => {
    const args = requestArguments(optionsOrCallback, callback);
    return new ClientRequest(
      normalizeOptions(input, args.options),
      args.callback,
      getTrackIO?.(),
      'http:'
    );
  };
  const get = (
    input: RequestInput,
    optionsOrCallback?: RequestOptions | RequestCallback,
    callback?: RequestCallback
  ): ClientRequest => {
    const args = requestArguments(optionsOrCallback, callback);
    const options = normalizeOptions(input, args.options);
    options.method = 'GET';
    const clientRequest = new ClientRequest(options, args.callback, getTrackIO?.(), 'http:');
    clientRequest.end();
    return clientRequest;
  };
  return {
    request,
    get,
    createServer: unsupportedServer,
    STATUS_CODES,
    METHODS: [
      'ACL',
      'BIND',
      'CHECKOUT',
      'CONNECT',
      'COPY',
      'DELETE',
      'GET',
      'HEAD',
      'LINK',
      'LOCK',
      'M-SEARCH',
      'MERGE',
      'MKACTIVITY',
      'MKCALENDAR',
      'MKCOL',
      'MOVE',
      'NOTIFY',
      'OPTIONS',
      'PATCH',
      'POST',
      'PROPFIND',
      'PROPPATCH',
      'PURGE',
      'PUT',
      'QUERY',
      'REBIND',
      'REPORT',
      'SEARCH',
      'SOURCE',
      'SUBSCRIBE',
      'TRACE',
      'UNBIND',
      'UNLINK',
      'UNLOCK',
      'UNSUBSCRIBE',
    ],
    IncomingMessage,
    OutgoingMessage,
    ServerResponse,
    ClientRequest,
  };
}

export function createHTTPSModule(getTrackIO?: () => TrackIO | undefined) {
  const httpModule = createHTTPModule(getTrackIO);
  const request = (
    input: RequestInput,
    optionsOrCallback?: RequestOptions | RequestCallback,
    callback?: RequestCallback
  ): ClientRequest => {
    const args = requestArguments(optionsOrCallback, callback);
    const options = normalizeOptions(input, args.options);
    options.protocol = options.protocol ?? 'https:';
    return new ClientRequest(options, args.callback, getTrackIO?.(), 'https:');
  };
  const get = (
    input: RequestInput,
    optionsOrCallback?: RequestOptions | RequestCallback,
    callback?: RequestCallback
  ): ClientRequest => {
    const args = requestArguments(optionsOrCallback, callback);
    const options = normalizeOptions(input, args.options);
    options.protocol = options.protocol ?? 'https:';
    options.method = 'GET';
    const clientRequest = new ClientRequest(options, args.callback, getTrackIO?.(), 'https:');
    clientRequest.end();
    return clientRequest;
  };
  return {
    ...httpModule,
    request,
    get,
    createServer: httpModule.createServer,
  };
}
