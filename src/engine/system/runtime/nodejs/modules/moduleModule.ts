import { NODE_BUILTIN_MODULES } from '@/engine/system/runtime/module/builtinModules';
import { fileURLToPath } from './urlModule';

export const builtinModules = NODE_BUILTIN_MODULES;

function invalidFilename(filename: string | URL): TypeError & { code: string } {
  let received = `'${filename}'`;
  if (filename instanceof URL) received = `URL { href: '${filename.href}', ... }`;
  return Object.assign(
    new TypeError(
      `The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received ${received}`
    ),
    { code: 'ERR_INVALID_ARG_VALUE' }
  );
}

function resolveFilename(filename: string | URL): string {
  if (filename instanceof URL) {
    try {
      return fileURLToPath(filename);
    } catch {
      throw invalidFilename(filename);
    }
  }
  if (filename.startsWith('/')) return filename;
  if (!filename.toLowerCase().startsWith('file:')) throw invalidFilename(filename);
  try {
    return fileURLToPath(filename);
  } catch {
    throw invalidFilename(filename);
  }
}

export function createModuleModule(requireFactory: (filename: string) => (id: string) => unknown) {
  return {
    builtinModules,
    createRequire: (filename: string | URL) => {
      let filenameStr = resolveFilename(filename);
      if (filenameStr.endsWith('/')) filenameStr += 'noop.js';
      return requireFactory(filenameStr);
    },
  };
}
