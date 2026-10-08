import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RegistryNetworkCapture } from './registry-network-capture.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

async function browser(session, ...args) {
  const { stdout } = await execFileAsync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
  });
  return stdout.trim();
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
  profileText = 'off',
] = process.argv.slice(2);
const count = Number(countText);
if (
  !session ||
  !workspace ||
  !fixturePath ||
  !outputPath ||
  !Number.isInteger(count) ||
  count < 1 ||
  !['on', 'off'].includes(networkText) ||
  !['on', 'off'].includes(profileText)
) {
  throw new Error(
    'Usage: node terminal-browser-cohort.mjs <session> <workspace> <fixture.json> <output.json> [trials=7] [cdp-network=off] [profile=off]'
  );
}

const fixtureData = JSON.parse(await readFile(resolve(fixturePath), 'utf8'));
const fixtureUrl = `/scripts/bench/npm-install/${basename(fixturePath)}`;
const cdpUrl = await browser(session, 'get', 'cdp-url');
const ready = await browser(
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
if (profileText === 'on') {
  const hooksReady = await browser(
    session,
    'eval',
    `(async()=>{const profile=await import('/scripts/bench/npm-install/terminal-profile.mjs');await profile.initTerminalProfileHooks();return true})()`
  );
  if (hooksReady !== 'true') throw new Error('Terminal profile hooks did not initialize.');
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
    const fixtureState = parseEval(await browser(session, 'eval', setupCode));
    if (
      !fixtureState.fixtureMatch ||
      (fixtureState.lockfileBytes && fixtureState.lockPackageCount !== 43)
    ) {
      throw new Error(`Trial ${trial} did not start from the frozen fixture bytes.`);
    }
    if (profileText === 'on') {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await execFileAsync('node', [resolve(scriptDirectory, 'clear-browser-cache.mjs'), cdpUrl], {
      encoding: 'utf8',
    });
    networkCapture?.beginTrial();
    await browser(session, 'click', 'textarea[aria-label="Terminal input"]');
    await browser(session, 'keyboard', 'type', fixtureData.command);
    const caseName = `${fixtureData.name}-${trial}`;
    if (profileText === 'on') {
      const started = await browser(
        session,
        'eval',
        `(async()=>{const {fsClient}=await import('/src/engine/core/fs/client.ts');const profile=await import('/scripts/bench/npm-install/profile.mjs');const terminal=await import('/scripts/bench/npm-install/terminal-profile.mjs');await profile.startProfile(fsClient,${JSON.stringify(caseName)});terminal.startTerminalProfile(${JSON.stringify(caseName)});return true})()`
      );
      if (started !== 'true') throw new Error(`Profile ${caseName} did not start.`);
    }
    await browser(
      session,
      'eval',
      `window.__npmTerminalCapture.arm({command:${JSON.stringify(fixtureData.command)},cwd:'${workspace}',caseName:${JSON.stringify(caseName)},cachePolicy:'http-cold'})`
    );
    await browser(session, 'press', 'Enter');
    const completed = await browser(
      session,
      'wait',
      '--fn',
      'window.__npmTerminalCapture.current()?.promptStableAt !== null'
    );
    if (completed !== 'true') throw new Error(`Trial ${trial} did not return to a stable prompt.`);
    const capture = parseEval(
      await browser(session, 'eval', 'JSON.stringify(window.__npmTerminalCapture.current())')
    );
    let network = null;
    if (networkCapture) network = networkCapture.endTrial();
    let profile = null;
    if (profileText === 'on') {
      profile = parseEval(
        await browser(
          session,
          'eval',
          `(async()=>{const {fsClient}=await import('/src/engine/core/fs/client.ts');const workerProfile=await import('/scripts/bench/npm-install/profile.mjs');const terminalProfile=await import('/scripts/bench/npm-install/terminal-profile.mjs');return JSON.stringify({terminal:terminalProfile.finishTerminalProfile(${JSON.stringify(caseName)}),worker:await workerProfile.finishProfile(fsClient,${JSON.stringify(caseName)})})})()`
        )
      );
    }
    if (
      !capture.trustedEnter ||
      !capture.commandEchoedBeforeEnter ||
      !capture.outputTail.includes(`added ${fixtureData.expectedAddedPackages} packages`) ||
      !capture.outputTail.includes(`checked ${fixtureData.pyxisExpectedCheckedPackages} packages`)
    ) {
      throw new Error(`Trial ${trial} failed its Terminal output checks.`);
    }
    trials.push({ trial, fixture: fixtureState, capture, network, profile });
    const resultPath = resolve(
      `${outputPath.replace(/\.json$/, '')}-trial${String(trial).padStart(2, '0')}.json`
    );
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      `${JSON.stringify({ fixture: fixtureState, capture, network, profile }, null, 2)}\n`
    );
    let networkSummary = '';
    if (network) networkSummary = `, ${network.requests.length} registry requests`;
    process.stdout.write(
      `trial ${trial}/${count}: ${capture.enterToPromptMs.toFixed(1)} ms visible, ${capture.enterToStablePromptMs.toFixed(1)} ms stable${networkSummary}\n`
    );
  }

  const visible = trials.map(trial => trial.capture.enterToPromptMs);
  const stable = trials.map(trial => trial.capture.enterToStablePromptMs);
  let networkDescription = 'disabled to avoid observer overhead in lightweight Terminal cohorts.';
  if (networkCapture) {
    networkDescription =
      'CDP Network events from the page and filesystem Worker; public registry requests only.';
  }
  let profileDescription = 'disabled for lightweight Terminal cohorts.';
  if (profileText === 'on') {
    profileDescription =
      'Terminal and filesystem Worker instrumentation enabled; requires the benchmark Worker.';
  }
  const result = {
    benchmark: 'pyxis-terminal-npm-install',
    sourceLabel: fixtureData.name,
    command: fixtureData.command,
    cachePolicy:
      'OPFS npm cache and node_modules cleared before each trial; browser HTTP cache cleared through CDP.',
    networkCapture: networkDescription,
    profileCapture: profileDescription,
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
