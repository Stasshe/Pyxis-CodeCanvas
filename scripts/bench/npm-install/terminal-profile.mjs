let active = null;
let installed = false;

function wrap(target, key, phase, includeText = false) {
  const original = target[key];
  target[key] = async function (...args) {
    const sample = active;
    let interval = null;
    if (sample) {
      interval = {
        phase,
        startMs: performance.now() - sample.started,
        endMs: null,
        failed: false,
      };
      if (includeText) interval.text = String(args[0] ?? '').slice(0, 240);
      sample.intervals.push(interval);
    }
    try {
      return await original.apply(this, args);
    } catch (error) {
      if (interval) interval.failed = true;
      throw error;
    } finally {
      if (interval) interval.endMs = performance.now() - sample.started;
    }
  };
}

export async function initTerminalProfileHooks() {
  if (installed) return;
  const [
    { StreamShell },
    { NpmCommands },
    { TerminalOutputManager },
    { SpinnerController },
    { FsClient, fsClient },
    { GitCommands },
    { terminalCommandRegistry },
  ] = await Promise.all([
    import('/src/engine/system/shell/streamShell.ts'),
    import('/src/engine/system/commands/npm/index.ts'),
    import('/src/engine/system/terminal/terminalOutputManager.ts'),
    import('/src/engine/system/terminal/terminalUI.ts'),
    import('/src/engine/core/fs/client.ts'),
    import('/src/engine/system/commands/git/index.ts'),
    import('/src/engine/system/terminal/terminalRegistry.ts'),
  ]);
  wrap(StreamShell.prototype, 'run', 'main.shell');
  wrap(NpmCommands.prototype, 'install', 'main.npm');
  wrap(terminalCommandRegistry, 'getNpmCommands', 'main.npmInit');
  wrap(GitCommands.prototype, 'getCurrentBranch', 'main.promptGit');
  for (const key of ['start', 'update', 'stop']) {
    wrap(SpinnerController.prototype, key, `main.spinner.${key}`, true);
  }
  for (const key of ['write', 'writeRaw', 'flush', 'ensureNewline']) {
    wrap(TerminalOutputManager.prototype, key, `main.output.${key}`, true);
  }
  for (const key of ['getNpm', 'readText', 'writeFile', 'exists', 'walk']) {
    wrap(FsClient.prototype, key, `main.fs.${key}`, true);
  }
  fsClient.addChangeListener(event => {
    if (!active) return;
    active.changes.push({
      type: event.type,
      path: event.path,
      atMs: performance.now() - active.started,
    });
  });
  installed = true;
}

export function startTerminalProfile(id) {
  if (active) throw new Error('A terminal profile is already active.');
  active = { id, started: performance.now(), intervals: [], changes: [] };
}

export function finishTerminalProfile(id) {
  if (!active || active.id !== id) throw new Error('Terminal profile ID does not match.');
  const sample = active;
  active = null;
  return {
    id,
    startedAt: performance.timeOrigin + sample.started,
    wallMs: performance.now() - sample.started,
    intervals: sample.intervals.map(interval => ({ ...interval })),
    pending: sample.intervals.filter(interval => interval.endMs === null).map(entry => entry.phase),
    changes: sample.changes,
  };
}
