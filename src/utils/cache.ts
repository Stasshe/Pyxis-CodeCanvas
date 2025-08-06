// 簡単なメモリキャッシュユーティリティ（ローディング時間削減用）
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class SimpleCache {
  private cache = new Map<string, CacheEntry<any>>();

  set<T>(key: string, data: T, ttlMs = 5000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  // プレフィックスベースの削除
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// Git関連のキャッシュ
export const gitCache = new SimpleCache();

// プロジェクト関連のキャッシュ
export const projectCache = new SimpleCache();

// ファイル内容のキャッシュ
export const fileCache = new SimpleCache();

export { SimpleCache };