// ES Moduleサンプル - モジュールのインポート/エクスポート

// 名前付きエクスポート
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

// 定数のエクスポート
export const PI = 3.14159;
export const E = 2.71828;

// クラスのエクスポート
export class Calculator {
  constructor(private value: number = 0) {}

  add(n: number): this {
    this.value += n;
    return this;
  }

  subtract(n: number): this {
    this.value -= n;
    return this;
  }

  multiply(n: number): this {
    this.value *= n;
    return this;
  }

  divide(n: number): this {
    if (n === 0) {
      throw new Error('Division by zero');
    }
    this.value /= n;
    return this;
  }

  getValue(): number {
    return this.value;
  }

  reset(): this {
    this.value = 0;
    return this;
  }
}

// デフォルトエクスポート
export default class MathUtils {
  static square(n: number): number {
    return n * n;
  }

  static cube(n: number): number {
    return n * n * n;
  }

  static sqrt(n: number): number {
    if (n < 0) {
      throw new Error('Cannot calculate square root of negative number');
    }
    return Math.sqrt(n);
  }

  static power(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }
}
