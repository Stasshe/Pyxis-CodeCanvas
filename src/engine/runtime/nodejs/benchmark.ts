/** Opt-in measurements scoped to one execution in a reusable runtime worker. */
import { RuntimeBridge } from '../bridge/client';
import type { RpcValue } from '../bridge/protocol';
import { ModuleCode } from '../module/moduleCode';
import { ModuleResolver } from '../module/moduleResolver';

export interface BenchmarkSession {
  report(): string;
  dispose(): void;
}

export interface BenchmarkAcquisition {
  acquisitionMs: number;
  preparedWorker: boolean;
}

export function startBenchmark(
  workerStartMs: number,
  acquisition?: BenchmarkAcquisition
): BenchmarkSession {
  const benchmark = {
    workerStartMs,
    ...acquisition,
    parseCalls: 0,
    parseMs: 0,
    analyzeCalls: 0,
    analyzeMs: 0,
    syncXhr: 0,
    syncMs: 0,
    fsRpc: 0,
    readFileCalls: 0,
    readFileBytes: 0,
    readFileMs: 0,
    asyncRpc: 0,
    asyncMs: 0,
    resolveCalls: 0,
    resolveMs: 0,
    transpileCalls: 0,
    transpileMs: 0,
    esbuildInitMs: 0,
    transformMs: 0,
    packageTypeCalls: 0,
    packageTypeMs: 0,
    actualXhrCalls: 0,
    actualXhrMs: 0,
  };
  function recordReply(value: RpcValue): void {
    if (typeof value === 'object' && value !== null && 'benchmark' in value && value.benchmark) {
      benchmark.esbuildInitMs += value.benchmark.initMs;
      benchmark.transformMs += value.benchmark.transformMs;
    }
  }
  const originalSync = RuntimeBridge.prototype.sync;
  RuntimeBridge.prototype.sync = function (request) {
    const startedAt = performance.now();
    benchmark.syncXhr++;
    if (request.kind === 'fs') benchmark.fsRpc++;
    if (request.kind === 'transpile') {
      benchmark.transpileCalls++;
      request = { ...request, benchmark: true };
    }
    try {
      const value = originalSync.call(this, request);
      recordReply(value);
      if (request.kind === 'fs' && request.op === 'readFile') {
        benchmark.readFileCalls++;
        if (Array.isArray(value)) benchmark.readFileBytes += value.length;
      }
      return value;
    } finally {
      const elapsed = performance.now() - startedAt;
      benchmark.syncMs += elapsed;
      if (request.kind === 'fs' && request.op === 'readFile') benchmark.readFileMs += elapsed;
      if (request.kind === 'transpile') benchmark.transpileMs += elapsed;
    }
  };
  const originalAsync = RuntimeBridge.prototype.async;
  RuntimeBridge.prototype.async = async function (request) {
    const startedAt = performance.now();
    benchmark.asyncRpc++;
    if (request.kind === 'fs') benchmark.fsRpc++;
    if (request.kind === 'transpile') {
      benchmark.transpileCalls++;
      request = { ...request, benchmark: true };
    }
    try {
      const value = await originalAsync.call(this, request);
      recordReply(value);
      if (request.kind === 'fs' && request.op === 'readFile') {
        benchmark.readFileCalls++;
        if (Array.isArray(value)) benchmark.readFileBytes += value.length;
      }
      return value;
    } finally {
      const elapsed = performance.now() - startedAt;
      benchmark.asyncMs += elapsed;
      if (request.kind === 'fs' && request.op === 'readFile') benchmark.readFileMs += elapsed;
      if (request.kind === 'transpile') benchmark.transpileMs += elapsed;
    }
  };
  const originalResolve = ModuleResolver.prototype.resolve;
  ModuleResolver.prototype.resolve = async function (...args) {
    const startedAt = performance.now();
    benchmark.resolveCalls++;
    try {
      return await originalResolve.apply(this, args);
    } finally {
      benchmark.resolveMs += performance.now() - startedAt;
    }
  };
  const originalResolveSync = ModuleResolver.prototype.resolveSync;
  ModuleResolver.prototype.resolveSync = function (...args) {
    const startedAt = performance.now();
    benchmark.resolveCalls++;
    try {
      return originalResolveSync.apply(this, args);
    } finally {
      benchmark.resolveMs += performance.now() - startedAt;
    }
  };
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['send']>
  ) {
    const startedAt = performance.now();
    benchmark.actualXhrCalls++;
    try {
      return originalXhrSend.apply(this, args);
    } finally {
      benchmark.actualXhrMs += performance.now() - startedAt;
    }
  };
  const originalPackageType = ModuleResolver.prototype.packageType;
  ModuleResolver.prototype.packageType = async function (...args) {
    const startedAt = performance.now();
    benchmark.packageTypeCalls++;
    try {
      return await originalPackageType.apply(this, args);
    } finally {
      benchmark.packageTypeMs += performance.now() - startedAt;
    }
  };
  const originalPackageTypeSync = ModuleResolver.prototype.packageTypeSync;
  ModuleResolver.prototype.packageTypeSync = function (...args) {
    const startedAt = performance.now();
    benchmark.packageTypeCalls++;
    try {
      return originalPackageTypeSync.apply(this, args);
    } finally {
      benchmark.packageTypeMs += performance.now() - startedAt;
    }
  };
  const originalParse = ModuleCode.parse;
  ModuleCode.parse = function (...args) {
    const startedAt = performance.now();
    benchmark.parseCalls++;
    try {
      return originalParse.apply(this, args);
    } finally {
      benchmark.parseMs += performance.now() - startedAt;
    }
  };
  const originalAnalyze = ModuleCode.analyze;
  ModuleCode.analyze = function (...args) {
    const startedAt = performance.now();
    benchmark.analyzeCalls++;
    try {
      return originalAnalyze.apply(this, args);
    } finally {
      benchmark.analyzeMs += performance.now() - startedAt;
    }
  };
  let disposed = false;
  return {
    report: () => `__RUNTIME_BENCH__${JSON.stringify(benchmark)}\n`,
    dispose() {
      if (disposed) return;
      disposed = true;
      RuntimeBridge.prototype.sync = originalSync;
      RuntimeBridge.prototype.async = originalAsync;
      ModuleResolver.prototype.resolve = originalResolve;
      ModuleResolver.prototype.resolveSync = originalResolveSync;
      ModuleResolver.prototype.packageType = originalPackageType;
      ModuleResolver.prototype.packageTypeSync = originalPackageTypeSync;
      XMLHttpRequest.prototype.send = originalXhrSend;
      ModuleCode.parse = originalParse;
      ModuleCode.analyze = originalAnalyze;
    },
  };
}
