function isRegistryUrl(value) {
  try {
    return new URL(value).hostname === 'registry.npmjs.org';
  } catch {
    return false;
  }
}

function responseHeaders(headers) {
  const selected = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lowerName = name.toLowerCase();
    if (['content-encoding', 'content-length', 'content-type', 'etag'].includes(lowerName)) {
      selected[lowerName] = value;
    }
  }
  return selected;
}

function timingPhases(timing) {
  if (!timing) return null;
  const elapsed = (start, end) => {
    if (start < 0 || end < 0) return null;
    return end - start;
  };
  return {
    proxyMs: elapsed(timing.proxyStart, timing.proxyEnd),
    dnsMs: elapsed(timing.dnsStart, timing.dnsEnd),
    connectMs: elapsed(timing.connectStart, timing.connectEnd),
    tlsMs: elapsed(timing.secureConnectionStart, timing.connectEnd),
    sendMs: elapsed(timing.sendStart, timing.sendEnd),
    waitMs: elapsed(timing.sendEnd, timing.receiveHeadersStart),
    receiveHeadersMs: elapsed(timing.receiveHeadersStart, timing.receiveHeadersEnd),
  };
}

export class RegistryNetworkCapture {
  constructor(endpoint, pagePrefix) {
    this.endpoint = endpoint;
    this.pagePrefix = pagePrefix;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.targets = new Map();
    this.requests = new Map();
    this.enabledTargets = [];
    this.errors = [];
    this.eventCounts = new Map();
    this.methodCounts = new Map();
    this.ignoredHosts = new Map();
    this.active = false;
  }

  async connect() {
    this.socket = new WebSocket(this.endpoint);
    this.socket.addEventListener('message', event => this.onMessage(event.data));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });

    await this.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await this.send('Target.getTargets');
    const page = targetInfos.find(
      target => target.type === 'page' && target.url.startsWith(this.pagePrefix)
    );
    if (!page) throw new Error(`No benchmark page starts with ${this.pagePrefix}.`);

    const { sessionId } = await this.send('Target.attachToTarget', {
      targetId: page.targetId,
      flatten: true,
    });
    this.targets.set(sessionId, page);
    await this.enableTarget(sessionId, page);

    for (const target of targetInfos) {
      if (!this.isNetworkTarget(target)) continue;
      await this.attachTarget(target);
    }
    return this;
  }

  beginTrial() {
    this.requests.clear();
    this.errors = [];
    this.eventCounts.clear();
    this.methodCounts.clear();
    this.ignoredHosts.clear();
    this.active = true;
  }

  endTrial() {
    this.active = false;
    return {
      targets: this.enabledTargets.map(target => ({ ...target })),
      errors: [...this.errors],
      eventCounts: Object.fromEntries(this.eventCounts),
      methodCounts: Object.fromEntries(this.methodCounts),
      ignoredHosts: Object.fromEntries(this.ignoredHosts),
      requests: [...this.requests.values()].map(request => ({ ...request })),
    };
  }

  async close() {
    if (!this.socket) return;
    for (const sessionId of this.targets.keys()) {
      try {
        await this.send('Target.detachFromTarget', { sessionId });
      } catch {
        this.errors.push(`Failed to detach ${sessionId}.`);
      }
    }
    this.socket.close();
    this.socket = null;
  }

  isFsWorker(url) {
    return url.includes('/core/fs/worker.ts') || url.includes('/npm-install/worker.mjs');
  }

  isNetworkTarget(target) {
    if (target.type === 'worker') return this.isFsWorker(target.url);
    if (target.type === 'service_worker') return target.url.startsWith(this.pagePrefix);
    return false;
  }

  async attachTarget(target) {
    const alreadyAttached = [...this.targets.values()].some(
      attached => attached.targetId === target.targetId
    );
    if (alreadyAttached) return;
    const { sessionId } = await this.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    this.targets.set(sessionId, target);
    await this.enableTarget(sessionId, target);
  }

  async enableTarget(sessionId, target) {
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Network.enable', {}, sessionId);
    this.enabledTargets.push({ type: target.type, url: target.url });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify(message));
    return promise;
  }

  onMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      this.errors.push('Ignored a non-JSON CDP message.');
      return;
    }

    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
      return;
    }

    if (this.active) {
      const scope = message.sessionId ?? 'browser';
      const methodKey = `${scope}:${message.method}`;
      this.methodCounts.set(methodKey, (this.methodCounts.get(methodKey) ?? 0) + 1);
    }
    if (!message.method?.startsWith('Network.')) return;
    if (this.active) {
      const key = `${message.sessionId ?? 'page'}:${message.method}`;
      this.eventCounts.set(key, (this.eventCounts.get(key) ?? 0) + 1);
    }
    this.onNetworkEvent(message);
  }

  onNetworkEvent(message) {
    const sessionId = message.sessionId ?? '';
    const params = message.params;
    const key = `${sessionId}:${params.requestId}`;

    if (message.method === 'Network.requestWillBeSent') {
      if (!this.active) return;
      if (!isRegistryUrl(params.request.url)) {
        let hostname = 'invalid-url';
        try {
          hostname = new URL(params.request.url).hostname;
        } catch {}
        this.ignoredHosts.set(hostname, (this.ignoredHosts.get(hostname) ?? 0) + 1);
        return;
      }
      this.requests.set(key, {
        sessionId,
        target: this.targets.get(sessionId)?.url ?? 'unknown',
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        startedAtSeconds: params.timestamp,
        wallTimeSeconds: params.wallTime,
        status: null,
        protocol: null,
        connectionId: null,
        connectionReused: null,
        fromDiskCache: null,
        fromPrefetchCache: null,
        fromServiceWorker: null,
        remoteIPAddress: null,
        responseTiming: null,
        timingPhases: null,
        headers: {},
        encodedDataLength: null,
        finishedAtSeconds: null,
        failure: null,
      });
      return;
    }

    const request = this.requests.get(key);
    if (!request) return;

    if (message.method === 'Network.responseReceived') {
      const response = params.response;
      request.status = response.status;
      request.protocol = response.protocol;
      request.connectionId = response.connectionId;
      request.connectionReused = response.connectionReused;
      request.fromDiskCache = response.fromDiskCache;
      request.fromPrefetchCache = response.fromPrefetchCache;
      request.fromServiceWorker = response.fromServiceWorker;
      request.remoteIPAddress = response.remoteIPAddress;
      request.responseTiming = response.timing ?? null;
      request.timingPhases = timingPhases(response.timing);
      request.headers = { ...responseHeaders(response.headers), ...request.headers };
      return;
    }

    if (message.method === 'Network.responseReceivedExtraInfo') {
      request.headers = { ...request.headers, ...responseHeaders(params.headers) };
      return;
    }

    if (message.method === 'Network.loadingFinished') {
      request.finishedAtSeconds = params.timestamp;
      request.encodedDataLength = params.encodedDataLength;
      return;
    }

    if (message.method === 'Network.loadingFailed') {
      request.finishedAtSeconds = params.timestamp;
      request.failure = params.errorText;
    }
  }
}
