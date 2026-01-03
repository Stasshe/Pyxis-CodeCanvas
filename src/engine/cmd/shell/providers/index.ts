/**
 * Provider Module Index
 * Exports all provider-related types, classes, and utilities.
 */

// Types
export * from './types';

// Registry
export { ProviderRegistry, getProviderRegistry, createProviderRegistry, resetGlobalRegistry } from './registry';

// Resolver
export { CommandResolver, createCommandResolver } from './resolver';

// Provider implementations
export { BuiltinCommandProvider, createBuiltinProvider } from './builtinProvider';
export { GitCommandProvider, createGitProvider } from './gitProvider';
export { NpmCommandProvider, createNpmProvider } from './npmProvider';
export { ExtensionCommandProvider, createExtensionProvider } from './extensionProvider';
export { PyxisCommandProvider, createPyxisProvider } from './pyxisProvider';
export { ExternalCommandProvider, createExternalProvider } from './externalProvider';

/**
 * Setup default providers for a project
 */
export async function setupDefaultProviders(): Promise<void> {
  const { getProviderRegistry } = await import('./registry');
  const registry = getProviderRegistry();

  // Only setup if empty
  if (registry.count > 0) {
    return;
  }

  // Import all providers
  const [
    { createBuiltinProvider },
    { createGitProvider },
    { createNpmProvider },
    { createExtensionProvider },
    { createPyxisProvider },
    { createExternalProvider },
  ] = await Promise.all([
    import('./builtinProvider'),
    import('./gitProvider'),
    import('./npmProvider'),
    import('./extensionProvider'),
    import('./pyxisProvider'),
    import('./externalProvider'),
  ]);

  // Register all providers
  registry.register(createBuiltinProvider());
  registry.register(createGitProvider());
  registry.register(createNpmProvider());
  registry.register(createExtensionProvider());
  registry.register(createPyxisProvider());
  registry.register(createExternalProvider());

  console.log('[Providers] Default providers registered');
}
