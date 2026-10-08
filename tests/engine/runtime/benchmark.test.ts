import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { ModuleCode } from '@/engine/runtime/module/moduleCode';
import { ModuleLoader } from '@/engine/runtime/module/moduleLoader';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import { startBenchmark } from '@/engine/runtime/nodejs/benchmark';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { createNodeRuntimeFixture } from '../../_helpers/nodeRuntime';

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(),
  readMessage: vi.fn(),
}));

interface BenchmarkCounters {
  parseCalls: number;
  analyzeCalls: number;
  workerStartMs: number;
  acquisitionMs?: number;
  preparedWorker?: boolean;
  preloadWallMs: number;
  executeWallMs: number;
  executeOutsidePreloadMs: number;
  preloadAnalyzeMs: number;
  preloadRpcOutsideAnalyzeMs: number;
  preloadOtherMs: number;
  eventLoopWallMs: number;
  fsOperations: Record<string, { calls: number; wallMs: number; queueMs: number; coreMs: number }>;
}

function counters(report: string): BenchmarkCounters {
  return JSON.parse(report.slice('__RUNTIME_BENCH__'.length));
}

afterEach(() => vi.unstubAllGlobals());

describe('runtime benchmark lifecycle', () => {
  it('restores all instrumented methods before a subsequent execution', () => {
    class Xhr {
      send() {}
    }
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const benchmarkReply = RuntimeBridge.prototype.benchmarkReply;
    const preload = ModuleLoader.prototype.preloadDependencies;
    const execute = NodeRuntime.prototype.execute;
    const wait = NodeRuntime.prototype.waitForEventLoop;
    const sync = RuntimeBridge.prototype.sync;
    const asyncRpc = RuntimeBridge.prototype.async;
    const resolve = ModuleResolver.prototype.resolve;
    const resolveSync = ModuleResolver.prototype.resolveSync;
    const packageType = ModuleResolver.prototype.packageType;
    const packageTypeSync = ModuleResolver.prototype.packageTypeSync;
    const parse = ModuleCode.parse;
    const analyze = ModuleCode.analyze;
    const send = Xhr.prototype.send;
    const first = startBenchmark(4);
    try {
      ModuleCode.analyze('const value = 1;', 'first.js');
      expect(counters(first.report())).toMatchObject({ parseCalls: 1, analyzeCalls: 1 });
    } finally {
      first.dispose();
    }
    first.dispose();
    expect(RuntimeBridge.prototype.benchmarkReply).toBe(benchmarkReply);
    expect(ModuleLoader.prototype.preloadDependencies).toBe(preload);
    expect(NodeRuntime.prototype.execute).toBe(execute);
    expect(NodeRuntime.prototype.waitForEventLoop).toBe(wait);
    expect(RuntimeBridge.prototype.sync).toBe(sync);
    expect(RuntimeBridge.prototype.async).toBe(asyncRpc);
    expect(ModuleResolver.prototype.resolve).toBe(resolve);
    expect(ModuleResolver.prototype.resolveSync).toBe(resolveSync);
    expect(ModuleResolver.prototype.packageType).toBe(packageType);
    expect(ModuleResolver.prototype.packageTypeSync).toBe(packageTypeSync);
    expect(ModuleCode.parse).toBe(parse);
    expect(ModuleCode.analyze).toBe(analyze);
    expect(Xhr.prototype.send).toBe(send);

    ModuleCode.analyze('const value = 2;', 'normal.js');
    expect(counters(first.report()).analyzeCalls).toBe(1);
    const second = startBenchmark(2, { acquisitionMs: 3, preparedWorker: true });
    try {
      ModuleCode.analyze('const value = 3;', 'second.js');
      expect(counters(second.report())).toMatchObject({
        parseCalls: 1,
        analyzeCalls: 1,
        workerStartMs: 2,
        acquisitionMs: 3,
        preparedWorker: true,
      });
      expect(counters(first.report()).analyzeCalls).toBe(1);
    } finally {
      second.dispose();
    }
    expect(ModuleCode.parse).toBe(parse);
    expect(ModuleCode.analyze).toBe(analyze);
  });

  it('partitions preload wall time without summing overlapping RPC or parser spans', async () => {
    class Xhr {
      send() {}
    }
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const fixture = await createNodeRuntimeFixture('/tmp/benchmark');
    const path = `${fixture.rootPath}/entry.cjs`;
    await fixture.writeFile(path, 'module.exports = 1;');
    await fixture.writeFile(`${fixture.rootPath}/package.json`, '{"type":"commonjs"}');
    const session = startBenchmark(0);
    try {
      await fixture.runtime.execute(path);
      await fixture.runtime.waitForEventLoop();
      const metrics = counters(session.report());
      expect(metrics.preloadWallMs).toBeGreaterThan(0);
      expect(metrics.eventLoopWallMs).toBeGreaterThan(0);
      expect(
        metrics.preloadAnalyzeMs + metrics.preloadRpcOutsideAnalyzeMs + metrics.preloadOtherMs
      ).toBeCloseTo(metrics.preloadWallMs, 8);
      expect(metrics.preloadWallMs + metrics.executeOutsidePreloadMs).toBeCloseTo(
        metrics.executeWallMs,
        8
      );
      expect(metrics.preloadOtherMs).toBeGreaterThanOrEqual(0);
      expect(metrics.fsOperations[`readFile ${path}`].calls).toBe(1);
    } finally {
      session.dispose();
      fixture.runtime.dispose();
      fixture.close();
    }
  });
});
