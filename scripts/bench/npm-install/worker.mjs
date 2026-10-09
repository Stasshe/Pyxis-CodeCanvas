import '/src/engine/core/fs/buffer.ts';
import '/src/engine/core/fs/endpoint.ts';
import { installProfileHooks, installSerialExtractionHook } from './profile.mjs';

const fetch = globalThis.fetch;
const options = new URL(globalThis.location.href).searchParams;
if (options.get('cachePolicy') !== 'default') {
  globalThis.fetch = (input, settings) => fetch(input, { ...settings, cache: 'no-store' });
}
if (options.get('serialExtraction') === '1') await installSerialExtractionHook();
if (options.get('profile') === '1') {
  await installProfileHooks();
}
