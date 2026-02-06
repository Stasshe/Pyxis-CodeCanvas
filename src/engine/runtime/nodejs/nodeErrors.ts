/**
 * Node.js-style error utilities
 * エラーをNode.jsと同様の形式でフォーマットする
 */

/**
 * Maximum number of stack frames to include in formatted errors
 */
const MAX_STACK_FRAMES = 10;

/**
 * Format an error in Node.js style
 * Creates error messages similar to Node.js's format
 */
export function formatNodeError(
  error: Error | unknown,
  context?: {
    filePath?: string;
    moduleName?: string;
    code?: string;
  }
): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const lines: string[] = [];

  // Error type and message (similar to Node.js format)
  const errorType = err.name || 'Error';
  lines.push(`${errorType}: ${err.message}`);

  // Add context information if available
  if (context?.filePath) {
    lines.push(`    at ${context.filePath}`);
  }
  if (context?.moduleName) {
    lines.push(`    module: '${context.moduleName}'`);
  }

  // Add stack trace if available, filtering out internal frames
  if (err.stack) {
    const stackLines = err.stack.split('\n').slice(1);
    const filteredStack = stackLines
      .filter(line => {
        // Filter out internal VM and eval frames that aren't useful
        const trimmed = line.trim();
        if (trimmed.startsWith('at eval')) return false;
        if (trimmed.includes('Function (<anonymous>)')) return false;
        if (trimmed.includes('new Function')) return false;
        return true;
      })
      .slice(0, MAX_STACK_FRAMES);

    if (filteredStack.length > 0) {
      lines.push(...filteredStack);
    }
  }

  return lines.join('\n');
}

/**
 * Create a Node.js-style MODULE_NOT_FOUND error
 */
export function createModuleNotFoundError(moduleName: string, parent?: string): Error {
  const error = new Error(`Cannot find module '${moduleName}'`);
  error.name = 'Error [ERR_MODULE_NOT_FOUND]';
  if (parent) {
    error.message += `\nRequire stack:\n- ${parent}`;
  }
  return error;
}

/**
 * Create a Node.js-style syntax error with code location
 */
export function createSyntaxError(
  message: string,
  filePath?: string,
  line?: number,
  column?: number
): SyntaxError {
  let fullMessage = message;
  if (filePath) {
    fullMessage = `${filePath}${line ? `:${line}` : ''}${column ? `:${column}` : ''}\n${message}`;
  }
  const error = new SyntaxError(fullMessage);
  return error;
}
