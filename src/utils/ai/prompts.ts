// AI Agent用のプロンプトテンプレート

export const SYSTEM_PROMPT = `あなたは優秀なコード編集アシスタントです。
ユーザーからコードの編集指示を受けて、適切な変更を提案してください。

重要: 必ず以下の形式で回答してください。この形式を厳密に守ってください。

制約:
- 400行以内のファイルのみ処理する
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

export const EDIT_PROMPT_TEMPLATE = (
  files: Array<{path: string, content: string}>,
  instruction: string,
  previousMessages?: Array<{type: string, content: string, mode?: string}>
) => {
  // 直近5件のメッセージをまとめる
  const history = previousMessages && previousMessages.length > 0
    ? previousMessages.slice(-5).map(msg =>
        `### ${msg.type === 'user' ? 'ユーザー' : 'アシスタント'}: ${msg.mode === 'edit' ? '編集' : '会話'}\n${msg.content}`
      ).join('\n\n')
    : '';

  const fileContexts = files.map(file => `
## ファイル: ${file.path}
<AI_EDIT_CONTENT_START:${file.path}>
${file.content}
<AI_EDIT_CONTENT_END:${file.path}>
`).join('\n');

  return `${SYSTEM_PROMPT}

${history ? `## これまでの会話履歴\n${history}\n` : ''}

## 提供されたファイル
${fileContexts}

## 編集指示
${instruction}

上記のファイルに対して編集を行ってください。変更が必要なファイルのみ、必ず以下の形式で回答してください:

## 変更ファイル: [上記に記載された完全なファイルパスをそのまま使用してください]

**変更理由**: [変更理由の詳細説明]

<AI_EDIT_CONTENT_START:[上記に記載された完全なファイルパス]>
[変更後のファイル全体の内容]
<AI_EDIT_CONTENT_END:[上記に記載された完全なファイルパス]>

---

重要: 
- この形式を厳密に守ってください
- ファイルパスは上記のファイル一覧で ## ファイル: の後に記載されたパスを正確にコピーしてください
- **変更理由**: の後には必ず改行を入れてください
- コードブロックは <AI_EDIT_CONTENT_START:[ファイルパス]> と <AI_EDIT_CONTENT_END:[ファイルパス]> で囲んでください
- 複数ファイルの場合は上記ブロックを繰り返してください
- 各ファイルブロックの最後には --- を記載してください`;
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
