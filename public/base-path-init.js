(function(){
  var meta = document.querySelector('meta[name="pyxis-base-path"]');
  var basePath = meta ? meta.getAttribute('content') || '' : '';
  window.__NEXT_PUBLIC_BASE_PATH__ = basePath;
})();
