# Binary fileが複数経路で文字列化された (2026-10-07)

## 症状

PNGなどのbinary、BOM付きtext、UTF-8として不正なbytesを含むfileが、経路によって内容を変えられていた。shellのredirectやpipe、`cat`、Gitのshow・diff・HEAD/index内容、GitHub push、npm tarball展開、移行、download/ZIP、拡張機能のstorage、previewのlocal assetなどが該当した。

## 原因

各経路が独自に`TextDecoder`や`String(chunk)`でbytesを文字列へ変換していた。

| 経路 | 変換の仕方 |
|---|---|
| shellの出力とredirect | stream chunkを`String(chunk)`で文字列化してから連結・書込み |
| `cat` | fileを`readText`で読んで文字列で返す |
| Git show、HEAD・index内容取得 | blobを`TextDecoder`でdecode |
| GitHub push | `isLikelyTextFile`がtextと判定したfileをdecodeしてUTF-8で送信 |

正本がbytesなのに、decodeの判断が呼び出し側ごとに散っていた。判定を誤るか、不正なUTF-8を含むと、置換文字が入ったまま書き戻される。

## 修正

- FS、Git、migration、upload/download、ZIP、npm、runtimeのstreamとpipeをbytesのまま通す。shellの出力はBuffer列として集め、terminalへ表示する時だけstreaming decodeする。
- GitHub pushは全fileをraw bytesからBase64にして送る。
- UIは`readFileContent`で読んだbytesを分類し、textだけdecodeする。拡張子がtextでもbytes検査を省略しない。
- previewのlocal assetはbytesから判定したMIMEでinline化する。

## 再発防止

- decodeしてよい境界は [arch/storage](../../arch/storage.md#bytesの保持) の表に限る。新しい経路は`Uint8Array`を受け渡しの型にし、表示直前までdecodeしない。
- 「textらしい」判定でdecode・再encodeする分岐を作らない。

## 根拠

- 修正コミット `a414a92b`
- [fileBytes.ts](../../../src/engine/core/fileBytes.ts)、[outputHandler.ts](../../../src/engine/cmd/shell/outputHandler.ts)、[TreeBuilder.ts](../../../src/engine/cmd/global/gitOperations/github/TreeBuilder.ts)
- 回帰テスト: `tests/engine/cmd/shell/runtimeBytes.test.ts`、`tests/engine/core/fileBytes.test.ts`、`tests/engine/cmd/global/gitOperations/treeBuilder.test.ts`、`tests/engine/in-ex/exportFolderZip.test.ts`
