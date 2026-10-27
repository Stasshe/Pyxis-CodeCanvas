import './styles/globals.css';
import { runStartupStage } from './engine/core/startup';
import { assetPath, pyxisEnv } from './env';
import { showStartup, showStartupError } from './startup';

function loadScript(src: string, onLoad?: () => void): void {
  const script = document.createElement('script');
  script.src = src;
  if (onLoad) script.addEventListener('load', onLoad, { once: true });
  document.head.appendChild(script);
}

if (!pyxisEnv.isProductionBuild || pyxisEnv.isDevServer) {
  loadScript('https://cdn.jsdelivr.net/npm/eruda', () => loadScript(assetPath('/eruda-init.js')));
}

async function start(): Promise<void> {
  let application: typeof import('./application') | undefined;
  try {
    const root = document.getElementById('root');
    if (!root) throw new Error('Root element was not found.');
    application = await runStartupStage(
      'Loading application modules',
      async () => {
        await import('./polyfills');
        return import('./application');
      },
      showStartup
    );
    await application.startApplication(root);
  } catch (error) {
    console.error('Pyxis startup failed:', error);
    application?.closeFilesystem();
    showStartupError(error);
  }
}

void start();
