(function(){
  var meta = document.querySelector('meta[name="pyxis-base-path"]');
  var rawBasePath = meta ? meta.getAttribute('content') || '' : '';
  var basePath = rawBasePath === '/' ? '' : rawBasePath.replace(/\/$/, '');
  window.__PYXIS_BASE_PATH__ = basePath;
})();
