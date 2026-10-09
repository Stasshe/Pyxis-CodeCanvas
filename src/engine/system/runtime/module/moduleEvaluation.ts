import type { ModuleFormat } from './moduleCode';

export interface EvaluationSource {
  format: ModuleFormat;
  hasTopLevelAwait: boolean;
  staticImports: string[];
}

/** Execution-scoped ESM graph state; CommonJS remains on its synchronous evaluator. */
export class ModuleEvaluation {
  private readonly promises = new Map<string, Promise<void>>();

  constructor(
    private readonly source: (path: string) => EvaluationSource,
    private readonly resolve: (specifier: string, parent: string) => string | null,
    private readonly execute: (path: string) => Promise<void>
  ) {}

  hasAsyncModule(path: string, visited = new Set<string>()): boolean {
    if (visited.has(path)) return false;
    visited.add(path);
    const source = this.source(path);
    if (source.format !== 'module') return false;
    if (source.hasTopLevelAwait) return true;
    for (const specifier of source.staticImports) {
      const dependency = this.resolve(specifier, path);
      if (dependency && this.hasAsyncModule(dependency, visited)) return true;
    }
    return false;
  }

  hasPath(from: string, target: string, visited = new Set<string>()): boolean {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    const source = this.source(from);
    if (source.format !== 'module') return false;
    for (const specifier of source.staticImports) {
      const dependency = this.resolve(specifier, from);
      if (dependency && this.hasPath(dependency, target, visited)) return true;
    }
    return false;
  }

  evaluate(path: string): Promise<void> {
    const pending = this.promises.get(path);
    if (pending) return pending;
    const promise = Promise.resolve().then(() => this.execute(path));
    this.promises.set(path, promise);
    return promise;
  }

  pending(path: string): Promise<void> | undefined {
    return this.promises.get(path);
  }

  clear(): void {
    this.promises.clear();
  }
}
