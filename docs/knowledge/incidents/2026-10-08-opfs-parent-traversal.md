# OPFSの親directoryを毎回rootから辿っていた (2026-10-08)

## 症状

Runtime Workerを使い回すようにした後も、24個のCommonJS `require`と実package `diff@9.0.0`の実行がOPFS移行前のmain thread実行より遅かった（warm中央値 35.4 ms・56.7 ms、移行前 17.9 ms・38.3 ms）。

## 原因

FS Coreはfile操作のたびに、親directoryのhandleを`/`から1 segmentずつ`getDirectoryHandle`で取り直していた。module解決は同じdirectoryの兄弟fileを連続して読むので、同じroot→parentの探索がFS時間の大半を占めた。RPC回数やread回数は変わっておらず、1回あたりのCore時間が問題だった。

## 修正

直近に成功したpathのdirectory handle chainだけを保持し、次のpathとの共通prefixを再利用する。

- 保持はpath 1本分。file handleと内容はcacheしない。
- 初期化とdirectory削除でepochを進めてchainを捨てる。lookup開始時とepochが違えば、そのlookupはchainを更新しない。削除と並行した古いlookupが無効なhandleを戻せない。

結果はrequires 35.4→18.8 ms、diff 56.7→38.0 ms。FS Coreの呼出し時間合計は34.2→15.7 ms、49.7→22.7 msで、RPC/read回数は不変だった。

## 再発防止

- OPFSのhandle取得は無料ではない。小fileを大量に読む経路（module解決、npm、Git）はpath解決の回数を計測する。
- handle cacheを足す時は、削除・renameによる無効化と、並行lookupによる書き戻しを同時に設計する。

## 根拠

- 修正コミット `3b9f5eee`
- [core.ts](../../../src/engine/core/fs/core.ts) の`directory`と`invalidateDirectories`
- [回帰テスト](../../../tests/engine/core/fs/handles.test.ts)
- 計測値: `scripts/bench/node-runtime/results/runtime-residual.json`
