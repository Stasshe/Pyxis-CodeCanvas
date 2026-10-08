import { HOME_DIR } from '@/engine/core/pathUtils';

export function createEnvironment(overrides?: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
  return { ...inherited, HOME: HOME_DIR, ...overrides };
}
