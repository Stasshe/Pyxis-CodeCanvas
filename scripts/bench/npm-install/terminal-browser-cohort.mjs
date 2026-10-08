import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegistryNetworkCapture } from './registry-network-capture.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function browser(session, ...args) {
  return execFileSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
  }).trim();
}

function parseEval(output) {
  const parsed = JSON.parse(output);
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const weight = position - low;
  return sorted[low] + (sorted[high] - sorted[low]) * weight;
}

const [
  session,
  workspace,
  fixturePath,
  outputPath,
  countText = '7',
  networkText = 'off',
] = process.argv.slice(2);
const count = Number(countText);
if (
  !session ||
  !workspace ||
  !fixturePath ||
  !outputPath ||
  !Number.isInteger(count) ||
  count < 1 ||
  !['on', 'off'].includes(networkText)
) {
  throw new Error(
    'Usage: node terminal-browser-cohort.mjs <session> <workspace> <fixture.json> <output.json> [trials=7] [cdp-network=off]'
  );
}

const fixtureData = JSON.parse(await readFile(resolve(fixturePath), 'utf8'));
const fixtureUrl = `/scripts/bench/npm-install/${basename(fixturePath)}`;
const cdpUrl = browser(session, 'get', 'cdp-url');
const ready = browser(
  session,
  'eval',
  `(async()=>{await import('/scripts/bench/npm-install/terminal-capture.mjs');return true})()`
);
if (ready !== 'true') throw new Error('Terminal capture did not initialize.');
let networkCapture = null;
if (networkText === 'on') {
  networkCapture = await new RegistryNetworkCapture(
    cdpUrl,
    'http://pyxis.localhost:5174/'
  ).connect();
}

const trials = [];
try {
  for (let trial = 1; trial <= count; trial += 1) {
    const setupCode = `(async()=>{
    const {fsClient}=await import('/src/engine/core/fs/client.ts');
    const fixture=await (await fetch('${fixtureUrl}',{cache:'no-store'})).json();
    for(const path of ['${workspace}/node_modules','${workspace}/package-lock.json','/home/pyxis/.npm']){
      try{await fsClient.rm(path,{recursive:true,force:true})}catch{}
    }
    await fsClient.writeFile('${workspace}/package.json',fixture.manifestText);
    if(fixture.lockfileText)await fsClient.writeFile('${workspace}/package-lock.json',fixture.lockfileText);
    const manifestText=await fsClient.readText('${workspace}/package.json');
    const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),value=>value.toString(16).padStart(2,'0')).join('');
    const lockfileText=fixture.lockfileText?await fsClient.readText('${workspace}/package-lock.json'):null;
    return {fixtureMatch:manifestText===fixture.manifestText&&lockfileText===fixture.lockfileText,manifestSha256:await digest(manifestText),lockSha256:lockfileText?await digest(lockfileText):null,manifestBytes:new TextEncoder().encode(manifestText).length,lockfileBytes:lockfileText?new TextEncoder().encode(lockfileText).length:0,lockPackageCount:fixture.lockfileText?Object.keys(JSON.parse(lockfileText).packages).length-1:0};
  })()`;
    const fixtureState = parseEval(browser(session, 'eval', setupCode));
    if (
      !fixtureState.fixtureMatch ||
      (fixtureState.lockfileBytes && fixtureState.lockPackageCount !== 43)
    ) {
      throw new Error(`Trial ${trial} did not start from the frozen fixture bytes.`);
    }
    execFileSync('node', [resolve(scriptDirectory, 'clear-browser-cache.mjs'), cdpUrl], {
      encoding: 'utf8',
    });
    networkCapture?.beginTrial();
    browser(session, 'click', 'textarea[aria-label="Terminal input"]');
    browser(session, 'keyboard', 'type', fixtureData.command);
    browser(
      session,
      'eval',
      `window.__npmTerminalCapture.arm({command:${JSON.stringify(fixtureData.command)},cwd:'${workspace}',caseName:'${fixtureData.name}-${trial}',cachePolicy:'http-cold'})`
    );
    browser(session, 'press', 'Enter');
    const completed = browser(
      session,
      'wait',
      '--fn',
      'window.__npmTerminalCapture.current()?.promptStableAt !== null'
    );
    if (completed !== 'true') throw new Error(`Trial ${trial} did not return to a stable prompt.`);
    const capture = parseEval(
      browser(session, 'eval', 'JSON.stringify(window.__npmTerminalCapture.current())')
    );
    let network = null;
    if (networkCapture) network = networkCapture.endTrial();
    if (
      !capture.trustedEnter ||
      !capture.commandEchoedBeforeEnter ||
      !capture.outputTail.includes(`added ${fixtureData.expectedAddedPackages} packages`) ||
      !capture.outputTail.includes(`checked ${fixtureData.pyxisExpectedCheckedPackages} packages`)
    ) {
      throw new Error(`Trial ${trial} failed its Terminal output checks.`);
    }
    trials.push({ trial, fixture: fixtureState, capture, network });
    const resultPath = resolve(
      `${outputPath.replace(/\.json$/, '')}-trial${String(trial).padStart(2, '0')}.json`
    );
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      `${JSON.stringify({ fixture: fixtureState, capture, network }, null, 2)}\n`
    );
    process.stdout.write(
      `trial ${trial}/${count}: ${capture.enterToPromptMs.toFixed(1)} ms visible, ${capture.enterToStablePromptMs.toFixed(1)} ms stable${network ? `, ${network.requests.length} registry requests` : ''}\n`
    );
  }

  const visible = trials.map(trial => trial.capture.enterToPromptMs);
  const stable = trials.map(trial => trial.capture.enterToStablePromptMs);
  const result = {
    benchmark: 'pyxis-terminal-npm-install',
    sourceLabel: fixtureData.name,
    command: fixtureData.command,
    cachePolicy:
      'OPFS npm cache and node_modules cleared before each trial; browser HTTP cache cleared through CDP.',
    networkCapture: networkText === 'on'
      ? 'CDP Network events from the page and filesystem Worker; public registry requests only.'
      : 'disabled to avoid observer overhead in lightweight Terminal cohorts.',
    fixtureSha256: trials[0].fixture,
    trialCount: count,
    visiblePromptMs: {
      median: percentile(visible, 0.5),
      p25: percentile(visible, 0.25),
      p75: percentile(visible, 0.75),
      min: Math.min(...visible),
      max: Math.max(...visible),
    },
    stablePromptMs: {
      median: percentile(stable, 0.5),
      p25: percentile(stable, 0.25),
      p75: percentile(stable, 0.75),
      min: Math.min(...stable),
      max: Math.max(...stable),
    },
    trials,
  };
  const summaryPath = resolve(outputPath);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ visiblePromptMs: result.visiblePromptMs, stablePromptMs: result.stablePromptMs, summaryPath })}\n`
  );
} finally {
  if (networkCapture) await networkCapture.close();
}
