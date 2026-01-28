import { type EvalContext, ExprBuilder, ExprParser, type Expression, evaluate } from '../../lib';
import { UnixCommandBase } from './base';
import { fsPathToAppPath, resolvePath as pathResolve, toFSPath } from '@/engine/core/pathUtils';

/**
 * test - 条件式を評価 (POSIX準拠)
 *
 * 使用法:
 *   test expression
 *   [ expression ]
 *
 * 文字列テスト:
 *   -n STRING      文字列の長さが非ゼロ
 *   -z STRING      文字列の長さがゼロ
 *   STRING         文字列が空でない（-n と同じ）
 *   S1 = S2        文字列が等しい
 *   S1 == S2       文字列が等しい（bashism）
 *   S1 != S2       文字列が等しくない
 *   S1 < S2        S1がS2より辞書順で前
 *   S1 > S2        S1がS2より辞書順で後
 *
 * 整数テスト:
 *   N1 -eq N2      等しい
 *   N1 -ne N2      等しくない
 *   N1 -gt N2      N1 > N2
 *   N1 -ge N2      N1 >= N2
 *   N1 -lt N2      N1 < N2
 *   N1 -le N2      N1 <= N2
 *
 * ファイルテスト:
 *   -e FILE        存在する
 *   -f FILE        通常ファイル
 *   -d FILE        ディレクトリ
 *   -r FILE        読み取り可能
 *   -w FILE        書き込み可能
 *   -x FILE        実行可能
 *   -s FILE        サイズが非ゼロ
 *
 * 論理演算:
 *   ! EXPR         否定
 *   EXPR -a EXPR   AND
 *   EXPR -o EXPR   OR
 *   ( EXPR )       グループ化
 */

interface TestContext extends EvalContext {
  checkFile: (
    path: string
  ) => Promise<{ exists: boolean; isFile: boolean; isDir: boolean; size: number } | null>;
}

/**
 * test用の式パーサー
 */
class TestExprParser extends ExprParser<TestContext> {
  private checkFile: (
    path: string
  ) => Promise<{ exists: boolean; isFile: boolean; isDir: boolean; size: number } | null>;

  constructor(tokens: string[], checkFile: TestContext['checkFile']) {
    super(tokens);
    this.checkFile = checkFile;
  }

  protected isOrOperator(tok: string | null): boolean {
    return tok === '-o';
  }

  protected isAndOperator(tok: string | null): boolean {
    return tok === '-a';
  }

  protected isNotOperator(tok: string | null): boolean {
    return tok === '!';
  }

  protected parsePredicate(): Expression | null {
    const tok = this.stream.peek();
    if (!tok) return null;

    // 単項ファイルテスト
    if (['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h'].includes(tok)) {
      this.stream.consume();
      const path = this.stream.consume();
      if (!path) return ExprBuilder.false();

      const checkFile = this.checkFile;
      return ExprBuilder.predicate(tok, [path], (ctx: EvalContext) => {
        // 非同期なので、事前にチェック結果をコンテキストに入れておく必要あり
        const tc = ctx as TestContext & { fileCache?: Map<string, any> };
        const cached = tc.fileCache?.get(path);
        if (!cached) return false;

        switch (tok) {
          case '-e':
            return cached.exists;
          case '-f':
            return cached.exists && cached.isFile;
          case '-d':
            return cached.exists && cached.isDir;
          case '-r':
            return cached.exists; // 常に読み取り可能と仮定
          case '-w':
            return cached.exists; // 常に書き込み可能と仮定
          case '-x':
            return cached.exists; // 常に実行可能と仮定
          case '-s':
            return cached.exists && cached.size > 0;
          case '-L':
          case '-h':
            return false; // シンボリックリンクは非サポート
          default:
            return false;
        }
      });
    }

    // 単項文字列テスト
    if (tok === '-n') {
      this.stream.consume();
      const str = this.stream.consume() || '';
      return ExprBuilder.predicate('-n', [str], () => str.length > 0);
    }

    if (tok === '-z') {
      this.stream.consume();
      const str = this.stream.consume() || '';
      return ExprBuilder.predicate('-z', [str], () => str.length === 0);
    }

    // 3項式のチェック（先読み）
    const tokens = this.stream.remaining();
    if (tokens.length >= 3) {
      const [left, op, right] = [tokens[0], tokens[1], tokens[2]];

      // 文字列比較
      if (['=', '==', '!=', '<', '>'].includes(op)) {
        this.stream.consume(); // left
        this.stream.consume(); // op
        this.stream.consume(); // right
        return ExprBuilder.predicate(op, [left, right], () => {
          switch (op) {
            case '=':
            case '==':
              return left === right;
            case '!=':
              return left !== right;
            case '<':
              return left < right;
            case '>':
              return left > right;
            default:
              return false;
          }
        });
      }

      // 整数比較
      if (['-eq', '-ne', '-gt', '-ge', '-lt', '-le'].includes(op)) {
        this.stream.consume();
        this.stream.consume();
        this.stream.consume();
        const nl = Number(left);
        const nr = Number(right);
        return ExprBuilder.predicate(op, [left, right], () => {
          if (Number.isNaN(nl) || Number.isNaN(nr)) return false;
          switch (op) {
            case '-eq':
              return nl === nr;
            case '-ne':
              return nl !== nr;
            case '-gt':
              return nl > nr;
            case '-ge':
              return nl >= nr;
            case '-lt':
              return nl < nr;
            case '-le':
              return nl <= nr;
            default:
              return false;
          }
        });
      }
    }

    // 単一の引数 = 非空文字列チェック
    if (!tok.startsWith('-') && tok !== '(' && tok !== ')') {
      this.stream.consume();
      return ExprBuilder.predicate('STRING', [tok], () => tok.length > 0);
    }

    return null;
  }
}

export class TestCommand extends UnixCommandBase {
  /**
   * test式を評価
   * @param args 引数（]が末尾にある場合は除去済み想定）
   * @returns true: 成功(0), false: 失敗(1)
   */
  async evaluate(args: string[]): Promise<boolean> {
    // ] を除去
    let tokens = [...args];
    if (tokens.length > 0 && tokens[tokens.length - 1] === ']') {
      tokens = tokens.slice(0, -1);
    }

    if (tokens.length === 0) {
      return false;
    }

    // ファイルチェック用の関数
    const checkFile = async (path: string) => {
      try {
        const baseApp = fsPathToAppPath(this.currentDir, this.projectName);
        const appPath = pathResolve(baseApp, path);
        const resolvedPath = toFSPath(this.projectName, appPath);
        const exists = await this.exists(resolvedPath);
        if (!exists) return null;

        const isDir = await this.isDirectory(resolvedPath);
        const isFile = await this.isFile(resolvedPath);

        // サイズ取得
        let size = 0;
        if (isFile) {
          const relativePath = appPath;
          const file = await this.getFileFromDB(relativePath);
          if (file) {
            size = file.bufferContent?.byteLength || file.content?.length || 0;
          }
        }

        return { exists, isFile, isDir, size };
      } catch {
        return null;
      }
    };

    // ファイルパスを事前に収集してキャッシュ
    const fileCache = new Map<string, any>();
    const filePaths = this.extractFilePaths(tokens);
    for (const p of filePaths) {
      const result = await checkFile(p);
      fileCache.set(p, result || { exists: false, isFile: false, isDir: false, size: 0 });
    }

    // パーサーで式を構築
    const parser = new TestExprParser(tokens, checkFile);
    const expr = parser.parse();

    if (!expr) {
      // パースできない場合、単一引数は非空チェック
      if (tokens.length === 1) {
        return tokens[0].length > 0;
      }
      return false;
    }

    // 評価
    const ctx: TestContext & { fileCache: Map<string, any> } = {
      checkFile,
      fileCache,
    };

    return evaluate(expr, ctx);
  }

  /**
   * ファイルパスを抽出（-e, -f, -d等の後の引数）
   */
  private extractFilePaths(tokens: string[]): string[] {
    const paths: string[] = [];
    const fileOps = ['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h'];

    for (let i = 0; i < tokens.length; i++) {
      if (fileOps.includes(tokens[i]) && i + 1 < tokens.length) {
        paths.push(tokens[i + 1]);
        i++;
      }
    }

    return paths;
  }

  /**
   * executeは直接使用せず、evaluateを使用
   */
  async execute(args: string[]): Promise<string> {
    const result = await this.evaluate(args);
    if (!result) {
      throw { __silent: true, code: 1 };
    }
    return '';
  }
}
