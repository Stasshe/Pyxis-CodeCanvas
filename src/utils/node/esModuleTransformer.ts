// ES6 import/export を CommonJS に変換
export function transformESModules(code: string): string {
  let transformedCode = code;

  // export default function name(...) {...} → function name(...) {...};
  transformedCode = transformedCode.replace(
    /export\s+default\s+function\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/g,
    (match, funcName, args, body) => {
      return `function ${funcName}(${args}) {${body}}\nmodule.exports = ${funcName};`;
    }
  );

  // export default something → module.exports = something;
  transformedCode = transformedCode.replace(
    /export\s+default\s+(.+);?$/gm,
    'module.exports = $1;'
  );

  // import文を require に変換
  // import Utils, { helper } from 'module' → const _temp = require('module'); const Utils = _temp.default || _temp; const { helper } = _temp;
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (match, defaultImport, namedImports, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      return `const ${tempVar} = require('${modulePath}'); const ${defaultImport} = ${tempVar}.default || ${tempVar}; const { ${namedImports} } = ${tempVar};`;
    }
  );

  // import { something } from 'module' → const { something } = require('module')
  transformedCode = transformedCode.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    'const { $1 } = require(\'$2\');'
  );

  // import something from 'module' → const something = require('module').default || require('module')
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (match, varName, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      return `const ${tempVar} = require('${modulePath}'); const ${varName} = ${tempVar}.default || ${tempVar};`;
    }
  );

  // import * as something from 'module' → const something = require('module')
  transformedCode = transformedCode.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    'const $1 = require(\'$2\');'
  );

  // import 'module' → require('module')
  transformedCode = transformedCode.replace(
    /import\s+['"]([^'"]+)['"];?/g,
    'require(\'$1\');'
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

  // // export default class の後処理
  // const exportDefaultClassMatches = code.match(/export\s+default\s+class\s+(\w+)/g);
  // if (exportDefaultClassMatches) {
  //   exportDefaultClassMatches.forEach(match => {
  //     const className = match.replace(/export\s+default\s+class\s+/, '');
  //     if (!transformedCode.includes(`module.exports = ${className}`)) {
  //       transformedCode += `\nmodule.exports = ${className};\nmodule.exports.default = ${className};`;
  //     }
  //   });
  // }

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
