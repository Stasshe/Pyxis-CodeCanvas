/** Opt-in measurements scoped to one execution in a reusable runtime worker. */
import { RuntimeBridge } from '../bridge/client';
import type { FsRequest, RpcValue } from '../bridge/protocol';
import { ModuleCode } from '../module/moduleCode';
import { ModuleLoader } from '../module/moduleLoader';
import { ModuleResolver } from '../module/moduleResolver';
import { NodeRuntime } from './nodeRuntime';

interface Span {
  start: number;
  end: number;
}

function coveredMs(spans: Span[], bounds: Span): number {
  const clipped = spans
    .map(span => ({
      start: Math.max(span.start, bounds.start),
      end: Math.min(span.end, bounds.end),
    }))
    .filter(span => span.end > span.start)
    .sort((first, second) => first.start - second.start);
  let end = bounds.start;
  let total = 0;
  for (const span of clipped) {
    total += Math.max(0, span.end - Math.max(span.start, end));
    end = Math.max(end, span.end);
  }
  return total;
}

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
    preloadWallMs: 0,
    executeWallMs: 0,
    eventLoopWallMs: 0,
    fsOperations: {} as Record<
      string,
      { calls: number; wallMs: number; queueMs: number; coreMs: number }
    >,
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
  const rpcSpans: Span[] = [];
  const analyzeSpans: Span[] = [];
  const preloadSpans: Span[] = [];
  function fsOperation(request: FsRequest) {
    const key = `${request.op} ${request.path}`;
    let operation = benchmark.fsOperations[key];
    if (!operation) {
      operation = { calls: 0, wallMs: 0, queueMs: 0, coreMs: 0 };
      benchmark.fsOperations[key] = operation;
    }
    return operation;
  }
  const originalBenchmarkReply = RuntimeBridge.prototype.benchmarkReply;
  RuntimeBridge.prototype.benchmarkReply = (request, metrics) => {
    const operation = fsOperation(request);
    operation.queueMs += metrics.queueMs;
    operation.coreMs += metrics.coreMs;
  };
  function recordRpc(request: Parameters<RuntimeBridge['sync']>[0], start: number): number {
    const end = performance.now();
    rpcSpans.push({ start, end });
    const elapsed = end - start;
    if (request.kind === 'fs') {
      const operation = fsOperation(request);
      operation.calls++;
      operation.wallMs += elapsed;
    }
    return elapsed;
  }
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
    if (request.kind === 'fs') {
      benchmark.fsRpc++;
      request = { ...request, benchmark: true };
    }
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
      const elapsed = recordRpc(request, startedAt);
      benchmark.syncMs += elapsed;
      if (request.kind === 'fs' && request.op === 'readFile') benchmark.readFileMs += elapsed;
      if (request.kind === 'transpile') benchmark.transpileMs += elapsed;
    }
  };
  const originalAsync = RuntimeBridge.prototype.async;
  RuntimeBridge.prototype.async = async function (request) {
    const startedAt = performance.now();
    benchmark.asyncRpc++;
    if (request.kind === 'fs') {
      benchmark.fsRpc++;
      request = { ...request, benchmark: true };
    }
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
      const elapsed = recordRpc(request, startedAt);
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
      const end = performance.now();
      benchmark.analyzeMs += end - startedAt;
      analyzeSpans.push({ start: startedAt, end });
    }
  };
  const originalPreload = ModuleLoader.prototype.preloadDependencies;
  ModuleLoader.prototype.preloadDependencies = async function (...args) {
    const start = performance.now();
    try {
      return await originalPreload.apply(this, args);
    } finally {
      const end = performance.now();
      benchmark.preloadWallMs += end - start;
      preloadSpans.push({ start, end });
    }
  };
  const originalExecute = NodeRuntime.prototype.execute;
  NodeRuntime.prototype.execute = async function (...args) {
    const start = performance.now();
    try {
      return await originalExecute.apply(this, args);
    } finally {
      benchmark.executeWallMs += performance.now() - start;
    }
  };
  const originalWaitForEventLoop = NodeRuntime.prototype.waitForEventLoop;
  NodeRuntime.prototype.waitForEventLoop = async function (...args) {
    const start = performance.now();
    try {
      return await originalWaitForEventLoop.apply(this, args);
    } finally {
      benchmark.eventLoopWallMs += performance.now() - start;
    }
  };
  let disposed = false;
  return {
    report() {
      let preloadAnalyzeMs = 0;
      let preloadRpcActiveMs = 0;
      let preloadRpcWhileAnalyzeMs = 0;
      for (const preload of preloadSpans) {
        preloadAnalyzeMs += coveredMs(analyzeSpans, preload);
        preloadRpcActiveMs += coveredMs(rpcSpans, preload);
        for (const analyze of analyzeSpans) {
          const bounds = {
            start: Math.max(analyze.start, preload.start),
            end: Math.min(analyze.end, preload.end),
          };
          preloadRpcWhileAnalyzeMs += coveredMs(rpcSpans, bounds);
        }
      }
      const preloadRpcOutsideAnalyzeMs = preloadRpcActiveMs - preloadRpcWhileAnalyzeMs;
      const phases = {
        executeOutsidePreloadMs: benchmark.executeWallMs - benchmark.preloadWallMs,
        preloadAnalyzeMs,
        preloadRpcOutsideAnalyzeMs,
        preloadOtherMs: benchmark.preloadWallMs - preloadAnalyzeMs - preloadRpcOutsideAnalyzeMs,
        preloadRpcActiveMs,
        preloadRpcWhileAnalyzeMs,
      };
      return `__RUNTIME_BENCH__${JSON.stringify({ ...benchmark, ...phases })}\n`;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      RuntimeBridge.prototype.benchmarkReply = originalBenchmarkReply;
      ModuleLoader.prototype.preloadDependencies = originalPreload;
      NodeRuntime.prototype.execute = originalExecute;
      NodeRuntime.prototype.waitForEventLoop = originalWaitForEventLoop;
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
