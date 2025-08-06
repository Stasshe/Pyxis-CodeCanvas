// ES6 import/export を CommonJS に変換
export function transformESModules(code: string): string {
  
  let transformedCode = code;
  // export { ... } from ... （複数行・コメント入り・as対応・空要素除去）
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, exports: string, modulePath: string) => {
      // コメント除去
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      // 改行・余分な空白・カンマの連続除去
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ').replace(/,+/g, ',');
      // as構文を分解
      const exportList = cleaned.split(',').map((e: string) => e.trim()).filter((e: string) => e.length > 0);
      return exportList.map((exp: string) => {
        const asMatch = exp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          // foo as bar → module.exports.bar = require('module').foo;
          return `module.exports.${asMatch[2]} = require('${modulePath}').${asMatch[1]};`;
        } else {
          // foo → module.exports.foo = require('module').foo;
          return `module.exports.${exp} = require('${modulePath}').${exp};`;
        }
      }).join('\n');
    }
  );

  // export { ... } （from句なし、複数行・コメント入り・as対応・空要素除去）
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\};?/g,
    (match, exports: string) => {
      // コメント除去
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      // 改行・余分な空白・カンマの連続除去
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ').replace(/,+/g, ',');
      // as構文を分解
      const exportList = cleaned.split(',').map((e: string) => e.trim()).filter((e: string) => e.length > 0);
      return exportList.map((exp: string) => {
        const asMatch = exp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          // foo as bar → module.exports.bar = foo;
          return `module.exports.${asMatch[2]} = ${asMatch[1]};`;
        } else {
          // foo → module.exports.foo = foo;
          return `module.exports.${exp} = ${exp};`;
        }
      }).join('\n');
    }
  );
  // export { ... } from ... （複数行・コメント入り・as対応）
  
  // // export default function name(...) {...} → function name(...) {...};
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, exports: string, modulePath: string) => {
      // コメント除去
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      // 改行・余分な空白除去
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ');
      // as構文を分解
      const exportList = cleaned.split(',').map((e: string) => e.trim()).filter((e: string) => e.length > 0);
      return exportList.map((exp: string) => {
        const asMatch = exp.match(/^(\w+)\s+as\s+(\w+)$/);
        if (asMatch) {
          // foo as bar → module.exports.bar = require('module').foo;
          return `module.exports.${asMatch[2]} = require('${modulePath}').${asMatch[1]};`;
        } else {
          // foo → module.exports.foo = require('module').foo;
          return `module.exports.${exp} = require('${modulePath}').${exp};`;
        }
      }).join('\n');
    }
  );
  // transformedCode = transformedCode.replace(
  //   /export\s+default\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g,
  //   (match, funcName, args, body) => {
  //     return `function ${funcName}(${args}) {${body}}\nmodule.exports = ${funcName};`;
  //   }
  // );

  // export default something → module.exports = something;
  transformedCode = transformedCode.replace(
    /export\s+default\s+(.+);?$/gm,
    'module.exports = $1;'
  );



  // import * as something from 'module' → const something = require('module')
  transformedCode = transformedCode.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (match, varName, modulePath) => `const ${varName} = require('${modulePath}');`
  );

  // import { ... } from ... （複数行・コメント入り対応）
  transformedCode = transformedCode.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, imports, modulePath) => {
      // コメント除去
      let cleaned = imports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      // 改行・余分な空白除去
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ');
      // as構文を:に変換
      const converted = cleaned.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2');
      return `const { ${converted.trim()} } = require('${modulePath}');`;
    }
  );

  // import default, { ... } from 'module' → const _temp = require('module'); const default = _temp.default || _temp; const { ... } = _temp;
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (match, defaultImport, namedImports, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      const converted = namedImports.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2');
      return `const ${tempVar} = require('${modulePath}'); const ${defaultImport} = ${tempVar}.default || ${tempVar}; const { ${converted} } = ${tempVar};`;
    }
  );

  // import something from 'module' → const something = require('module').default || require('module')
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (match, varName, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      return `const ${tempVar} = require('${modulePath}'); const ${varName} = ${tempVar}.default || ${tempVar};`;
    }
  );

  // import 'module' → require('module')
  transformedCode = transformedCode.replace(
    /import\s+['"]([^'"]+)['"];?/g,
    (match, modulePath) => `require('${modulePath}');`
  );

  // export { something } →
  transformedCode = transformedCode.replace(
    /export\s+\{([^}]+)\};?/g,
    (match, exports) => {
      const exportList = exports.split(',').map((exp: string) => exp.trim());
      return exportList.map((exp: string) => `module.exports.${exp} = ${exp};`).join('\n');
    }
  );

  // export const/let/var something →
  transformedCode = transformedCode.replace(
    /export\s+(const|let|var)\s+(\w+)\s*=\s*([^;]+);?/g,
    '$1 $2 = $3;'
  );

  // export function name() {...} →
  transformedCode = transformedCode.replace(
    /export\s+function\s+(\w+)/g,
    'function $1'
  );

  // export class Name {...} →
  transformedCode = transformedCode.replace(
    /export\s+class\s+(\w+)/g,
    'class $1'
  );

  // 後処理：exportされた関数やクラスをmodule.exportsに追加
  // export function の後処理
  const exportFunctionMatches = code.match(/export\s+function\s+(\w+)/g);
  if (exportFunctionMatches) {
    exportFunctionMatches.forEach(match => {
      const funcName = match.replace(/export\s+function\s+/, '');
      if (!transformedCode.includes(`module.exports.${funcName} = ${funcName}`)) {
        transformedCode += `\nmodule.exports.${funcName} = ${funcName};`;
      }
    });
  }

  // export class の後処理
  const exportClassMatches = code.match(/export\s+class\s+(\w+)/g);
  if (exportClassMatches) {
    exportClassMatches.forEach(match => {
      const className = match.replace(/export\s+class\s+/, '');
      if (!transformedCode.includes(`module.exports.${className} = ${className}`)) {
        transformedCode += `\nmodule.exports.${className} = ${className};`;
      }
    });
  }

  // export default class の後処理
  const exportDefaultClassMatches = code.match(/export\s+default\s+class\s+(\w+)/g);
  if (exportDefaultClassMatches) {
    exportDefaultClassMatches.forEach(match => {
      const className = match.replace(/export\s+default\s+class\s+/, '');
      if (!transformedCode.includes(`module.exports = ${className}`)) {
        transformedCode += `\nmodule.exports = ${className};\nmodule.exports.default = ${className};`;
      }
    });
  }

  console.log('[transformESModules] Original code:', code.substring(0, 200) + '...');
  console.log('[transformESModules] Transformed code:', transformedCode.substring(0, 200) + '...');

  return transformedCode;
}

// モジュールコードをラップ
export function wrapModuleCode(code: string, globals: any): string {
  return `
    (async function(globals) {
      const { console, process, require, module, exports, __filename, __dirname, Buffer, setTimeout, setInterval, clearTimeout, clearInterval } = globals;

      ${code}

      return module.exports;
    })
  `;
}

// コードを実行用にラップ
export function wrapCodeForExecution(code: string, globals: any): string {
  // ES6 import/export を CommonJS require/module.exports に変換
  const transformedCode = transformESModules(code);

  // 確実に非同期関数として実行されるようにする
  return `
    (async function(globals) {
      // グローバル変数を設定
      const { console, process, require, module, exports, __filename, __dirname, Buffer, setTimeout, setInterval, clearTimeout, clearInterval } = globals;

      // ユーザーコードを実行
      ${transformedCode}
    })
  `;
}
