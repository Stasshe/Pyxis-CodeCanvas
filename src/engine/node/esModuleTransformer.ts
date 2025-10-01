// #エイリアス解決用関数
function resolveImportAlias(moduleName: string, importsMap: Record<string, any>): string {
  const entry = importsMap && importsMap[moduleName];
  if (!entry) return moduleName;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') return entry.default || entry.node || Object.values(entry)[0];
  return moduleName;
}

// ES6 import/export を CommonJS に変換（importsMapで#エイリアス解決）
export function transformESModules(code: string, importsMap?: Record<string, any>): string {
  let transformedCode = code;

  // #エイリアスの置換（import, require, from句）
  if (importsMap) {
    // require('...')
    transformedCode = transformedCode.replace(
      /require\s*\(\s*['"](#\w[\w-]*)['"]\s*\)/g,
      (match, moduleName) => {
        const resolved = resolveImportAlias(moduleName, importsMap);
        return match.replace(moduleName, resolved);
      }
    );
    // from '...'
    transformedCode = transformedCode.replace(
      /from\s+['"](#\w[\w-]*)['"]/g,
      (match, moduleName) => {
        const resolved = resolveImportAlias(moduleName, importsMap);
        return match.replace(moduleName, resolved);
      }
    );
    // import '...'
    transformedCode = transformedCode.replace(
      /import\s+['"](#\w[\w-]*)['"]/g,
      (match, moduleName) => {
        const resolved = resolveImportAlias(moduleName, importsMap);
        return match.replace(moduleName, resolved);
      }
    );
  }

  // ...既存の変換処理...
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, exports: string, modulePath: string) => {
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ').replace(/,+/g, ',');
      const exportList = cleaned
        .split(',')
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0);
      return exportList
        .map((exp: string) => {
          const asMatch = exp.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
          if (asMatch) {
            return `module.exports.${asMatch[2]} = require('${modulePath}').${asMatch[1]};`;
          } else {
            return `module.exports.${exp} = require('${modulePath}').${exp};`;
          }
        })
        .join('\n');
    }
  );
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\};?/g,
    (match, exports: string) => {
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ').replace(/,+/g, ',');
      const exportList = cleaned
        .split(',')
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0);
      return exportList
        .map((exp: string) => {
          const asMatch = exp.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
          if (asMatch) {
            return `module.exports.${asMatch[2]} = ${asMatch[1]};`;
          } else {
            return `module.exports.${exp} = ${exp};`;
          }
        })
        .join('\n');
    }
  );
  transformedCode = transformedCode.replace(
    /export\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, exports: string, modulePath: string) => {
      let cleaned = exports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ');
      const exportList = cleaned
        .split(',')
        .map((e: string) => e.trim())
        .filter((e: string) => e.length > 0);
      return exportList
        .map((exp: string) => {
          const asMatch = exp.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
          if (asMatch) {
            return `module.exports.${asMatch[2]} = require('${modulePath}').${asMatch[1]};`;
          } else {
            return `module.exports.${exp} = require('${modulePath}').${exp};`;
          }
        })
        .join('\n');
    }
  );
  transformedCode = transformedCode.replace(/export\s+default\s+(.+);?$/gm, 'module.exports = $1;');
  transformedCode = transformedCode.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (match, varName, modulePath) => `const ${varName} = require('${modulePath}');`
  );
  transformedCode = transformedCode.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (match, imports, modulePath) => {
      let cleaned = imports.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      cleaned = cleaned.replace(/\n/g, '').replace(/\s+/g, ' ');
      const converted = cleaned.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2');
      return `const { ${converted.trim()} } = require('${modulePath}');`;
    }
  );
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (match, defaultImport, namedImports, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      const converted = namedImports.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2');
      return `const ${tempVar} = require('${modulePath}'); const ${defaultImport} = ${tempVar}.default || ${tempVar}; const { ${converted} } = ${tempVar};`;
    }
  );
  transformedCode = transformedCode.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (match, varName, modulePath) => {
      const tempVar = `_temp_${Math.random().toString(36).substr(2, 9)}`;
      return `const ${tempVar} = require('${modulePath}'); const ${varName} = ${tempVar}.default || ${tempVar};`;
    }
  );
  transformedCode = transformedCode.replace(
    /import\s+['"]([^'"]+)['"];?/g,
    (match, modulePath) => `require('${modulePath}');`
  );
  transformedCode = transformedCode.replace(/export\s+\{([^}]+)\};?/g, (match, exports) => {
    const exportList = exports.split(',').map((exp: string) => exp.trim());
    return exportList.map((exp: string) => `module.exports.${exp} = ${exp};`).join('\n');
  });
  transformedCode = transformedCode.replace(
    /export\s+(const|let|var)\s+(\w+)\s*=\s*([^;]+);?/g,
    '$1 $2 = $3;'
  );
  transformedCode = transformedCode.replace(/export\s+function\s+(\w+)/g, 'function $1');
  transformedCode = transformedCode.replace(/export\s+class\s+(\w+)/g, 'class $1');
  const exportFunctionMatches = code.match(/export\s+function\s+(\w+)/g);
  if (exportFunctionMatches) {
    exportFunctionMatches.forEach(match => {
      const funcName = match.replace(/export\s+function\s+/, '');
      if (!transformedCode.includes(`module.exports.${funcName} = ${funcName}`)) {
        transformedCode += `\nmodule.exports.${funcName} = ${funcName};`;
      }
    });
  }
  const exportClassMatches = code.match(/export\s+class\s+(\w+)/g);
  if (exportClassMatches) {
    exportClassMatches.forEach(match => {
      const className = match.replace(/export\s+class\s+/, '');
      if (!transformedCode.includes(`module.exports.${className} = ${className}`)) {
        transformedCode += `\nmodule.exports.${className} = ${className};`;
      }
    });
  }
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
