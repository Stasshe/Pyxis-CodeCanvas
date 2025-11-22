declare module 'https://unpkg.com/esbuild-wasm@0.19.8/lib/browser.min.js' {
  const esbuild: any;
  export default esbuild;
}

// Global fallback if script attaches esbuild to window
interface Window {
  esbuild?: any;
  esbuildWasm?: any;
}
