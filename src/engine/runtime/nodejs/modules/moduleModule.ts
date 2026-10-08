import { NODE_BUILTIN_MODULES } from '@/engine/runtime/module/builtinModules';

export const builtinModules = NODE_BUILTIN_MODULES;

export function createModuleModule(requireFactory?: (filename: string) => (id: string) => unknown) {
  return {
    builtinModules,
    createRequire: (filename: string | URL) => {
      const filenameStr = typeof filename === 'string' ? filename : filename.pathname;
      if (requireFactory) {
        return requireFactory(filenameStr);
      }
      return (_id: string) => {
        throw new Error(
          'require() created via module.createRequire is not fully supported in this environment yet.'
        );
      };
    },
  };
}
