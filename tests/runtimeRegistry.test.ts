/**
 * RuntimeRegistry Tests
 *
 * RuntimeRegistryの基本機能をテスト
 */

import { RuntimeRegistry } from '@/engine/runtime/RuntimeRegistry';

import type { RuntimeProvider, TranspilerProvider } from '@/engine/runtime/RuntimeProvider';

describe('RuntimeRegistry', () => {
  let registry: RuntimeRegistry;

  beforeEach(() => {
    // 各テスト前にレジストリをクリア
    registry = RuntimeRegistry.getInstance();
    registry.clear();
  });

  describe('Runtime Provider Registration', () => {
    test('should register a runtime provider', () => {
      const mockProvider: RuntimeProvider = {
        id: 'test-runtime',
        name: 'Test Runtime',
        supportedExtensions: ['.test'],
        canExecute: (filePath: string) => filePath.endsWith('.test'),
        execute: async () => ({ exitCode: 0 }),
      };

      registry.registerRuntime(mockProvider);

      const retrieved = registry.getRuntime('test-runtime');
      expect(retrieved).toBe(mockProvider);
    });

    test('should get runtime provider by file extension', () => {
      const mockProvider: RuntimeProvider = {
        id: 'test-runtime',
        name: 'Test Runtime',
        supportedExtensions: ['.test'],
        canExecute: (filePath: string) => filePath.endsWith('.test'),
        execute: async () => ({ exitCode: 0 }),
      };

      registry.registerRuntime(mockProvider);

      const retrieved = registry.getRuntimeForFile('example.test');
      expect(retrieved).toBe(mockProvider);
    });

    test('should return null for unknown file extension', () => {
      const retrieved = registry.getRuntimeForFile('example.unknown');
      expect(retrieved).toBeNull();
    });

    test('should unregister a runtime provider', () => {
      const mockProvider: RuntimeProvider = {
        id: 'test-runtime',
        name: 'Test Runtime',
        supportedExtensions: ['.test'],
        canExecute: (filePath: string) => filePath.endsWith('.test'),
        execute: async () => ({ exitCode: 0 }),
      };

      registry.registerRuntime(mockProvider);
      registry.unregisterRuntime('test-runtime');

      const retrieved = registry.getRuntime('test-runtime');
      expect(retrieved).toBeNull();
    });
  });

  describe('Transpiler Provider Registration', () => {
    test('should register a transpiler provider', () => {
      const mockProvider: TranspilerProvider = {
        id: 'test-transpiler',
        supportedExtensions: ['.ts'],
        needsTranspile: (filePath: string) => filePath.endsWith('.ts'),
        transpile: async (code: string) => ({ code, dependencies: [] }),
      };

      registry.registerTranspiler(mockProvider);

      const retrieved = registry.getTranspiler('test-transpiler');
      expect(retrieved).toBe(mockProvider);
    });

    test('should get transpiler provider by file extension', () => {
      const mockProvider: TranspilerProvider = {
        id: 'test-transpiler',
        supportedExtensions: ['.ts'],
        needsTranspile: (filePath: string) => filePath.endsWith('.ts'),
        transpile: async (code: string) => ({ code, dependencies: [] }),
      };

      registry.registerTranspiler(mockProvider);

      const retrieved = registry.getTranspilerForFile('example.ts');
      expect(retrieved).toBe(mockProvider);
    });

    test('should return null for unknown file extension', () => {
      const retrieved = registry.getTranspilerForFile('example.unknown');
      expect(retrieved).toBeNull();
    });

    test('should unregister a transpiler provider', () => {
      const mockProvider: TranspilerProvider = {
        id: 'test-transpiler',
        supportedExtensions: ['.ts'],
        needsTranspile: (filePath: string) => filePath.endsWith('.ts'),
        transpile: async (code: string) => ({ code, dependencies: [] }),
      };

      registry.registerTranspiler(mockProvider);
      registry.unregisterTranspiler('test-transpiler');

      const retrieved = registry.getTranspiler('test-transpiler');
      expect(retrieved).toBeNull();
    });
  });

  describe('Multiple Providers', () => {
    test('should handle multiple runtime providers', () => {
      const provider1: RuntimeProvider = {
        id: 'runtime1',
        name: 'Runtime 1',
        supportedExtensions: ['.r1'],
        canExecute: (filePath: string) => filePath.endsWith('.r1'),
        execute: async () => ({ exitCode: 0 }),
      };

      const provider2: RuntimeProvider = {
        id: 'runtime2',
        name: 'Runtime 2',
        supportedExtensions: ['.r2'],
        canExecute: (filePath: string) => filePath.endsWith('.r2'),
        execute: async () => ({ exitCode: 0 }),
      };

      registry.registerRuntime(provider1);
      registry.registerRuntime(provider2);

      const allRuntimes = registry.getAllRuntimes();
      expect(allRuntimes.length).toBe(2);
      expect(allRuntimes).toContain(provider1);
      expect(allRuntimes).toContain(provider2);
    });

    test('should handle multiple transpiler providers for same extension', () => {
      const provider1: TranspilerProvider = {
        id: 'transpiler1',
        supportedExtensions: ['.ts'],
        needsTranspile: (filePath: string) => filePath.endsWith('.ts'),
        transpile: async (code: string) => ({ code, dependencies: [] }),
      };

      const provider2: TranspilerProvider = {
        id: 'transpiler2',
        supportedExtensions: ['.ts'],
        needsTranspile: (filePath: string) => filePath.endsWith('.ts'),
        transpile: async (code: string) => ({ code, dependencies: [] }),
      };

      registry.registerTranspiler(provider1);
      registry.registerTranspiler(provider2);

      // Should return the first registered transpiler
      const retrieved = registry.getTranspilerForFile('example.ts');
      expect(retrieved).toBe(provider1);
    });
  });
});
