function normalizeBasePath(value: string | undefined): string {
  if (!value || value === '/') return '';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/$/, '');
}

export function getBasePath(): string {
  const runtimeBasePath = (globalThis as { __PYXIS_BASE_PATH__?: string }).__PYXIS_BASE_PATH__;
  return normalizeBasePath(runtimeBasePath || import.meta.env.BASE_URL);
}

export const pyxisEnv = {
  get basePath() {
    return getBasePath();
  },
  isDevServer: import.meta.env.VITE_IS_DEV_SERVER === 'true',
  enableReactScan: import.meta.env.VITE_ENABLE_REACT_SCAN === 'true',
  isProductionBuild: import.meta.env.PROD,
  version: __PYXIS_VERSION__,
};

export function assetPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBasePath()}${normalizedPath}`;
}
