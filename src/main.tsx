import './polyfills';
import './styles/globals.css';
import './lib/ReactScan';

import { createRoot } from 'react-dom/client';

import App from './App';
import AppInitializer from './components/AppInitializer';
import { TabSessionManager } from './components/Tab/TabSessionManager';
import { FileSelectorProvider } from './context/FileSelectorContext';
import { GitHubUserProvider } from './context/GitHubUserContext';
import { I18nProvider } from './context/I18nContext';
import { ThemeProvider } from './context/ThemeContext';
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

createRoot(root).render(
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
