import type { StartupProgress } from './engine/core/startup';

export function showStartup(stage: string, progress: StartupProgress): void {
  const status = document.getElementById('startup-status');
  const detail = document.getElementById('startup-detail');
  if (!status || !detail) return;
  status.textContent = stage;
  let text = progress.detail;
  if (text === stage) text = '';
  if (progress.completed !== undefined) {
    text += ` · ${progress.completed}`;
    if (progress.total !== undefined) text += ` / ${progress.total}`;
  }
  detail.textContent = text;
}

export function showStartupError(error: unknown): void {
  console.error('[Startup] Application failed:', error);
  let status = document.getElementById('startup-status');
  let detail = document.getElementById('startup-detail');
  if (!status || !detail) {
    const root = document.getElementById('root');
    if (!root) return;
    status = document.createElement('p');
    detail = document.createElement('p');
    detail.style.overflowWrap = 'anywhere';
    root.replaceChildren(status, detail);
  }
  status.setAttribute('role', 'alert');
  status.textContent = 'Pyxis could not start';
  detail.textContent = String(error);
}
