import { maxSatisfying, satisfies, validRange } from 'semver';

export function satisfiesVersionSpec(version: string, spec: string): boolean {
  const range = spec.trim();
  if (!range || range === 'latest') return true;
  return satisfies(version, range);
}

export function matchesLockedVersion(version: string, spec: string): boolean {
  if (validRange(spec.trim())) return satisfiesVersionSpec(version, spec);
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(spec);
}

export function isVersionRange(spec: string): boolean {
  return Boolean(validRange(spec.trim()));
}

export function resolveVersionSpec(
  spec: string,
  versions: Record<string, object>,
  preferredVersion?: string
): string | null {
  if (versions[spec]) return spec;
  if (preferredVersion && versions[preferredVersion] && satisfies(preferredVersion, spec)) {
    return preferredVersion;
  }
  return maxSatisfying(Object.keys(versions), spec);
}
