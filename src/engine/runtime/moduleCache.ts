/**
 * [NEW ARCHITECTURE] Module Cache Manager
 */

import { fileRepository } from '@/engine/core/fileRepository';

export interface CacheEntry {
  originalPath: string;
  hash: string;
  code: string;
  sourceMap?: string;
  deps: string[];
  mtime: number;
  lastAccess: number;
  size: number;
}

export class ModuleCache {
  private projectId: string;
  private projectName: string;
  private cache: Map<string, CacheEntry> = new Map();
  private maxCacheSize: number = 100 * 1024 * 1024;
  private cacheDir = '/cache/modules';
  private metaDir = '/cache/meta';
  private initialized = false;

  constructor(projectId: string, projectName: string) {
    this.projectId = projectId;
    this.projectName = projectName;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🗄️ Initializing module cache...');
    await this.ensureCacheDirectories();
    await this.loadAllCacheFromDisk();
    this.initialized = true;
    
    console.log('✅ Module cache initialized:', {
      entries: this.cache.size,
      totalSize: this.formatSize(this.getTotalSize()),
    });
  }

  async get(path: string): Promise<CacheEntry | null> {
    const hash = this.hashPath(path);
    const entry = this.cache.get(hash);
    
    if (entry) {
      entry.lastAccess = Date.now();
      console.log('✅ Cache HIT:', path);
      return entry;
    }
    
    console.log('❌ Cache MISS:', path);
    return null;
  }

  async set(path: string, entry: Omit<CacheEntry, 'hash' | 'lastAccess'>): Promise<void> {
    const hash = this.hashPath(path);
    const cacheEntry: CacheEntry = { ...entry, hash, lastAccess: Date.now() };
    
    this.cache.set(hash, cacheEntry);
    console.log('💾 Saving cache:', path, `(${this.formatSize(entry.size)})`);
    
    try {
      await this.saveToDisk(hash, cacheEntry);
      console.log('✅ Cache saved:', path);
    } catch (error) {
      console.error('❌ Failed to save cache:', error);
      this.cache.delete(hash);
      throw error;
    }
    
    await this.checkCacheSize();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    console.log('✅ Cache cleared');
  }

  private async ensureCacheDirectories(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      
      if (!files.some(f => f.path === this.cacheDir)) {
        await fileRepository.createFile(this.projectId, this.cacheDir, '', 'folder');
        console.log('📁 Created:', this.cacheDir);
      }
      
      if (!files.some(f => f.path === this.metaDir)) {
        await fileRepository.createFile(this.projectId, this.metaDir, '', 'folder');
        console.log('📁 Created:', this.metaDir);
      }
    } catch (error) {
      console.warn('⚠️ Failed to create cache directories:', error);
    }
  }

  private async loadAllCacheFromDisk(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const metaFiles = files.filter(f => 
        f.path.startsWith(this.metaDir) && 
        f.path.endsWith('.json') &&
        f.type === 'file' &&
        f.content?.trim()
      );
      
      console.log(`📂 Found ${metaFiles.length} cache meta files`);
      let loadedCount = 0;
      
      for (const metaFile of metaFiles) {
        try {
          const meta: Omit<CacheEntry, 'code'> = JSON.parse(metaFile.content);
          const hash = metaFile.name.replace('.json', '');
          const codeFile = files.find(f => f.path === `${this.cacheDir}/${hash}.js`);
          
          if (codeFile?.content) {
            this.cache.set(hash, { ...meta, code: codeFile.content } as CacheEntry);
            loadedCount++;
          }
        } catch (error) {
          console.warn('⚠️ Failed to parse:', metaFile.path);
        }
      }
      
      console.log(`✅ Loaded ${loadedCount} cache entries`);
    } catch (error) {
      console.warn('⚠️ Failed to load cache:', error);
    }
  }

  private async saveToDisk(hash: string, entry: CacheEntry): Promise<void> {
    await fileRepository.createFile(
      this.projectId,
      `${this.cacheDir}/${hash}.js`,
      entry.code,
      'file'
    );
    
    const meta: Omit<CacheEntry, 'code'> = {
      originalPath: entry.originalPath,
      hash: entry.hash,
      sourceMap: entry.sourceMap,
      deps: entry.deps,
      mtime: entry.mtime,
      lastAccess: entry.lastAccess,
      size: entry.size,
    };
    
    await fileRepository.createFile(
      this.projectId,
      `${this.metaDir}/${hash}.json`,
      JSON.stringify(meta, null, 2),
      'file'
    );
  }

  private async checkCacheSize(): Promise<void> {
    const totalSize = this.getTotalSize();
    if (totalSize > this.maxCacheSize) {
      console.log(`🗑️ Cache size exceeded (${this.formatSize(totalSize)}), running GC...`);
      await this.runGC();
    }
  }

  private async runGC(): Promise<void> {
    const beforeSize = this.getTotalSize();
    const entries = Array.from(this.cache.values()).sort((a, b) => a.lastAccess - b.lastAccess);
    
    let currentSize = beforeSize;
    const targetSize = this.maxCacheSize * 0.7;
    let deletedCount = 0;
    
    for (const entry of entries) {
      if (currentSize <= targetSize) break;
      
      this.cache.delete(entry.hash);
      try {
        await this.deleteFromDisk(entry.hash);
        currentSize -= entry.size;
        deletedCount++;
      } catch (error) {
        console.warn('⚠️ Failed to delete:', entry.hash);
      }
    }
    
    console.log('✅ GC completed:', {
      deleted: deletedCount,
      before: this.formatSize(beforeSize),
      after: this.formatSize(this.getTotalSize()),
    });
  }

  private async deleteFromDisk(hash: string): Promise<void> {
    const files = await fileRepository.getProjectFiles(this.projectId);
    
    const codeFile = files.find(f => f.path === `${this.cacheDir}/${hash}.js`);
    if (codeFile) await fileRepository.deleteFile(codeFile.id);
    
    const metaFile = files.find(f => f.path === `${this.metaDir}/${hash}.json`);
    if (metaFile) await fileRepository.deleteFile(metaFile.id);
  }

  private getTotalSize(): number {
    return Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  private hashPath(path: string): string {
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
