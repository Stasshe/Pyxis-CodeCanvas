/**
 * Utility module for testing multi-file extension
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export default {
  add,
  multiply,
  version: "1.0.0"
};
