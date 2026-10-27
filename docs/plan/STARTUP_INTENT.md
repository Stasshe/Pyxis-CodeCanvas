# 起動処理の意図

旧file・node_modules・Git履歴はブラウザ内にしかない。新規profileの起動速度では、Stassheの既存profileでの移行時間を評価できない。移行が数十秒以上かかる間、空のrootは正常処理と停止を区別できなかった。

- HTMLからstatusを表示し、大きなapplication graphはその後に読む。React・i18n・metadataの準備が表示の前提にならないようにする。
- 期限は総時間ではなく進捗のない時間。件数に比例する移行を最後まで進めつつ、Worker・IDB・SWが応答しない起動を止める。timeout後は中断signalとFS Workerの終了で、遅れた処理から次工程へ進まないようにする。
- copyとbyte検証、metadata変換の完了後にだけ旧DB削除を許す。deadlineは検証済みの工程順序を崩さない。
- SWは`clients.claim()`で現在のpageを制御できる。登録からFS port受領までを同じpageで完了させ、過去のcontroller状態やtab内のreload履歴を成立条件にしない。
- consoleを開くと現象が変わるため、診断情報を画面にも残す。各工程の所要時間logで、別originの初回・移行済み・SW更新を比較できるようにする。
