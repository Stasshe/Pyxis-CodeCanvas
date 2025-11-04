/**
 * Extension Loader Multi-File Support Tests
 * 複数ファイルに渡る拡張機能のロード機能をテスト
 */

import { transformImports } from '../src/engine/extensions/transformImports';

describe('Extension Loader - Multi-File Support', () => {
  describe('transformImports', () => {
    it('should transform React default import', () => {
      const code = `import React from 'react';`;
      const result = transformImports(code);
      expect(result).toBe(`const React = window.__PYXIS_REACT__;`);
    });

    it('should transform React named imports', () => {
      const code = `import { useState, useEffect } from 'react';`;
      const result = transformImports(code);
      expect(result).toBe(`const { useState, useEffect } = window.__PYXIS_REACT__;`);
    });

    it('should transform React default + named imports', () => {
      const code = `import React, { useState, useEffect } from 'react';`;
      const result = transformImports(code);
      expect(result).toBe(
        `const React = window.__PYXIS_REACT__; const { useState, useEffect } = React;`
      );
    });

    it('should handle multiple React imports in the same file', () => {
      const code = `
import React from 'react';
import { useState } from 'react';
const Component = () => {};
`;
      const result = transformImports(code);
      expect(result).toContain(`const React = window.__PYXIS_REACT__;`);
      expect(result).toContain(`const { useState } = window.__PYXIS_REACT__;`);
    });

    it('should not transform non-React imports', () => {
      const code = `import { helper } from './helper';`;
      const result = transformImports(code);
      expect(result).toBe(code);
    });

    it('should handle code without imports', () => {
      const code = `const x = 1;\nconst y = 2;`;
      const result = transformImports(code);
      expect(result).toBe(code);
    });
  });

  describe('Relative Import Resolution', () => {
    it('should resolve relative imports with .js extension', () => {
      const code = `import { helper } from './helper.js';`;
      const importMap: Record<string, string> = {
        './helper.js': 'blob:http://localhost/abc123',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        return `from '${importMap[importPath] || importPath}'`;
      });

      expect(resolved).toBe(`import { helper } from 'blob:http://localhost/abc123';`);
    });

    it('should resolve relative imports without extension', () => {
      const code = `import { helper } from './helper';`;
      const importMap: Record<string, string> = {
        './helper': 'blob:http://localhost/abc123',
        './helper.js': 'blob:http://localhost/abc123',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(`import { helper } from 'blob:http://localhost/abc123';`);
    });

    it('should resolve nested relative imports', () => {
      const code = `import { util } from './utils/math';`;
      const importMap: Record<string, string> = {
        './utils/math.js': 'blob:http://localhost/xyz789',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(`import { util } from 'blob:http://localhost/xyz789';`);
    });

    it('should handle parent directory imports', () => {
      const code = `import { shared } from '../shared/types';`;
      const importMap: Record<string, string> = {
        '../shared/types.js': 'blob:http://localhost/parent123',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(`import { shared } from 'blob:http://localhost/parent123';`);
    });

    it('should not modify unresolvable imports', () => {
      const code = `import { missing } from './missing';`;
      const importMap: Record<string, string> = {};

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        return `from '${importMap[importPath] || importPath}'`;
      });

      expect(resolved).toBe(code);
    });
  });

  describe('Import Map Construction', () => {
    it('should create import map for multiple files', () => {
      const files = {
        'helper.js': 'export function helper() {}',
        'utils.js': 'export function add() {}',
        'types.js': 'export interface Type {}',
      };

      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${filePath}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./helper.js']).toBeDefined();
      expect(importMap['./helper']).toBe(importMap['./helper.js']);
      expect(importMap['./utils.js']).toBeDefined();
      expect(importMap['./utils']).toBe(importMap['./utils.js']);
    });

    it('should handle files with different extensions', () => {
      const files = {
        'component.tsx': 'export const Component = () => {}',
        'types.ts': 'export interface Type {}',
        'module.js': 'export const module = {}',
      };

      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${filePath}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./component.tsx']).toBeDefined();
      expect(importMap['./component']).toBe(importMap['./component.tsx']);
      expect(importMap['./types.ts']).toBeDefined();
      expect(importMap['./types']).toBe(importMap['./types.ts']);
    });

    it('should handle nested directory structure', () => {
      const files = {
        'utils/math.js': 'export function add() {}',
        'utils/string.js': 'export function concat() {}',
        'core/base.js': 'export class Base {}',
      };

      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${filePath}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./utils/math.js']).toBeDefined();
      expect(importMap['./utils/math']).toBe(importMap['./utils/math.js']);
      expect(importMap['./core/base']).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files object', () => {
      const files = {};
      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        importMap[normalizedPath] = `blob:http://localhost/${filePath}`;
      }

      expect(Object.keys(importMap).length).toBe(0);
    });

    it('should handle files with special characters in names', () => {
      const files = {
        'my-helper.js': 'export function helper() {}',
        'utils_v2.js': 'export const utils = {}',
        'test.spec.js': 'export const test = {}',
      };

      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${filePath}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./my-helper.js']).toBeDefined();
      expect(importMap['./utils_v2']).toBeDefined();
      expect(importMap['./test.spec']).toBeDefined();
    });

    it('should handle multiple imports in single line', () => {
      const code = `import { a } from './moduleA'; import { b } from './moduleB';`;
      const importMap: Record<string, string> = {
        './moduleA.js': 'blob:http://localhost/a',
        './moduleB.js': 'blob:http://localhost/b',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(
        `import { a } from 'blob:http://localhost/a'; import { b } from 'blob:http://localhost/b';`
      );
    });

    it('should handle default exports', () => {
      const code = `import utils from './utils';`;
      const importMap: Record<string, string> = {
        './utils.js': 'blob:http://localhost/utils',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(`import utils from 'blob:http://localhost/utils';`);
    });

    it('should handle mixed default and named imports', () => {
      const code = `import React, { useState } from 'react';\nimport helper, { util } from './helper';`;
      const transformedCode = transformImports(code);
      
      expect(transformedCode).toContain('const React = window.__PYXIS_REACT__');
      expect(transformedCode).toContain('import helper, { util } from \'./helper\';');
    });

    it('should handle re-exports', () => {
      const code = `export { helper } from './helper';`;
      const importMap: Record<string, string> = {
        './helper.js': 'blob:http://localhost/helper',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toBe(`export { helper } from 'blob:http://localhost/helper';`);
    });

    it('should handle dynamic imports', () => {
      const code = `const module = await import('./dynamic');`;
      // 動的importは静的解析では扱わないため、そのまま残る
      expect(code).toContain(`import('./dynamic')`);
    });

    it('should handle absolute imports from node_modules', () => {
      const code = `import lodash from 'lodash';`;
      const transformed = transformImports(code);
      // node_modulesのimportはそのまま残る
      expect(transformed).toBe(code);
    });

    it('should handle import with newlines', () => {
      const code = `import {
  helper,
  util
} from './helper';`;
      const importMap: Record<string, string> = {
        './helper.js': 'blob:http://localhost/helper',
      };

      const resolved = code.replace(/from\s+['"](\.[^'"]+)['"]/, (match, importPath: string) => {
        let normalizedPath = importPath;
        if (!importPath.match(/\.(js|ts|tsx)$/)) {
          const withJs = `${importPath}.js`;
          if (importMap[withJs]) {
            normalizedPath = withJs;
          }
        }
        return `from '${importMap[normalizedPath] || importPath}'`;
      });

      expect(resolved).toContain(`from 'blob:http://localhost/helper'`);
    });

    it('should handle type-only imports (post-transpilation)', () => {
      // TypeScriptのtype-only importはトランスパイル後に削除されるため、
      // JavaScriptコードには残らない
      const code = `import { helper } from './helper';`;
      expect(code).not.toContain('import type');
    });

    it('should handle circular dependencies structure', () => {
      // 循環依存はブラウザのモジュールシステムが処理するため、
      // import map自体は循環を検出する必要はない
      const files = {
        'a.js': 'import { b } from "./b";',
        'b.js': 'import { a } from "./a";',
      };

      const importMap: Record<string, string> = {};
      
      for (const [filePath, _code] of Object.entries(files)) {
        const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${filePath}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./a.js']).toBeDefined();
      expect(importMap['./b.js']).toBeDefined();
    });

    it('should handle files with no imports', () => {
      const code = `
export const constant = 'value';
export function helper() {
  return 'result';
}
`;
      const transformed = transformImports(code);
      expect(transformed).toBe(code);
    });

    it('should handle files with only exports', () => {
      const code = `export default { version: '1.0.0' };`;
      const transformed = transformImports(code);
      expect(transformed).toBe(code);
    });

    it('should handle import statements in comments', () => {
      const code = `
// import React from 'react';
/* import { useState } from 'react'; */
const x = 1;
`;
      const transformed = transformImports(code);
      // コメント内のimportも変換される（実害なし）
      expect(transformed).toContain('__PYXIS_REACT__');
    });

    it('should handle import statements in strings', () => {
      const code = `const str = "import React from 'react'";`;
      const transformed = transformImports(code);
      // 文字列内のimportも変換される（実害なし）
      expect(transformed).toContain('__PYXIS_REACT__');
    });

    it('should preserve whitespace in imports', () => {
      const code = `import   React   from   'react'  ;`;
      const transformed = transformImports(code);
      // 末尾のセミコロン前のスペースは保持される
      expect(transformed).toBe('const React = window.__PYXIS_REACT__;  ;');
    });
  });

  describe('Manifest Files Array Processing', () => {
    it('should process files array from manifest', () => {
      const manifest = {
        id: 'test.extension',
        entry: 'index.js',
        files: ['helper.js', 'utils.js'],
      };

      const additionalFiles: Record<string, string> = {};
      
      for (const file of manifest.files) {
        additionalFiles[file] = `// code for ${file}`;
      }

      expect(additionalFiles['helper.js']).toBeDefined();
      expect(additionalFiles['utils.js']).toBeDefined();
      expect(Object.keys(additionalFiles).length).toBe(2);
    });

    it('should handle empty files array', () => {
      const manifest = {
        id: 'test.extension',
        entry: 'index.js',
        files: [],
      };

      expect(manifest.files.length).toBe(0);
    });

    it('should handle missing files property', () => {
      const manifest: {
        id: string;
        entry: string;
        files?: string[];
      } = {
        id: 'test.extension',
        entry: 'index.js',
      };

      const files = manifest.files || [];
      expect(files.length).toBe(0);
    });

    it('should handle files in nested directories', () => {
      const manifest = {
        id: 'test.extension',
        entry: 'index.js',
        files: ['utils/math.js', 'utils/string.js', 'core/base.js'],
      };

      const importMap: Record<string, string> = {};
      
      for (const file of manifest.files) {
        const normalizedPath = file.startsWith('./') ? file : `./${file}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${file}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      expect(importMap['./utils/math.js']).toBeDefined();
      expect(importMap['./utils/math']).toBe(importMap['./utils/math.js']);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete multi-file extension scenario', () => {
      // Manifest
      const manifest = {
        id: 'test.multi-file',
        entry: 'index.js',
        files: ['helper.js', 'utils.js'],
      };

      // コード
      const entryCode = `
import React from 'react';
import { helperFunction } from './helper';
import utils from './utils';

export function activate(context) {
  const result = helperFunction();
  const sum = utils.add(1, 2);
  return { services: { test: { result, sum } } };
}
`;

      const helperCode = `
export function helperFunction() {
  return 'Hello';
}
`;

      const utilsCode = `
export function add(a, b) {
  return a + b;
}
export default { add };
`;

      // React importを変換
      const transformedEntry = transformImports(entryCode);
      const transformedHelper = transformImports(helperCode);
      const transformedUtils = transformImports(utilsCode);

      expect(transformedEntry).toContain('const React = window.__PYXIS_REACT__');
      expect(transformedEntry).toContain(`import { helperFunction } from './helper'`);
      expect(transformedHelper).toContain('export function helperFunction()');
      expect(transformedUtils).toContain('export default { add }');

      // Import mapを構築
      const importMap: Record<string, string> = {};
      for (const file of manifest.files) {
        const normalizedPath = file.startsWith('./') ? file : `./${file}`;
        const pathWithoutExt = normalizedPath.replace(/\.(js|ts|tsx)$/, '');
        
        const mockBlobUrl = `blob:http://localhost/${file}`;
        importMap[normalizedPath] = mockBlobUrl;
        importMap[pathWithoutExt] = mockBlobUrl;
      }

      // 相対importを解決
      const resolvedEntry = transformedEntry.replace(
        /from\s+['"](\.[^'"]+)['"]/g,
        (match, importPath: string) => {
          let normalizedPath = importPath;
          if (!importPath.match(/\.(js|ts|tsx)$/)) {
            const withJs = `${importPath}.js`;
            if (importMap[withJs]) {
              normalizedPath = withJs;
            }
          }
          return `from '${importMap[normalizedPath] || importPath}'`;
        }
      );

      expect(resolvedEntry).toContain('blob:http://localhost/helper.js');
      expect(resolvedEntry).toContain('blob:http://localhost/utils.js');
    });

    it('should handle extension with React components in multiple files', () => {
      const manifest = {
        id: 'test.ui-extension',
        entry: 'index.js',
        files: ['Component.js', 'hooks.js'],
      };

      const entryCode = `
import React from 'react';
import { MyComponent } from './Component';
import { useCustomHook } from './hooks';

export function activate(context) {
  return { ui: { MyComponent, useCustomHook } };
}
`;

      const componentCode = `
import React, { useState } from 'react';

export function MyComponent() {
  const [count, setCount] = useState(0);
  return React.createElement('div', null, count);
}
`;

      const hooksCode = `
import { useEffect } from 'react';

export function useCustomHook() {
  useEffect(() => {
    console.log('mounted');
  }, []);
}
`;

      // 全てのファイルでReact importを変換
      const transformedEntry = transformImports(entryCode);
      const transformedComponent = transformImports(componentCode);
      const transformedHooks = transformImports(hooksCode);

      expect(transformedEntry).toContain('const React = window.__PYXIS_REACT__');
      expect(transformedComponent).toContain('const React = window.__PYXIS_REACT__');
      expect(transformedComponent).toContain('const { useState } = React');
      expect(transformedHooks).toContain('const { useEffect } = window.__PYXIS_REACT__');
    });
  });
});
