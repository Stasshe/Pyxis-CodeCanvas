/**
 * Provider Registry
 * Manages all command providers with priority-based resolution.
 */

import type {
  CommandProvider,
  IExecutionContext,
} from './types';

/**
 * Provider Registry
 * Singleton that manages all registered command providers.
 */
export class ProviderRegistry {
  private providers: CommandProvider[] = [];
  private providerMap: Map<string, CommandProvider> = new Map();
  private initialized = false;

  /**
   * Register a command provider
   */
  register(provider: CommandProvider): void {
    // Check for duplicate provider IDs
    if (this.providerMap.has(provider.id)) {
      console.warn(
        `[ProviderRegistry] Provider with ID "${provider.id}" is already registered. Replacing...`
      );
      this.providers = this.providers.filter(p => p.id !== provider.id);
    }

    // Add to registry
    this.providers.push(provider);
    this.providerMap.set(provider.id, provider);

    // Sort by priority (lower = higher priority)
    this.providers.sort((a, b) => a.priority - b.priority);

    console.log(
      `[ProviderRegistry] Registered provider: ${provider.id} (priority: ${provider.priority})`
    );
  }

  /**
   * Unregister a provider
   */
  async unregister(providerId: string): Promise<void> {
    const provider = this.providerMap.get(providerId);
    if (!provider) {
      return;
    }

    // Call dispose if available
    if (provider.dispose) {
      try {
        await provider.dispose();
      } catch (e) {
        console.warn(`[ProviderRegistry] Error disposing provider ${providerId}:`, e);
      }
    }

    // Remove from registry
    this.providers = this.providers.filter(p => p.id !== providerId);
    this.providerMap.delete(providerId);

    console.log(`[ProviderRegistry] Unregistered provider: ${providerId}`);
  }

  /**
   * Get all providers sorted by priority
   */
  getProvidersByPriority(): CommandProvider[] {
    return [...this.providers];
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): CommandProvider | undefined {
    return this.providerMap.get(providerId);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(providerId: string): boolean {
    return this.providerMap.has(providerId);
  }

  /**
   * Get all provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.providerMap.keys());
  }

  /**
   * Initialize all providers for a project
   */
  async initializeProviders(projectId: string, context: IExecutionContext): Promise<void> {
    if (this.initialized) {
      return;
    }

    for (const provider of this.providers) {
      if (provider.initialize) {
        try {
          await provider.initialize(projectId, context);
        } catch (error) {
          console.error(
            `[ProviderRegistry] Failed to initialize provider ${provider.id}:`,
            error
          );
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Reset initialization state
   */
  resetInitialization(): void {
    this.initialized = false;
  }

  /**
   * Dispose all providers
   */
  async dispose(): Promise<void> {
    for (const provider of this.providers) {
      if (provider.dispose) {
        try {
          await provider.dispose();
        } catch (error) {
          console.error(
            `[ProviderRegistry] Failed to dispose provider ${provider.id}:`,
            error
          );
        }
      }
    }

    this.providers = [];
    this.providerMap.clear();
    this.initialized = false;
  }

  /**
   * Get all supported commands from all providers
   * Returns a deduplicated list of commands sorted alphabetically
   */
  getAllSupportedCommands(): string[] {
    const commands = new Set<string>();
    
    for (const provider of this.providers) {
      const providerCommands = provider.getSupportedCommands();
      for (const cmd of providerCommands) {
        commands.add(cmd);
      }
    }
    
    return Array.from(commands).sort();
  }

  /**
   * Get supported commands grouped by provider
   * Useful for help output and debugging
   */
  getCommandsByProvider(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    
    for (const provider of this.providers) {
      const commands = provider.getSupportedCommands();
      result.set(provider.id, commands);
    }
    
    return result;
  }

  /**
   * Get provider count
   */
  get count(): number {
    return this.providers.length;
  }

  /**
   * Check if registry has been initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}

// Global registry instance
let globalRegistry: ProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProviderRegistry();
  }
  return globalRegistry;
}

/**
 * Create a new provider registry (for testing or isolated contexts)
 */
export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

/**
 * Reset the global registry (for testing)
 */
export async function resetGlobalRegistry(): Promise<void> {
  if (globalRegistry) {
    await globalRegistry.dispose();
    globalRegistry = null;
  }
}
