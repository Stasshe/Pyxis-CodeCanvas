// AI Agent用のプロンプトテンプレート

export const SYSTEM_PROMPT = `あなたは優秀なコード編集アシスタントです。
ユーザーからコードの編集指示を受けて、適切な変更を提案してください。

重要: 必ず以下の形式で回答してください。この形式を厳密に守ってください。

制約:
- 400行以内のファイルのみ処理する
- テキストファイルのみ対応（バイナリファイルは処理しない）
- 変更は最小限に留める
- 既存のコードスタイルに合わせる
- 変更理由を簡潔に説明する

回答形式（必須）:
変更が必要な各ファイルについて、必ず以下の正確な形式で回答してください:

## 変更ファイル: [ファイルパス]

**変更理由**: [変更理由の説明]

\`\`\`javascript
[変更後のファイル全体の内容をここに記述]
\`\`\`

---

変更が不要な場合は「変更は必要ありません。」とだけ回答してください。
必ずマークダウン形式で、上記の構造を守って回答してください。`;

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

上記のファイルに対して編集を行ってください。変更が必要なファイルのみ、必ず以下の形式で回答してください:

## 変更ファイル: [正確なファイルパス]

**変更理由**: [変更理由の詳細説明]

\`\`\`typescript
[変更後のファイル全体の内容]
\`\`\`

---

重要: この形式を厳密に守ってください。複数ファイルの場合は上記ブロックを繰り返してください。`;
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

// テスト用の簡単な例
export const EXAMPLE_EDIT_INSTRUCTIONS = [
  'コメントを日本語で追加してください',
  'console.logを追加してデバッグしやすくしてください', 
  'TypeScriptの型注釈を追加してください',
  'エラーハンドリングを改善してください',
  '関数にJSDocコメントを追加してください'
];
