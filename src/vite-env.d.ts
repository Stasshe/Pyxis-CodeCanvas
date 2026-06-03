/// <reference types="vite/client" />

declare const __PYXIS_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_ENABLE_REACT_SCAN?: string;
  readonly VITE_IS_DEV_SERVER?: string;
}

interface Window {
  __PYXIS_BASE_PATH__?: string;
}
