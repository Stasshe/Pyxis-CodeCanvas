import { runStartupStage, type StartupProgress } from '@/engine/core/startup';
import { assetPath } from '@/env';
import type { HostRequest, RpcCall, RpcReply, RpcValue } from './protocol';

type HostHandler = (request: HostRequest, signal: AbortSignal) => Promise<RpcValue>;
const hosts = new Map<string, HostHandler>();
const hostCalls = new Map<string, { runtimeId: string; controller: AbortController }>();
let createPort: (() => Promise<MessagePort>) | null = null;
let initialization: Promise<string> | null = null;
let listenersRegistered = false;

export function registerRuntimeHost(id: string, handler: HostHandler): () => void {
  hosts.set(id, handler);
  return () => {
    hosts.delete(id);
    for (const [callId, call] of hostCalls) {
      if (call.runtimeId !== id) continue;
      call.controller.abort();
      hostCalls.delete(callId);
    }
    navigator.serviceWorker.controller?.postMessage({ type: 'runtime-cancel', runtimeId: id });
  };
}

async function sendFsPort(): Promise<void> {
  const controller = navigator.serviceWorker.controller;
  const factory = createPort;
  if (!controller || !factory) throw new Error('Runtime service worker is not ready.');
  const acknowledgment = new MessageChannel();
  let finished = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finished = true;
        reject(
          new Error(
            'Runtime service worker did not accept the filesystem port. Reload this page normally.'
          )
        );
      }, 10000);
      acknowledgment.port1.onmessage = () => {
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      Promise.resolve()
        .then(() => factory())
        .then(value => {
          if (finished) {
            value.close();
            return;
          }
          controller.postMessage({ type: 'runtime-fs-port' }, [value, acknowledgment.port2]);
        })
        .catch(error => {
          finished = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  } finally {
    acknowledgment.port1.close();
    acknowledgment.port2.close();
  }
}

export function ensureRuntimeBridge(
  factory: () => Promise<MessagePort>,
  report?: (progress: StartupProgress) => void
): Promise<string> {
  createPort = factory;
  if (!initialization) {
    const pending = initialize(report);
    let attempt: Promise<string>;
    attempt = pending.catch(error => {
      if (initialization === attempt) {
        initialization = null;
        createPort = null;
      }
      throw error;
    });
    initialization = attempt;
  }
  return initialization;
}

async function waitForActivation(worker: ServiceWorker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Runtime service worker activation timed out.')),
      30000
    );
    function finish(error?: Error): void {
      clearTimeout(timer);
      worker.removeEventListener('statechange', inspect);
      if (error) reject(error);
      else resolve();
    }
    function inspect(): void {
      if (worker.state === 'activated') finish();
      if (worker.state === 'redundant')
        finish(new Error('Runtime service worker installation failed.'));
    }
    worker.addEventListener('statechange', inspect);
    inspect();
  });
}

async function waitForController(registration: ServiceWorkerRegistration): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', inspect);
      reject(new Error('Runtime service worker did not take control. Reload this page normally.'));
    }, 10000);
    function inspect(): void {
      if (!registration.active || navigator.serviceWorker.controller !== registration.active)
        return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', inspect);
      resolve();
    }
    navigator.serviceWorker.addEventListener('controllerchange', inspect);
    inspect();
  });
}

async function initialize(report?: (progress: StartupProgress) => void): Promise<string> {
  if (!('serviceWorker' in navigator)) throw new Error('Pyxis requires service worker support.');
  const phase = <T>(detail: string, operation: () => Promise<T>): Promise<T> =>
    runStartupStage(detail, operation, (_stage, progress) => report?.(progress), 30_000);
  const registration = await phase('Registering service worker', () =>
    navigator.serviceWorker.register(assetPath('/sw.js'), { updateViaCache: 'none' })
  );
  const installing = registration.installing || registration.waiting;
  if (installing) {
    await phase('Activating service worker', () => waitForActivation(installing));
  }
  if (!registration.active) throw new Error('Runtime service worker is not active.');
  // Activation claims new pages. An already-active worker must also reclaim a
  // page loaded with a hard refresh, without navigating away from startup.
  if (navigator.serviceWorker.controller !== registration.active) {
    registration.active.postMessage({ type: 'runtime-claim' });
  }
  await phase('Waiting for service worker control', () => waitForController(registration));
  if (!listenersRegistered) {
    navigator.serviceWorker.addEventListener(
      'message',
      async (
        event: MessageEvent<{
          type: string;
          call?: RpcCall;
          runtimeId?: string;
          callId?: string;
        }>
      ) => {
        if (event.data.type === 'runtime-host-cancel') {
          const call = event.data.callId ? hostCalls.get(event.data.callId) : undefined;
          if (call && call.runtimeId === event.data.runtimeId) call.controller.abort();
          return;
        }
        if (event.data.type === 'runtime-request-fs-port') {
          try {
            await sendFsPort();
          } catch (error) {
            console.error(error);
            navigator.serviceWorker.controller?.postMessage({ type: 'runtime-fs-port-error' });
          }
          return;
        }
        if (event.data.type !== 'runtime-host-call') return;
        const call = event.data.call;
        if (!call) return;
        const responsePort = event.ports[0];
        if (!responsePort) return;
        const controller = new AbortController();
        hostCalls.set(call.id, { runtimeId: call.runtimeId, controller });
        let reply: RpcReply;
        try {
          const handler = hosts.get(call.runtimeId);
          if (!handler) throw new Error('Runtime host is no longer available.');
          if (call.request.kind !== 'shell' && call.request.kind !== 'stdin')
            throw new Error('Main only handles shell and stdin.');
          reply = {
            id: call.id,
            result: { ok: true, value: await handler(call.request, controller.signal) },
          };
        } catch (error) {
          reply = { id: call.id, result: { ok: false, error: String(error) } };
        } finally {
          hostCalls.delete(call.id);
        }
        responsePort.postMessage(reply);
        responsePort.close();
      }
    );
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      void sendFsPort().catch(console.error);
    });
    listenersRegistered = true;
  }
  await phase('Connecting filesystem port', sendFsPort);
  return registration.scope;
}
