import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import fixtureData from './fixtures.json' with { type: 'json' };

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !name.startsWith('--') || !value) {
      throw new Error('Usage: run-native.mjs --workspace <path> --output <path>');
    }
    values.set(name, value);
  }
  const workspace = values.get('--workspace');
  const output = values.get('--output');
  const sourceLabel = values.get('--source-label');
  let trialCount = 7;
  const trialValue = values.get('--trials');
  if (trialValue) trialCount = Number(trialValue);
  if (
    !workspace ||
    !output ||
    !sourceLabel ||
    (values.size !== 3 && values.size !== 4) ||
    !Number.isInteger(trialCount) ||
    trialCount < 5
  ) {
    throw new Error(
      'Usage: run-native.mjs --workspace <path> --output <path> --source-label <label> [--trials 7]'
    );
  }
  return { workspace: resolve(workspace), output: resolve(output), sourceLabel, trialCount };
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

function runNpm(rootPath, cachePath) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cachePath],
      { cwd: rootPath, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`npm install exited ${code}: ${output}`));
        return;
      }
      resolve({ wallMs: performance.now() - startedAt, output });
    });
  });
}

function npmVersion() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`npm --version exited ${code}`));
        return;
      }
      resolve(output.trim());
    });
  });
}

async function collectFileStats(rootPath) {
  const pending = [rootPath];
  let fileCount = 0;
  let manifestCount = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      if (entry.name === 'package.json') manifestCount += 1;
      bytes += (await stat(path)).size;
    }
  }
  return { fileCount, manifestCount, bytes };
}

async function benchmarkFixture(basePath, fixture, trialCount) {
  const manifest = {
    name: `pyxis-bench-${fixture.name}`,
    version: '1.0.0',
    dependencies: fixture.dependencies,
    devDependencies: fixture.devDependencies,
  };
  const trials = [];
  let lockfile = null;
  for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
    const trial = trialIndex + 1;
    const rootPath = join(basePath, fixture.name, `cold-${trial}`);
    const cachePath = join(basePath, 'cache', fixture.name, `trial-${trial}`);
    await mkdir(rootPath, { recursive: true });
    await mkdir(cachePath, { recursive: true });
    await writeFile(join(rootPath, 'package.json'), JSON.stringify(manifest, null, 2));
    const sample = await runNpm(rootPath, cachePath);
    Object.assign(sample, await collectFileStats(join(rootPath, 'node_modules')));
    if (trialIndex === 0) {
      lockfile = JSON.parse(await readFile(join(rootPath, 'package-lock.json'), 'utf8'));
    }
    trials.push({ trial, rootPath, cachePath, sample });
    process.stderr.write(
      `${fixture.name} cold trial ${trial}/${trialCount}: ${sample.wallMs.toFixed(1)} ms\n`
    );
  }
  return {
    manifest,
    lockfile,
    trials,
    timings: summarize(trials.map(trial => trial.sample.wallMs)),
    footprint: {
      fileCount: summarize(trials.map(trial => trial.sample.fileCount)),
      manifestCount: summarize(trials.map(trial => trial.sample.manifestCount)),
      bytes: summarize(trials.map(trial => trial.sample.bytes)),
    },
  };
}

const { workspace, output, sourceLabel, trialCount } = parseArguments(process.argv.slice(2));
const basePath = join(workspace, 'native-npm-bench');
await rm(basePath, { recursive: true, force: true });
await mkdir(basePath, { recursive: true });
const results = {};
for (const fixture of fixtureData.fixtures) {
  results[fixture.name] = await benchmarkFixture(basePath, fixture, trialCount);
}
const result = {
  benchmark: 'npm-install-native',
  sourceLabel,
  trialCount,
  node: process.version,
  npm: await npmVersion(),
  installArgs: ['--ignore-scripts', '--no-audit', '--no-fund'],
  cachePolicy: 'Each trial uses a new project root and an empty dedicated npm cache.',
  results,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized);
process.stdout.write(serialized);
