import { subscribeKey } from 'valtio/utils';
import { fsClient } from '@/engine/core/fs/client';
import {
  basename,
  getParentPath,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/pathUtils';
import { registerAction } from '@/hooks/keybindings/useKeyBindings';
import { getCurrentRootPath, projectState } from '@/stores/projectStore';
import type { SystemModuleMap, SystemModuleName } from './systemModuleTypes';

type SystemModuleGetters = {
  [K in SystemModuleName]: () => Promise<SystemModuleMap[K]>;
};

const systemModuleGetters = {
  fsClient: async () => fsClient,
  workerRuntime: async () => import('@/engine/workers/WorkerPool'),
  pathUtils: async () => ({
    posixPath,
    normalizePath,
    resolvePath,
    getParentPath,
    basename,
    isPathWithin,
  }),
  workspace: async () => ({
    getRootPath: getCurrentRootPath,
    subscribe: (listener: (rootPath: string | null) => void) =>
      subscribeKey(projectState, 'currentRootPath', listener),
  }),
  keybindings: async () => ({ registerAction }),
  commandRegistry: async () => (await import('./commandRegistry')).commandRegistry,
  systemBuiltinCommands: async () =>
    (await import('@/engine/cmd/terminalRegistry')).terminalCommandRegistry,
} satisfies SystemModuleGetters;

export function getSystemModule<T extends SystemModuleName>(
  moduleName: T
): Promise<SystemModuleMap[T]>;
export function getSystemModule(
  moduleName: SystemModuleName
): Promise<SystemModuleMap[SystemModuleName]> {
  return systemModuleGetters[moduleName]();
}
