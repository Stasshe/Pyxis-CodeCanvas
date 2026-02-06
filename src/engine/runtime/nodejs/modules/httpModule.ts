/**
 * [NEW ARCHITECTURE] http/https モジュールのエミュレーション
 */

interface RequestOptions {
  hostname?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: { [key: string]: string };
  auth?: string;
  timeout?: number;
  agent?: any;
  createConnection?: Function;
  family?: number;
  localAddress?: string;
  localPort?: number;
  socketPath?: string;
  setHost?: boolean;
  lookup?: Function;
  protocol?: string;
}

// IncomingMessageクラス（レスポンス）
class IncomingMessage {
  public statusCode = 200;
  public statusMessage = 'OK';
  public headers: { [key: string]: string } = {};
  public rawHeaders: string[] = [];
  public httpVersion = '1.1';
  public complete = false;
  public url?: string;
  public method?: string;
  public trailers: { [key: string]: string } = {};
  public rawTrailers: string[] = [];
  private _listeners: { [event: string]: Function[] } = {};
  private _chunks: Uint8Array[] = [];

  on(event: string, listener: Function): this {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(listener);
    return this;
  }

  once(event: string, listener: Function): this {
    const onceWrapper = (...args: unknown[]) => {
      listener(...args);
      this.removeListener(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._listeners[event];
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      }
      return true;
    }
    return false;
  }

  removeListener(event: string, listener: Function): this {
    const listeners = this._listeners[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  _addData(chunk: Uint8Array): void {
    this._chunks.push(chunk);
    this.emit('data', chunk);
  }

  _end(): void {
    this.complete = true;
    this.emit('end');
  }

  _error(error: Error): void {
    this.emit('error', error);
  }

  getText(): string {
    const decoder = new TextDecoder();
    return this._chunks.map(chunk => decoder.decode(chunk)).join('');
  }

  pause(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  isPaused(): boolean {
    return false;
  }
  setEncoding(encoding: string): this {
    return this;
  }
  read(): any {
    return null;
  }
  destroy(): this {
    return this;
  }
}

// ClientRequestクラス（リクエスト）
class ClientRequest {
  private _listeners: { [event: string]: Function[] } = {};
  private _options: RequestOptions;
  private _body = '';
  private _aborted = false;
  private _response: IncomingMessage | null = null;

  constructor(options: RequestOptions | string, callback?: Function) {
    if (typeof options === 'string') {
      const url = new URL(options);
      this._options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number.parseInt(url.port) : undefined,
        path: url.pathname + url.search,
        method: 'GET',
      };
    } else {
      this._options = options;
    }

    if (callback) {
      this.on('response', callback);
    }

    setTimeout(() => this._sendRequest(), 0);
  }

  on(event: string, listener: Function): this {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(listener);
    return this;
  }

  once(event: string, listener: Function): this {
    const onceWrapper = (...args: unknown[]) => {
      listener(...args);
      this.removeListener(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._listeners[event];
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      }
      return true;
    }
    return false;
  }

  removeListener(event: string, listener: Function): this {
    const listeners = this._listeners[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  write(chunk: string | Uint8Array, encoding?: string, callback?: Function): boolean {
    if (typeof chunk === 'string') {
      this._body += chunk;
    } else {
      const decoder = new TextDecoder();
      this._body += decoder.decode(chunk);
    }
    if (callback) callback();
    return true;
  }

  end(chunk?: string | Uint8Array, encoding?: string, callback?: Function): void {
    if (chunk) {
      this.write(chunk, encoding);
    }
    if (callback) callback();
  }

  abort(): void {
    this._aborted = true;
    this.emit('abort');
  }

  setTimeout(timeout: number, callback?: Function): this {
    if (callback) {
      this.once('timeout', callback);
    }
    setTimeout(() => {
      if (!this._response) {
        this.emit('timeout');
        this.abort();
      }
    }, timeout);
    return this;
  }

  private async _sendRequest(): Promise<void> {
    if (this._aborted) return;

    const protocol = this._options.protocol || 'https:';
    const hostname = this._options.hostname || 'localhost';
    const port = this._options.port || (protocol === 'https:' ? 443 : 80);
    const path = this._options.path || '/';
    const method = this._options.method || 'GET';
    const url = `${protocol}//${hostname}${port !== 80 && port !== 443 ? `:${port}` : ''}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: this._options.headers,
        body: method !== 'GET' && method !== 'HEAD' ? this._body : undefined,
      });

      const incomingMessage = new IncomingMessage();
      incomingMessage.statusCode = response.status;
      incomingMessage.statusMessage = response.statusText;
      incomingMessage.httpVersion = '1.1';

      response.headers.forEach((value, key) => {
        incomingMessage.headers[key] = value;
      });

      this._response = incomingMessage;
      this.emit('response', incomingMessage);

      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            incomingMessage._addData(value);
          }
        }
      }

      incomingMessage._end();
    } catch (error) {
      this.emit('error', error);
    }
  }
}

export function createHTTPModule() {
  return {
    request: (options: RequestOptions | string, callback?: Function): ClientRequest => {
      return new ClientRequest(options, callback);
    },
    get: (options: RequestOptions | string, callback?: Function): ClientRequest => {
      if (typeof options === 'string') {
        const url = new URL(options);
        options = {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port ? Number.parseInt(url.port) : undefined,
          path: url.pathname + url.search,
          method: 'GET',
        };
      }
      const req = new ClientRequest({ ...options, method: 'GET' }, callback);
      req.end();
      return req;
    },
    createServer: (requestListener?: Function): any => {
      console.warn('http.createServer is not supported in browser environment');
      return {
        listen: () => {},
        close: () => {},
      };
    },
    Agent: class Agent {},
    globalAgent: new (class Agent {})(),
    STATUS_CODES: {
      100: 'Continue',
      101: 'Switching Protocols',
      200: 'OK',
      201: 'Created',
      202: 'Accepted',
      204: 'No Content',
      300: 'Multiple Choices',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    },
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'TRACE', 'CONNECT'],
    IncomingMessage,
    ClientRequest,
  };
}

export function createHTTPSModule() {
  const httpModule = createHTTPModule();

  return {
    ...httpModule,
    request: (options: any, callback?: Function): any => {
      if (typeof options === 'string') {
        const url = new URL(options);
        options = {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'GET',
        };
      }
      options.protocol = 'https:';
      return new ClientRequest(options, callback);
    },
    get: (options: any, callback?: Function): any => {
      const req = httpModule.request({ ...options, method: 'GET' }, callback);
      req.end();
      return req;
    },
    createServer: (options?: any, requestListener?: Function): any => {
      console.warn('https.createServer is not supported in browser environment');
      return httpModule.createServer(requestListener);
    },
    Agent: class Agent extends httpModule.Agent {},
    globalAgent: new (class Agent extends httpModule.Agent {})(),
  };
}
