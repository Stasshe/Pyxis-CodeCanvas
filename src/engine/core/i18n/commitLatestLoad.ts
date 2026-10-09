export async function commitLatestLoad<T>(
  requestId: number,
  getCurrentRequestId: () => number,
  load: () => Promise<T>,
  commit: (value: T) => void
): Promise<boolean> {
  const value = await load();
  if (requestId !== getCurrentRequestId()) return false;
  commit(value);
  return true;
}
