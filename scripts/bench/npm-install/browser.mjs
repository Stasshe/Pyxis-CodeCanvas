import fixtureData from './fixtures.json';
import { finishProfile, initProfiledFsClient, startProfile } from './profile.mjs';
import nativeBaseline from './results/native-baseline.json';

const BENCH_ROOT = '/home/pyxis/.bench/npm-install';
const NPM_CACHE = '/home/pyxis/.npm';
let runNumber = 0;

async function writeManifest(fsClient, rootPath, fixture) {
  await fsClient.mkdir(rootPath, { recursive: true });
  const manifest = {
    name: `pyxis-bench-${fixture.name}`,
    version: '1.0.0',
    dependencies: fixture.dependencies,
    devDependencies: fixture.devDependencies,
  };
  await fsClient.writeFile(`${rootPath}/package.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}

async function fileStats(fsClient, rootPath) {
  const nodeModulesPath = `${rootPath}/node_modules`;
  if (!(await fsClient.exists(nodeModulesPath))) {
    return { fileCount: 0, manifestCount: 0, bytes: 0 };
  }
  const entries = await fsClient.walk(nodeModulesPath);
  const files = entries.filter(entry => entry.type === 'file');
  const manifestCount = files.filter(entry => entry.path.endsWith('/package.json')).length;
  const bytes = files.reduce((total, entry) => total + entry.size, 0);
  return { fileCount: files.length, manifestCount, bytes };
}

async function waitForFsLockRelease() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const locks = await navigator.locks.query();
    if (!locks.held.some(lock => lock.name === 'pyxis-fs-owner')) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Filesystem worker did not release its ownership lock.');
}

async function closeFsClient(fsClient) {
  fsClient.close();
  await waitForFsLockRelease();
}

async function sampleInstall(fsClient, rootPath, fixture, id, options) {
  await closeFsClient(fsClient);
  await initProfiledFsClient(fsClient, {
    profile: options.profile,
    serialExtraction: options.serialExtraction,
  });
  const manifest = await writeManifest(fsClient, rootPath, fixture);
  if (options.lockfile) {
    await fsClient.writeFile(
      `${rootPath}/package-lock.json`,
      JSON.stringify(options.lockfile, null, 2)
    );
  }
  if (options.clearCache) await fsClient.rm(NPM_CACHE, { recursive: true, force: true });
  const installer = await fsClient.getNpm(rootPath);
  try {
    if (options.profile) await startProfile(fsClient, id);
    const startedAt = performance.now();
    let output = '';
    let succeeded = true;
    try {
      output = await installer.install(undefined, []);
      succeeded = !output.includes('npm WARN ');
    } catch (error) {
      succeeded = false;
      output = error instanceof Error ? error.message : String(error);
    }
    const wallMs = performance.now() - startedAt;
    let metrics = null;
    if (options.profile) metrics = await finishProfile(fsClient, id);
    const counts = await fileStats(fsClient, rootPath);
    return {
      wallMs,
      output,
      succeeded,
      manifest,
      metrics,
      ...counts,
    };
  } finally {
    await closeFsClient(fsClient);
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p25Ms: percentile(sorted, 0.25),
    p75Ms: percentile(sorted, 0.75),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function summarizeFootprint(trials) {
  const fileCounts = trials.map(trial => trial.sample.fileCount);
  const manifestCounts = trials.map(trial => trial.sample.manifestCount);
  const bytes = trials.map(trial => trial.sample.bytes);
  return {
    fileCount: summarize(fileCounts),
    manifestCount: summarize(manifestCounts),
    bytes: summarize(bytes),
  };
}

export async function runColdTrials({
  profile = false,
  serialExtraction = false,
  fixtureNames,
  trialCount = 7,
  sourceLabel,
  onTrial,
} = {}) {
  if (!sourceLabel) throw new Error('A sourceLabel is required for repeated cold trials.');
  if (!Number.isInteger(trialCount) || trialCount < 3) {
    throw new Error('Cold-trial count must be an integer of at least 3.');
  }

  const { fsClient } = await import('/src/engine/core/fs/client.ts');
  runNumber += 1;
  const runId = `trials-${Date.now()}-${runNumber}`;
  const selectedFixtures = fixtureNames
    ? fixtureData.fixtures.filter(fixture => fixtureNames.includes(fixture.name))
    : fixtureData.fixtures;
  if (selectedFixtures.length === 0) {
    throw new Error('No matching npm benchmark fixtures were requested.');
  }
  const results = Object.fromEntries(selectedFixtures.map(fixture => [fixture.name, []]));
  const startedAt = performance.now();

  for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
    for (let offset = 0; offset < selectedFixtures.length; offset += 1) {
      const fixtureIndex = (offset + trialIndex) % selectedFixtures.length;
      const fixture = selectedFixtures[fixtureIndex];
      const rootPath = `${BENCH_ROOT}/${runId}/${fixture.name}-cold-${trialIndex + 1}`;
      const id = `${runId}-${fixture.name}-cold-${trialIndex + 1}`;
      const sample = await sampleInstall(fsClient, rootPath, fixture, id, {
        profile,
        serialExtraction,
        clearCache: true,
      });
      const trial = { trial: trialIndex + 1, rootPath, sample };
      results[fixture.name].push(trial);
      onTrial?.(fixture.name, trial);
    }
  }

  const fixtures = {};
  for (const fixture of selectedFixtures) {
    const trials = results[fixture.name];
    fixtures[fixture.name] = {
      trials,
      timings: summarize(trials.map(trial => trial.sample.wallMs)),
      footprint: summarizeFootprint(trials),
      allSucceeded: trials.every(trial => trial.sample.succeeded),
    };
  }

  return {
    benchmark: 'npm-install-cold-trials',
    sourceLabel,
    instrumented: profile,
    serialExtraction,
    trialCount,
    browser: navigator.userAgent,
    cachePolicy:
      'Each trial clears OPFS ~/.npm, uses a new project root, and fetches with cache:no-store.',
    setupMs: performance.now() - startedAt,
    results: fixtures,
  };
}

async function benchmarkFixture(fsClient, fixture, runId, profile, onFixture) {
  const coldRoot = `${BENCH_ROOT}/${runId}/${fixture.name}-cold`;
  const warmRoot = `${BENCH_ROOT}/${runId}/${fixture.name}-warm`;
  const cold = await sampleInstall(fsClient, coldRoot, fixture, `${runId}-${fixture.name}-cold`, {
    profile,
    clearCache: true,
  });
  const warm = await sampleInstall(fsClient, warmRoot, fixture, `${runId}-${fixture.name}-warm`, {
    profile,
    clearCache: false,
  });
  const lockfile = nativeBaseline.results[fixture.name].lockfile;
  const lockedRoot = `${BENCH_ROOT}/${runId}/${fixture.name}-locked`;
  const locked = await sampleInstall(
    fsClient,
    lockedRoot,
    fixture,
    `${runId}-${fixture.name}-locked`,
    { profile, clearCache: false, lockfile }
  );
  const noop = await sampleInstall(fsClient, lockedRoot, fixture, `${runId}-${fixture.name}-noop`, {
    profile,
    clearCache: false,
  });
  const result = {
    coldRoot,
    warmRoot,
    lockedRoot,
    manifest: cold.manifest,
    cold,
    warm,
    locked,
    noop,
  };
  onFixture?.(fixture.name, result);
  return result;
}

export async function runNpmBenchmarks({ profile = true, onFixture } = {}) {
  const { fsClient } = await import('/src/engine/core/fs/client.ts');
  const startedAt = performance.now();
  runNumber += 1;
  const runId = `run-${Date.now()}-${runNumber}`;
  const results = {};
  for (const fixture of fixtureData.fixtures) {
    results[fixture.name] = await benchmarkFixture(fsClient, fixture, runId, profile, onFixture);
  }
  return {
    benchmark: 'npm-install',
    instrumented: profile,
    browser: navigator.userAgent,
    cachePolicy: 'Cold clears OPFS ~/.npm; warm reuses it. Browser fetch uses cache:no-store.',
    setupMs: performance.now() - startedAt,
    results,
  };
}

export async function runInstall(name, cacheState = 'cold', profile = true) {
  const { fsClient } = await import('/src/engine/core/fs/client.ts');
  const fixture = fixtureData.fixtures.find(entry => entry.name === name);
  if (!fixture) throw new Error(`Unknown npm benchmark fixture: ${name}`);
  runNumber += 1;
  const runId = `run-${Date.now()}-${runNumber}`;
  const rootPath = `${BENCH_ROOT}/${runId}/${fixture.name}-${cacheState}`;
  const sample = await sampleInstall(
    fsClient,
    rootPath,
    fixture,
    `${runId}-${fixture.name}-${cacheState}`,
    { profile, serialExtraction: false, clearCache: cacheState === 'cold' }
  );
  return { name, cacheState, rootPath, ...sample };
}
