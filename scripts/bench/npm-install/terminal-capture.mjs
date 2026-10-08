function getTerminalRows() {
  const container = document.querySelector('.terminal-container');
  const rows = container?.querySelector('.xterm-rows');
  return {
    text: rows ? Array.from(rows.children, row => row.textContent ?? '').join('\n') : '',
    lines: rows ? Array.from(rows.children, row => row.textContent ?? '') : [],
    rowCount: rows?.children.length ?? 0,
  };
}

function getScreenSize() {
  const screen = document.querySelector('.terminal-container .xterm-screen');
  return { screenWidth: screen?.clientWidth ?? 0, screenHeight: screen?.clientHeight ?? 0 };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNewPrompt(text, prompt) {
  const markers = /added \d+ packages|up to date|npm install failed|npm ERR!/g;
  const completions = Array.from(text.matchAll(markers));
  const completion = completions.at(-1);
  if (!completion) return false;
  const afterCompletion = text.slice((completion.index ?? 0) + completion[0].length);
  const promptAtEnd = new RegExp(`${escapeRegExp(prompt)}\\s*$`);
  return promptAtEnd.test(afterCompletion);
}

function markRendered(run, snapshot) {
  if (run.stableCheckPending) return;
  run.stableCheckPending = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const current = getTerminalRows();
      run.stableCheckPending = false;
      if (current.text !== snapshot.text || !hasNewPrompt(current.text, run.prompt)) {
        inspect(run);
        return;
      }
      run.promptStableAt = performance.now();
      run.promptStableEpochMs = performance.timeOrigin + run.promptStableAt;
      run.promptStableRows = current.lines;
      run.viewportRows = current.rowCount;
    });
  });
}

function inspect(run) {
  if (!run.enterAt || run.promptStableAt) return;
  const snapshot = getTerminalRows();
  if (snapshot.text === run.preEnterText) return;
  if (!hasNewPrompt(snapshot.text, run.prompt)) return;
  if (!run.promptVisibleAt) {
    run.promptVisibleAt = performance.now();
    run.promptVisibleEpochMs = performance.timeOrigin + run.promptVisibleAt;
    run.promptVisibleRows = snapshot.lines;
    run.outputTail = snapshot.text.slice(-1200);
    run.promptOccurrenceCount = snapshot.lines.filter(line => line.includes(run.prompt)).length;
    Object.assign(run, getScreenSize());
  }
  markRendered(run, snapshot);
}

function captureEnter(event) {
  const run = window.__npmTerminalCapture?.active;
  if (!run || run.enterAt || event.key !== 'Enter') return;
  if (!event.target.matches('.xterm-helper-textarea')) return;
  const before = getTerminalRows();
  run.enterAt = performance.now();
  run.enterEpochMs = performance.timeOrigin + run.enterAt;
  run.trustedEnter = event.isTrusted;
  run.commandEchoedBeforeEnter = before.text.includes(run.command);
  run.preEnterText = before.text;
  run.preEnterRows = before.lines;
  run.terminalRows = before.rowCount;
}

if (!window.__npmTerminalCapture) {
  window.__npmTerminalCapture = {
    runs: [],
    active: null,
    arm({ command, cwd, caseName, cachePolicy }) {
      const run = {
        command,
        cwd,
        caseName,
        cachePolicy,
        prompt: `${cwd} $`,
        armedAt: performance.now(),
        armedEpochMs: performance.timeOrigin + performance.now(),
        enterAt: null,
        promptVisibleAt: null,
        promptStableAt: null,
      };
      this.active = run;
      this.runs.push(run);
      return run.armedEpochMs;
    },
    current() {
      const run = this.active;
      if (!run) return null;
      return {
        ...run,
        enterToPromptMs: run.promptVisibleAt ? run.promptVisibleAt - run.enterAt : null,
        enterToStablePromptMs: run.promptStableAt ? run.promptStableAt - run.enterAt : null,
      };
    },
    disarm() {
      this.active = null;
    },
    screen() {
      return getTerminalRows();
    },
  };
  document.addEventListener('keydown', captureEnter, true);
  const observer = new MutationObserver(() => {
    const run = window.__npmTerminalCapture?.active;
    if (run?.enterAt) inspect(run);
  });
  const container = document.querySelector('.terminal-container');
  if (container) observer.observe(container, { childList: true, subtree: true, characterData: true });
  window.__npmTerminalCapture.observer = observer;
}
