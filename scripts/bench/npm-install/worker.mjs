import '/src/engine/core/fs/buffer.ts';
import '/src/engine/core/fs/endpoint.ts';
import { installProfileHooks } from './profile.mjs';

const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => fetch(input, { ...options, cache: 'no-store' });

if (new URL(globalThis.location.href).searchParams.get('profile') === '1') {
  await installProfileHooks();
}
