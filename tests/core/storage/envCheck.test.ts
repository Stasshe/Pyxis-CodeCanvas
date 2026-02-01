/**
 * Tests for Environment Detection
 *
 * These tests validate the environment detection logic.
 */

import {
  detectEnvironment,
  isBrowser,
  isNode,
  isTest,
} from '../../../src/engine/core/storage/envCheck';

describe('Environment Detection', () => {
  describe('detectEnvironment', () => {
    it('should detect test environment', () => {
      // We're running in Jest, so this should return 'test'
      const env = detectEnvironment();
      expect(env).toBe('test');
    });
  });

  describe('isBrowser', () => {
    it('should return false in test environment', () => {
      expect(isBrowser()).toBe(false);
    });
  });

  describe('isNode', () => {
    it('should return true in test environment', () => {
      // Test environment is considered a Node.js environment
      expect(isNode()).toBe(true);
    });
  });

  describe('isTest', () => {
    it('should return true when running in Jest', () => {
      expect(isTest()).toBe(true);
    });
  });
});
