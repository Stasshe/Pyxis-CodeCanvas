import { subscribeKey } from 'valtio/utils';
import { fsClient } from '@/engine/core/fs/client';
import {
  basename,
  getParentPath,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/paths';
import { registerAction } from '@/engine/ide/keybindings/manager';
import { getCurrentRootPath, projectState } from '@/stores/projectStore';
import type { SystemModuleMap, SystemModuleName } from './systemModuleTypes';

type SystemModuleGetters = {
  [K in SystemModuleName]: () => Promise<SystemModuleMap[K]>;
};

const systemModuleGetters = {
  fsClient: async () => fsClient,
  workerRuntime: async () => import('@/engine/system/runtime/transpiler/WorkerPool'),
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
    (await import('@/engine/system/terminal/terminalRegistry')).terminalCommandRegistry,
} satisfies SystemModuleGetters;

export function getSystemModule<T extends SystemModuleName>(
  moduleName: T
): Promise<SystemModuleMap[T]>;
export function getSystemModule(
  moduleName: SystemModuleName
): Promise<SystemModuleMap[SystemModuleName]> {
  return systemModuleGetters[moduleName]();
}
