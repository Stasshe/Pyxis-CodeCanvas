/**
 * [LEGACY] ES Module Transformer
 *
 * ## 状態
 * ⚠️ このファイルはレガシーです。新しいコードではtranspileManager（SWC wasm）を使用してください。
 * 
 * ## 役割
 * ES ModulesをCommonJS形式に変換する（正規表現ベース）
 * 
 * ## 使用場面
 * - フォールバック: SWC wasmが利用できない場合
 * - 軽量変換: 単純なES Module構文のみの場合
 * 
 * ## 推奨
 * 新しいコードでは `transpileManager` を使用してください:
 * ```typescript
 * import { transpileManager } from '@/engine/runtime/transpileManager';
 * const result = await transpileManager.transpile({ code, filePath });
 * ```
 */

/**
 * ES ModulesをCommonJSに変換
 */
export function transformESModules(code: string): string {
  let transformed = code;

  // コメントを一時的に保護（変換対象から除外）
  const comments: string[] = [];
  transformed = transformed.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, (match) => {
    const index = comments.length;
    comments.push(match);
    return `__COMMENT_${index}__`;
  });

  // 文字列リテラルを一時的に保護
  const strings: string[] = [];
  transformed = transformed.replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, (match) => {
    const index = strings.length;
    strings.push(match);
    return `__STRING_${index}__`;
  });

  // 1. export default クラス/関数
  // export default class MyClass { ... } → class MyClass { ... }; module.exports = MyClass; module.exports.default = MyClass;
  transformed = transformed.replace(
    /export\s+default\s+(class|function)\s+(\w+)/g,
    (match, type, name) => {
      return `${type} ${name}`;
    }
  );

  // export default で定義されたクラス/関数の名前を抽出してexports追加
  const defaultClassFuncMatches = code.match(/export\s+default\s+(?:class|function)\s+(\w+)/g);
  if (defaultClassFuncMatches) {
    const names = defaultClassFuncMatches.map(m => m.match(/export\s+default\s+(?:class|function)\s+(\w+)/)![1]);
    names.forEach(name => {
      transformed += `\nif (typeof ${name} !== 'undefined') { module.exports = ${name}; module.exports.default = ${name}; }`;
    });
  }

  // 2. export default 式
  // export default something; → module.exports = something; module.exports.default = something;
  transformed = transformed.replace(
    /export\s+default\s+(.+?);/g,
    (match, expression) => {
      return `module.exports = ${expression}; module.exports.default = ${expression};`;
    }
  );

  // 3. export { ... } from '...'
  // export { a, b as c } from 'mod' → const _temp = require('mod'); module.exports.a = _temp.a; module.exports.c = _temp.b;
  transformed = transformed.replace(
    /export\s*\{\s*([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, exports, modulePath) => {
      const tempVar = `_export_${generateId()}`;
      const exportList = exports.split(',').map((e: string) => e.trim()).filter(Boolean);
      
      let result = `const ${tempVar} = require('${modulePath}');\n`;
      
      exportList.forEach((exp: string) => {
        const asMatch = exp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          result += `module.exports.${asMatch[2]} = ${tempVar}.${asMatch[1]};\n`;
        } else {
          result += `module.exports.${exp} = ${tempVar}.${exp};\n`;
        }
      });
      
      return result;
    }
  );

  // 4. export * from '...'
  // export * from 'mod' → Object.assign(module.exports, require('mod'));
  transformed = transformed.replace(
    /export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, modulePath) => {
      return `Object.assign(module.exports, require('${modulePath}'));`;
    }
  );

  // 5. export * as name from '...'
  // export * as name from 'mod' → module.exports.name = require('mod');
  transformed = transformed.replace(
    /export\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, name, modulePath) => {
      return `module.exports.${name} = require('${modulePath}');`;
    }
  );

  // 6. export { ... }
  // export { a, b as c } → module.exports.a = a; module.exports.c = b;
  transformed = transformed.replace(
    /export\s*\{\s*([^}]+)\}\s*;?/g,
    (match, exports) => {
      const exportList = exports.split(',').map((e: string) => e.trim()).filter(Boolean);
      
      return exportList.map((exp: string) => {
        const asMatch = exp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          return `module.exports.${asMatch[2]} = ${asMatch[1]};`;
        } else {
          return `module.exports.${exp} = ${exp};`;
        }
      }).join('\n');
    }
  );

  // 7. export const/let/var
  // export const x = 1 → const x = 1; module.exports.x = x;
  transformed = transformed.replace(
    /export\s+(const|let|var)\s+(\w+)\s*=\s*([^;]+);?/g,
    (match, type, name, value) => {
      return `${type} ${name} = ${value};\nmodule.exports.${name} = ${name};`;
    }
  );

  // 8. export function
  // export function foo() {} → function foo() {}; module.exports.foo = foo;
  transformed = transformed.replace(
    /export\s+function\s+(\w+)/g,
    (match, name) => {
      return `function ${name}`;
    }
  );

  // export functionの名前を収集してexports追加
  const exportFuncMatches = code.match(/export\s+function\s+(\w+)/g);
  if (exportFuncMatches) {
    const funcNames = exportFuncMatches.map(m => m.match(/export\s+function\s+(\w+)/)![1]);
    funcNames.forEach(name => {
      if (!transformed.includes(`module.exports.${name} = ${name}`)) {
        transformed += `\nmodule.exports.${name} = ${name};`;
      }
    });
  }

  // 9. export class
  // export class MyClass {} → class MyClass {}; module.exports.MyClass = MyClass;
  transformed = transformed.replace(
    /export\s+class\s+(\w+)/g,
    (match, name) => {
      return `class ${name}`;
    }
  );

  // export classの名前を収集してexports追加
  const exportClassMatches = code.match(/export\s+class\s+(\w+)/g);
  if (exportClassMatches) {
    const classNames = exportClassMatches.map(m => m.match(/export\s+class\s+(\w+)/)![1]);
    classNames.forEach(name => {
      if (!transformed.includes(`module.exports.${name} = ${name}`)) {
        transformed += `\nmodule.exports.${name} = ${name};`;
      }
    });
  }

  // 10. export async function
  transformed = transformed.replace(
    /export\s+async\s+function\s+(\w+)/g,
    (match, name) => {
      return `async function ${name}`;
    }
  );

  const exportAsyncFuncMatches = code.match(/export\s+async\s+function\s+(\w+)/g);
  if (exportAsyncFuncMatches) {
    const funcNames = exportAsyncFuncMatches.map(m => m.match(/export\s+async\s+function\s+(\w+)/)![1]);
    funcNames.forEach(name => {
      if (!transformed.includes(`module.exports.${name} = ${name}`)) {
        transformed += `\nmodule.exports.${name} = ${name};`;
      }
    });
  }

  // === import構文の変換 ===

  // 11. import defaultName, { named1, named2 as alias } from '...'
  // → const _temp = require('...'); const defaultName = _temp.default || _temp; const { named1, named2: alias } = _temp;
  transformed = transformed.replace(
    /import\s+(\w+)\s*,\s*\{\s*([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, defaultName, namedImports, modulePath) => {
      const tempVar = `_import_${generateId()}`;
      const named = namedImports.split(',').map((n: string) => n.trim()).filter(Boolean);
      const converted = named.map((n: string) => {
        const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          return `${asMatch[1]}: ${asMatch[2]}`;
        }
        return n;
      }).join(', ');
      
      return `const ${tempVar} = require('${modulePath}');\nconst ${defaultName} = ${tempVar}.default || ${tempVar};\nconst { ${converted} } = ${tempVar};`;
    }
  );

  // 12. import { named1, named2 as alias } from '...'
  // → const { named1, named2: alias } = require('...');
  transformed = transformed.replace(
    /import\s*\{\s*([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, imports, modulePath) => {
      const importList = imports.split(',').map((i: string) => i.trim()).filter(Boolean);
      const converted = importList.map((imp: string) => {
        const asMatch = imp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          return `${asMatch[1]}: ${asMatch[2]}`;
        }
        return imp;
      }).join(', ');
      
      return `const { ${converted} } = require('${modulePath}');`;
    }
  );

  // 13. import defaultName from '...'
  // → const _temp = require('...'); const defaultName = _temp.default || _temp;
  transformed = transformed.replace(
    /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, name, modulePath) => {
      const tempVar = `_import_${generateId()}`;
      return `const ${tempVar} = require('${modulePath}');\nconst ${name} = ${tempVar}.default || ${tempVar};`;
    }
  );

  // 14. import * as name from '...'
  // → const name = require('...');
  transformed = transformed.replace(
    /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?/g,
    (match, name, modulePath) => {
      return `const ${name} = require('${modulePath}');`;
    }
  );

  // 15. import '...' (side-effect import)
  // → require('...');
  transformed = transformed.replace(
    /import\s*['"]([^'"]+)['"]\s*;?/g,
    (match, modulePath) => {
      return `require('${modulePath}');`;
    }
  );

  // 16. import() (dynamic import)
  // → Promise.resolve(require(...))
  transformed = transformed.replace(
    /import\s*\(\s*(['"`][^'"]+['"`])\s*\)/g,
    (match, modulePath) => {
      return `Promise.resolve(require(${modulePath}))`;
    }
  );

  // 文字列リテラルを復元
  transformed = transformed.replace(/__STRING_(\d+)__/g, (match, index) => {
    return strings[parseInt(index)];
  });

  // コメントを復元
  transformed = transformed.replace(/__COMMENT_(\d+)__/g, (match, index) => {
    return comments[parseInt(index)];
  });

  return transformed;
}

/**
 * ユニークなIDを生成
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

/**
 * コードがES Moduleかどうかを判定
 */
export function isESModule(code: string): boolean {
  // コメントと文字列を除外して判定
  const cleaned = code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');

  return /^\s*(import|export)\s+/m.test(cleaned);
}

/**
 * デバッグログ（開発時のみ）
 */
export function debugTransform(original: string, transformed: string): void {
  if (process.env.NODE_ENV === 'development') {
    console.group('🔄 ES Module Transform');
    console.log('Original:', original.substring(0, 200) + (original.length > 200 ? '...' : ''));
    console.log('Transformed:', transformed.substring(0, 200) + (transformed.length > 200 ? '...' : ''));
    console.groupEnd();
  }
}
