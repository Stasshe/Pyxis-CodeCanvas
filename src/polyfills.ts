import { Buffer } from 'buffer';
import process from 'process';

const globalScope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: typeof process;
};

globalScope.global = globalScope;
globalScope.Buffer = globalScope.Buffer || Buffer;
globalScope.process = globalScope.process || process;
globalScope.process.env = {
  ...globalScope.process.env,
  NODE_ENV: import.meta.env.MODE,
};
