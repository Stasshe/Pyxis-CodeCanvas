import { type EvalContext, ExprBuilder, type Expression, ExprParser, evaluate } from '../../lib';
import { UnixCommandBase, UnixCommandFailure } from './base';

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

interface FileTestResult {
  exists: boolean;
  isFile: boolean;
  isDir: boolean;
  size: number;
}

interface TestContext extends EvalContext {
  checkFile: (path: string) => Promise<FileTestResult | null>;
  fileCache?: Map<string, FileTestResult>;
}

/**
 * test用の式パーサー
 */
class TestExprParser extends ExprParser<TestContext> {
  constructor(tokens: string[]) {
    super(tokens);
  }

  hasRemaining(): boolean {
    return this.stream.hasMore();
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

  protected parseOrExpr(): Expression | null {
    let left = this.parseAndExpr();
    if (!left) return null;

    while (this.isOrOperator(this.stream.peek())) {
      this.stream.consume();
      const right = this.parseAndExpr();
      if (!right) throw new UnixCommandFailure("test: argument expected after '-o'", 2);
      left = ExprBuilder.or(left, right);
    }
    return left;
  }

  protected parseAndExpr(): Expression | null {
    let left = this.parseUnaryExpr();
    if (!left) return null;

    while (
      this.stream.hasMore() &&
      !this.isOrOperator(this.stream.peek()) &&
      !this.isCloseGroup(this.stream.peek())
    ) {
      if (!this.isAndOperator(this.stream.peek())) {
        const token = this.stream.peek();
        throw new UnixCommandFailure(`test: syntax error near '${token}'`, 2);
      }
      this.stream.consume();
      const right = this.parseUnaryExpr();
      if (!right) throw new UnixCommandFailure("test: argument expected after '-a'", 2);
      left = ExprBuilder.and(left, right);
    }
    return left;
  }

  protected parsePrimary(): Expression | null {
    const token = this.stream.peek();
    if (token === null) return null;

    if (this.isOpenGroup(token)) {
      this.stream.consume();
      const expression = this.parseOrExpr();
      if (this.isCloseGroup(this.stream.peek())) this.stream.consume();
      return expression;
    }

    return this.parsePredicate();
  }

  protected parsePredicate(): Expression | null {
    const tok = this.stream.peek();
    if (tok === null) return null;

    // 単項ファイルテスト
    if (['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h'].includes(tok)) {
      this.stream.consume();
      const path = this.stream.consume();
      if (path === null) throw new UnixCommandFailure(`test: missing argument after '${tok}'`, 2);

      return ExprBuilder.predicate(tok, [path], (ctx: EvalContext) => {
        // 非同期なので、事前にチェック結果をコンテキストに入れておく必要あり
        const tc = ctx as TestContext;
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
      const str = this.stream.consume();
      if (str === null) throw new UnixCommandFailure("test: missing argument after '-n'", 2);
      return ExprBuilder.predicate('-n', [str], () => str.length > 0);
    }

    if (tok === '-z') {
      this.stream.consume();
      const str = this.stream.consume();
      if (str === null) throw new UnixCommandFailure("test: missing argument after '-z'", 2);
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
        if (!/^[+-]?\d+$/.test(left) || !/^[+-]?\d+$/.test(right)) {
          throw new UnixCommandFailure(
            `test: integer expression expected: ${left} ${op} ${right}`,
            2
          );
        }
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
      if (['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-n', '-z'].includes(tok)) {
        throw new UnixCommandFailure(`test: unary operator expected: ${tok}`, 2);
      }
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
    const checkFile = async (path: string): Promise<FileTestResult | null> => {
      const resolvedPath = this.resolvePath(path);
      const file = await this.getFile(resolvedPath);
      if (!file) return null;
      return {
        exists: true,
        isDir: file.type === 'folder',
        isFile: file.type === 'file',
        size: file.size,
      };
    };

    // ファイルパスを事前に収集してキャッシュ
    const fileCache = new Map<string, FileTestResult>();
    const filePaths = this.extractFilePaths(tokens);
    for (const p of filePaths) {
      const result = await checkFile(p);
      fileCache.set(p, result || { exists: false, isFile: false, isDir: false, size: 0 });
    }

    // パーサーで式を構築
    const parser = new TestExprParser(tokens);
    const expr = parser.parse();

    if (!expr || parser.hasRemaining()) {
      let nearToken = tokens[0];
      if (parser.hasRemaining()) nearToken = tokens[tokens.length - 1];
      throw new UnixCommandFailure(`test: syntax error near '${nearToken}'`, 2);
    }

    // 評価
    const ctx: TestContext & { fileCache: Map<string, FileTestResult> } = {
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
}
