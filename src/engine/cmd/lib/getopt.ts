/**
 * getopt - POSIX getopt(3) 準拠のオプションパーサー
 *
 * 全コマンドで共通使用するオプション解析ライブラリ。
 * GNU拡張のlong optionsもサポート。
 *
 * 使用例:
 *   const parser = new GetOpt('abc:d::', ['help', 'verbose', 'file=', 'count::']);
 *   for (const opt of parser.parse(args)) {
 *     switch (opt.option) {
 *       case 'a': ...
 *       case 'c': console.log(opt.argument); ...
 *       case 'help': ...
 *     }
 *   }
 *   const positional = parser.remaining();
 */

/**
 * パースされたオプション
 */
export interface ParsedOption {
  /** オプション文字または長いオプション名 */
  option: string;
  /** オプションの引数（あれば） */
  argument: string | null;
}

/**
 * オプション定義
 */
export interface OptionDef {
  /** 短いオプション文字（1文字） */
  short?: string;
  /** 長いオプション名 */
  long?: string;
  /** 引数の要求: 'none' | 'required' | 'optional' */
  argRequired: 'none' | 'required' | 'optional';
}

/**
 * GetOpt クラス - POSIX/GNU getopt互換パーサー
 */
export class GetOpt {
  private shortOpts: Map<string, 'none' | 'required' | 'optional'> = new Map();
  private longOpts: Map<string, 'none' | 'required' | 'optional'> = new Map();
  private args: string[] = [];
  private index = 0;
  private charIndex = 0;
  private _remaining: string[] = [];
  private _errors: string[] = [];

  /**
   * @param optstring - 短いオプション文字列（getopt形式）
   *                    例: "abc:d::" (a,bは引数なし、cは必須引数、dは任意引数)
   * @param longopts - 長いオプションの配列
   *                   例: ['help', 'verbose', 'file=', 'count::']
   *                   (=は必須引数、::は任意引数)
   */
  constructor(optstring = '', longopts: string[] = []) {
    this.parseOptstring(optstring);
    this.parseLongopts(longopts);
  }

  /**
   * 短いオプション文字列をパース
   */
  private parseOptstring(optstring: string): void {
    let i = 0;
    while (i < optstring.length) {
      const c = optstring[i];
      if (c === ':') {
        i++;
        continue;
      }

      let argReq: 'none' | 'required' | 'optional' = 'none';
      if (optstring[i + 1] === ':') {
        if (optstring[i + 2] === ':') {
          argReq = 'optional';
          i += 2;
        } else {
          argReq = 'required';
          i++;
        }
      }
      this.shortOpts.set(c, argReq);
      i++;
    }
  }

  /**
   * 長いオプション配列をパース
   */
  private parseLongopts(longopts: string[]): void {
    for (const opt of longopts) {
      let name = opt;
      let argReq: 'none' | 'required' | 'optional' = 'none';

      if (name.endsWith('::')) {
        argReq = 'optional';
        name = name.slice(0, -2);
      } else if (name.endsWith('=')) {
        argReq = 'required';
        name = name.slice(0, -1);
      }

      this.longOpts.set(name, argReq);
    }
  }

  /**
   * 引数をパースしてオプションを順次返すジェネレーター
   */
  *parse(args: string[]): Generator<ParsedOption> {
    this.args = args;
    this.index = 0;
    this.charIndex = 0;
    this._remaining = [];
    this._errors = [];

    while (this.index < this.args.length) {
      const arg = this.args[this.index];

      // -- でオプション終了
      if (arg === '--') {
        this.index++;
        this._remaining.push(...this.args.slice(this.index));
        break;
      }

      // 長いオプション --xxx
      if (arg.startsWith('--')) {
        const result = this.parseLongOption(arg);
        if (result) yield result;
        this.index++;
        continue;
      }

      // 短いオプション -x または -xyz
      if (arg.startsWith('-') && arg.length > 1) {
        // 短いオプションの連続処理
        for (let i = 1; i < arg.length; i++) {
          const c = arg[i];
          const argReq = this.shortOpts.get(c);

          if (argReq === undefined) {
            this._errors.push(`Unknown option: -${c}`);
            continue;
          }

          let optArg: string | null = null;

          if (argReq === 'required') {
            // 残りの文字があればそれが引数
            if (i + 1 < arg.length) {
              optArg = arg.slice(i + 1);
              i = arg.length; // ループ終了
            } else {
              // 次の引数が必要
              this.index++;
              if (this.index < this.args.length) {
                optArg = this.args[this.index];
              } else {
                this._errors.push(`Option -${c} requires an argument`);
              }
            }
          } else if (argReq === 'optional') {
            // 残りの文字があればそれが引数
            if (i + 1 < arg.length) {
              optArg = arg.slice(i + 1);
              i = arg.length;
            }
          }

          yield { option: c, argument: optArg };
        }
        this.index++;
        continue;
      }

      // オプションでなければ位置引数
      this._remaining.push(arg);
      this.index++;
    }
  }

  /**
   * 長いオプションをパース
   */
  private parseLongOption(arg: string): ParsedOption | null {
    let name = arg.slice(2);
    let optArg: string | null = null;

    // --name=value 形式
    const eqIndex = name.indexOf('=');
    if (eqIndex !== -1) {
      optArg = name.slice(eqIndex + 1);
      name = name.slice(0, eqIndex);
    }

    const argReq = this.longOpts.get(name);
    if (argReq === undefined) {
      this._errors.push(`Unknown option: --${name}`);
      return null;
    }

    if (argReq === 'required' && optArg === null) {
      // 次の引数をチェック
      if (this.index + 1 < this.args.length && !this.args[this.index + 1].startsWith('-')) {
        this.index++;
        optArg = this.args[this.index];
      } else {
        this._errors.push(`Option --${name} requires an argument`);
      }
    }

    return { option: name, argument: optArg };
  }

  /**
   * 残りの位置引数を取得
   */
  remaining(): string[] {
    return this._remaining;
  }

  /**
   * パースエラーを取得
   */
  errors(): string[] {
    return this._errors;
  }
}

/**
 * シンプルなオプションパース（互換性のため）
 * 値を取るオプションも正しく処理
 */
export function parseArgs(
  args: string[],
  optionsWithValue: string[] = []
): {
  flags: Set<string>;
  values: Map<string, string>;
  positional: string[];
} {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  const valueOpts = new Set(optionsWithValue);

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const name = arg.slice(2, eqIndex);
        values.set(`--${name}`, arg.slice(eqIndex + 1));
      } else {
        const name = arg.slice(2);
        if (valueOpts.has(`--${name}`) && i + 1 < args.length) {
          values.set(arg, args[++i]);
        } else {
          flags.add(arg);
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // 短いオプション
      for (let j = 1; j < arg.length; j++) {
        const opt = `-${arg[j]}`;
        if (valueOpts.has(opt)) {
          // 残りの文字または次の引数
          if (j + 1 < arg.length) {
            values.set(opt, arg.slice(j + 1));
            break;
          } else if (i + 1 < args.length) {
            values.set(opt, args[++i]);
          }
        } else {
          flags.add(opt);
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { flags, values, positional };
}
