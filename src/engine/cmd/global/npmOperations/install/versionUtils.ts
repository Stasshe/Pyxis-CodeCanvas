import { maxSatisfying, satisfies } from 'semver';

export function satisfiesVersionSpec(version: string, spec: string): boolean {
  const range = spec.trim();
  if (!range || range === 'latest') return true;
  return satisfies(version, range);
}

export function resolveVersionSpec(spec: string, versions: Record<string, object>): string | null {
  if (versions[spec]) return spec;
  return maxSatisfying(Object.keys(versions), spec);
}
