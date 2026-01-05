/**
 * Utility functions for AbortSignal handling
 * Used for interruptible command execution (Ctrl+C support)
 */

/**
 * Check if operation should be aborted and throw if so
 * @param signal - Optional AbortSignal to check
 * @throws Error with message 'Operation interrupted' if signal is aborted
 */
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation interrupted');
  }
}

/**
 * Check if signal is aborted (non-throwing version)
 * @param signal - Optional AbortSignal to check
 * @returns true if signal is aborted, false otherwise
 */
export function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}
