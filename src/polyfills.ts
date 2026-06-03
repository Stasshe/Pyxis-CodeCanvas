import { Buffer } from 'buffer';

const globalScope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: {
    env: Record<string, string | undefined>;
    versions?: Record<string, string>;
    browser?: boolean;
  };
};

globalScope.global = globalScope;
globalScope.Buffer = globalScope.Buffer || Buffer;
globalScope.process = globalScope.process || { env: {}, browser: true };
globalScope.process.env = {
  ...globalScope.process.env,
  NODE_ENV: import.meta.env.MODE,
};
