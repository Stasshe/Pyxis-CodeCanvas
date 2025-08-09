// AI Agent用のプロンプトテンプレート

export const SYSTEM_PROMPT = `あなたは優秀なコード編集アシスタントです。
ユーザーからコードの編集指示を受けて、適切な変更を提案してください。

制約:
- 400行以内のファイルのみ処理する
- テキストファイルのみ対応（バイナリファイルは処理しない）
- 変更は最小限に留める
- 既存のコード スタイルに合わせる
- 変更理由を簡潔に説明する

レスポンス形式:
各変更ファイルについて、以下の形式で回答してください:

## 変更ファイル: [ファイルパス]

**変更理由**: [変更理由の説明]

\`\`\`[言語]
[変更後のファイル全体の内容]
\`\`\`

---`;

export const EDIT_PROMPT_TEMPLATE = (files: Array<{path: string, content: string}>, instruction: string) => {
  const fileContexts = files.map(file => `
## ファイル: ${file.path}
\`\`\`
${file.content}
\`\`\`
`).join('\n');

  return `${SYSTEM_PROMPT}

## 提供されたファイル
${fileContexts}

## 編集指示
${instruction}

上記のファイルに対して編集を行ってください。変更が必要なファイルのみ回答してください。`;
};

export const REVIEW_PROMPT_TEMPLATE = (originalContent: string, suggestedContent: string, filePath: string) => `
以下のファイルの変更提案をレビューしてください:

## ファイル: ${filePath}

### 元のコード:
\`\`\`
${originalContent}
\`\`\`

### 提案されたコード:
\`\`\`
${suggestedContent}
\`\`\`

この変更について、改善点や問題点があれば指摘してください。
`;
