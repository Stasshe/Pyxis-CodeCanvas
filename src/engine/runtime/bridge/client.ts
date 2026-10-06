import { makeServiceWorkerChannel, readMessage } from 'sync-message';
import {
  type FsRequest,
  type RpcCall,
  type RpcReply,
  type RpcResult,
  type RpcValue,
  type RuntimeRequest,
  type TranspileRequest,
  unwrapResult,
} from './protocol';

export class RuntimeBridge {
  private readonly channel;
  private readonly pending = new Map<string, (result: RpcResult) => void>();
  private closed = false;

  constructor(
    scope: string,
    private readonly port: MessagePort,
    private readonly runtimeId: string
  ) {
    this.channel = makeServiceWorkerChannel({ scope });
    port.onmessage = (event: MessageEvent<RpcReply>) => {
      const resolve = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      resolve?.(event.data.result);
    };
    port.start();
    port.onmessageerror = () => this.close();
  }

  sync(request: RuntimeRequest): RpcValue {
    if (this.closed) throw new Error('Runtime closed.');
    const call: RpcCall = { id: crypto.randomUUID(), request, runtimeId: this.runtimeId };
    // The request travels inside the read ID so the SW can dispatch it without
    // asking the blocked Runtime Worker or passing file I/O through main.
    const result: RpcResult | null = readMessage(this.channel, JSON.stringify(call), {
      timeout: 120000,
    });
    if (!result) throw new Error('Runtime synchronous request timed out.');
    return unwrapResult(result);
  }

  async(request: FsRequest | TranspileRequest): Promise<RpcValue> {
    if (this.closed) return Promise.reject(new Error('Runtime closed.'));
    const call: RpcCall = { id: crypto.randomUUID(), request, runtimeId: this.runtimeId };
    return new Promise<RpcResult>(resolve => {
      this.pending.set(call.id, resolve);
      this.port.postMessage(call);
    }).then(unwrapResult);
  }

  close(): void {
    this.closed = true;
    for (const resolve of this.pending.values()) resolve({ ok: false, error: 'Runtime closed.' });
    this.pending.clear();
    this.port.close();
  }
}
