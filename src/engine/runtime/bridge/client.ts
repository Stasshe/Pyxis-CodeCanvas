import { makeServiceWorkerChannel, readMessage } from 'sync-message';
import {
  type FsBenchmark,
  type FsRequest,
  type RpcCall,
  type RpcReply,
  type RpcResult,
  type RpcValue,
  type RuntimeRequest,
  type TranspileRequest,
  unwrapResult,
} from './protocol';

export class RuntimeBridgeClosedError extends Error {
  constructor(readonly runtimeId: string) {
    super('Runtime bridge closed.');
    this.name = 'RuntimeBridgeClosedError';
  }
}

function waitsForPeer(request: RuntimeRequest): boolean {
  if (request.kind === 'stdin') return true;
  if (request.kind !== 'fs') return false;
  switch (request.op) {
    case 'readFile':
    case 'writeFile':
    case 'fifoOpen':
    case 'fifoRead':
    case 'fifoWrite':
      return true;
    default:
      return false;
  }
}

export class RuntimeBridge {
  private readonly channel;
  private readonly pending = new Map<
    string,
    { resolve: (result: RpcResult) => void; reject: (error: Error) => void }
  >();
  private closed = false;

  constructor(
    scope: string,
    private readonly port: MessagePort,
    private readonly runtimeId: string,
    private readonly cancelCall: (callId: string) => void
  ) {
    this.channel = makeServiceWorkerChannel({ scope });
    port.onmessage = (event: MessageEvent<RpcReply>) => {
      const pending = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      pending?.resolve(event.data.result);
    };
    port.start();
    port.onmessageerror = () => this.close();
  }

  benchmarkReply(_request: FsRequest, _metrics: FsBenchmark): void {}

  sync(request: RuntimeRequest): RpcValue {
    if (this.closed) throw new RuntimeBridgeClosedError(this.runtimeId);
    const call: RpcCall = { id: crypto.randomUUID(), request, runtimeId: this.runtimeId };
    // The request travels inside the read ID so the SW can dispatch it without
    // asking the blocked Runtime Worker or passing file I/O through main.
    let options: { timeout?: number } = { timeout: 120000 };
    if (waitsForPeer(request)) options = {};
    const result: RpcResult | null = readMessage(this.channel, JSON.stringify(call), options);
    if (!result) {
      this.cancelCall(call.id);
      throw new Error('Runtime synchronous request timed out.');
    }
    if (request.kind === 'fs' && request.benchmark && result.fsBenchmark) {
      this.benchmarkReply(request, result.fsBenchmark);
    }
    return unwrapResult(result);
  }

  async(request: FsRequest | TranspileRequest): Promise<RpcValue> {
    if (this.closed) return Promise.reject(new RuntimeBridgeClosedError(this.runtimeId));
    const call: RpcCall = { id: crypto.randomUUID(), request, runtimeId: this.runtimeId };
    const reply = new Promise<RpcResult>((resolve, reject) => {
      this.pending.set(call.id, { resolve, reject });
      this.port.postMessage(call);
    });
    if (request.kind === 'fs' && request.benchmark) {
      return reply.then(result => {
        if (result.fsBenchmark) this.benchmarkReply(request, result.fsBenchmark);
        return unwrapResult(result);
      });
    }
    return reply.then(unwrapResult);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new RuntimeBridgeClosedError(this.runtimeId));
    }
    this.pending.clear();
    this.port.close();
  }
}
