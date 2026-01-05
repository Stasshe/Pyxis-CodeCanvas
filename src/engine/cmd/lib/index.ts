/**
 * 共通ライブラリ エクスポート
 *
 * POSIXユーティリティ群の共通基盤
 */

// fnmatch - パターンマッチング
export {
  fnmatch,
  fnmatchToRegExp,
  fnmatchBasename,
  fnmatchPath,
  FNM_NOESCAPE,
  FNM_PATHNAME,
  FNM_PERIOD,
  FNM_CASEFOLD,
  FNM_LEADING_DIR,
  FNM_EXTMATCH,
  FNM_NOMATCH,
} from './fnmatch';

// getopt - オプションパーサー
export { GetOpt, parseArgs } from './getopt';
export type { ParsedOption, OptionDef } from './getopt';

// expr - 式評価
export {
  evaluate,
  ExprBuilder,
  TokenStream,
  ExprParser,
} from './expr';
export type {
  EvalContext,
  ExprNode,
  ExprNodeKind,
  PredicateNode,
  AndNode,
  OrNode,
  NotNode,
  ConstNode,
  Expression,
} from './expr';
