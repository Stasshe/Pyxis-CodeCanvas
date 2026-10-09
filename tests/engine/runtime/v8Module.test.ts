import { describe, expect, it } from 'vitest';
import { createV8Module } from '@/engine/runtime/nodejs/modules/v8Module';

describe('Node v8 builtin', () => {
  it('reports unsupported serialization instead of losing data', () => {
    const v8 = createV8Module();
    const value = { answer: 42 };

    expect(() => v8.serialize(value)).toThrowError(
      expect.objectContaining({ code: 'ERR_FEATURE_UNAVAILABLE' })
    );
    expect(() => v8.serialize(42)).toThrowError(
      expect.objectContaining({ code: 'ERR_FEATURE_UNAVAILABLE' })
    );
    expect(() => v8.deserialize(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: 'ERR_FEATURE_UNAVAILABLE' })
    );
  });

  it('reports unsupported methods explicitly instead of returning fake values', () => {
    const v8 = createV8Module();
    const methods = [
      v8.getHeapStatistics,
      v8.getHeapSpaceStatistics,
      v8.getHeapCodeStatistics,
      v8.writeHeapSnapshot,
      v8.cachedDataVersionTag,
    ];

    for (const method of methods) {
      expect(() => method()).toThrowError(
        expect.objectContaining({ code: 'ERR_FEATURE_UNAVAILABLE' })
      );
    }

    expect(() => v8.setFlagsFromString('--expose-gc')).toThrowError(
      expect.objectContaining({ code: 'ERR_FEATURE_UNAVAILABLE' })
    );
  });
});
