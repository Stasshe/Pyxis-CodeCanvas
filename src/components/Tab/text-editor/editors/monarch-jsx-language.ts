import { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { getLanguage } from './editor-utils';

let isRegistered = false;

/**
 * JSX/TSX のセマンティックハイライトを強化
 * Monaco の TypeScript 言語サービスは JSX をパースできるが、
 * トークンのマッピングが不完全なため、カスタムプロバイダーで補完
 */
export function registerEnhancedJSXLanguage(monaco: Monaco) {
  if (isRegistered) {
    console.log('[jsx-language] Already registered, skipping');
    return;
  }

  console.log('[jsx-language] Registering JSX semantic token provider');

  // TypeScript のセマンティックトークンを有効化
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  // JSX 要素用のカスタムドキュメントセマンティックトークンプロバイダー
  // これは TypeScript 言語サービスの出力を補完する
  monaco.languages.registerDocumentSemanticTokensProvider('typescript', {
    getLegend: () => ({
      tokenTypes: [
        'class',
        'interface',
        'enum',
        'typeParameter',
        'type',
        'parameter',
        'variable',
        'property',
        'function',
        'member',
        'keyword',
        'string',
        'number',
        'regexp',
        'operator',
        'namespace',
        'tag', // JSX タグ名
        'attribute', // JSX 属性名
        'text', // JSX テキスト内容
      ],
      tokenModifiers: [
        'declaration',
        'documentation',
        'static',
        'abstract',
        'deprecated',
        'readonly',
        'defaultLibrary',
      ],
    }),
    provideDocumentSemanticTokens: async model => {
      // TypeScript の言語サービスが既にセマンティックトークンを提供しているため
      // ここでは null を返して標準の処理に任せる
      // （必要に応じて追加のトークンをここで生成できる）
      return null;
    },
    releaseDocumentSemanticTokens: () => {},
  });

  // JavaScript (JSX) も同様
  monaco.languages.registerDocumentSemanticTokensProvider('javascript', {
    getLegend: () => ({
      tokenTypes: [
        'class',
        'interface',
        'enum',
        'typeParameter',
        'type',
        'parameter',
        'variable',
        'property',
        'function',
        'member',
        'keyword',
        'string',
        'number',
        'regexp',
        'operator',
        'namespace',
        'tag',
        'attribute',
        'text',
      ],
      tokenModifiers: [
        'declaration',
        'documentation',
        'static',
        'abstract',
        'deprecated',
        'readonly',
        'defaultLibrary',
      ],
    }),
    provideDocumentSemanticTokens: async () => null,
    releaseDocumentSemanticTokens: () => {},
  });

  isRegistered = true;
  console.log('[jsx-language] JSX semantic token provider registered');
}

export function getEnhancedLanguage(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'javascript';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  // For other extensions, fall back to the generic language detector
  // so `.html` becomes `html`, `.css` becomes `css`, etc.
  return getLanguage(filename);
}

export function getModelLanguage(filename: string): string {
  return getEnhancedLanguage(filename);
}
