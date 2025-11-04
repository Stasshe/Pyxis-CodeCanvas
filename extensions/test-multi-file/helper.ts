/**
 * Helper module for testing multi-file extension
 */

export function helperFunction(): string {
  return "Hello from helper module!";
}

export class HelperClass {
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  getMessage(): string {
    return `Helper says: ${this.message}`;
  }
}

export const helperConstant = "This is a constant from helper";
