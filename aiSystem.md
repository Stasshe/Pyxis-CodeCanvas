aiコンポーネントを作成してください。
geminiを使って、コードの編集などを行えるようにして。

(terminalは無理です。isbufferarrayがfalseのファイルだけを渡すこと。)

vscodeのgithub copilot chatと同じようなシステムで。

monacoeditorに直接編集を適用できる見た目が良い。

複数のファイルコンテキストを渡せるように。（fileselectなどを再利用可能）

----注意点-----

今開いていないファイルに対しても、編集できるよう、dbに直接編集できるように。

それぞれのファイルに、
content以外に、
isAiAgentReview
aiAgentCode
の2つを追加するように。
それぞれのファイルにこれらを追加することによってコードのレビューもできるように。
レビューでは、aiAgentCodeとcontentの差分を、表示・編集するタブコンポーネントが必要です。
独自のdiff,コードブロック処理、それぞれの採用破棄処理が必要です。
レビューでは、aiAgentCodeを編集し、contentは触らないように。
レビューが終わって、適用ボタンを押されたら、isAiAgentReviewをfalse,aiAgentCodeをcontentにコピーし、nullにする。

エージェントモードも搭載予定ですが、とりあえず今の所は、1 responseの、edit modeだけ。（後に実装しやすくなるように工夫して）
一つのファイルは400行くらいになるように、ファイル分割を活用してください。

タブを開く処理は、tab.ts,page.tsなどを参照して。(diffreviewの搭載例が参考になるかも)

また、プロンプト文は編集しやすいよう、これだけ別ファイルにして。
見た目は、themecontextを使用し、スタイリッシュでvscodeっぽいものに。