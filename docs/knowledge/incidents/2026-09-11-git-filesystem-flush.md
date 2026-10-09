# Gitファイルシステムのflush漏れ (2026-09-11)

lightning-fs時代の事故。lightning-fsとGit用のコピー層はOPFS移行で削除済みで、該当コードは現存しない。教訓は現行のOPFS書込みにも当てはまる。

## 症状

Git操作の後、壊れたGit objectに対する`unknown compression method`がcallerに現れることがあった。

## 原因

旧Git用ファイルシステムのflush処理は`fs.sync()`の有無を調べて呼んでいたが、利用中のLightningFSにはそのAPIがなく、flushは何もしていなかった。永続化されないGit objectが残り、破損データをisomorphic-gitが読み直した結果、圧縮形式のエラーとして表面化した。圧縮エラーは原因ではなく、破損に続いて出た二次的なエラー。

## 修正

flushを実在する`fs.promises.flush()`へ変え、Gitの変更操作の後に必ず呼ぶ共通処理を加えた。

## 再発防止

- 永続化APIは、使っているファイルシステムが実際に提供するものを確認して呼ぶ。存在確認で分岐して黙って何もしない実装にしない。
- 現行のFS Coreは書込みごとに`SyncAccessHandle.flush()`してから閉じる（[filesystem](../../domain/filesystem.md#fscoreの内部)）。

## 根拠

- [修正コミット](https://github.com/Stasshe/Pyxis-CodeCanvas/commit/25e2d6ef00c9dc572379b45c95b5ac167ef76bd0)
