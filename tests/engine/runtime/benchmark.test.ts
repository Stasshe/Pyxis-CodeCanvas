import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { ModuleCode } from '@/engine/runtime/module/moduleCode';
import { ModuleResolver } from '@/engine/runtime/module/moduleResolver';
import { startBenchmark } from '@/engine/runtime/nodejs/benchmark';

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
});
