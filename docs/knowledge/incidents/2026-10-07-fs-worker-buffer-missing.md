# FS WorkerにBufferがなくGit操作が失敗 (2026-10-07)

## 症状

OPFS移行でGitをFS Workerへ移した後、index更新やcommit履歴の読み書きを伴うGit操作がWorker内で失敗し得た。

## 原因

main threadは起動時の`polyfills.ts`で`globalThis.Buffer`を設定している。FS Workerは別のglobal scopeで、この初期化を通らない。isomorphic-gitはglobal `Buffer`を前提に動くため、GitをWorkerへ移した時点で前提が崩れた。main threadで動いていた間は表面化しなかった。

## 修正

`Buffer`をglobalへ代入するだけのmoduleを作り、FS Workerのentryで他のどのmoduleよりも先にimportする。ES moduleのimportは本文より先に評価されるので、entry本文で代入するとisomorphic-gitを含むmoduleの評価に間に合わない。副作用moduleを先頭importにすることで評価順を保証する。

回帰テストは`Buffer`を未定義にした状態でWorker entryを読み込み、endpoint評価時点で`Buffer`が存在すること、実際のGit init・add・commit・status・logが通ることを確認する。

## 再発防止

- Workerはmainのpolyfillを継承しない。新しいWorkerへ処理を移す時は、その処理が依存するglobal（`Buffer`、`process`など）を洗い出す。
- globalのpolyfillは副作用moduleにしてentryの先頭でimportする。

## 根拠

- 修正コミット `570d1195`
- [buffer.ts](../../../src/engine/core/fs/buffer.ts)、[worker.ts](../../../src/engine/core/fs/worker.ts)
- [回帰テスト](../../../tests/engine/core/fs/git.test.ts)
