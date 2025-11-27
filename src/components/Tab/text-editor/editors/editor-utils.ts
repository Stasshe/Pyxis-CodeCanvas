/**
 * エディター共通ユーティリティ
 */

/**
 * ファイル名から言語を推定
 */
export const getLanguage = (filename: string): string => {
  // handle dotfiles and special filenames first
  const name = filename.toLowerCase();
  if (name === '.gitignore') return 'gitignore';
  if (name === '.gitattributes') return 'git';
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.editorconfig') return 'ini';
  if (name === '.env' || name.startsWith('.env.')) return 'dotenv';
  if (name === 'readme' || name.startsWith('readme.')) return 'markdown';
  if (name === 'license' || name === 'licence') return 'plaintext';

  const ext = name;
  if (ext.endsWith('.tsx')) return 'typescript';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'javascript';
  if (ext.endsWith('.js')) return 'javascript';
  if (ext.endsWith('.mjs')) return 'javascript';
  if (ext.endsWith('.cjs')) return 'javascript';
  if (ext.endsWith('.gs')) return 'javascript';
  if (ext.endsWith('.json') || ext.endsWith('.jsonc')) return 'json';
  if (ext.endsWith('.md') || ext.endsWith('.markdown')) return 'markdown';
  if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) return 'html';
  if (ext.endsWith('.css')) return 'css';
  if (ext.endsWith('.scss') || ext.endsWith('.sass')) return 'scss';
  if (ext.endsWith('.less')) return 'less';
  if (ext.endsWith('.styl')) return 'stylus';
  if (ext.endsWith('.py') || ext.endsWith('.pyw')) return 'python';
  if (ext.endsWith('.java')) return 'java';
  if (ext.endsWith('.kt') || ext.endsWith('.kts')) return 'kotlin';
  if (ext.endsWith('.swift')) return 'swift';
  if (ext.endsWith('.rb')) return 'ruby';
  if (ext.endsWith('.php')) return 'php';
  if (ext.endsWith('.go')) return 'go';
  if (ext.endsWith('.rs')) return 'rust';
  if (
    ext.endsWith('.cpp') ||
    ext.endsWith('.cc') ||
    ext.endsWith('.cxx') ||
    ext.endsWith('.hpp') ||
    ext.endsWith('.hxx')
  )
    return 'cpp';
  if (ext.endsWith('.c') || ext.endsWith('.h')) return 'c';
  if (ext.endsWith('.cs')) return 'csharp';
  if (ext.endsWith('.xml') || ext.endsWith('.xsd') || ext.endsWith('.xslt') || ext.endsWith('.xsl'))
    return 'xml';
  if (ext.endsWith('.yaml') || ext.endsWith('.yml')) return 'yaml';
  if (ext.endsWith('.toml')) return 'toml';
  if (ext.endsWith('.ini') || ext.endsWith('.conf')) return 'ini';
  if (ext.endsWith('.sql')) return 'sql';
  if (ext.endsWith('.sh') || ext.endsWith('.bash')) return 'shell';
  if (ext.endsWith('.bat') || ext.endsWith('.cmd')) return 'bat';
  if (ext.endsWith('.ps1')) return 'powershell';
  if (ext.endsWith('.dockerfile') || ext.endsWith('dockerfile')) return 'dockerfile';
  if (ext.endsWith('.makefile') || ext.endsWith('makefile')) return 'makefile';
  if (ext.endsWith('.r')) return 'r';
  if (ext.endsWith('.pl')) return 'perl';
  if (ext.endsWith('.lua')) return 'lua';
  if (ext.endsWith('.dart')) return 'dart';
  if (ext.endsWith('.scala')) return 'scala';
  if (ext.endsWith('.groovy')) return 'groovy';
  if (ext.endsWith('.coffee')) return 'coffeescript';
  if (ext.endsWith('.elm')) return 'elm';
  if (ext.endsWith('.clj') || ext.endsWith('.cljs') || ext.endsWith('.cljc')) return 'clojure';
  if (ext.endsWith('.tex')) return 'latex';
  if (ext.endsWith('.vue')) return 'vue';
  if (ext.endsWith('.svelte')) return 'svelte';
  if (ext.endsWith('.sol')) return 'solidity';
  if (ext.endsWith('.asm')) return 'assembly';
  if (ext.endsWith('.matlab') || ext.endsWith('.m')) return 'matlab';
  if (ext.endsWith('.vhdl') || ext.endsWith('.vhd')) return 'vhdl';
  if (ext.endsWith('.verilog') || ext.endsWith('.v')) return 'verilog';
  if (ext.endsWith('.f90') || ext.endsWith('.f95') || ext.endsWith('.for') || ext.endsWith('.f'))
    return 'fortran';
  if (ext.endsWith('.ada')) return 'ada';
  if (ext.endsWith('.dart')) return 'dart';
  if (ext.endsWith('.tsv') || ext.endsWith('.csv')) return 'plaintext';
  return 'plaintext';
};

/**
 * バイナリファイルのMIMEタイプ推定
 */
export function guessMimeType(fileName: string, buffer?: ArrayBuffer): string {
  const ext = fileName.toLowerCase();
  if (ext.match(/\.(png)$/)) return 'image/png';
  if (ext.match(/\.(jpg|jpeg)$/)) return 'image/jpeg';
  if (ext.match(/\.(gif)$/)) return 'image/gif';
  if (ext.match(/\.(bmp)$/)) return 'image/bmp';
  if (ext.match(/\.(webp)$/)) return 'image/webp';
  if (ext.match(/\.(svg)$/)) return 'image/svg+xml';
  if (ext.match(/\.(pdf)$/)) return 'application/pdf';
  if (ext.match(/\.(mp3)$/)) return 'audio/mpeg';
  if (ext.match(/\.(wav)$/)) return 'audio/wav';
  if (ext.match(/\.(ogg)$/)) return 'audio/ogg';
  if (ext.match(/\.(mp4)$/)) return 'video/mp4';
  return 'application/octet-stream';
}

/**
 * 文字数カウント（スペース除外）
 * 安全化: runtime で string 以外が渡されることがあるため、まず文字列に変換する。
 */
export const countCharsNoSpaces = (text?: unknown) => {
  if (text == null) return 0;
  if (typeof text !== 'string') {
    try {
      // objects/arrays/buffers を渡された場合にもある程度扱えるように文字列化
      text = String(text);
    } catch (e) {
      return 0;
    }
  }

  return (text as string).replace(/\s/g, '').length;
};
