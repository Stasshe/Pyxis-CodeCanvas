import '/src/engine/core/fs/buffer.ts';
import '/src/engine/core/fs/endpoint.ts';
import { installProfileHooks, installSerialExtractionHook } from './profile.mjs';

const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => fetch(input, { ...options, cache: 'no-store' });

const options = new URL(globalThis.location.href).searchParams;
if (options.get('serialExtraction') === '1') await installSerialExtractionHook();
if (options.get('profile') === '1') {
  await installProfileHooks();
}
