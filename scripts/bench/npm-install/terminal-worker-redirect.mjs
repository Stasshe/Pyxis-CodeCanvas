const OriginalWorker = globalThis.Worker;
let redirected = false;

globalThis.Worker = class extends OriginalWorker {
  constructor(url, options) {
    let target = url;
    if (!redirected && String(url).includes('/core/fs/worker.ts')) {
      redirected = true;
      target = new URL(
        '/scripts/bench/npm-install/worker.mjs?worker_file&type=module&profile=1&serialExtraction=0&cachePolicy=default',
        globalThis.location.origin
      );
      globalThis.__npmBenchWorkerRedirected = String(target);
    }
    super(target, options);
  }
};
