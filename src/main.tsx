import './polyfills';
import './styles/globals.css';
import './lib/ReactScan';
import './engine/tabs/monacoLoader';

import { createRoot } from 'react-dom/client';

import App from './App';
import AppInitializer from './components/AppInitializer';
import { TabSessionManager } from './components/Tab/TabSessionManager';
import { FileSelectorProvider } from './context/FileSelectorContext';
import { GitHubUserProvider } from './context/GitHubUserContext';
import { I18nProvider } from './context/I18nContext';
import { ThemeProvider } from './context/ThemeContext';
import { fsClient } from './engine/core/fs';
import { migrateLegacyStorage } from './engine/core/migration';
import { prepareProjectStore } from './engine/core/project';
import { ensureRuntimeBridge } from './engine/runtime/bridge/main';
import { assetPath, pyxisEnv } from './env';

function loadScript(src: string, onLoad?: () => void): void {
  const script = document.createElement('script');
  script.src = src;
  if (onLoad) {
    script.addEventListener('load', onLoad, { once: true });
  }
  document.head.appendChild(script);
}

if (!pyxisEnv.isProductionBuild || pyxisEnv.isDevServer) {
  loadScript('https://cdn.jsdelivr.net/npm/eruda', () => {
    loadScript(assetPath('/eruda-init.js'));
  });
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element was not found.');
}

async function start(): Promise<void> {
  try {
    await fsClient.init();
    await migrateLegacyStorage(fsClient);
    await fsClient.ensureDemoWorkspace();
    await prepareProjectStore();
    await ensureRuntimeBridge(() => fsClient.createRuntimePort());
  } catch (error) {
    console.error('Pyxis startup failed:', error);
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = String(error);
    root!.replaceChildren(message);
    return;
  }
  createRoot(root!).render(
    <I18nProvider>
      <ThemeProvider>
        <GitHubUserProvider>
          <TabSessionManager>
            <FileSelectorProvider>
              <App />
              <AppInitializer />
            </FileSelectorProvider>
          </TabSessionManager>
        </GitHubUserProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

void start();
