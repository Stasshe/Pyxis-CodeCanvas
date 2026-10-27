import type { CommandContext } from './commandRegistry';
import type { ExplorerMenuAPI } from './system-api/ExplorerMenuAPI';
import type { SidebarAPI } from './system-api/SidebarAPI';
import type { TabAPI } from './system-api/TabAPI';
import type { SystemModuleMap, SystemModuleName } from './systemModuleTypes';
import type { ExtensionContext, ExtensionManifest } from './types';

export interface ExtensionAPIs {
  tabs: TabAPI;
  sidebar: SidebarAPI;
  explorerMenu: ExplorerMenuAPI;
  disposeSubscriptions(): void;
}

interface ExtensionContextCallbacks {
  registerTranspiler: NonNullable<ExtensionContext['registerTranspiler']>;
  registerRuntime: NonNullable<ExtensionContext['registerRuntime']>;
}

export async function createExtensionContext(
  manifest: ExtensionManifest,
  callbacks: ExtensionContextCallbacks
): Promise<{ context: ExtensionContext; apis: ExtensionAPIs }> {
  const extensionId = manifest.id;
  const { TabAPI } = await import('./system-api/TabAPI');
  const { SidebarAPI } = await import('./system-api/SidebarAPI');
  const { ExplorerMenuAPI } = await import('./system-api/ExplorerMenuAPI');
  const { commandRegistry } = await import('./commandRegistry');
  const baseGetSystemModule = (await import('./systemModules')).getSystemModule;
  const subscriptions = new Set<() => void>();
  let subscriptionsDisposed = false;
  const trackUnsubscribe = (unsubscribe: () => void): (() => void) => {
    let subscribed = true;
    const tracked = () => {
      if (!subscribed) return;
      subscribed = false;
      subscriptions.delete(tracked);
      unsubscribe();
    };
    if (subscriptionsDisposed) tracked();
    else subscriptions.add(tracked);
    return tracked;
  };
  const disposeSubscriptions = () => {
    subscriptionsDisposed = true;
    for (const unsubscribe of [...subscriptions]) {
      try {
        unsubscribe();
      } catch (error) {
        console.error(
          `[Extension:${extensionId}] Failed to unsubscribe system module listener:`,
          error
        );
      }
    }
  };
  const getExtensionSystemModule = async <T extends SystemModuleName>(
    moduleName: T
  ): Promise<SystemModuleMap[T]> => {
    const module = await baseGetSystemModule(moduleName);
    if (moduleName === 'fsClient') {
      const scoped = new Proxy(module as SystemModuleMap['fsClient'], {
        get: (target, property) => {
          if (property === 'addChangeListener') {
            return (listener: Parameters<SystemModuleMap['fsClient']['addChangeListener']>[0]) =>
              trackUnsubscribe(target.addChangeListener(listener));
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return scoped as SystemModuleMap[T];
    }
    if (moduleName === 'workspace') {
      const workspace = module as SystemModuleMap['workspace'];
      const scoped = {
        ...workspace,
        subscribe: (listener: Parameters<SystemModuleMap['workspace']['subscribe']>[0]) =>
          trackUnsubscribe(workspace.subscribe(listener)),
      };
      return scoped as SystemModuleMap[T];
    }
    if (moduleName === 'keybindings') {
      const keybindings = module as SystemModuleMap['keybindings'];
      const scoped = {
        ...keybindings,
        registerAction: (
          actionId: Parameters<SystemModuleMap['keybindings']['registerAction']>[0],
          callback: Parameters<SystemModuleMap['keybindings']['registerAction']>[1]
        ) => trackUnsubscribe(keybindings.registerAction(actionId, callback)),
      };
      return scoped as SystemModuleMap[T];
    }
    return module;
  };

  const notInitialized =
    (fnName: string) =>
    (..._args: unknown[]) => {
      throw new Error(
        `[Extension:${extensionId}] ${fnName} called before extension context was fully initialized`
      );
    };

  const context: ExtensionContext = {
    extensionId,
    extensionPath: `/extensions/${extensionId.replace(/\./g, '/')}`,
    version: manifest.version,
    logger: {
      info: (...args: unknown[]) => console.log(`[${extensionId}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[${extensionId}]`, ...args),
      error: (...args: unknown[]) => console.error(`[${extensionId}]`, ...args),
    },
    getSystemModule: getExtensionSystemModule,
    registerTranspiler: callbacks.registerTranspiler,
    registerRuntime: callbacks.registerRuntime,
    tabs: {
      registerTabType: notInitialized('tabs.registerTabType'),
      createTab: notInitialized('tabs.createTab'),
      updateTab: notInitialized('tabs.updateTab'),
      closeTab: notInitialized('tabs.closeTab'),
      onTabClose: notInitialized('tabs.onTabClose'),
      getTabData: notInitialized('tabs.getTabData'),
      openSystemTab: notInitialized('tabs.openSystemTab'),
    },
    sidebar: {
      createPanel: notInitialized('sidebar.createPanel'),
      updatePanel: notInitialized('sidebar.updatePanel'),
      removePanel: notInitialized('sidebar.removePanel'),
      onPanelActivate: notInitialized('sidebar.onPanelActivate'),
    },
    commands: {
      registerCommand: (commandName, handler) => {
        const wrappedHandler = async (args: string[], cmdContext: CommandContext) =>
          handler(args, { ...context, ...cmdContext });
        return commandRegistry.registerCommand(extensionId, commandName, wrappedHandler);
      },
    },
    explorerMenu: {
      addMenuItem: notInitialized('explorerMenu.addMenuItem'),
      removeMenuItem: notInitialized('explorerMenu.removeMenuItem'),
    },
  };

  const tabs = new TabAPI(context);
  const sidebar = new SidebarAPI(context);
  const explorerMenu = new ExplorerMenuAPI(context);

  context.tabs = {
    registerTabType: component => tabs.registerTabType(component),
    createTab: options => tabs.createTab(options),
    updateTab: (tabId, options) => tabs.updateTab(tabId, options),
    closeTab: tabId => tabs.closeTab(tabId),
    onTabClose: (tabId, callback) => tabs.onTabClose(tabId, callback),
    getTabData: tabId => tabs.getTabData(tabId),
    openSystemTab: (file, options) => tabs.openSystemTab(file, options),
  };

  context.sidebar = {
    createPanel: definition => sidebar.createPanel(definition),
    updatePanel: (panelId, state) => sidebar.updatePanel(panelId, state),
    removePanel: panelId => sidebar.removePanel(panelId),
    onPanelActivate: (panelId, callback) => sidebar.onPanelActivate(panelId, callback),
  };

  context.explorerMenu = {
    addMenuItem: definition => explorerMenu.addMenuItem(definition),
    removeMenuItem: itemId => explorerMenu.removeMenuItem(itemId),
  };

  return { context, apis: { tabs, sidebar, explorerMenu, disposeSubscriptions } };
}
