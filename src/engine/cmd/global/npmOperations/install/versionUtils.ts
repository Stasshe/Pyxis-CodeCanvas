export function versionCompare(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.').map(Number);
  const pb = normalizeVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '').split('-')[0];
}

function versionParts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = normalizeVersion(version).split('.').map(Number);
  return [major, minor, patch];
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const match = comparator.match(/^(<=|>=|<|>|=)?\s*v?(\d+\.\d+\.\d+)/);
  if (!match) return false;
  const op = match[1] || '=';
  const cmp = versionCompare(version, match[2]);
  if (op === '>=') return cmp >= 0;
  if (op === '>') return cmp > 0;
  if (op === '<=') return cmp <= 0;
  if (op === '<') return cmp < 0;
  return cmp === 0;
}

function satisfiesAll(version: string, comparators: string[]): boolean {
  return comparators.every(comparator => satisfiesComparator(version, comparator));
}

export function satisfiesVersionSpec(version: string, spec: string): boolean {
  const trimmedSpec = spec.trim();
  if (!trimmedSpec || trimmedSpec === 'latest' || trimmedSpec === '*') return true;
  if (trimmedSpec.includes('||')) {
    return trimmedSpec.split('||').some(part => satisfiesVersionSpec(version, part.trim()));
  }

  const specParts = trimmedSpec.split(/\s+/).filter(Boolean);
  if (specParts.length > 1 && specParts.some(part => /^(<=|>=|<|>|=)/.test(part))) {
    return satisfiesAll(version, specParts);
  }

  const primarySpec = specParts[0];
  if (/^[xX](?:\.[xX])?(?:\.[xX])?$/.test(primarySpec)) return true;

  const majorWildcard = primarySpec.match(/^(\d+)\.[xX]$/);
  if (majorWildcard) return versionParts(version)[0] === Number(majorWildcard[1]);

  const minorWildcard = primarySpec.match(/^(\d+)\.(\d+)\.[xX]$/);
  if (minorWildcard) {
    const [major, minor] = versionParts(version);
    return major === Number(minorWildcard[1]) && minor === Number(minorWildcard[2]);
  }

  const caret = primarySpec.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (caret) {
    const major = Number(caret[1]);
    const minor = Number(caret[2]);
    const patch = Number(caret[3]);
    const [vMajor, vMinor, vPatch] = versionParts(version);
    if (vMajor !== major) return false;
    if (versionCompare(version, `${major}.${minor}.${patch}`) < 0) return false;
    if (major === 0 && vMinor !== minor) return false;
    if (major === 0 && minor === 0 && vPatch !== patch) return false;
    return true;
  }

  const tilde = primarySpec.match(/^~(\d+)\.(\d+)/);
  if (tilde) {
    const [vMajor, vMinor] = versionParts(version);
    return vMajor === Number(tilde[1]) && vMinor === Number(tilde[2]);
  }

  if (/^(<=|>=|<|>|=)/.test(primarySpec)) return satisfiesComparator(version, primarySpec);

  const stripped = primarySpec.replace(/^[>=<^~=\s]+/, '').replace(/^v/, '');
  return normalizeVersion(version) === normalizeVersion(stripped);
}

/** semver 範囲 (^, ~, ||, >= 等) を利用可能バージョン群から解決して実際のバージョン文字列を返す */
export function resolveVersionSpec(spec: string, versions: Record<string, unknown>): string | null {
  const trimmedSpec = spec.trim();
  if (versions[trimmedSpec]) return trimmedSpec;

  // || 範囲: 左から順に解決
  if (trimmedSpec.includes('||')) {
    for (const part of trimmedSpec.split('||')) {
      const r = resolveVersionSpec(part.trim(), versions);
      if (r) return r;
    }
    return null;
  }

  // AND 範囲 (スペース区切り) は先頭制約のみ使う
  const specParts = trimmedSpec.split(/\s+/).filter(Boolean);
  const primarySpec = specParts[0];

  const stable = Object.keys(versions)
    .filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => versionCompare(b, a)); // 降順

  if (primarySpec === '*' || /^[xX](?:\.[xX])?(?:\.[xX])?$/.test(primarySpec)) {
    return stable[0] ?? null;
  }

  const majorWildcard = primarySpec.match(/^(\d+)\.[xX]$/);
  if (majorWildcard) return stable.find(v => v.split('.')[0] === majorWildcard[1]) ?? null;

  const minorWildcard = primarySpec.match(/^(\d+)\.(\d+)\.[xX]$/);
  if (minorWildcard) {
    const [, major, minor] = minorWildcard;
    return stable.find(v => v.split('.')[0] === major && v.split('.')[1] === minor) ?? null;
  }

  // ^ : 同じメジャーの最新
  const caret = primarySpec.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (caret) {
    const [, major, minor, patch] = caret;
    return (
      stable.find(v => {
        const [vMaj, vMin, vPat] = versionParts(v);
        if (vMaj !== Number(major)) return false;
        if (vMaj === 0) {
          if (vMin !== Number(minor)) return false;
          return vMin === 0 ? vPat === Number(patch) : vPat >= Number(patch);
        }
        return versionCompare(v, `${major}.${minor}.${patch}`) >= 0;
      }) ?? null
    );
  }

  // ~ : 同じメジャー.マイナーの最新
  const tilde = primarySpec.match(/^~(\d+)\.(\d+)/);
  if (tilde) {
    const [, major, minor] = tilde;
    return stable.find(v => v.split('.')[0] === major && v.split('.')[1] === minor) ?? null;
  }

  if (specParts.some(part => /^(<=|>=|<|>|=)/.test(part))) {
    return stable.find(v => satisfiesAll(v, specParts)) ?? null;
  }

  // 先頭記号除去して完全一致
  const stripped = primarySpec.replace(/^[>=<^~=\s]+/, '').replace(/^v/, '');
  return versions[stripped] ? stripped : null;
}

/** ^1.0.0 -> 1.0.0, ~1.0.0 -> 1.0.0 */
export function resolveVersion(versionSpec: string): string {
  return versionSpec.replace(/^[\^~]/, '');
}
