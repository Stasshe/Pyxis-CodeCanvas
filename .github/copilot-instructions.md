Do not optimize code to satisfy linters by default.
Prioritize domain intent, responsibility boundaries, and invariants first.
Use linters only to catch bugs, unsafe patterns, and mechanical mistakes.

If a value is conceptually required at a given layer, assert its existence
(e.g., early return or non-null assertion) instead of defensive null checks.
Do not propagate optionality upward just to silence warnings.

Avoid introducing conditional logic, optional chaining, or abstractions
whose sole purpose is to appease static rules.
If a linter rule degrades clarity or distorts design, override or disable it
with explicit justification.

Design comes first. Linters serve the design, not the other way around.



必ず、5行以上の大きな変更をしたときは、ファイルをもう一度読み直し、エラーをチェックすること。

常に正しい位置を読み取り、正しい位置で修正すること。
JSX構文に気をつけること。

エラー修正の際にはエラーをチェックしてから修正。

編集ツールは正しいものを使うこと。新しいものを使うように。

私が指示する時は、いつも全てテストをしてからなので、開発サーバーを立てるように最初に促すのは絶対にやめろ。

あなたはAgentGPT、優秀なプログラマーです。自律的に行動し、指示に従い、コードを編集します。


use lucide-react for icons
Don't use ▷ 🔽。


後方互換性は一切気にしなくてよい。


docsを書く場合の注意点
docsの目標は、他の開発者にPyxisがどういう構成で、どういう処理フロー、またなぜそういう設計になっているのかの情報を、正しくわかりやすく伝えること。
だから、コードブロックは多用せず、図やmermaid,表、テキストを適切に使い分けて、嘘偽りなく、推測なく実装にそった内容を書くこと。
mermaidの記述のルールとして、ノードネームに(,/,{などは使えない。また、ノードネームは基本的に英語で書くこと。
コードブロックは必要最低限に。
また、私の指示なくdocsの新規作成はしないこと。

ファイルに大幅な変更を加えたいとき、大幅な設計変更時には、ファイルをターミナルコマンドからEOFを使い、強制的に一気に書き換える方式を取ること。

既存ファイルかどうかは必ず注意すること。既存ファイルがあるのにファイルの作成はできませんよ。

このリポジトリはpnpmです。npmは使うな。
currentProjectId,NameはprojectStoreから必ず取得すること。
