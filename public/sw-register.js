(function(){
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      var meta = document.querySelector('meta[name="pyxis-base-path"]');
      var basePath = meta ? meta.getAttribute('content') || '' : '';
      var swPath = basePath + '/sw.js';
      navigator.serviceWorker.register(swPath).catch(function(err){ console.error('ServiceWorker registration failed: ', err); });
    });
  }
})();
