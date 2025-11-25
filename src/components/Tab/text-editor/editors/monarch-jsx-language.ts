import { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

/**
 * MonarchベースのJSX/TSX強化言語定義 (最終調整版)
 * - `const Hero` が白色になる問題を修正

 */
export function registerEnhancedJSXLanguage(monaco: Monaco) {
  monaco.languages.register({ id: 'enhanced-jsx' });
  monaco.languages.register({ id: 'enhanced-tsx' });

  const commonRules: any[] = [
    // コメントは各ステートの最優先で処理するため、ここからは削除し、各ステートの先頭に配置する。
    // { include: '@whitespace' }, 

    // JSXタグ開始 <Component
    [/(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
    // フラグメント <>
    [/(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
    
    // JSの括弧 (新しいステートへ)
    [/{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace' }],
    [/\[/, { token: 'delimiter.bracket', next: '@jsExpressionBracket' }],
    [/\(/, { token: 'delimiter.bracket', next: '@jsExpressionParen' }],

    // 関数呼び出し
    [/[a-zA-Z_$][\w$]*(?=\s*\()/, 'function.call'],

    // キーワードと識別子
    // `const Hero` の Hero を `variable` として認識させる
    [/(const|let|var)(\s+)([a-zA-Z_$][\w$]*)/, ['keyword', 'whitespace', 'variable']],
    [/[a-z_$][\w$]*/, { cases: { '@typeKeywords': 'type.identifier', '@keywords': 'keyword', '@default': 'identifier' } }],
    [/[A-Z][\w\$]*/, 'type.identifier'], // PascalCaseは型/クラス扱い

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
        { include: '@whitespace' }, // コメントを最優先で処理
        // ルートレベルでの閉じ括弧は、単なるデリミタとして処理（ポップしない）
        [/[}\)\]]/, 'delimiter.bracket'],
        ...commonRules
      ],

      // --------------------------
      // JSX関連ステート
      // --------------------------

      // JSXタグ定義内: <div className="foo">
      jsxTag: [
        { include: '@whitespace' }, // コメントを最優先で処理
        
        // 属性名
        [/([\w\-]+)(?=\s*=)/, 'attribute.name'], // = が続く場合
        [/([\w\-]+)/, 'attribute.name'],          // Boolean属性

        // 属性値: "=" の後の文字列
        [/=/, 'delimiter'],
        [/"([^"]*)"/, 'attribute.value'],
        [/'([^']*)'/, 'attribute.value'],
        
        // 属性値がJS式の場合: className={...}
        [/{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace' }],

        // タグの終了
        [/>/, { token: 'delimiter.bracket', next: '@jsxContent' }], // > 本文へ
        [/\/>/, { token: 'delimiter.bracket', next: '@pop' }],      // /> 即終了
      ],

      // JSX本文: <div>Text</div>
      jsxContent: [
        { include: '@whitespace' }, // コメントを最優先で処理
        // 子要素の開始
        [/(<)([\w\.\-_]+)/, ['delimiter.bracket', { token: 'tag', next: '@jsxTag' }]],
        [/(<)(>)/, ['delimiter.bracket', { token: 'delimiter.bracket', next: '@jsxContent' }]],
        
        // 終了タグ </Component>
        [/(<\/)([\w\.\-_]+)(>)/, [
          'delimiter.bracket', 
          'tag', 
          { token: 'delimiter.bracket', next: '@pop' }
        ]],
        
        // フラグメント終了 </>
        [/(<\/>)/, [{ token: 'delimiter.bracket', next: '@pop' }]],

        // 本文内のJS式 { expression }
        [/{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace' }],

        // 単なるテキスト (重要: < や { 以外の文字。コメント文字も避ける)
        // ここを修正: / / や * / がstringにマッチしないようにする
        [/[^<{/]+/, 'string'] 
      ],

      // --------------------------
      // JS式ステート (再帰処理用)
      // --------------------------

      // { ... }
      jsExpressionBrace: [
        { include: '@whitespace' }, // コメントを最優先で処理
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }], // 脱出最優先
        [/[\[\{\(]/, 'delimiter.bracket', '@push'], // 開き括弧はスタックにプッシュ
        ...commonRules
      ],

      // [ ... ]
      jsExpressionBracket: [
        { include: '@whitespace' }, // コメントを最優先で処理
        [/\]/, { token: 'delimiter.bracket', next: '@pop' }], // 脱出最優先
        [/[\[\{\(]/, 'delimiter.bracket', '@push'], // 開き括弧はスタックにプッシュ
        ...commonRules
      ],

      // ( ... ) -> return ( ... ) はここを通る
      jsExpressionParen: [
        { include: '@whitespace' }, // コメントを最優先で処理
        [/\)/, { token: 'delimiter.bracket', next: '@pop' }], // 脱出最優先
        [/[\[\{\(]/, 'delimiter.bracket', '@push'], // 開き括弧はスタックにプッシュ
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
        [/\$\{/, { token: 'delimiter.bracket', next: '@jsExpressionBrace' }],
        [/[^\\`$]+/, 'string'],
        [/\\./, 'string.escape'],
        [/`/, 'string', '@pop']
      ],
    },
  };

  monaco.languages.setMonarchTokensProvider('enhanced-jsx', jsxMonarchLanguage);

  // TSX用の言語設定（同じMonarch定義を使用）
  monaco.languages.setMonarchTokensProvider('enhanced-tsx', jsxMonarchLanguage);

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
}
/**
 * ファイル名から強化言語を取得
 */
export function getEnhancedLanguage(filename: string): string {
  const ext = filename.toLowerCase();
  if (ext.endsWith('.tsx')) return 'enhanced-tsx';
  if (ext.endsWith('.jsx')) return 'enhanced-jsx';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.js')) return 'javascript';
  
  // その他のファイル形式は既存のgetLanguageを使用
  return 'plaintext';
}