/**
 * expr - POSIX式評価ライブラリ
 *
 * find, test, [, expr など複数コマンドで使用される
 * 論理式評価の共通基盤。
 *
 * 式の構造:
 *   - 述語（predicate）: 単一のテスト条件
 *   - 演算子: AND, OR, NOT
 *   - グループ化: ( )
 */

/**
 * 評価コンテキスト - 各述語に渡される情報
 */
export interface EvalContext {
  [key: string]: unknown;
}

/**
 * 式ノードの種類
 */
export type ExprNodeKind = 'predicate' | 'and' | 'or' | 'not' | 'true' | 'false';

/**
 * 式ノードの基底インターフェース
 */
export interface ExprNode {
  kind: ExprNodeKind;
}

/**
 * 述語ノード - 実際のテスト条件
 */
export interface PredicateNode extends ExprNode {
  kind: 'predicate';
  name: string;
  args: unknown[];
  evaluate: (ctx: EvalContext) => boolean;
}

/**
 * AND演算子ノード
 */
export interface AndNode extends ExprNode {
  kind: 'and';
  left: ExprNode;
  right: ExprNode;
}

/**
 * OR演算子ノード
 */
export interface OrNode extends ExprNode {
  kind: 'or';
  left: ExprNode;
  right: ExprNode;
}

/**
 * NOT演算子ノード
 */
export interface NotNode extends ExprNode {
  kind: 'not';
  operand: ExprNode;
}

/**
 * 定数ノード
 */
export interface ConstNode extends ExprNode {
  kind: 'true' | 'false';
}

/**
 * 式ノードの型ユニオン
 */
export type Expression = PredicateNode | AndNode | OrNode | NotNode | ConstNode;

/**
 * 式を評価
 */
export function evaluate(expr: Expression | null, ctx: EvalContext): boolean {
  if (!expr) return true;

  switch (expr.kind) {
    case 'true':
      return true;

    case 'false':
      return false;

    case 'predicate':
      return expr.evaluate(ctx);

    case 'and':
      return evaluate(expr.left as Expression, ctx) && evaluate(expr.right as Expression, ctx);

    case 'or':
      return evaluate(expr.left as Expression, ctx) || evaluate(expr.right as Expression, ctx);

    case 'not':
      return !evaluate(expr.operand as Expression, ctx);

    default:
      return true;
  }
}

/**
 * 式ビルダー - 式を構築するためのヘルパー
 */
export class ExprBuilder {
  /**
   * AND式を作成
   */
  static and(left: Expression, right: Expression): AndNode {
    return { kind: 'and', left, right };
  }

  /**
   * OR式を作成
   */
  static or(left: Expression, right: Expression): OrNode {
    return { kind: 'or', left, right };
  }

  /**
   * NOT式を作成
   */
  static not(operand: Expression): NotNode {
    return { kind: 'not', operand };
  }

  /**
   * 述語を作成
   */
  static predicate(
    name: string,
    args: unknown[],
    evaluate: (ctx: EvalContext) => boolean
  ): PredicateNode {
    return { kind: 'predicate', name, args, evaluate };
  }

  /**
   * 定数TRUEを作成
   */
  static true(): ConstNode {
    return { kind: 'true' };
  }

  /**
   * 定数FALSEを作成
   */
  static false(): ConstNode {
    return { kind: 'false' };
  }

  /**
   * 複数の式をANDで結合
   */
  static andAll(exprs: Expression[]): Expression {
    if (exprs.length === 0) return ExprBuilder.true();
    if (exprs.length === 1) return exprs[0];
    return exprs.reduce((acc, expr) => ExprBuilder.and(acc, expr));
  }

  /**
   * 複数の式をORで結合
   */
  static orAll(exprs: Expression[]): Expression {
    if (exprs.length === 0) return ExprBuilder.false();
    if (exprs.length === 1) return exprs[0];
    return exprs.reduce((acc, expr) => ExprBuilder.or(acc, expr));
  }
}

/**
 * トークンストリーム - パーサーで使用
 */
export class TokenStream {
  private tokens: string[];
  private pos = 0;

  constructor(tokens: string[]) {
    this.tokens = tokens;
  }

  peek(): string | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  consume(): string | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos++] : null;
  }

  hasMore(): boolean {
    return this.pos < this.tokens.length;
  }

  position(): number {
    return this.pos;
  }

  remaining(): string[] {
    return this.tokens.slice(this.pos);
  }
}

/**
 * 汎用式パーサーの基底クラス
 * 各コマンド（find, test等）がこれを継承してパーサーを実装
 */
export abstract class ExprParser<T extends EvalContext> {
  protected stream: TokenStream;

  constructor(tokens: string[]) {
    this.stream = new TokenStream(tokens);
  }

  /**
   * 式をパース
   */
  parse(): Expression | null {
    if (!this.stream.hasMore()) return null;
    return this.parseOrExpr();
  }

  /**
   * OR式: and_expr ( '-o' and_expr )*
   */
  protected parseOrExpr(): Expression | null {
    let left = this.parseAndExpr();
    if (!left) return null;

    while (this.isOrOperator(this.stream.peek())) {
      this.stream.consume();
      const right = this.parseAndExpr();
      if (!right) break;
      left = ExprBuilder.or(left, right);
    }

    return left;
  }

  /**
   * AND式: unary_expr ( [ '-a' ] unary_expr )*
   */
  protected parseAndExpr(): Expression | null {
    let left = this.parseUnaryExpr();
    if (!left) return null;

    while (this.stream.hasMore()) {
      const tok = this.stream.peek();
      if (this.isOrOperator(tok) || this.isCloseGroup(tok)) break;

      if (this.isAndOperator(tok)) {
        this.stream.consume();
      }

      const right = this.parseUnaryExpr();
      if (!right) break;
      left = ExprBuilder.and(left, right);
    }

    return left;
  }

  /**
   * 単項式: '!' unary_expr | primary
   */
  protected parseUnaryExpr(): Expression | null {
    const tok = this.stream.peek();

    if (this.isNotOperator(tok)) {
      this.stream.consume();
      const operand = this.parseUnaryExpr();
      if (!operand) return null;
      return ExprBuilder.not(operand);
    }

    return this.parsePrimary();
  }

  /**
   * プライマリ式: '(' or_expr ')' | predicate
   */
  protected parsePrimary(): Expression | null {
    const tok = this.stream.peek();
    if (!tok) return null;

    if (this.isOpenGroup(tok)) {
      this.stream.consume();
      const inner = this.parseOrExpr();
      if (this.isCloseGroup(this.stream.peek())) {
        this.stream.consume();
      }
      return inner;
    }

    return this.parsePredicate();
  }

  /**
   * OR演算子かどうか（サブクラスでオーバーライド可能）
   */
  protected isOrOperator(tok: string | null): boolean {
    return tok === '-o' || tok === '-or';
  }

  /**
   * AND演算子かどうか（サブクラスでオーバーライド可能）
   */
  protected isAndOperator(tok: string | null): boolean {
    return tok === '-a' || tok === '-and';
  }

  /**
   * NOT演算子かどうか（サブクラスでオーバーライド可能）
   */
  protected isNotOperator(tok: string | null): boolean {
    return tok === '!' || tok === '-not';
  }

  /**
   * 開きグループかどうか
   */
  protected isOpenGroup(tok: string | null): boolean {
    return tok === '(' || tok === '\\(';
  }

  /**
   * 閉じグループかどうか
   */
  protected isCloseGroup(tok: string | null): boolean {
    return tok === ')' || tok === '\\)';
  }

  /**
   * 述語をパース（サブクラスで実装必須）
   */
  protected abstract parsePredicate(): Expression | null;
}
