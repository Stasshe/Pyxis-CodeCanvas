import { Monaco } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
/**
 * MonarchベースのJSX/TSX強化言語定義
 * npm installなしでトークンハイライトを改善
 */
export function registerEnhancedJSXLanguage(monaco: Monaco) {
  // JSX/TSX用の強化言語を登録
  monaco.languages.register({ id: 'enhanced-jsx' });
  monaco.languages.register({ id: 'enhanced-tsx' });

  // 共通のMonarch定義
  const jsxMonarchLanguage: monaco.languages.IMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.jsx',

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

    operators: [
      '<=', '>=', '==', '!=', '===', '!==', '=>', '+', '-', '**', '*', '/', '%',
      '++', '--', '<<', '</', '>>', '>>>', '&', '|', '^', '!', '~', '&&', '||',
      '??', '?', ':', '=', '+=', '-=', '*=', '**=', '/=', '%=', '<<=', '>>=',
      '>>>=', '&=', '|=', '^=', '@',
    ],

    // 正規表現とJSXタグの区別に使う
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
    digits: /\d+(_+\d+)*/,
    octaldigits: /[0-7]+(_+[0-7]+)*/,
    binarydigits: /[0-1]+(_+[0-1]+)*/,
    hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,

    regexpctl: /[(){}\[\]\$\^|\-*+?\.]/,
    regexpesc: /\\(?:[bBdDfnrstvwWn0\\\/]|@regexpctl|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/,

    tokenizer: {
      root: [
        // JSXタグの開始 <Component
        [/(<)([A-Z][\w]*)(>|\/?>|\s)/, ['delimiter.bracket', 'tag', 'delimiter.bracket']],
        [/(<)([a-z][\w-]*)(>|\/?>|\s)/, ['delimiter.bracket', 'tag', 'delimiter.bracket']],
        
        // JSXクロージングタグ </Component>
        [/(<\/)([A-Z][\w]*)(>)/, ['delimiter.bracket', 'tag', 'delimiter.bracket']],
        [/(<\/)([a-z][\w-]*)(>)/, ['delimiter.bracket', 'tag', 'delimiter.bracket']],

        // JSX属性
        [/\s+([a-zA-Z][\w-]*)(?=\s*=)/, 'attribute.name'],
        
        // メソッド呼び出し object.method()
        [/([a-zA-Z_$][\w$]*)(\s*)(\.)(\s*)([a-z_$][\w$]*)(?=\s*\()/, 
          ['identifier', '', 'delimiter', '', 'method']],
        
        // プロパティアクセス object.property
        [/([a-zA-Z_$][\w$]*)(\s*)(\.)(\s*)([a-z_$][\w$]*)/, 
          ['identifier', '', 'delimiter', '', 'property']],
        
        // 関数呼び出し functionName()
        [/[a-z_$][\w$]*(?=\s*\()/, 'function.call'],
        
        // 識別子とキーワード
        [/[a-z_$][\w$]*/, {
          cases: {
            '@typeKeywords': 'type.identifier',
            '@keywords': 'keyword',
            '@default': 'identifier'
          }
        }],
        [/[A-Z][\w\$]*/, 'type.identifier'],

        // 空白
        { include: '@whitespace' },

        // 正規表現
        [/\/(?=([^\\\/]|\\.)+\/([gimsuy]*)(\s*)(\.|;|,|\)|\]|\}|$))/, { token: 'regexp', bracket: '@open', next: '@regexp' }],

        // デリミタとオペレータ
        [/[()\[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, '@brackets'],
        [/!(?=([^=]|$))/, 'delimiter'],
        [/@symbols/, {
          cases: {
            '@operators': 'delimiter',
            '@default': ''
          }
        }],

        // 数値
        [/(@digits)[eE]([\-+]?(@digits))?/, 'number.float'],
        [/(@digits)\.(@digits)([eE][\-+]?(@digits))?/, 'number.float'],
        [/0[xX](@hexdigits)n?/, 'number.hex'],
        [/0[oO]?(@octaldigits)n?/, 'number.octal'],
        [/0[bB](@binarydigits)n?/, 'number.binary'],
        [/(@digits)n?/, 'number'],

        // デリミタ: コンテキスト後
        [/[;,.]/, 'delimiter'],

        // 文字列
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
        [/`/, 'string', '@string_backtick'],
      ],

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

      regexp: [
        [/(\{)(\d+(?:,\d*)?)(\})/, ['regexp.escape.control', 'regexp.escape.control', 'regexp.escape.control']],
        [/(\[)(\^?)(?=(?:[^\]\\\/]|\\.)+)/, ['regexp.escape.control', { token: 'regexp.escape.control', next: '@regexrange' }]],
        [/(\()(\?:|\?=|\?!)/, ['regexp.escape.control', 'regexp.escape.control']],
        [/[()]/, 'regexp.escape.control'],
        [/@regexpctl/, 'regexp.escape.control'],
        [/[^\\\/]/, 'regexp'],
        [/@regexpesc/, 'regexp.escape'],
        [/\\\./, 'regexp.invalid'],
        [/(\/)([gimsuy]*)/, [{ token: 'regexp', bracket: '@close', next: '@pop' }, 'keyword.other']],
      ],

      regexrange: [
        [/-/, 'regexp.escape.control'],
        [/\^/, 'regexp.invalid'],
        [/@regexpesc/, 'regexp.escape'],
        [/[^\]]/, 'regexp'],
        [/\]/, { token: 'regexp.escape.control', next: '@pop', bracket: '@close' }],
      ],

      string_double: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop']
      ],

      string_single: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop']
      ],

      string_backtick: [
        [/\$\{/, { token: 'delimiter.bracket', next: '@bracketCounting' }],
        [/[^\\`$]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/`/, 'string', '@pop']
      ],

      bracketCounting: [
        [/\{/, 'delimiter.bracket', '@bracketCounting'],
        [/\}/, 'delimiter.bracket', '@pop'],
        { include: 'root' }
      ],
    },
  };

  // JSX用の言語設定
  monaco.languages.setMonarchTokensProvider('enhanced-jsx', jsxMonarchLanguage);
  
  // TSX用の言語設定（同じMonarch定義を使用）
  monaco.languages.setMonarchTokensProvider('enhanced-tsx', jsxMonarchLanguage);

  // 言語設定（括弧、コメント、オートクロージング等）
  const languageConfiguration: monaco.languages.LanguageConfiguration = {
    wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/']
    },

    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')']
    ],

    onEnterRules: [
      {
        beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
        afterText: /^\s*\*\/$/,
        action: {
          indentAction: monaco.languages.IndentAction.IndentOutdent,
          appendText: ' * '
        }
      },
      {
        beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
        action: {
          indentAction: monaco.languages.IndentAction.None,
          appendText: ' * '
        }
      },
      {
        beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
        action: {
          indentAction: monaco.languages.IndentAction.None,
          appendText: '* '
        }
      },
      {
        beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
        action: {
          indentAction: monaco.languages.IndentAction.None,
          removeText: 1
        }
      }
    ],

    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '`', close: '`', notIn: ['string', 'comment'] },
      { open: "/**", close: " */", notIn: ['string'] },
      { open: '<', close: '>', notIn: ['string'] }
    ],

    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' },
      { open: '<', close: '>' }
    ],

    folding: {
      markers: {
        start: new RegExp('^\\s*//\\s*#?region\\b'),
        end: new RegExp('^\\s*//\\s*#?endregion\\b')
      }
    }
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