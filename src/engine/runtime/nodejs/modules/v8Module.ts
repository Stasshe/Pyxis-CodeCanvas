/**
 * v8 モジュールのエミュレーション（ブラウザ環境用スタブ）
 *
 * 実際のV8エンジン統計APIは提供できないため、
 * 最低限のインターフェースのみスタブとして実装する。
 * prettierなどのパッケージがimportするケースに対応。
 */

export function createV8Module() {
  return {
    serialize: (_value: unknown): Buffer => Buffer.alloc(0),
    deserialize: (_buffer: unknown): unknown => undefined,
    getHeapStatistics: () => ({
      total_heap_size: 0,
      total_heap_size_executable: 0,
      total_physical_size: 0,
      total_available_size: 0,
      used_heap_size: 0,
      heap_size_limit: 0,
      malloced_memory: 0,
      peak_malloced_memory: 0,
      does_zap_garbage: 0,
      number_of_native_contexts: 0,
      number_of_detached_contexts: 0,
    }),
    getHeapSpaceStatistics: () => [],
    getHeapCodeStatistics: () => ({
      code_and_metadata_size: 0,
      bytecode_and_metadata_size: 0,
      external_script_source_size: 0,
    }),
    writeHeapSnapshot: () => '',
    setFlagsFromString: (_flags: string) => {},
    cachedDataVersionTag: () => 0,
  };
}
