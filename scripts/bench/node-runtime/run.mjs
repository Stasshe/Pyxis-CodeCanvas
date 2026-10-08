import diffFixtures from './runtime-diff-fixture.json';
import runtimeFixtures from './runtime-fixtures.json';
import { seedRuntimeBenchmarks } from './seed.mjs';

function toText(data) {
  if (typeof data === 'string') return data;
  return new TextDecoder().decode(data);
}

function parseMetrics(output) {
  const marker = output.match(/__RUNTIME_BENCH__(\{[^\n]*\})/);
  if (!marker) throw new Error('Runtime benchmark metrics were not emitted.');
  return JSON.parse(marker[1]);
}

async function configureTranspilers(fsClient) {
  const { runtimeRegistry } = await import('/src/engine/runtime/core/RuntimeRegistry.ts');
  if (runtimeRegistry.getAllTranspilers().length === 0) {
    const extensionUrl = new URL('/extensions/typescript-runtime/index.js', location.origin).href;
    const { activate } = await import(extensionUrl);
    await activate({
      extensionId: 'typescript-runtime',
      extensionPath: '/extensions/typescript-runtime',
      version: '1.0.0',
      logger: { info() {}, warn() {}, error() {} },
      registerTranspiler: config => runtimeRegistry.registerTranspiler(config),
    });
  }
  await fsClient.configureTranspilers(runtimeRegistry.getAllTranspilers());
}

async function measureProvider(provider, rootPath, filePath, benchmark) {
  let output = '';
  const startedAt = performance.now();
  const result = await provider.execute({
    rootPath,
    cwd: rootPath,
    filePath,
    argv: [],
    benchmark,
    onStdout: data => {
      output += toText(data);
    },
  });
  const wallMs = performance.now() - startedAt;
  if (result.exitCode !== 0) {
    throw new Error(`${filePath} exited ${result.exitCode}: ${result.stderr ?? ''}${output}`);
  }
  const sample = { wallMs, output };
  if (benchmark) sample.metrics = parseMetrics(output);
  return sample;
}

async function measureNpmRun(providerType, rootPath, benchmark) {
  const { terminalCommandRegistry } = await import('/src/engine/cmd/terminalRegistry.ts');
  const npm = await terminalCommandRegistry.getNpmCommands(rootPath);
  const originalExecute = providerType.prototype.execute;
  const startedAt = performance.now();
  let output = '';
  if (benchmark) {
    providerType.prototype.execute = function (options) {
      return originalExecute.call(this, {
        ...options,
        benchmark: true,
        onStdout: data => {
          output += toText(data);
          options.onStdout?.(data);
        },
      });
    };
  }
  try {
    output = await npm.run('bench');
  } finally {
    if (benchmark) providerType.prototype.execute = originalExecute;
  }
  const sample = { wallMs: performance.now() - startedAt, output };
  if (benchmark) sample.metrics = parseMetrics(output);
  return sample;
}

export async function measureRuntimeBenchmarks({ benchmark = true } = {}) {
  const setupStartedAt = performance.now();
  const { fsClient } = await import('/src/engine/core/fs/client.ts');
  await seedRuntimeBenchmarks();
  await configureTranspilers(fsClient);
  const { NodeRuntimeProvider } = await import('/src/engine/runtime/nodejs/NodeRuntimeProvider.ts');
  const provider = new NodeRuntimeProvider();
  const rootPath = runtimeFixtures.rootPath;
  const setupMs = performance.now() - setupStartedAt;
  const cases = [
    ['small', `${rootPath}/bench-small.js`, runtimeFixtures.commands[0]],
    ['requires24', `${rootPath}/bench-requires.js`, runtimeFixtures.commands[1]],
    ['typescript', `${rootPath}/bench-ts.ts`, runtimeFixtures.commands[2]],
    ['nodeModules', `${rootPath}/bench-node-modules.js`, runtimeFixtures.commands[3]],
    ['diff9', `${rootPath}/bench-diff.js`, diffFixtures.command],
  ];
  const results = {};

  for (const [name, filePath, command] of cases) {
    const samples = [];
    for (let index = 0; index < 4; index++) {
      samples.push(await measureProvider(provider, rootPath, filePath, benchmark));
    }
    results[name] = { command, samples, warmSamples: samples.slice(1) };
  }

  const npmSamples = [];
  for (let index = 0; index < 4; index++) {
    npmSamples.push(await measureNpmRun(NodeRuntimeProvider, rootPath, benchmark));
  }
  results.npm = {
    command: 'npm run bench',
    samples: npmSamples,
    warmSamples: npmSamples.slice(1),
  };
  return { benchmark, setupMs, results };
}
