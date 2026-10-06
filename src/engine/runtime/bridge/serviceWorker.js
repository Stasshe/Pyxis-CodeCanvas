import { isServiceWorkerRequest, serviceWorkerFetchListener } from 'sync-message';

const syncFetch = serviceWorkerFetchListener();
const ICON_CACHE = 'pyxis-icons-v1';
const BASE_PATH = self.location.pathname.slice(0, -'/sw.js'.length);
const icons = [
  `${BASE_PATH}/favicon.ico`,
  `${BASE_PATH}/apple-touch-icon.png`,
  `${BASE_PATH}/file.svg`,
];
let fsPort = null;
let ownerClientId = null;
let waitingForPort = null;
let resolvePort = null;
let portTimeout = null;
const pending = new Map();
const retiredPorts = new Set();
const calls = new Map();
const syncVersion = new Promise(resolve => {
  syncFetch({
    request: new Request(
      `${self.location.origin}${BASE_PATH}/__SyncMessageServiceWorkerInput__/version`
    ),
    respondWith(response) {
      resolve(Promise.resolve(response).then(value => value.text()));
    },
  });
});

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data.type === 'runtime-cancel') {
    for (const [id, call] of calls) {
      if (call.runtimeId !== event.data.runtimeId) continue;
      call.cancel({ ok: false, error: 'Runtime closed.' });
      call.cleanup?.();
      calls.delete(id);
      const request = pending.get(id);
      pending.delete(id);
      if (request) closeRetiredPort(request.port);
    }
    return;
  }
  if (event.data.type === 'runtime-fs-port-error') {
    resolvePort?.(null);
    clearTimeout(portTimeout);
    resolvePort = null;
    waitingForPort = null;
    return;
  }
  if (event.data.type !== 'runtime-fs-port') return;
  ownerClientId = event.source.id;
  if (fsPort) {
    retiredPorts.add(fsPort);
    closeRetiredPort(fsPort);
  }
  fsPort = event.ports[0];
  const connectedPort = fsPort;
  connectedPort.onmessage = response => {
    const request = pending.get(response.data.id);
    pending.delete(response.data.id);
    request?.resolve(response.data.result);
    closeRetiredPort(connectedPort);
  };
  connectedPort.onmessageerror = () => {
    for (const [id, request] of pending) {
      if (request.port !== connectedPort) continue;
      request.resolve({ ok: false, error: 'Runtime filesystem connection failed.' });
      pending.delete(id);
    }
    connectedPort.close();
    retiredPorts.delete(connectedPort);
    if (fsPort === connectedPort) fsPort = null;
  };
  fsPort.start();
  event.ports[1]?.postMessage({ ready: true });
  event.ports[1]?.close();
  resolvePort?.(fsPort);
  clearTimeout(portTimeout);
  resolvePort = null;
  waitingForPort = null;
});

function closeRetiredPort(port) {
  if (!retiredPorts.has(port)) return;
  for (const request of pending.values()) if (request.port === port) return;
  port.close();
  retiredPorts.delete(port);
}

async function getFsPort() {
  if (fsPort) return fsPort;
  let connection = waitingForPort;
  if (!waitingForPort) {
    waitingForPort = new Promise(resolve => {
      resolvePort = resolve;
    });
    connection = waitingForPort;
    portTimeout = setTimeout(() => {
      resolvePort?.(null);
      resolvePort = null;
      waitingForPort = null;
    }, 30000);
    const clients = await self.clients.matchAll({ type: 'window' });
    if (!clients.length) {
      clearTimeout(portTimeout);
      resolvePort?.(null);
      resolvePort = null;
      waitingForPort = null;
      throw new Error('Runtime host page is closed.');
    }
    for (const client of clients) client.postMessage({ type: 'runtime-request-fs-port' });
  }
  const port = await connection;
  if (!port) throw new Error('Runtime filesystem port is unavailable.');
  return port;
}

async function execute(call) {
  if (call.request.kind === 'shell' || call.request.kind === 'stdin') {
    // A blocked second tab is still a window client. Only the tab that owns
    // the filesystem lock and transferred its port can handle runtime input.
    await getFsPort();
    const owner = await self.clients.get(ownerClientId);
    if (!calls.has(call.id)) return { ok: false, error: 'Runtime closed.' };
    if (!owner) return { ok: false, error: 'Runtime host page is closed.' };
    const channel = new MessageChannel();
    calls.get(call.id).cleanup = () => channel.port1.close();
    return new Promise(resolve => {
      channel.port1.onmessage = event => {
        channel.port1.close();
        resolve(event.data.result);
      };
      owner.postMessage({ type: 'runtime-host-call', call }, [channel.port2]);
    });
  }
  let port = await getFsPort();
  while (port !== fsPort) port = await getFsPort();
  if (!calls.has(call.id)) return { ok: false, error: 'Runtime closed.' };
  return new Promise(resolve => {
    pending.set(call.id, { resolve, port });
    port.postMessage(call);
  });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const syncPrefix = `${BASE_PATH}/__SyncMessageServiceWorkerInput__/`;
  if (
    url.origin === self.location.origin &&
    url.pathname.startsWith(syncPrefix) &&
    isServiceWorkerRequest(event)
  ) {
    if (event.request.url.endsWith('/read')) {
      // A read carries the operation and waits for its single execution. The
      // sync-message client handles the synchronous XHR and response decoding.
      event.respondWith(
        event.request.json().then(async ({ messageId }) => {
          const call = JSON.parse(messageId);
          let execution = calls.get(call.id);
          if (!execution) {
            let cancel;
            const cancellation = new Promise(resolve => {
              cancel = resolve;
            });
            const operation = execute(call).catch(error => ({ ok: false, error: String(error) }));
            execution = {
              runtimeId: call.runtimeId,
              promise: Promise.race([operation, cancellation]),
              cancel,
            };
            calls.set(call.id, execution);
          }
          const result = await execution.promise;
          calls.delete(call.id);
          return new Response(JSON.stringify({ message: result, version: await syncVersion }), {
            status: 200,
          });
        })
      );
      return;
    }
    syncFetch(event);
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(`${BASE_PATH}/vscode-icons/`) && !icons.includes(url.pathname))
    return;
  event.respondWith(
    caches.open(ICON_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })
  );
});
