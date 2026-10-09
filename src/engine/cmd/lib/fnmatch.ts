/**
 * fnmatch - POSIX fnmatch(3) 準拠のパターンマッチング
 *
 * POSIXのfnmatch関数を模倣。shell wildcard pattern matching。
 * find, ls, tree, grep, case文などで共通使用。
 *
 * パターン:
 *   *      - 任意の文字列（0文字以上）
 *   ?      - 任意の1文字
 *   [...]  - 文字クラス
 *   [!...] - 否定文字クラス
 *   \x     - エスケープ
 *
 * フラグ:
 *   FNM_NOESCAPE  - バックスラッシュをエスケープとして扱わない
 *   FNM_PATHNAME  - スラッシュを特別扱い（*や?でマッチしない）
 *   FNM_PERIOD    - 先頭のドットを特別扱い
 *   FNM_CASEFOLD  - 大文字小文字を区別しない（GNU拡張）
 */

/** fnmatchフラグ */
export const FNM_NOESCAPE = 1 << 0;
export const FNM_PATHNAME = 1 << 1;
export const FNM_PERIOD = 1 << 2;
export const FNM_CASEFOLD = 1 << 3;
export const FNM_LEADING_DIR = 1 << 4;
export const FNM_EXTMATCH = 1 << 5; // GNU拡張パターン

/** fnmatch戻り値 */
export const FNM_NOMATCH = 1;

/**
 * POSIX fnmatch(3) 準拠のパターンマッチング
 *
 * @param pattern - ワイルドカードパターン
 * @param string - マッチ対象文字列
 * @param flags - FNM_* フラグの組み合わせ
 * @returns 0ならマッチ、FNM_NOMATCHなら不一致
 */
export function fnmatch(pattern: string, string: string, flags = 0): number {
  const caseFold = (flags & FNM_CASEFOLD) !== 0;
  const pathname = (flags & FNM_PATHNAME) !== 0;
  const period = (flags & FNM_PERIOD) !== 0;
  const noescape = (flags & FNM_NOESCAPE) !== 0;

  // 大文字小文字を無視する場合は両方を小文字に
  let normalizedPattern = pattern;
  let normalizedString = string;
  if (caseFold) {
    normalizedPattern = pattern.toLowerCase();
    normalizedString = string.toLowerCase();
  }
  const p = Array.from(normalizedPattern);
  const s = Array.from(normalizedString);

  if (fnmatchInternal(p, 0, s, 0, pathname, period, noescape)) {
    return 0;
  }
  return FNM_NOMATCH;
}

/**
 * 内部マッチング関数（再帰）
 */
function fnmatchInternal(
  pattern: string[],
  pi: number,
  string: string[],
  si: number,
  pathname: boolean,
  period: boolean,
  noescape: boolean
): boolean {
  while (pi < pattern.length) {
    const pc = pattern[pi];

    // 文字列の終端チェック
    if (si >= string.length) {
      // パターンの残りが*のみなら一致
      if (pc === '*') {
        pi++;
        // 連続する*をスキップ
        while (pi < pattern.length && pattern[pi] === '*') pi++;
        if (pi >= pattern.length) return true;
        continue;
      }
      return false;
    }

    const sc = string[si];

    // 先頭ドットの特別扱い
    if (period && sc === '.' && (si === 0 || (pathname && string[si - 1] === '/'))) {
      const escapedDot = !noescape && pc === '\\' && pattern[pi + 1] === '.';
      if (pc !== '.' && !escapedDot) return false;
    }

    switch (pc) {
      case '?':
        // ?はスラッシュ以外の任意の1文字（pathnameモード時）
        if (pathname && sc === '/') return false;
        pi++;
        si++;
        break;

      case '*': {
        // 連続する*をスキップ
        while (pi + 1 < pattern.length && pattern[pi + 1] === '*') pi++;
        pi++;

        // パターン終端なら残り全部マッチ（ただしpathname時は/を含まない場合のみ）
        if (pi >= pattern.length) {
          if (pathname) {
            return !string.slice(si).includes('/');
          }
          return true;
        }

        // 残りのパターンと文字列の各位置でマッチを試行
        for (let i = si; i <= string.length; i++) {
          // pathnameモードでは/を越えない
          if (pathname && i > si && string[i - 1] === '/') break;

          if (fnmatchInternal(pattern, pi, string, i, pathname, period, noescape)) {
            return true;
          }
        }
        return false;
      }

      case '[': {
        // 文字クラス
        if (pathname && sc === '/') return false;
        const result = matchBracket(pattern, pi, sc, noescape);
        if (!result.valid) {
          if (pc !== sc) return false;
          pi++;
          si++;
          break;
        }
        if (!result.matched) return false;
        pi = result.newPi;
        si++;
        break;
      }

      case '\\':
        if (!noescape && pi + 1 < pattern.length) {
          pi++;
          if (pattern[pi] !== sc) return false;
          pi++;
          si++;
        } else {
          if (pc !== sc) return false;
          pi++;
          si++;
        }
        break;

      default:
        if (pc !== sc) return false;
        pi++;
        si++;
        break;
    }
  }

  // パターン終端で文字列も終端ならマッチ
  return si >= string.length;
}

/**
 * 文字クラス [...] のマッチング
 */
function matchBracket(
  pattern: string[],
  pi: number,
  char: string,
  noescape: boolean
): { matched: boolean; newPi: number; valid: boolean } {
  const alphaClass = pattern.slice(pi, pi + 11).join('') === '[[:alpha:]]';
  if (alphaClass) {
    return {
      matched: /^\p{Alphabetic}$/u.test(char),
      newPi: pi + 11,
      valid: true,
    };
  }

  pi++; // '[' をスキップ

  let negate = false;
  if (pi < pattern.length && (pattern[pi] === '!' || pattern[pi] === '^')) {
    negate = true;
    pi++;
  }

  let matched = false;
  let first = true;
  let closed = false;

  while (pi < pattern.length) {
    const c = pattern[pi];

    // 最初の文字でなければ']'で終了
    if (c === ']' && !first) {
      pi++;
      closed = true;
      break;
    }
    first = false;

    // 範囲指定 a-z
    if (pi + 2 < pattern.length && pattern[pi + 1] === '-' && pattern[pi + 2] !== ']') {
      const start = c;
      const end = pattern[pi + 2];
      if (char >= start && char <= end) {
        matched = true;
      }
      pi += 3;
      continue;
    }

    // エスケープ
    let matchChar = c;
    if (!noescape && c === '\\' && pi + 1 < pattern.length) {
      pi++;
      matchChar = pattern[pi];
    }

    if (char === matchChar) {
      matched = true;
    }
    pi++;
  }

  let finalMatch = matched;
  if (negate) {
    finalMatch = !matched;
  }
  return { matched: finalMatch, newPi: pi, valid: closed };
}

/**
 * fnmatchパターンを正規表現に変換
 * 高速なマッチングが必要な場合に使用
 *
 * @param pattern - fnmatchパターン
 * @param flags - FNM_* フラグ
 * @returns 正規表現オブジェクト
 */
export function fnmatchToRegExp(pattern: string, flags = 0): RegExp {
  const caseFold = (flags & FNM_CASEFOLD) !== 0;
  const pathname = (flags & FNM_PATHNAME) !== 0;
  const noescape = (flags & FNM_NOESCAPE) !== 0;

  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];

    switch (c) {
      case '*':
        // 連続する*を1つにまとめる
        while (i + 1 < pattern.length && pattern[i + 1] === '*') i++;
        if (pathname) {
          regex += '[^/]*';
        } else {
          regex += '.*';
        }
        break;

      case '?':
        if (pathname) {
          regex += '[^/]';
        } else {
          regex += '.';
        }
        break;

      case '[': {
        const alphaClass = pattern.slice(i, i + 11) === '[[:alpha:]]';
        if (alphaClass) {
          regex += '\\p{Alphabetic}';
          i += 10;
          break;
        }

        let j = i + 1;
        let bracket = '[';
        let first = true;
        let closed = false;

        if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) {
          bracket += '^';
          j++;
        }

        while (j < pattern.length) {
          if (pattern[j] === ']' && !first) {
            j++;
            closed = true;
            break;
          }

          const bc = pattern[j];
          first = false;
          if (bc === ']') {
            bracket += '\\]';
            j++;
            continue;
          }

          if (!noescape && bc === '\\' && j + 1 < pattern.length) {
            bracket += `\\${pattern[j + 1]}`;
            j += 2;
          } else {
            // 正規表現で特殊な文字をエスケープ
            if (bc === '\\' || bc === '^' || bc === '-') {
              bracket += '\\';
            }
            bracket += bc;
            j++;
          }
        }

        if (!closed) {
          regex += escapeRegex(c);
          break;
        }

        bracket += ']';
        regex += bracket;
        i = j - 1;
        break;
      }

      case '\\':
        if (!noescape && i + 1 < pattern.length) {
          i++;
          regex += `\\${escapeRegex(pattern[i])}`;
        } else {
          regex += '\\\\';
        }
        break;

      default:
        regex += escapeRegex(c);
        break;
    }
    i++;
  }

  let regexpFlags = 'u';
  if (caseFold) {
    regexpFlags = 'iu';
  }
  return new RegExp(`^${regex}$`, regexpFlags);
}

/**
 * 正規表現のメタ文字をエスケープ
 */
function escapeRegex(char: string): string {
  if ('.+^${}()|[]\\'.includes(char)) {
    return `\\${char}`;
  }
  return char;
}

/**
 * basename用のfnmatch（ファイル名のみマッチ）
 */
export function fnmatchBasename(pattern: string, path: string, flags = 0): number {
  const basename = path.split('/').pop() || path;
  return fnmatch(pattern, basename, flags);
}

/**
 * パス用のfnmatch（パス全体でマッチ）
 */
export function fnmatchPath(pattern: string, path: string, flags = 0): number {
  return fnmatch(pattern, path, flags | FNM_PATHNAME);
}
