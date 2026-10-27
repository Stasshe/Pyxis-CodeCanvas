# Terminal Vim

Terminal上の軽量なvim風editor。vimscript、設定、pluginはない。実装は`src/engine/system/commands/vim/`。

## 起動と保存

- `vim <file>`が1つのsegmentだけの行のとき、Terminalがshellより先に処理する。pipeline、script、`&&`の中では`command not found`。
- file引数は1つだけ。複数fileは明示的なerrorで拒否する。
- pathはshellのcwdから解決する。存在しなければ空bufferで開く。binary判定されたfileは開けない。
- alternate screenを使い、終了後もscrollbackを保つ。終了時はalternate screenを戻してpromptを表示する。
- 改行スタイル（LF/CRLF）を保持する。全ての行末がCRLFならCRLFで保存し、LF/CRLFが混在する場合はLFで保存する。単独CRや混在行末中のCRは本文データとして保持する。保存時は空でないfileにfinal newlineを付け、空bufferは0 bytesで保存する。末尾LFをphantom行として表示しない。保存に失敗したら終了しない。

## 操作

| mode | 操作 |
|---|---|
| NORMAL | `h j k l`と矢印、`w b e`、`0 $`、`gg G`、`i a A I`、`o O`、`x`、`r<char>`、`D`、`dd`、`yy`、`p`（行yankなら下の行、文字なら後ろ）、`u`、Ctrl+R、`n N`、`v`、`:`、`/` |
| INSERT | 文字、Enter、Tab、Backspace（行結合）、Delete、矢印、Home/End、Escで列を1戻してNORMALへ |
| VISUAL | inclusiveな文字範囲。`h j k l`、`d`/`x`、`y` |
| COMMAND | `:w`/`:w!`、`:wq`/`:wq!`、`:x`/`:x!`（変更時だけ保存）、`:q`（未保存なら警告）、`:q!`、`:N`、`:s/pat/rep[/g]`、`:%s/pat/rep[/g]` |

- `w`/`b`/`e`のword境界はUnicode code point単位で走査する。検索`/pattern`と置換のpatternはJavaScriptのUnicode mode正規表現（`u` flag）、置換文字列もJavaScriptの`$&`・`$1`の意味。`/`のescapeはできない。検索は前方のみで末尾から先頭へ折り返す。zero-width matchの検索位置は次のcode pointへ進め、UTF-16 surrogate pairを分断しない。
- substituteは末尾の`/`を省略でき、`/g`で各行の全一致を置換する。置換は行単位で適用し、newlineをまたぐpatternはmatchしない。空patternは以前の検索patternを再利用せず、errorにする。完了時は置換したmatch数を表示する。保存・終了・通常のEx commandでは末尾空白を無視するが、`/search`と`:s`/`:%s`のpattern・replacementでは末尾空白を保持する。
- `dd`・`yy`は2打鍵目を時間制限なしで待つ。唯一の行に`dd`を実行すると空bufferになり、保存結果は0 bytes。`r<char>`は現在のgraphemeを1文字で置き換える。
- INSERTに入ってから出るまでが1つのundo単位。深さ100。undo後に新しい編集をするとredo履歴を破棄する。保存後もundo履歴を保持し、modifiedは現在内容と保存内容の比較で決まる。
- NORMALの`"`・`q`・`@`とVISUALの`"`・`@`で始まるregister/macro prefixは未対応。prefix後の入力をEscまでblockしてerrorを表示する。VISUALの`q`はno-op。
- NORMAL/VISUAL modeの`1`〜`9` count prefix、NORMAL change command `c`、Visual text object prefix `i`/`a`、`.` repeatは未対応。該当prefix後の入力をEscまでblockしてerrorを表示する。`0`はNORMALの行頭移動。text object（`iw`/`aw`など）もない。
- window split（`:split`/`:vsplit`）とEx command separator `|`は未対応で、commandを実行せずerrorにする。
- ない: `dw` `cw` `J` `~` `>>`、`V`、Ctrl+V、mark、`?`、`:w file`、`:wa`、`:qa`、`:e`、`:set`、`%`以外の範囲、syntax highlight。

## 描画

Vimがactiveな間はxtermがキー入力を受け取り、global app shortcutは割り込まない。`VimEditor`は`term.onData`を直接購読し、描画とgrapheme境界処理はrenderer/text helperへ分ける。編集境界は`Intl.Segmenter`のgrapheme単位で、INSERTでは結合文字やZWJでつながる列も1 graphemeとして扱う。表示セル幅はxtermのactive Unicode providerと共有するため、編集境界と端末幅判定を分離しつつcursor位置を一致させる。縦移動はsource offsetではなく表示cell columnを目標にし、短い行を挟んでも目標を保つ。`$`の後は各行末を目標にし、`e`など明示的なカーソル移動で現在の表示columnを目標に戻す。本文は範囲外を`~`で示し、tabは8桁境界、制御文字は安全なcaret表記、VISUAL範囲は反転表示する。resizeで再描画し、下部panelのEscボタンは`pressEsc()`を呼ぶ。
