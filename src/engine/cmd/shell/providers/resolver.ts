/**
 * Command Resolver
 * Resolves command names to appropriate providers following POSIX resolution order.
 */

import type { ProviderRegistry } from './registry';
import type {
  CommandProvider,
  CommandResolutionOptions,
  IExecutionContext,
  ResolvedCommand,
  ResolutionCacheEntry,
} from './types';
import {
  CommandNotFoundError,
  isShellBuiltin,
  isSpecialBuiltin,
  ProviderType,
} from './types';

/**
 * Command Resolver
 * Resolves command names to appropriate providers.
 */
export class CommandResolver {
  private registry: ProviderRegistry;
  private cache: Map<string, ResolutionCacheEntry> = new Map();
  private maxCacheSize = 1000;

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  /**
   * Resolve a command to its provider
   * Follows POSIX resolution order:
   * 1. Special builtins
   * 2. Shell builtins
   * 3. Aliases (unless skipped)
   * 4. Functions (unless skipped)
   * 5. Extension commands
   * 6. Domain-specific providers (git, npm, etc.)
   * 7. External commands
   */
  async resolve(
    commandName: string,
    options: CommandResolutionOptions
  ): Promise<ResolvedCommand> {
    const { skipAliases, skipFunctions, onlyBuiltins, context } = options;

    // 1. Special builtins - always check first
    if (isSpecialBuiltin(commandName)) {
      const provider = await this.findBuiltinProvider(commandName, context);
      if (provider) {
        return {
          type: ProviderType.SPECIAL_BUILTIN,
          provider,
          priority: 0,
        };
      }
    }

    // 2. Shell builtins
    if (isShellBuiltin(commandName)) {
      const provider = await this.findBuiltinProvider(commandName, context);
      if (provider) {
        return {
          type: ProviderType.BUILTIN,
          provider,
          priority: 100,
        };
      }
    }

    // If onlyBuiltins is set, fail now
    if (onlyBuiltins) {
      throw new CommandNotFoundError(commandName);
    }

    // 3. Aliases (unless skipped with \command)
    if (!skipAliases) {
      const alias = context.getAlias(commandName);
      if (alias) {
        return {
          type: 'alias',
          expansion: alias,
          priority: 200,
        };
      }
    }

    // 4. Functions (unless skipped with command builtin)
    if (!skipFunctions) {
      const func = context.getFunction(commandName);
      if (func) {
        return {
          type: 'function',
          body: func,
          priority: 300,
        };
      }
    }

    // 5. Check resolution cache
    const cached = this.getFromCache(commandName);
    if (cached) {
      return cached;
    }

    // 6. Query registered providers by priority
    const providers = this.registry.getProvidersByPriority();

    for (const provider of providers) {
      // Skip builtin provider as we already checked
      if (
        provider.type === ProviderType.BUILTIN ||
        provider.type === ProviderType.SPECIAL_BUILTIN
      ) {
        continue;
      }

      try {
        if (await provider.canHandle(commandName, context)) {
          const resolved: ResolvedCommand = {
            type: provider.type,
            provider,
            priority: provider.priority,
          };

          // Cache the result
          this.addToCache(commandName, resolved, provider.cacheTTL);

          return resolved;
        }
      } catch (e) {
        console.warn(`[CommandResolver] Provider ${provider.id} canHandle error:`, e);
      }
    }

    // 7. Command not found
    const suggestions = await this.findSuggestions(commandName, context);
    throw new CommandNotFoundError(commandName, suggestions);
  }

  /**
   * Find the builtin provider for a command
   */
  private async findBuiltinProvider(
    commandName: string,
    context: IExecutionContext
  ): Promise<CommandProvider | undefined> {
    const providers = this.registry.getProvidersByPriority();

    for (const provider of providers) {
      if (
        provider.type === ProviderType.BUILTIN ||
        provider.type === ProviderType.SPECIAL_BUILTIN
      ) {
        if (await provider.canHandle(commandName, context)) {
          return provider;
        }
      }
    }

    return undefined;
  }

  /**
   * Get a resolved command from cache
   */
  private getFromCache(commandName: string): ResolvedCommand | null {
    const entry = this.cache.get(commandName);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.ttl !== -1) {
      const age = Date.now() - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(commandName);
        return null;
      }
    }

    return entry.provider;
  }

  /**
   * Add a resolved command to cache
   */
  private addToCache(
    commandName: string,
    resolved: ResolvedCommand,
    ttl: number
  ): void {
    // Skip caching if TTL is 0
    if (ttl === 0) {
      return;
    }

    // Enforce max cache size
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entries
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, Math.floor(this.maxCacheSize / 4));
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }

    this.cache.set(commandName, {
      provider: resolved,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Find similar commands for suggestions
   */
  private async findSuggestions(
    commandName: string,
    context: IExecutionContext
  ): Promise<string[]> {
    const suggestions: string[] = [];
    const providers = this.registry.getProvidersByPriority();

    // Collect all available commands from providers that support completion
    for (const provider of providers) {
      if (provider.complete) {
        try {
          const completions = await provider.complete(commandName.slice(0, 3), context);
          for (const c of completions) {
            if (
              c.type === 'command' &&
              this.levenshteinDistance(commandName, c.text) <= 3
            ) {
              suggestions.push(c.text);
            }
          }
        } catch (e) {
          // Ignore completion errors
        }
      }
    }

    // Check aliases
    for (const [name] of context.aliases) {
      if (this.levenshteinDistance(commandName, name) <= 2) {
        suggestions.push(name);
      }
    }

    // Check functions
    for (const [name] of context.functions) {
      if (this.levenshteinDistance(commandName, name) <= 2) {
        suggestions.push(name);
      }
    }

    // Deduplicate and limit
    return [...new Set(suggestions)].slice(0, 5);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Clear the resolution cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate cache for a specific command
   */
  invalidateCache(commandName: string): void {
    this.cache.delete(commandName);
  }

  /**
   * Invalidate cache for commands from a specific provider type
   */
  invalidateCacheByType(type: ProviderType): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.provider.type === type) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
    };
  }
}

/**
 * Create a new command resolver
 */
export function createCommandResolver(registry: ProviderRegistry): CommandResolver {
  return new CommandResolver(registry);
}
