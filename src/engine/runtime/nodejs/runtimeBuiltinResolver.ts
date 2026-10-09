import type { BuiltInModules } from './builtInModule';
import {
  type ConsumerStream,
  collectStream,
  type ProcessObject,
  type RuntimeConsole,
  type RuntimeTimerModule,
} from './runtimeTypes';

interface RuntimeBuiltinResolverOptions {
  modules: BuiltInModules;
  getProcess: () => ProcessObject;
  createConsole: () => RuntimeConsole;
  createTimerModule: () => RuntimeTimerModule;
}

export class RuntimeBuiltinResolver {
  private readonly cache = new Map<string, unknown>();
  private builtIns: Record<string, unknown> | null = null;

  constructor(private readonly options: RuntimeBuiltinResolverOptions) {}

  resolve(moduleName: string): unknown | null {
    let normalizedName = moduleName;
    if (normalizedName.startsWith('node:')) normalizedName = normalizedName.slice(5);
    if (this.cache.has(normalizedName)) return this.cache.get(normalizedName) ?? null;

    let builtIns = this.builtIns;
    if (builtIns === null) {
      const modules = this.options.modules;
      builtIns = {
        fs: modules.fs,
        'fs/promises': modules.fs.promises,
        path: modules.path,
        'path/posix': modules.path.posix,
        'path/win32': modules.path.win32,
        os: modules.os,
        util: modules.util,
        'util/types': modules.util.types,
        http: modules.http,
        https: modules.https,
        buffer: modules.buffer,
        readline: modules.readline,
        'readline/promises': modules.readlinePromises,
        assert: modules.assert,
        'assert/strict': modules.assert.strict,
        events: modules.events,
        module: modules.module,
        net: modules.net,
        url: modules.url,
        stream: modules.stream,
        'stream/promises': modules.stream.promises,
        'stream/web': modules.webStreams,
        worker_threads: modules.worker_threads,
        tty: modules.tty,
        v8: modules.v8,
        crypto: modules.crypto,
        diagnostics_channel: modules.diagnostics_channel,
        child_process: modules.child_process,
        constants: modules.constants,
        zlib: modules.zlib,
        querystring: modules.querystring,
        'stream/consumers': {
          text: async (stream: ConsumerStream) =>
            new TextDecoder().decode(await collectStream(stream)),
          json: async (stream: ConsumerStream): Promise<unknown> =>
            JSON.parse(new TextDecoder().decode(await collectStream(stream))),
          buffer: collectStream,
        },
        string_decoder: modules.string_decoder,
        'timers/promises': {
          setTimeout: (delay?: number) =>
            new Promise<void>(resolve =>
              this.options.createTimerModule().setTimeout(() => resolve(), delay)
            ),
          setImmediate: () =>
            new Promise<void>(resolve =>
              this.options.createTimerModule().setImmediate(() => resolve())
            ),
        },
        perf_hooks: {
          performance: globalThis.performance,
        },
        process: this.options.getProcess(),
        timers: this.options.createTimerModule(),
        console: this.options.createConsole(),
      };
      this.builtIns = builtIns;
    }

    const builtInModule = builtIns[normalizedName];
    if (builtInModule === undefined) return null;
    this.cache.set(normalizedName, builtInModule);
    return builtInModule;
  }
}
