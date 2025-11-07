// Service Worker for Pyxis
// Purpose: keep icons cached (they don't change) and use cache-first strategy for them.
const ICON_CACHE = 'pyxis-icons-v1';

// Derive basePath from the service worker script location.
// When deployed to a subpath (e.g. /repo-name/), sw.js will be served at
// /repo-name/sw.js and self.location.pathname will contain that prefix.
// We remove the trailing '/sw.js' to get the basePath ('' for root).
const _swPath = (self && self.location && self.location.pathname) || '/sw.js';
let BASE_PATH = '';
try {
  if (_swPath.endsWith('/sw.js')) {
    BASE_PATH = _swPath.slice(0, -'/sw.js'.length) || '';
  } else {
    BASE_PATH = '';
  }
} catch (e) {
  BASE_PATH = '';
}

// Normalize so BASE_PATH does not end with a slash (unless it's empty)
if (BASE_PATH && BASE_PATH.endsWith('/')) BASE_PATH = BASE_PATH.slice(0, -1);

const PRECACHE_URLS = [
  `${BASE_PATH}/favicon.ico`,
  `${BASE_PATH}/apple-touch-icon.png`,
  `${BASE_PATH}/file.svg`,
];

self.addEventListener('install', (event) => {
  // Pre-cache a few common icon assets
  event.waitUntil(
    caches
      .open(ICON_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Activate immediately and take control of clients
  event.waitUntil(self.clients.claim());
});

// Helper to determine if a request should be treated as an "icon" request
function isIconRequest(request) {
  try {
    const url = new URL(request.url);
    // Same-origin and path starts with /vscode-icons/ OR matches our precached icon paths
    if (url.origin === location.origin) {
      const p = url.pathname || '';
      // check both unprefixed and basePath-prefixed paths
      if (p.startsWith(`${BASE_PATH}/vscode-icons/`) || p.startsWith('/vscode-icons/')) return true;
      if (PRECACHE_URLS.includes(p)) return true;
    }
  } catch (e) {
    // ignore malformed URLs
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // For icon requests: cache-first strategy. They rarely change.
  if (isIconRequest(req)) {
    event.respondWith(
      caches.open(ICON_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const response = await fetch(req);
          // Only cache successful responses
          if (response && response.status === 200) {
            cache.put(req, response.clone()).catch(() => {});
          }
          return response;
        } catch (err) {
          // network failed, return cached if available
          return cached || new Response(null, { status: 503, statusText: 'Service Unavailable' });
        }
      })
    );
    return;
  }

  // For other requests, prefer network but fallback to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        return res;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
