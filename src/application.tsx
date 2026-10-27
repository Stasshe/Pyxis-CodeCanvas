import './lib/ReactScan';
import './lib/monaco/monacoLoader';
import { createRoot } from 'react-dom/client';

import App from './App';
import AppInitializer from './components/layout/AppInitializer';
import { TabSessionManager } from './components/tabs/TabSessionManager';
import { FileSelectorProvider } from './context/FileSelectorContext';
import { GitHubUserProvider } from './context/GitHubUserContext';
import { I18nProvider } from './context/I18nContext';
import { ThemeProvider } from './context/ThemeContext';
import { fsClient } from './engine/core/fs/index';
import { migrateLegacyStorage } from './engine/core/migration/index';
import { runStartupStage } from './engine/core/startup';
import { prepareProjectStore } from './engine/core/workspace/project';
import { initializeAppCommands } from './engine/ide/commands/initialize';
import { ensureRuntimeBridge } from './engine/system/runtime/bridge/main';
import { showStartup, showStartupError } from './startup';

export function closeFilesystem(): void {
  fsClient.close();
}

export async function startApplication(root: HTMLElement): Promise<void> {
  initializeAppCommands();
  await runStartupStage('Opening filesystem', () => fsClient.init(), showStartup);
  await runStartupStage(
    'Migrating legacy storage',
    context => migrateLegacyStorage(fsClient, context),
    showStartup
  );
  await runStartupStage(
    'Preparing demo workspace',
    context => fsClient.ensureDemoWorkspace(context.report),
    showStartup
  );
  await runStartupStage('Opening recent folder', () => prepareProjectStore(), showStartup);
  await runStartupStage(
    'Connecting runtime',
    context => ensureRuntimeBridge(() => fsClient.createRuntimePort(), context.report),
    showStartup
  );
  createRoot(root, {
    onUncaughtError(error) {
      fsClient.close();
      showStartupError(error);
    },
  }).render(
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
