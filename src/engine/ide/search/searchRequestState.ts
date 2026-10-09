export interface SearchRequestToken {
  generation: number;
  rootPath: string;
  query: string;
  optionsKey: string;
}

interface CachedSearch<Result> {
  rootPath: string;
  query: string;
  optionsKey: string;
  results: Result[];
}

export class SearchRequestState<Result> {
  private generation = 0;
  private cache: CachedSearch<Result> | null = null;

  invalidate(): void {
    this.generation += 1;
    this.cache = null;
  }

  getCached(rootPath: string, query: string, optionsKey: string): Result[] | null {
    const cache = this.cache;
    if (
      !cache ||
      cache.rootPath !== rootPath ||
      cache.query !== query ||
      cache.optionsKey !== optionsKey ||
      cache.results.length === 0
    ) {
      return null;
    }
    return cache.results;
  }

  start(rootPath: string, query: string, optionsKey: string): SearchRequestToken {
    this.generation += 1;
    return { generation: this.generation, rootPath, query, optionsKey };
  }

  isCurrent(request: SearchRequestToken, currentRootPath: string): boolean {
    return request.generation === this.generation && request.rootPath === currentRootPath;
  }

  complete(request: SearchRequestToken, currentRootPath: string, results: Result[]): boolean {
    if (!this.isCurrent(request, currentRootPath)) return false;
    this.cache = {
      rootPath: request.rootPath,
      query: request.query,
      optionsKey: request.optionsKey,
      results,
    };
    return true;
  }
}
