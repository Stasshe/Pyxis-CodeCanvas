// AI Agent用のプロンプトテンプレート

const SYSTEM_PROMPT = `あなたは優秀なコード編集アシスタントです。
ユーザーからコードの編集指示を受けて、適切な変更を提案してください。

重要: 必ず以下の形式で回答してください。この形式を厳密に守ってください。

制約:
- 変更は最小限に留める
- 既存のコードスタイルに合わせる
- 変更理由を簡潔に説明する

回答形式（必須）:
変更が必要な各ファイルについて、必ず以下の正確な形式で回答してください:

## 変更ファイル: [ファイルパス]

**変更理由**: [変更理由の説明]

<AI_EDIT_CONTENT_START:[ファイルパス]>
[変更後のファイル全体の内容をここに記述]
<AI_EDIT_CONTENT_END:[ファイルパス]>

---

注意事項:
- ## 変更ファイル: と **変更理由**: の後には改行を入れてください
- コードブロックは <AI_EDIT_CONTENT_START:[ファイルパス]> と <AI_EDIT_CONTENT_END:[ファイルパス]> で囲んでください
- [ファイルパス]の部分には、## 変更ファイル: に記載したものと同じファイルパスを記述してください
- これらのタグは絶対に変更・省略しないでください
- ファイルパスは提供されたパスを正確にコピーしてください

必ずマークダウン形式で、上記の構造を守って回答してください。`;

export const ASK_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  question: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string }>
) => {
  // 直近5件のメッセージをまとめる
  const history =
    previousMessages && previousMessages.length > 0
      ? previousMessages
          .slice(-5)
          .map(
            msg =>
              `### ${msg.type === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.mode === 'edit' ? '編集' : '会話'}\n${msg.content}`
          )
          .join('\n\n')
      : '';

  const fileContexts = files
    .map(
      file => `
## ファイル: ${file.path}
<AI_EDIT_CONTENT_START:${file.path}>
${file.content}
<AI_EDIT_CONTENT_END:${file.path}>
`
    )
    .join('\n');

  return `あなたは優秀なコードアシスタント。ユーザーの質問に対して、ファイル内容や履歴を参考に、分かりやすく回答しろ。ユーザーの母国語に合わせて。

${history ? `## これまでの会話履歴\n${history}\n` : ''}

${fileContexts ? `## 提供されたファイル\n${fileContexts}\n` : ''}

## 質問
${question}

---
回答は分かりやすく簡潔にお願いします。コード例が必要な場合は適切なコードブロックを使ってください。`;
};

export const EDIT_PROMPT_TEMPLATE = (
  files: Array<{ path: string; content: string }>,
  instruction: string,
  previousMessages?: Array<{ type: string; content: string; mode?: string }>
) => {
  // 直近5件のメッセージをまとめる
  const history =
    previousMessages && previousMessages.length > 0
      ? previousMessages
          .slice(-5)
          .map(
            msg =>
              `### ${msg.type === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.mode === 'edit' ? '編集' : '会話'}\n${msg.content}`
          )
          .join('\n\n')
      : '';

  const fileContexts = files
    .map(
      file => `
## ファイル: ${file.path}
<AI_EDIT_CONTENT_START:${file.path}>
${file.content}
<AI_EDIT_CONTENT_END:${file.path}>
`
    )
    .join('\n');

  return `${SYSTEM_PROMPT}

${history ? `## これまでの会話履歴\n${history}\n` : ''}

## 提供されたファイル
${fileContexts}

## 編集指示
${instruction}

---
新規ファイルを作成する場合は、必ず「新規ファイル」と明記してください。

新規ファイルの場合の回答形式:
## 変更ファイル: [新規作成するファイルパス]
**変更理由**: 新規ファイルの作成
<AI_EDIT_CONTENT_START:[新規作成するファイルパス]>
[新規ファイルの全内容]
<AI_EDIT_CONTENT_END:[新規作成するファイルパス]>
---

重要: 
- この形式を厳密に守ってください
- 新規ファイルの場合は「新規ファイル」と必ず明記してください
- コードブロックは <AI_EDIT_CONTENT_START:[ファイルパス]> と <AI_EDIT_CONTENT_END:[ファイルパス]> で囲んでください
- 複数ファイルの場合は上記ブロックを繰り返してください
- 各ファイルブロックの最後には --- を記載してください`;
};
