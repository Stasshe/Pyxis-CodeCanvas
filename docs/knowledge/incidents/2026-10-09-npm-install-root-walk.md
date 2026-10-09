# npm install後のroot全体walkがpromptを遅らせた (2026-10-09)

## 症状

43 packageのinstallで、installer自体が終わってからterminalのpromptが戻るまでに待ちがあった。

## 原因

Explorerはfile変更eventを受けるたびにworkspace root全体を`walk`し直していた。2026-10-07の修正（`570d1195`）で既存fileの`update`だけはwalk対象から外し、Git stagingの`.git/index`更新によるroot walk（49回の再帰呼出しで327.9 ms）は消えた。create・delete・renameでは引き続き100 ms debounce後にroot全体をwalkしていた。npm installは`node_modules`へ大量のfileを作るので、install完了後にroot全体のwalkがFS Workerのqueueへ積まれた。計測ではworker側のwalkに164.6 msかかり、FS Workerを占有してpromptを遅らせた。

## 修正

Explorerのtreeをfilesystem metadataのprojectionにした。`FileItem`はpath・name・type・childrenだけを持ち、create/delete/renameのevent metadataから構造を直接更新する。中身を知らないfolderが移動で入ってきた時だけそのsubtreeを読む。既存fileの`update`は構造を変えない。修正後の計測ではinstall後のworkspace walkが0回になった。

## 再発防止

- 変更eventの受け手は、eventが運ぶmetadataで済むなら読み直さない。root全体の走査は初回、root切替、明示refreshに限る。
- FS Workerは単一queueなので、UI都合の重い読込は他の全処理を待たせる。

## 根拠

- 修正コミット `570d1195`（updateの除外）、`3258531f`（projection化）
- [projectTree.ts](../../../src/engine/core/projectTree.ts)、[project.ts](../../../src/engine/core/project.ts)
- 回帰テスト: `tests/engine/core/projectTree.test.ts`
- 計測値: `scripts/bench/npm-install/results/terminal-e2e-43-after-profile-trial02.json`、`terminal-e2e-43-final-profile-tree-zero-walk-trial01.json`
