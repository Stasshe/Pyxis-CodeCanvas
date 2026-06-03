(function(){
  function isLocalDevHost() {
    var hostname = window.location.hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }

  function unregisterLocalServiceWorkers() {
    if (!navigator.serviceWorker.getRegistrations) return;

    navigator.serviceWorker
      .getRegistrations()
      .then(function(registrations) {
        if (registrations.length === 0) return;

        Promise.all(registrations.map(function(registration) {
          return registration.unregister();
        })).then(function() {
          if (!navigator.serviceWorker.controller) return;
          if (window.sessionStorage.getItem('pyxis-sw-cleared') === 'true') return;

          window.sessionStorage.setItem('pyxis-sw-cleared', 'true');
          window.location.reload();
        });
      })
      .catch(function(err) {
        console.error('ServiceWorker cleanup failed: ', err);
      });
  }

  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    if (isLocalDevHost()) {
      unregisterLocalServiceWorkers();
      return;
    }

    window.addEventListener('load', function() {
      var meta = document.querySelector('meta[name="pyxis-base-path"]');
      var rawBasePath = meta ? meta.getAttribute('content') || '' : '';
      var basePath = rawBasePath === '/' ? '' : rawBasePath.replace(/\/$/, '');
      var swPath = basePath + '/sw.js';
      navigator.serviceWorker.register(swPath).catch(function(err){ console.error('ServiceWorker registration failed: ', err); });
    });
  }
})();
