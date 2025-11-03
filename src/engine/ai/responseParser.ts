// AI応答パーサー - 強化版

export interface ParsedFile {
  path: string;
  originalContent: string;
  suggestedContent: string;
  explanation: string;
}

export interface ParseResult {
  changedFiles: ParsedFile[];
  message: string;
  raw: string;
}

/**
 * パス正規化 - ケースインセンシティブ比較用
 */
export function normalizePath(path: string): string {
  return path.replace(/^\/|\/$/g, '').toLowerCase();
}

/**
 * ファイルパスを抽出（新規ファイル含む）
 */
export function extractFilePathsFromResponse(response: string): string[] {
  const fileBlockPattern = /<AI_EDIT_CONTENT_START:(.+?)>/g;
  const foundPaths: string[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    if (filePath && !seen.has(filePath)) {
      foundPaths.push(filePath);
      seen.add(filePath);
    }
  }
  return foundPaths;
}

/**
 * ファイルブロックを抽出
 */
export function extractFileBlocks(response: string): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = [];

  // 正規パターン: <AI_EDIT_CONTENT_START:path>...<AI_EDIT_CONTENT_END:path>
  const fileBlockPattern =
    /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)\n\s*<AI_EDIT_CONTENT_END:\1>/g;

  let match;
  while ((match = fileBlockPattern.exec(response)) !== null) {
    blocks.push({
      path: match[1].trim(),
      content: match[2],
    });
  }

  // フォールバック: ENDタグのパスが一致しない場合も拾う
  if (blocks.length === 0) {
    const loosePattern = /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)<AI_EDIT_CONTENT_END:(.+?)>/g;
    let looseMatch;
    while ((looseMatch = loosePattern.exec(response)) !== null) {
      const startPath = looseMatch[1].trim();
      const endPath = looseMatch[3].trim();
      // パスが正規化して一致する場合のみ追加
      if (normalizePath(startPath) === normalizePath(endPath)) {
        blocks.push({
          path: startPath,
          content: looseMatch[2].trim(),
        });
      }
    }
  }

  // さらなるフォールバック: 閉じタグがない場合
  if (blocks.length === 0) {
    const unclosedPattern =
      /<AI_EDIT_CONTENT_START:(.+?)>\s*\n([\s\S]*?)(?=<AI_EDIT_CONTENT_START:|$)/g;
    let unclosedMatch;
    while ((unclosedMatch = unclosedPattern.exec(response)) !== null) {
      const path = unclosedMatch[1].trim();
      let content = unclosedMatch[2];
      // ENDタグがあれば削除
      content = content.replace(/<AI_EDIT_CONTENT_END:.+?>[\s\S]*$/, '');
      if (content.trim()) {
        blocks.push({
          path,
          content: content.trim(),
        });
      }
    }
  }

  return blocks;
}

/**
 * 変更理由を抽出
 */
export function extractReasons(response: string): Map<string, string> {
  const reasonMap = new Map<string, string>();

  // パターン1: ## 変更ファイル: ... **変更理由**: ... (最優先、改行まで)
  const reasonPattern1 = /##\s*変更ファイル:\s*(.+?)\s*\n+\*\*変更理由\*\*:\s*(.+?)(?=\n)/gs;

  let match1;
  while ((match1 = reasonPattern1.exec(response)) !== null) {
    const path = match1[1].trim();
    const reason = match1[2].trim();
    reasonMap.set(path, reason);
  }

  // パターン2: **ファイル名**: ... **理由**: ...
  const reasonPattern2 = /\*\*ファイル名\*\*:\s*(.+?)\s*\n+\*\*理由\*\*:\s*(.+?)(?=\n|$)/gs;

  let match2;
  while ((match2 = reasonPattern2.exec(response)) !== null) {
    const path = match2[1].trim();
    const reason = match2[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // パターン3: [ファイルパス] - [理由]
  const reasonPattern3 = /^-?\s*\[?(.+?\.(?:ts|tsx|js|jsx|json|md|css|html))\]?\s*[-:]\s*(.+)$/gm;

  let match3;
  while ((match3 = reasonPattern3.exec(response)) !== null) {
    const path = match3[1].trim();
    const reason = match3[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // パターン4: ## File: ... Reason: ... (英語版)
  const reasonPattern4 =
    /##\s*(?:File|ファイル):\s*(.+?)\s*\n+(?:\*\*)?(?:Reason|理由)(?:\*\*)?:\s*(.+?)(?=\n)/gs;

  let match4;
  while ((match4 = reasonPattern4.exec(response)) !== null) {
    const path = match4[1].trim();
    const reason = match4[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  // パターン5: 変更: ファイルパス - 理由
  const reasonPattern5 =
    /^(?:変更|Change|Modified):\s*(.+?\.(?:ts|tsx|js|jsx|json|md|css|html|py|java|go|rs))\s*[-:]\s*(.+)$/gm;

  let match5;
  while ((match5 = reasonPattern5.exec(response)) !== null) {
    const path = match5[1].trim();
    const reason = match5[2].trim();
    if (!reasonMap.has(path)) {
      reasonMap.set(path, reason);
    }
  }

  return reasonMap;
}

/**
 * メッセージをクリーンアップ
 */
export function cleanupMessage(response: string): string {
  let cleaned = response;

  // ファイルブロックを削除（厳密なマッチング）
  cleaned = cleaned.replace(
    /<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*?<AI_EDIT_CONTENT_END:[^>]+>/g,
    ''
  );

  // 閉じタグがないブロックも削除
  cleaned = cleaned.replace(/<AI_EDIT_CONTENT_START:[^>]+>[\s\S]*$/g, '');

  // メタデータを削除（日本語・英語両対応）
  cleaned = cleaned.replace(/^##\s*(?:変更ファイル|File|Changed File):.*$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:変更理由|Reason|Change Reason)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:ファイル名|File Name|Filename)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^\*\*(?:理由|Reason)\*\*:.+$/gm, '');
  cleaned = cleaned.replace(/^(?:Reason|理由):\s*.+$/gm, ''); // 単体のReason行
  cleaned = cleaned.replace(
    /^(?:変更|Change|Modified):\s*.+?\.(?:ts|tsx|js|jsx|json|md|css|html|py|java|go|rs)\s*[-:].*$/gm,
    ''
  );
  cleaned = cleaned.replace(/^---+$/gm, '');

  // コードブロックのマーカーを削除（```の中身は保持）
  cleaned = cleaned.replace(/^```[a-z]*\s*$/gm, '');

  // 連続する空行を1つに
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

/**
 * AI編集レスポンスをパース（強化版）
 */
export function parseEditResponse(
  response: string,
  originalFiles: Array<{ path: string; content: string }>
): ParseResult {
  const changedFiles: ParsedFile[] = [];

  // パスの正規化マップを作成
  const normalizedOriginalFiles = new Map(originalFiles.map(f => [normalizePath(f.path), f]));

  // ファイルブロックを抽出
  const fileBlocks = extractFileBlocks(response);

  // 変更理由を抽出
  const reasonMap = extractReasons(response);

  // 各ブロックを処理
  for (const block of fileBlocks) {
    const normalizedPath = normalizePath(block.path);
    const originalFile = normalizedOriginalFiles.get(normalizedPath);

    if (originalFile) {
      // 理由を検索（複数パターン対応）
      let explanation = reasonMap.get(block.path) || reasonMap.get(originalFile.path);

      // 理由が見つからない場合、正規化パスで再検索
      if (!explanation) {
        for (const [key, value] of reasonMap.entries()) {
          if (normalizePath(key) === normalizedPath) {
            explanation = value;
            break;
          }
        }
      }

      changedFiles.push({
        path: originalFile.path,
        originalContent: originalFile.content,
        suggestedContent: block.content,
        explanation: explanation || 'No explanation provided',
      });
    }
  }

  // メッセージをクリーンアップ
  let message = cleanupMessage(response);

  // メッセージが不十分な場合のフォールバック
  const hasValidMessage = message && message.replace(/\s/g, '').length >= 5;

  if (changedFiles.length === 0 && !hasValidMessage) {
    // 解析失敗時のデバッグ情報
    const failureNote = 'レスポンスの解析に失敗しました。プロンプトを調整してください。';
    const safeResponse = response.replace(/```/g, '```' + '\u200B');
    const rawBlock = `\n\n---\n\nRaw response:\n\n\`\`\`text\n${safeResponse}\n\`\`\``;
    message = failureNote + rawBlock;
  } else if (changedFiles.length > 0 && !hasValidMessage) {
    // ファイルが変更されたがメッセージが不十分
    message = `${changedFiles.length}個のファイルの編集を提案しました。`;
  }

  return {
    changedFiles,
    message,
    raw: response,
  };
}

/**
 * レスポンスの品質チェック
 */
export function validateResponse(response: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!response || response.trim().length === 0) {
    errors.push('Empty response');
    return { isValid: false, errors, warnings };
  }

  // ファイルブロックの検証
  const startTags = response.match(/<AI_EDIT_CONTENT_START:[^>]+>/g) || [];
  const endTags = response.match(/<AI_EDIT_CONTENT_END:[^>]+>/g) || [];

  if (startTags.length !== endTags.length) {
    errors.push(`Mismatched tags: ${startTags.length} START vs ${endTags.length} END`);
  }

  if (startTags.length === 0) {
    warnings.push('No file blocks found');
  }

  // タグのペアが正しいか検証
  const blocks = extractFileBlocks(response);
  if (blocks.length < startTags.length) {
    warnings.push('Some file blocks may be malformed');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
