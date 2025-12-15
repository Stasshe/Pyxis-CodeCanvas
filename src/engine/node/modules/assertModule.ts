/**
 * [NEW ARCHITECTURE] assert モジュールのエミュレーション
 */

export function createAssertModule() {
  const assert = Object.assign(
    function assert(value: any, message?: string): asserts value {
      if (!value) {
        throw new Error(message || 'Assertion failed')
      }
    },
    {
      ok(value: any, message?: string): asserts value {
        if (!value) {
          throw new Error(message || 'Assertion failed')
        }
      },
      strictEqual(actual: any, expected: any, message?: string): void {
        if (actual !== expected) {
          throw new Error(message || `Expected ${actual} to strictly equal ${expected}`)
        }
      },
      notStrictEqual(actual: any, expected: any, message?: string): void {
        if (actual === expected) {
          throw new Error(message || `Expected ${actual} to not strictly equal ${expected}`)
        }
      },
      deepStrictEqual(actual: any, expected: any, message?: string): void {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(
            message ||
              `Deep equal assertion failed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
          )
        }
      },
      notDeepStrictEqual(actual: any, expected: any, message?: string): void {
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
          throw new Error(message || 'Expected values to not be deeply equal')
        }
      },
      equal(actual: any, expected: any, message?: string): void {
        // eslint-disable-next-line eqeqeq
        if (actual != expected) {
          throw new Error(message || `Expected ${actual} to equal ${expected}`)
        }
      },
      notEqual(actual: any, expected: any, message?: string): void {
        // eslint-disable-next-line eqeqeq
        if (actual == expected) {
          throw new Error(message || `Expected ${actual} to not equal ${expected}`)
        }
      },
      fail(message?: string): never {
        throw new Error(message || 'Assertion failed')
      },
      throws(fn: () => void, message?: string): void {
        try {
          fn()
          throw new Error(message || 'Expected function to throw')
        } catch (error) {
          // Expected behavior
        }
      },
      doesNotThrow(fn: () => void, message?: string): void {
        try {
          fn()
        } catch (error) {
          throw new Error(message || 'Expected function to not throw')
        }
      },
    }
  )

  return assert
}
