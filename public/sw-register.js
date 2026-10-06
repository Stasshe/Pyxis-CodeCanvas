// Registration and mandatory startup checks run before React in main.tsx.
// This entry stays present for static deployments that reference it.
(function () {
  if (!('serviceWorker' in navigator)) return;
  document.documentElement.dataset.pyxisSwControlled = String(
    Boolean(navigator.serviceWorker.controller)
  );
  const meta = document.querySelector('meta[name="pyxis-base-path"]');
  let basePath = meta?.getAttribute('content') || '';
  if (basePath === '/') basePath = '';
  basePath = basePath.replace(/\/$/, '');
  navigator.serviceWorker.register(`${basePath}/sw.js`).catch(console.error);
})();
