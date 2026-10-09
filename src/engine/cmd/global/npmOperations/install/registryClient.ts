import { resolvePath } from '@/engine/core/fs';
import { FSError } from '@/engine/core/fs/errors';
import { NPM_CACHE_PATH } from '@/engine/core/fs/layout';
import type { FsApi } from '@/engine/core/fs/types';
import { type NpmNetwork, npmNetwork } from './npmNetwork';

const REGISTRY_URL = 'https://registry.npmjs.org';
const REGISTRY_CACHE_PATH = resolvePath(NPM_CACHE_PATH, 'registry');
const REGISTRY_ACCEPT = 'application/vnd.npm.install-v1+json';

export interface RegistryVersion {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  dist?: { tarball?: string; integrity?: string };
  bin?: string | Record<string, string>;
  os?: string[];
  cpu?: string[];
}

export interface RegistryPackument {
  name?: string;
  'dist-tags'?: Record<string, string>;
  versions: Record<string, RegistryVersion>;
}

interface CachedPackument {
  expiresAt: number;
  etag?: string;
  cacheControl?: string;
  packument: RegistryPackument;
}

interface Freshness {
  expiresAt: number;
  noStore: boolean;
}

export class RegistryClient {
  private readonly packuments = new Map<string, Promise<RegistryPackument>>();
  private registryCacheDirectory: Promise<void> | undefined;

  constructor(
    private readonly fs: FsApi,
    private readonly network: NpmNetwork = npmNetwork
  ) {}

  getPackument(packageName: string): Promise<RegistryPackument> {
    const cached = this.packuments.get(packageName);
    if (cached) return cached;
    const request = this.loadPackument(packageName);
    this.packuments.set(packageName, request);
    request.then(undefined, () => {
      if (this.packuments.get(packageName) === request) this.packuments.delete(packageName);
    });
    return request;
  }

  clearMemoryCache(): void {
    this.packuments.clear();
  }

  private async loadPackument(packageName: string): Promise<RegistryPackument> {
    const url = `${REGISTRY_URL}/${packageName}`;
    const cachePath = await this.cachePath(url);
    const cached = await this.readCache(cachePath);
    if (cached && cached.expiresAt > Date.now()) return cached.packument;

    const headers = new Headers({ Accept: REGISTRY_ACCEPT });
    if (cached?.etag) headers.set('If-None-Match', cached.etag);
    let result: { response: Response; packument?: RegistryPackument };
    try {
      result = await this.network.run(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, { headers, signal: controller.signal });
          if (response.status === 304 || !response.ok) return { response };
          const packument = compactPackument((await response.json()) as RegistryPackument);
          return { response, packument };
        } finally {
          clearTimeout(timeoutId);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout for package '${packageName}'`);
      }
      throw error;
    }
    const response = result.response;
    if (response.status === 304) {
      if (!cached)
        throw new Error(`Registry returned 304 without cached metadata for '${packageName}'`);
      const cacheControl = response.headers.get('Cache-Control') ?? cached.cacheControl;
      const freshness = getFreshness(response.headers, cacheControl);
      const entry: CachedPackument = {
        expiresAt: freshness.expiresAt,
        etag: response.headers.get('ETag') ?? cached.etag,
        cacheControl,
        packument: cached.packument,
      };
      await this.writeCache(cachePath, entry, freshness.noStore);
      return entry.packument;
    }
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Package '${packageName}' not found`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const packument = result.packument;
    if (!packument) throw new Error(`Invalid package data for '${packageName}'`);
    const freshness = getFreshness(response.headers);
    const entry: CachedPackument = {
      expiresAt: freshness.expiresAt,
      etag: response.headers.get('ETag') ?? undefined,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      packument,
    };
    await this.writeCache(cachePath, entry, freshness.noStore);
    return packument;
  }

  private async readCache(path: string): Promise<CachedPackument | undefined> {
    let content: string;
    try {
      content = await this.fs.readText(path);
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(content) as unknown;
    } catch (error) {
      console.warn(`[npm] Removing invalid registry cache at ${path}:`, error);
      await this.fs.rm(path, { force: true });
      return undefined;
    }
    if (!isCachedPackument(entry)) {
      console.warn(`[npm] Removing invalid registry cache at ${path}`);
      await this.fs.rm(path, { force: true });
      return undefined;
    }
    return entry;
  }

  private async writeCache(path: string, entry: CachedPackument, noStore: boolean): Promise<void> {
    if (noStore) {
      await this.fs.rm(path, { force: true });
      return;
    }
    await this.ensureRegistryCacheDirectory();
    await this.fs.writeFile(path, JSON.stringify(entry));
  }

  private ensureRegistryCacheDirectory(): Promise<void> {
    if (this.registryCacheDirectory) return this.registryCacheDirectory;
    let request: Promise<void>;
    request = this.fs.mkdir(REGISTRY_CACHE_PATH, { recursive: true }).catch(error => {
      if (this.registryCacheDirectory === request) this.registryCacheDirectory = undefined;
      throw error;
    });
    this.registryCacheDirectory = request;
    return request;
  }

  private async cachePath(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
      ''
    );
    return resolvePath(REGISTRY_CACHE_PATH, `${key}.json`);
  }
}

function isCachedPackument(value: unknown): value is CachedPackument {
  if (!isRecord(value) || typeof value.expiresAt !== 'number') return false;
  if (!isRecord(value.packument)) return false;
  return isRecord(value.packument.versions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactPackument(packument: RegistryPackument): RegistryPackument {
  const versions: Record<string, RegistryVersion> = {};
  for (const [version, metadata] of Object.entries(packument.versions)) {
    const compactMetadata: RegistryVersion = {};
    if (metadata.dependencies) compactMetadata.dependencies = metadata.dependencies;
    if (metadata.optionalDependencies)
      compactMetadata.optionalDependencies = metadata.optionalDependencies;
    if (metadata.peerDependencies) compactMetadata.peerDependencies = metadata.peerDependencies;
    if (metadata.peerDependenciesMeta)
      compactMetadata.peerDependenciesMeta = metadata.peerDependenciesMeta;
    if (metadata.bin) compactMetadata.bin = metadata.bin;
    if (metadata.os) compactMetadata.os = metadata.os;
    if (metadata.cpu) compactMetadata.cpu = metadata.cpu;
    if (metadata.dist) {
      compactMetadata.dist = {};
      if (metadata.dist.tarball) compactMetadata.dist.tarball = metadata.dist.tarball;
      if (metadata.dist.integrity) compactMetadata.dist.integrity = metadata.dist.integrity;
    }
    versions[version] = compactMetadata;
  }
  const compact: RegistryPackument = { versions };
  if (packument.name) compact.name = packument.name;
  if (packument['dist-tags']) compact['dist-tags'] = packument['dist-tags'];
  return compact;
}

function getFreshness(headers: Headers, cachedCacheControl?: string): Freshness {
  let directives = headers.get('Cache-Control');
  if (!directives) directives = cachedCacheControl ?? '';
  const noStore = /(?:^|,)\s*no-store\s*(?:,|$)/i.test(directives);
  const noCache = /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(directives);
  const maxAge = /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i.exec(directives);
  const age = Number.parseInt(headers.get('Age') ?? '0', 10);
  const responseDate = Date.parse(headers.get('Date') ?? '');
  let apparentAge = 0;
  if (Number.isFinite(responseDate)) {
    apparentAge = Math.max(0, Date.now() - responseDate) / 1000;
  }
  let lifetime = 0;
  if (maxAge) lifetime = Number.parseInt(maxAge[1], 10);
  let responseAge = age;
  if (!Number.isFinite(responseAge)) responseAge = 0;
  if (apparentAge > responseAge) responseAge = apparentAge;
  const remainingSeconds = Math.max(0, lifetime - responseAge);
  let expiresAt = Date.now() + remainingSeconds * 1000;
  if (noCache) expiresAt = 0;
  return { expiresAt, noStore };
}
