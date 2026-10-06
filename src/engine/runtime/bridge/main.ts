import { assetPath } from '@/env';
import type { HostRequest, RpcCall, RpcReply, RpcValue } from './protocol';

type HostHandler = (request: HostRequest) => Promise<RpcValue>;
const hosts = new Map<string, HostHandler>();
let createPort: (() => Promise<MessagePort>) | null = null;
let initialization: Promise<string> | null = null;

export function registerRuntimeHost(id: string, handler: HostHandler): () => void {
  hosts.set(id, handler);
  return () => {
    hosts.delete(id);
    navigator.serviceWorker.controller?.postMessage({ type: 'runtime-cancel', runtimeId: id });
  };
}

async function sendFsPort(): Promise<void> {
  const controller = navigator.serviceWorker.controller;
  if (!controller || !createPort) throw new Error('Runtime service worker is not ready.');
  const port = await createPort();
  const acknowledgment = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      acknowledgment.port1.close();
      reject(
        new Error(
          'Runtime service worker did not accept the filesystem port. Reload this page normally.'
        )
      );
    }, 10000);
    acknowledgment.port1.onmessage = () => {
      clearTimeout(timer);
      acknowledgment.port1.close();
      resolve();
    };
    controller.postMessage({ type: 'runtime-fs-port' }, [port, acknowledgment.port2]);
  });
}

export function ensureRuntimeBridge(factory: () => Promise<MessagePort>): Promise<string> {
  createPort = factory;
  if (!initialization) initialization = initialize();
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

async function waitForController(worker: ServiceWorker): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', inspect);
      reject(new Error('Runtime service worker did not take control. Reload this page normally.'));
    }, 10000);
    function inspect(): void {
      if (navigator.serviceWorker.controller !== worker) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', inspect);
      resolve();
    }
    navigator.serviceWorker.addEventListener('controllerchange', inspect);
    inspect();
  });
}

async function initialize(): Promise<string> {
  if (!('serviceWorker' in navigator)) throw new Error('Pyxis requires service worker support.');
  const reloadKey = 'pyxis-sw-initial-reload';
  let wasControlled = Boolean(navigator.serviceWorker.controller);
  if (document.documentElement.dataset.pyxisSwControlled === 'false') wasControlled = false;
  if (!wasControlled && sessionStorage.getItem(reloadKey)) {
    throw new Error('Pyxis is not controlled by its service worker. Reload this page normally.');
  }
  const registration = await navigator.serviceWorker.register(assetPath('/sw.js'));
  await registration.update();
  const installing = registration.installing || registration.waiting;
  if (installing) await waitForActivation(installing);
  await navigator.serviceWorker.ready;
  if (!wasControlled) {
    sessionStorage.setItem(reloadKey, 'true');
    location.reload();
    await new Promise<void>(() => {});
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error('Pyxis is not controlled by its service worker. Reload this page normally.');
  }
  if (!registration.active) throw new Error('Runtime service worker is not active.');
  await waitForController(registration.active);
  sessionStorage.setItem(reloadKey, 'true');
  navigator.serviceWorker.addEventListener(
    'message',
    async (event: MessageEvent<{ type: string; call: RpcCall }>) => {
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
      const { call } = event.data;
      const responsePort = event.ports[0];
      if (!responsePort) return;
      let reply: RpcReply;
      try {
        const handler = hosts.get(call.runtimeId);
        if (!handler) throw new Error('Runtime host is no longer available.');
        if (call.request.kind !== 'shell' && call.request.kind !== 'stdin')
          throw new Error('Main only handles shell and stdin.');
        reply = { id: call.id, result: { ok: true, value: await handler(call.request) } };
      } catch (error) {
        reply = { id: call.id, result: { ok: false, error: String(error) } };
      }
      responsePort.postMessage(reply);
      responsePort.close();
    }
  );
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    void sendFsPort().catch(console.error);
  });
  await sendFsPort();
  return registration.scope;
}
