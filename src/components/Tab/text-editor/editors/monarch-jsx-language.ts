import { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

/**
 * MonarchベースのJSX/TSX強化言語定義 (修正版)
 * - テンプレートリテラル内の ${...} 後の文字列が正しく認識されるよう修正
 * - next vs @push の使い分けを明確化
 */
export function registerEnhancedJSXLanguage(monaco: Monaco) {
  console.log('[monarch-jsx-language] registerEnhancedJSXLanguage() called');
  monaco.languages.register({ id: 'enhanced-jsx' });
  monaco.languages.register({ id: 'enhanced-tsx' });

  // commonRules: 括弧ルールは各ステートで明示的に処理するため除外
  const commonRules: any[] = [
    // 関数呼び出し
    [/[a-zA-Z_$][\w$]*(?=\s*\()/, 'function.call'],

    // キーワードと識別子
    [/(const|let|var)(\s+)([a-zA-Z_$][\w$]*)/, ['keyword', 'whitespace', 'variable']],
    [/[a-z_$][\w$]*/, { cases: { '@typeKeywords': 'type.identifier', '@keywords': 'keyword', '@default': 'identifier' } }],
    [/[A-Z][\w\$]*/, 'type.identifier'],

    // 文字列
    [/"([^"\\]|\\.)*$/, 'string.invalid'],
    [/'([^'\\]|\\.)*$/, 'string.invalid'],
    [/"/, 'string', '@string_double'],
    [/'/, 'string', '@string_single'],
    [/`/, 'string', '@string_backtick'],

    // 数値
    [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
    [/0[xX][0-9a-fA-F]+/, 'number.hex'],
    [/\d+/, 'number'],

    // その他デリミタ
    [/[;,.]/, 'delimiter'],
    [/[=><!~?:&|+\-*\/\^%]+/, 'operator'],
  ];

  const jsxMonarchLanguage: monaco.languages.IMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.jsx',
    ignoreCase: false,

    keywords: [
      'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch',
      'class', 'const', 'constructor', 'continue', 'debugger', 'declare', 'default',
      'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
      'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof',
      'interface', 'is', 'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null',
      'number', 'object', 'of', 'package', 'private', 'protected', 'public', 'readonly',
      'require', 'return', 'set', 'static', 'string', 'super', 'switch', 'symbol',
      'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void',
      'while', 'with', 'yield',
    ],

    typeKeywords: [
      'any', 'boolean', 'number', 'object', 'string', 'undefined', 'null', 'symbol',
      'never', 'void', 'unknown', 'bigint',
    ],

    tokenizer: {
      root: [
        { include: '@whitespace' },
        [/[}\)\]]/, 'delimiter.bracket'],
        
        // root から開き括弧: next を使ってステート遷移（スタックをクリア）
        [/{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace' }],
        [/\[/, { token: 'delimiter.bracket', next: '@jsExpressionBracket' }],
        [/\(/, { token: 'delimiter.bracket', next: '@jsExpressionParen' }],
        
        [/(?<![\w$])(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(?<![\w$])(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        ...commonRules
      ],

      // --------------------------
      // JSX関連ステート
      // --------------------------

      jsxTag: [
        { include: '@whitespace' },
        
        [/([\w\-]+)(?=\s*=)/, 'attribute.name'],
        [/([\w\-]+)/, 'attribute.name'],

        [/=/, 'delimiter'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
        [/`/, 'string', '@string_backtick'],
        
        // 属性値内の JS 式: push でネスト
        [/{/, 'delimiter.bracket', '@push'],

        [/>/, { token: 'delimiter.bracket', next: '@jsxContent' }],
        [/\/>/, { token: 'delimiter.bracket', next: '@pop' }],
      ],

      jsxContent: [
        { include: '@whitespace' },
        [/(?<![\w$])(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(?<![\w$])(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        
        [/(<\/)([\w\.\-_]+)(>)/, [
          'delimiter.bracket', 
          'tag', 
          { token: 'delimiter.bracket', next: '@pop' }
        ]],
        
        [/(<\/>)/, [{ token: 'delimiter.bracket', next: '@pop' }]],

        // 本文内の JS 式: push でネスト
        [/{/, 'delimiter.bracket', '@push'],

        [/[^<{]+/, 'jsx.text'],
        [/./, 'jsx.text']
      ],

      // --------------------------
      // JS式ステート
      // --------------------------

      jsExpressionBrace: [
        { include: '@whitespace' },
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        
        // ネストした括弧は push でスタックに積む
        [/{/, 'delimiter.bracket', '@push'],
        [/\[/, 'delimiter.bracket', '@push'],
        [/\(/, 'delimiter.bracket', '@push'],
        
        // JS 式内でも JSX は有効
        [/(?<![\w$])(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(?<![\w$])(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        
        ...commonRules
      ],

      jsExpressionBracket: [
        { include: '@whitespace' },
        [/\]/, { token: 'delimiter.bracket', next: '@pop' }],
        
        [/{/, 'delimiter.bracket', '@push'],
        [/\[/, 'delimiter.bracket', '@push'],
        [/\(/, 'delimiter.bracket', '@push'],
        
        [/(?<![\w$])(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(?<![\w$])(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        
        ...commonRules
      ],

      jsExpressionParen: [
        { include: '@whitespace' },
        [/\)/, { token: 'delimiter.bracket', next: '@pop' }],
        
        [/{/, 'delimiter.bracket', '@push'],
        [/\[/, 'delimiter.bracket', '@push'],
        [/\(/, 'delimiter.bracket', '@push'],
        
        [/(?<![\w$])(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(?<![\w$])(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        
        ...commonRules
      ],

      // --------------------------
      // ヘルパー
      // --------------------------
      whitespace: [
        [/[ \t\r\n]+/, ''],
        [/\/\*\*(?!\/)/, 'comment.doc', '@jsdoc'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],

      comment: [
        [/[^\/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment']
      ],

      jsdoc: [
        [/[^\/*]+/, 'comment.doc'],
        [/\*\//, 'comment.doc', '@pop'],
        [/[\/*]/, 'comment.doc']
      ],

      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop']
      ],

      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop']
      ],

      string_backtick: [
        // ${...} 式の開始: push でネスト（重要！）
        [/\$\{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace', nextEmbedded: '@push' }],
        [/[^\\`$]+/, 'string'],
        [/\$/, 'string'], // 単独の $ は文字列として扱う
        [/\\./, 'string.escape'],
        [/`/, 'string', '@pop']
      ],
    },
  };

  monaco.languages.setMonarchTokensProvider('enhanced-jsx', jsxMonarchLanguage);
  monaco.languages.setMonarchTokensProvider('enhanced-tsx', jsxMonarchLanguage);

  console.log('[monarch-jsx-language] Skipping global TS/JS token override; use enhanced-jsx/tsx for tokenization');
  try {
    console.log('[monarch-jsx-language] Tag detection uses negative lookbehind to avoid naive generic matches: `(?<![\\w$])(<)`');
  } catch (e) {
    console.warn('[monarch-jsx-language] Failed to attach enhanced tokens to ts/js:', e);
  }

  const languageConfiguration: monaco.languages.LanguageConfiguration = {
    wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '`', close: '`', notIn: ['string', 'comment'] },
      { open: '<', close: '>', notIn: ['string'] }
    ],
  };

  monaco.languages.setLanguageConfiguration('enhanced-jsx', languageConfiguration);
  monaco.languages.setLanguageConfiguration('enhanced-tsx', languageConfiguration);
  
  try {
    monaco.languages.setLanguageConfiguration('javascript', languageConfiguration);
    monaco.languages.setLanguageConfiguration('typescript', languageConfiguration);
  } catch (e) {
    console.warn('[monarch-jsx-language] Failed to set language configuration for js/ts:', e);
  }
}

export function getEnhancedLanguage(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx')) return 'enhanced-tsx';
  if (ext.endsWith('.jsx')) return 'enhanced-jsx';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  
  return 'plaintext';
}

export function getModelLanguage(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'javascript';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  return 'plaintext';
}