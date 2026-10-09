"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.pnpm/sync-message@0.0.12/node_modules/sync-message/dist/index.js
  var require_dist = __commonJS({
    "node_modules/.pnpm/sync-message@0.0.12/node_modules/sync-message/dist/index.js"(exports, module) {
      !(function(e, t) {
        "object" == typeof exports && "object" == typeof module ? module.exports = t() : "function" == typeof define && define.amd ? define([], t) : "object" == typeof exports ? exports.syncMessage = t() : e.syncMessage = t();
      })(self, (function() {
        return (() => {
          "use strict";
          var e = { d: (t2, r2) => {
            for (var n2 in r2) e.o(r2, n2) && !e.o(t2, n2) && Object.defineProperty(t2, n2, { enumerable: true, get: r2[n2] });
          }, o: (e2, t2) => Object.prototype.hasOwnProperty.call(e2, t2), r: (e2) => {
            "undefined" != typeof Symbol && Symbol.toStringTag && Object.defineProperty(e2, Symbol.toStringTag, { value: "Module" }), Object.defineProperty(e2, "__esModule", { value: true });
          } }, t = {};
          e.r(t), e.d(t, { isServiceWorkerRequest: () => s, serviceWorkerFetchListener: () => i, asyncSleep: () => u, ServiceWorkerError: () => c, writeMessageAtomics: () => a, writeMessageServiceWorker: () => f, writeMessage: () => d, makeChannel: () => l, makeAtomicsChannel: () => m, makeServiceWorkerChannel: () => y, readMessage: () => h, syncSleep: () => g, uuidv4: () => w });
          var r = function(e2, t2, r2, n2) {
            return new (r2 || (r2 = Promise))((function(o2, s2) {
              function i2(e3) {
                try {
                  c2(n2.next(e3));
                } catch (e4) {
                  s2(e4);
                }
              }
              function u2(e3) {
                try {
                  c2(n2.throw(e3));
                } catch (e4) {
                  s2(e4);
                }
              }
              function c2(e3) {
                var t3;
                e3.done ? o2(e3.value) : (t3 = e3.value, t3 instanceof r2 ? t3 : new r2((function(e4) {
                  e4(t3);
                }))).then(i2, u2);
              }
              c2((n2 = n2.apply(e2, t2 || [])).next());
            }));
          };
          const n = "__SyncMessageServiceWorkerInput__", o = "__sync-message-v2__";
          function s(e2) {
            return "string" != typeof e2 && (e2 = e2.request.url), e2.includes(n);
          }
          function i() {
            const e2 = {}, t2 = {};
            return (n2) => {
              const { url: i2 } = n2.request;
              return !!s(i2) && (n2.respondWith((function() {
                return r(this, void 0, void 0, (function* () {
                  function r2(e3) {
                    const t3 = { message: e3, version: o };
                    return new Response(JSON.stringify(t3), { status: 200 });
                  }
                  if (i2.endsWith("/read")) {
                    const { messageId: o2, timeout: s2 } = yield n2.request.json();
                    if (o2 in e2) {
                      const t3 = e2[o2];
                      return delete e2[o2], r2(t3);
                    }
                    return yield new Promise(((e3) => {
                      t2[o2] = e3, setTimeout((function() {
                        delete t2[o2], e3(new Response("", { status: 408 }));
                      }), s2);
                    }));
                  }
                  if (i2.endsWith("/write")) {
                    const { message: o2, messageId: s2 } = yield n2.request.json(), i3 = t2[s2];
                    return i3 ? (i3(r2(o2)), delete t2[s2]) : e2[s2] = o2, r2({ early: !i3 });
                  }
                  if (i2.endsWith("/version")) return new Response(o, { status: 200 });
                }));
              })()), true);
            };
          }
          function u(e2) {
            return new Promise(((t2) => setTimeout(t2, e2)));
          }
          class c extends Error {
            constructor(e2, t2) {
              super(`Received status ${t2} from ${e2}. Ensure the service worker is registered and active.`), this.url = e2, this.status = t2, this.type = "ServiceWorkerError", Object.setPrototypeOf(this, c.prototype);
            }
          }
          function a(e2, t2) {
            const r2 = new TextEncoder().encode(JSON.stringify(t2)), { data: n2, meta: o2 } = e2;
            if (r2.length > n2.length) throw new Error("Message is too big, increase bufferSize when making channel.");
            n2.set(r2, 0), Atomics.store(o2, 0, r2.length), Atomics.store(o2, 1, 1), Atomics.notify(o2, 1);
          }
          function f(e2, t2, n2) {
            return r(this, void 0, void 0, (function* () {
              yield navigator.serviceWorker.ready;
              const r2 = e2.baseUrl + "/write", s2 = Date.now();
              for (; ; ) {
                const i2 = { message: t2, messageId: n2 }, a2 = yield fetch(r2, { method: "POST", body: JSON.stringify(i2) });
                if (200 === a2.status && (yield a2.json()).version === o) return;
                if (!(Date.now() - s2 < e2.timeout)) throw new c(r2, a2.status);
                yield u(100);
              }
            }));
          }
          function d(e2, t2, n2) {
            return r(this, void 0, void 0, (function* () {
              "atomics" === e2.type ? a(e2, t2) : yield f(e2, t2, n2);
            }));
          }
          function l(e2 = {}) {
            return "undefined" != typeof SharedArrayBuffer ? m(e2.atomics) : "serviceWorker" in navigator ? y(e2.serviceWorker) : null;
          }
          function m({ bufferSize: e2 } = {}) {
            return { type: "atomics", data: new Uint8Array(new SharedArrayBuffer(e2 || 131072)), meta: new Int32Array(new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT)) };
          }
          function y(e2 = {}) {
            return { type: "serviceWorker", baseUrl: (e2.scope || "/") + n, timeout: e2.timeout || 5e3 };
          }
          function p(e2, t2) {
            return e2 > 0 ? +e2 : t2;
          }
          function h(e2, t2, { checkInterrupt: r2, checkTimeout: n2, timeout: s2 } = {}) {
            const i2 = performance.now();
            n2 = p(n2, r2 ? 100 : 5e3);
            const u2 = p(s2, Number.POSITIVE_INFINITY);
            let a2;
            if ("atomics" === e2.type) {
              const { data: t3, meta: r3 } = e2;
              a2 = () => {
                if ("timed-out" === Atomics.wait(r3, 1, 0, n2)) return null;
                {
                  const e3 = Atomics.exchange(r3, 0, 0), n3 = t3.slice(0, e3);
                  Atomics.store(r3, 1, 0);
                  const o2 = new TextDecoder().decode(n3);
                  return JSON.parse(o2);
                }
              };
            } else a2 = () => {
              const r3 = new XMLHttpRequest(), s3 = e2.baseUrl + "/read";
              r3.open("POST", s3, false);
              const u3 = { messageId: t2, timeout: n2 };
              r3.send(JSON.stringify(u3));
              const { status: a3 } = r3;
              if (408 === a3) return null;
              if (200 === a3) {
                const e3 = JSON.parse(r3.responseText);
                return e3.version !== o ? null : e3.message;
              }
              if (performance.now() - i2 < e2.timeout) return null;
              throw new c(s3, a3);
            };
            for (; ; ) {
              const e3 = u2 - (performance.now() - i2);
              if (e3 <= 0) return null;
              n2 = Math.min(n2, e3);
              const t3 = a2();
              if (null !== t3) return t3;
              if (null == r2 ? void 0 : r2()) return null;
            }
          }
          function g(e2, t2) {
            if (e2 = p(e2, 0)) if ("undefined" != typeof SharedArrayBuffer) {
              const t3 = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
              t3[0] = 0, Atomics.wait(t3, 0, 0, e2);
            } else h(t2, `sleep ${e2} ${w()}`, { timeout: e2 });
          }
          let w;
          return w = "randomUUID" in crypto ? function() {
            return crypto.randomUUID();
          } : function() {
            return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, ((e2) => {
              const t2 = Number(e2);
              return (t2 ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> t2 / 4).toString(16);
            }));
          }, t;
        })();
      }));
    }
  });

  // src/engine/system/runtime/bridge/serviceWorker.js
  var import_sync_message = __toESM(require_dist());
  var syncFetch = (0, import_sync_message.serviceWorkerFetchListener)();
  var ICON_CACHE = "pyxis-icons-v1";
  var BASE_PATH = self.location.pathname.slice(0, -"/sw.js".length);
  var icons = [
    `${BASE_PATH}/favicon.ico`,
    `${BASE_PATH}/apple-touch-icon.png`,
    `${BASE_PATH}/file.svg`
  ];
  var fsPort = null;
  var ownerClientId = null;
  var waitingForPort = null;
  var resolvePort = null;
  var portTimeout = null;
  var pending = /* @__PURE__ */ new Map();
  var retiredPorts = /* @__PURE__ */ new Set();
  var calls = /* @__PURE__ */ new Map();
  var syncVersion = new Promise((resolve) => {
    syncFetch({
      request: new Request(
        `${self.location.origin}${BASE_PATH}/__SyncMessageServiceWorkerInput__/version`
      ),
      respondWith(response) {
        resolve(Promise.resolve(response).then((value) => value.text()));
      }
    });
  });
  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("message", (event) => {
    if (event.data.type === "runtime-cancel") {
      for (const [id, call] of calls) {
        if (call.runtimeId !== event.data.runtimeId) continue;
        if (event.data.callId && event.data.callId !== id) continue;
        if (ownerClientId) {
          self.clients.get(ownerClientId).then((owner) => {
            owner?.postMessage({
              type: "runtime-host-cancel",
              runtimeId: call.runtimeId,
              callId: id
            });
          });
        }
        call.cancel({ ok: false, error: "Runtime closed." });
        call.cleanup?.();
        calls.delete(id);
        const request = pending.get(id);
        pending.delete(id);
        if (request) closeRetiredPort(request.port);
      }
      return;
    }
    if (event.data.type === "runtime-fs-port-error") {
      return;
    }
    if (event.data.type !== "runtime-fs-port") return;
    ownerClientId = event.source.id;
    if (fsPort) {
      retiredPorts.add(fsPort);
      closeRetiredPort(fsPort);
    }
    fsPort = event.ports[0];
    const connectedPort = fsPort;
    connectedPort.onmessage = (response) => {
      const request = pending.get(response.data.id);
      pending.delete(response.data.id);
      request?.resolve(response.data.result);
      closeRetiredPort(connectedPort);
    };
    connectedPort.onmessageerror = () => {
      for (const [id, request] of pending) {
        if (request.port !== connectedPort) continue;
        request.resolve({ ok: false, error: "Runtime filesystem connection failed." });
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
      waitingForPort = new Promise((resolve) => {
        resolvePort = resolve;
      });
      connection = waitingForPort;
      portTimeout = setTimeout(() => {
        resolvePort?.(null);
        resolvePort = null;
        waitingForPort = null;
      }, 3e4);
      const clients = await self.clients.matchAll({ type: "window" });
      if (!clients.length) {
        clearTimeout(portTimeout);
        resolvePort?.(null);
        resolvePort = null;
        waitingForPort = null;
        throw new Error("Runtime host page is closed.");
      }
      for (const client of clients) client.postMessage({ type: "runtime-request-fs-port" });
    }
    const port = await connection;
    if (!port) throw new Error("Runtime filesystem port is unavailable.");
    return port;
  }
  async function execute(call) {
    if (call.request.kind === "shell" || call.request.kind === "stdin") {
      await getFsPort();
      const owner = await self.clients.get(ownerClientId);
      if (!calls.has(call.id)) return { ok: false, error: "Runtime closed." };
      if (!owner) return { ok: false, error: "Runtime host page is closed." };
      const channel = new MessageChannel();
      calls.get(call.id).cleanup = () => channel.port1.close();
      return new Promise((resolve) => {
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(event.data.result);
        };
        owner.postMessage({ type: "runtime-host-call", call }, [channel.port2]);
      });
    }
    let port = await getFsPort();
    while (port !== fsPort) port = await getFsPort();
    if (!calls.has(call.id)) return { ok: false, error: "Runtime closed." };
    return new Promise((resolve) => {
      pending.set(call.id, { resolve, port });
      port.postMessage(call);
    });
  }
  self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    const syncPrefix = `${BASE_PATH}/__SyncMessageServiceWorkerInput__/`;
    if (url.origin === self.location.origin && url.pathname.startsWith(syncPrefix) && (0, import_sync_message.isServiceWorkerRequest)(event)) {
      if (event.request.url.endsWith("/read")) {
        event.respondWith(
          event.request.json().then(async ({ messageId }) => {
            const call = JSON.parse(messageId);
            let execution = calls.get(call.id);
            if (!execution) {
              let cancel;
              const cancellation = new Promise((resolve) => {
                cancel = resolve;
              });
              const operation = execute(call).catch((error) => ({ ok: false, error: String(error) }));
              execution = {
                runtimeId: call.runtimeId,
                promise: Promise.race([operation, cancellation]),
                cancel
              };
              calls.set(call.id, execution);
            }
            const result = await execution.promise;
            calls.delete(call.id);
            return new Response(JSON.stringify({ message: result, version: await syncVersion }), {
              status: 200
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
      caches.open(ICON_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })
    );
  });
})();
