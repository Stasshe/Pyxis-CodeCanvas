export function versionCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** semver 範囲 (^, ~, ||, >= 等) を利用可能バージョン群から解決して実際のバージョン文字列を返す */
export function resolveVersionSpec(
  spec: string,
  versions: Record<string, unknown>
): string | null {
  spec = spec.trim();
  if (versions[spec]) return spec;

  // || 範囲: 左から順に解決
  if (spec.includes('||')) {
    for (const part of spec.split('||')) {
      const r = resolveVersionSpec(part.trim(), versions);
      if (r) return r;
    }
    return null;
  }

  // AND 範囲 (スペース区切り) は先頭制約のみ使う
  const primarySpec = spec.split(/\s+/).filter(Boolean)[0];

  const stable = Object.keys(versions)
    .filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => versionCompare(b, a)); // 降順

  // ^ : 同じメジャーの最新
  const caret = primarySpec.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (caret) {
    const [, major, minor, patch] = caret;
    return (
      stable.find(v => {
        const [vMaj, vMin, vPat] = v.split('.').map(Number);
        if (vMaj !== Number(major)) return false;
        if (vMaj === 0) {
          if (vMin !== Number(minor)) return false;
          return vMin === 0 ? vPat >= Number(patch) : vPat >= Number(patch) || vMin > Number(minor);
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

  // >=
  const gte = primarySpec.match(/^>=(\d+\.\d+\.\d+)/);
  if (gte) return stable.find(v => versionCompare(v, gte[1]) >= 0) ?? null;

  // >
  const gt = primarySpec.match(/^>(\d+\.\d+\.\d+)/);
  if (gt) return stable.find(v => versionCompare(v, gt[1]) > 0) ?? null;

  // 先頭記号除去して完全一致
  const stripped = primarySpec.replace(/^[>=<^~]+/, '');
  return versions[stripped] ? stripped : null;
}

/** ^1.0.0 -> 1.0.0, ~1.0.0 -> 1.0.0 */
export function resolveVersion(versionSpec: string): string {
  return versionSpec.replace(/^[\^~]/, '');
}
