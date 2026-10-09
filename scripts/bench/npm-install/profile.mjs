const channel = 'npm-bench-profile';
const timelinePhases = new Set([
  'install.total',
  'install.jobs',
  'registry.total',
  'network.queue',
  'worker.install',
  'worker.readPackage',
  'worker.writePackage',
  'worker.progress',
  'worker.promptGit',
  'fs.walk',
]);
let active = null;

function metric(name) {
  if (!active.metrics[name]) {
    active.metrics[name] = { calls: 0, failures: 0, serviceMs: 0, wallMs: 0, maxParallel: 0 };
  }
  return active.metrics[name];
}

function enter(name) {
  if (!active) return null;
  const sample = active;
  const value = metric(name);
  const started = performance.now();
  let pending = sample.pending.get(name);
  if (!pending) {
    pending = { count: 0, started };
    sample.pending.set(name, pending);
  }
  pending.count += 1;
  value.calls += 1;
  value.maxParallel = Math.max(value.maxParallel, pending.count);
  return failed => {
    const ended = performance.now();
    value.serviceMs += ended - started;
    if (failed) value.failures += 1;
    pending.count -= 1;
    if (pending.count === 0) {
      value.wallMs += ended - pending.started;
      sample.pending.delete(name);
    }
    if (timelinePhases.has(name)) {
      sample.timeline.push({
        phase: name,
        startMs: started - sample.started,
        endMs: ended - sample.started,
        failed,
      });
    }
  };
}

function wrapAsync(target, key, label, after) {
  const original = target[key];
  if (typeof original !== 'function') return;
  target[key] = async function (...args) {
    let name = label;
    if (typeof label === 'function') name = label(args);
    const end = enter(name);
    try {
      const result = await original.apply(this, args);
      after?.(result, args);
      end?.(false);
      return result;
    } catch (error) {
      end?.(true);
      throw error;
    }
  };
}

function wrapSync(target, key, label) {
  const original = target[key];
  if (typeof original !== 'function') return;
  target[key] = function (...args) {
    const end = enter(label);
    try {
      const result = original.apply(this, args);
      end?.(false);
      return result;
    } catch (error) {
      end?.(true);
      throw error;
    }
  };
}

function fileScope(path) {
  if (path.startsWith('/home/pyxis/.npm/')) return 'cache';
  if (path.includes('/node_modules/.bin/')) return 'bins';
  if (path.endsWith('/package-lock.json')) return 'lockfile';
  if (path.includes('/node_modules/')) return 'packages';
  return 'workspace';
}

function readScope(path) {
  if (path.startsWith('/home/pyxis/.npm/registry/')) return 'cacheMetadata';
  if (path.startsWith('/home/pyxis/.npm/')) return 'cacheTarball';
  return fileScope(path);
}

function installFetchHooks() {
  const original = globalThis.fetch;
  globalThis.fetch = async function (input, options) {
    if (!active) return original.call(this, input, options);
    let url = input;
    if (input instanceof Request) url = input.url;
    url = String(url);
    let group = 'registry';
    if (url.includes('/-/') || url.endsWith('.tgz')) group = 'tarball';
    const sample = active;
    sample.urls[url] = (sample.urls[url] ?? 0) + 1;
    const request = {
      url,
      group,
      startMs: performance.now() - sample.started,
      headersMs: null,
      bodyMs: 0,
      endMs: null,
      status: 0,
      bytes: 0,
      contentEncoding: null,
      contentLength: null,
    };
    sample.network.push(request);
    const complete = enter(`network.${group}`);
    function finish(failed) {
      request.endMs = performance.now() - sample.started;
      if (request.headersMs !== null) request.bodyMs = request.endMs - request.headersMs;
      complete(failed);
    }
    const headersComplete = enter(`network.${group}.headers`);
    let response;
    try {
      response = await original.call(this, input, options);
      request.headersMs = performance.now() - sample.started;
      request.status = response.status;
      request.contentEncoding = response.headers.get('content-encoding');
      request.contentLength = response.headers.get('content-length');
      headersComplete(false);
    } catch (error) {
      headersComplete(true);
      finish(true);
      throw error;
    }
    if (!response.ok) {
      finish(response.status !== 304);
      return response;
    }
    let finished = false;
    for (const method of ['json', 'arrayBuffer', 'text']) {
      const read = response[method].bind(response);
      response[method] = async () => {
        const bodyComplete = enter(`network.${group}.body`);
        try {
          const data = await read();
          bodyComplete?.(false);
          if (data instanceof ArrayBuffer) {
            request.bytes = data.byteLength;
          } else {
            request.bytes = Number(response.headers.get('content-length') ?? 0);
          }
          sample.bytes[group] += request.bytes;
          if (!finished) finish(false);
          finished = true;
          return data;
        } catch (error) {
          bodyComplete?.(true);
          if (!finished) finish(true);
          finished = true;
          throw error;
        }
      };
    }
    return response;
  };
}

function measureGunzipReads(stream) {
  const original = stream.getReader.bind(stream);
  stream.getReader = (...args) => {
    const reader = original(...args);
    wrapAsync(reader, 'read', 'install.gunzipRead');
    return reader;
  };
}

function installOpfsHooks() {
  const directory = FileSystemDirectoryHandle.prototype;
  const file = FileSystemFileHandle.prototype;
  wrapAsync(directory, 'getDirectoryHandle', 'opfs.directoryLookup');
  wrapAsync(directory, 'getFileHandle', 'opfs.fileLookup');
  wrapAsync(file, 'getFile', 'opfs.metadata');
  const instrumented = new WeakSet();
  wrapAsync(file, 'createSyncAccessHandle', 'opfs.open', handle => {
    const prototype = Object.getPrototypeOf(handle);
    if (instrumented.has(prototype)) return;
    instrumented.add(prototype);
    for (const key of ['read', 'write', 'truncate', 'flush', 'close', 'getSize']) {
      wrapSync(prototype, key, `opfs.${key}`);
    }
  });
  wrapSync(directory, 'entries', 'opfs.entries');
}

export async function installProfileHooks() {
  const [
    { FsCore },
    { NpmInstall },
    { TarExtractor },
    { NpmNetwork },
    { RegistryClient },
    { WorkerNpmCommands },
    { WorkerGitCommands },
  ] = await Promise.all([
    import('/src/engine/core/fs/core.ts'),
    import('/src/engine/cmd/global/npmOperations/npmInstall.ts'),
    import('/src/engine/cmd/global/npmOperations/install/tarExtractor.ts'),
    import('/src/engine/cmd/global/npmOperations/install/npmNetwork.ts'),
    import('/src/engine/cmd/global/npmOperations/install/registryClient.ts'),
    import('/src/engine/cmd/global/npmOperations/worker.ts'),
    import('/src/engine/cmd/global/gitOperations/worker.ts'),
  ]);
  for (const method of ['stat', 'exists', 'readText', 'mkdir', 'readdir', 'walk']) {
    wrapAsync(FsCore.prototype, method, `fs.${method}`);
  }
  wrapAsync(FsCore.prototype, 'readFile', args => `fs.read.${readScope(args[0])}`);
  wrapAsync(
    FsCore.prototype,
    'writeFile',
    args => `fs.write.${fileScope(args[0])}`,
    (_, args) => {
      if (!active) return;
      const scope = fileScope(args[0]);
      let bytes = args[1].byteLength;
      if (typeof args[1] === 'string') bytes = new TextEncoder().encode(args[1]).byteLength;
      active.bytes[scope] = (active.bytes[scope] ?? 0) + bytes;
    }
  );
  wrapAsync(FsCore.prototype, 'directory', 'fs.directory');
  wrapSync(FsCore.prototype, 'emit', 'fs.emit');
  wrapAsync(WorkerNpmCommands.prototype, 'install', 'worker.install');
  wrapAsync(WorkerNpmCommands.prototype, 'readPackage', 'worker.readPackage');
  wrapAsync(WorkerNpmCommands.prototype, 'writePackage', 'worker.writePackage');
  wrapAsync(WorkerGitCommands.prototype, 'getCurrentBranch', 'worker.promptGit');
  const setProgress = NpmInstall.prototype.setInstallProgressCallback;
  NpmInstall.prototype.setInstallProgressCallback = function (callback) {
    return setProgress.call(this, async (...args) => {
      const end = enter('worker.progress');
      try {
        const result = await callback(...args);
        end?.(false);
        return result;
      } catch (error) {
        end?.(true);
        throw error;
      }
    });
  };
  wrapAsync(NpmInstall.prototype, 'resolvePackageInfo', 'install.resolve');
  wrapAsync(NpmInstall.prototype, 'installDependencies', 'install.total');
  wrapAsync(NpmInstall.prototype, 'installPackageJobs', 'install.jobs');
  wrapAsync(NpmInstall.prototype, 'ensurePackageDirectory', 'install.directory');
  wrapAsync(NpmNetwork.prototype, 'acquire', 'network.queue');
  wrapAsync(RegistryClient.prototype, 'loadPackument', 'registry.total');
  wrapAsync(NpmInstall.prototype, 'downloadTarball', 'install.tarball');
  wrapAsync(NpmInstall.prototype, 'ensureBinsForPackage', 'install.bins');
  wrapAsync(NpmInstall.prototype, 'downloadAndInstallPackage', 'install.package');
  const extractFromStream = TarExtractor.prototype.extractFromStream;
  TarExtractor.prototype.extractFromStream = function (packageDir, stream, onEntry) {
    measureGunzipReads(stream);
    const consumer = { onEntry };
    wrapAsync(consumer, 'onEntry', 'install.entryWrite');
    return extractFromStream.call(this, packageDir, stream, consumer.onEntry);
  };
  wrapAsync(TarExtractor.prototype, 'extractFromStream', 'install.gunzipTar');
  wrapSync(TarExtractor.prototype, 'entryPath', 'install.tarEntry');
  wrapAsync(crypto.subtle, 'digest', args => {
    let algorithm = args[0];
    if (typeof algorithm !== 'string') algorithm = algorithm.name;
    return `crypto.digest.${algorithm.toLowerCase().replaceAll('-', '')}`;
  });
  installFetchHooks();
  installOpfsHooks();
  globalThis.addEventListener('message', event => {
    if (event.data?.type !== channel) return;
    const { action, id } = event.data;
    let metrics = null;
    if (action === 'start') {
      performance.clearResourceTimings();
      performance.setResourceTimingBufferSize(2000);
      active = {
        metrics: {},
        bytes: { registry: 0, tarball: 0 },
        urls: {},
        network: [],
        timeline: [],
        pending: new Map(),
        started: performance.now(),
      };
    } else if (action === 'finish') {
      if (!active) throw new Error('No active npm benchmark profile.');
      metrics = {
        startedAt: performance.timeOrigin + active.started,
        wallMs: performance.now() - active.started,
        phases: active.metrics,
        bytes: active.bytes,
        requests: active.urls,
        network: active.network,
        resourceTimeOrigin: performance.timeOrigin,
        resources: performance
          .getEntriesByType('resource')
          .filter(entry => active.urls[entry.name])
          .map(entry => ({
            name: entry.name,
            initiatorType: entry.initiatorType,
            startTime: entry.startTime,
            duration: entry.duration,
            fetchStart: entry.fetchStart,
            domainLookupStart: entry.domainLookupStart,
            domainLookupEnd: entry.domainLookupEnd,
            connectStart: entry.connectStart,
            connectEnd: entry.connectEnd,
            secureConnectionStart: entry.secureConnectionStart,
            requestStart: entry.requestStart,
            responseStart: entry.responseStart,
            responseEnd: entry.responseEnd,
            transferSize: entry.transferSize,
            encodedBodySize: entry.encodedBodySize,
            decodedBodySize: entry.decodedBodySize,
            nextHopProtocol: entry.nextHopProtocol,
          })),
        timeline: active.timeline,
        pending: Array.from(active.pending, ([name, value]) => ({ name, count: value.count })),
      };
      active = null;
    }
    globalThis.postMessage({ type: `${channel}-result`, id, metrics });
  });
}

export async function installSerialExtractionHook() {
  const { TarExtractor } = await import(
    '/src/engine/cmd/global/npmOperations/install/tarExtractor.ts'
  );
  const extract = TarExtractor.prototype.extractFromStream;
  let queue = Promise.resolve();
  TarExtractor.prototype.extractFromStream = function (...args) {
    const queued = enter('install.extractQueue');
    const task = queue.then(() => {
      queued?.(false);
      return extract.apply(this, args);
    });
    queue = task.then(
      () => {},
      () => {}
    );
    return task;
  };
}

export async function initProfiledFsClient(
  fsClient,
  { profile = true, serialExtraction = false } = {}
) {
  fsClient.close();
  const OriginalWorker = globalThis.Worker;
  const workerUrl = new URL('./worker.mjs', import.meta.url);
  workerUrl.search = '?worker_file&type=module';
  workerUrl.searchParams.set('profile', String(Number(profile)));
  workerUrl.searchParams.set('serialExtraction', String(Number(serialExtraction)));
  globalThis.Worker = class extends OriginalWorker {
    constructor(url, options) {
      let target = url;
      if (String(url).includes('/core/fs/worker.ts')) target = workerUrl;
      super(target, options);
    }
  };
  try {
    await fsClient.init();
  } finally {
    globalThis.Worker = OriginalWorker;
  }
}

function control(fsClient, action, id) {
  const worker = fsClient.getWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener('message', receive);
      reject(new Error(`Npm benchmark profile ${action} did not respond.`));
    }, 15000);
    function receive(event) {
      if (event.data?.type !== `${channel}-result` || event.data.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener('message', receive);
      resolve(event.data.metrics);
    }
    worker.addEventListener('message', receive);
    worker.postMessage({ type: channel, action, id });
  });
}

export function startProfile(fsClient, id) {
  return control(fsClient, 'start', id);
}

export function finishProfile(fsClient, id) {
  return control(fsClient, 'finish', id);
}
