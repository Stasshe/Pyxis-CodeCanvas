function unavailable(method: string): never {
  throw Object.assign(new Error(`v8.${method} is unavailable in the browser runtime`), {
    code: 'ERR_FEATURE_UNAVAILABLE',
  });
}

export function createV8Module() {
  return {
    serialize: <T>(_value: T): never => unavailable('serialize'),
    deserialize: (_data: Uint8Array): never => unavailable('deserialize'),
    getHeapStatistics: (): never => unavailable('getHeapStatistics'),
    getHeapSpaceStatistics: (): never => unavailable('getHeapSpaceStatistics'),
    getHeapCodeStatistics: (): never => unavailable('getHeapCodeStatistics'),
    writeHeapSnapshot: (): never => unavailable('writeHeapSnapshot'),
    setFlagsFromString: (_flags: string): never => unavailable('setFlagsFromString'),
    cachedDataVersionTag: (): never => unavailable('cachedDataVersionTag'),
  };
}
