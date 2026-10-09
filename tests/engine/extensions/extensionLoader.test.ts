import { describe, expect, it } from 'vitest';

import {
  buildExtensionModuleGraph,
  rewriteExtensionModuleImports,
} from '@/engine/extensions/extensionLoader';

describe('extension module import rewriting', () => {
  it('rewrites side-effect, re-export, and dynamic relative imports', () => {
    const resolved: string[] = [];
    const result = rewriteExtensionModuleImports(
      [
        "import './setup.js';",
        "export { value } from '../shared/value.js';",
        "const load = () => import('./panels/detail.js');",
      ].join('\n'),
      specifier => {
        resolved.push(specifier);
        return `blob:${specifier}`;
      }
    );

    expect(resolved).toEqual(['./setup.js', '../shared/value.js', './panels/detail.js']);
    expect(result).toContain("import 'blob:./setup.js';");
    expect(result).toContain("from 'blob:../shared/value.js';");
    expect(result).toContain("import('blob:./panels/detail.js')");
  });

  it('leaves bare package and host imports unchanged', () => {
    const result = rewriteExtensionModuleImports(
      "import React from 'react';\nimport { command } from '@pyxis/extension-api';",
      () => {
        throw new Error('Bare imports should not be resolved as extension files');
      }
    );

    expect(result).toContain("from 'react'");
    expect(result).toContain("from '@pyxis/extension-api'");
  });

  it('does not rewrite import-like text in comments, strings, or templates', () => {
    const result = rewriteExtensionModuleImports(
      [
        "// import './comment.js';",
        'const text = "import(\'./string.js\')";',
        "const template = `import './template.js'`;",
        "import './real.js';",
      ].join('\n'),
      specifier => `blob:${specifier}`
    );

    expect(result).toContain("// import './comment.js';");
    expect(result).toContain('const text = "import(\'./string.js\')";');
    expect(result).toContain("const template = `import './template.js'`;");
    expect(result).toContain("import 'blob:./real.js';");
  });

  it('rejects escaped relative import specifiers without evaluating source text', () => {
    expect(() =>
      rewriteExtensionModuleImports("import './module\\x2ejs';", specifier => specifier)
    ).toThrow('Escaped extension import specifiers are unsupported');
  });

  it('rewrites a built-style binary editor entry without appending match offsets', async () => {
    const entryCode = [
      '/** Binary Editor Extension */',
      'const React = window.__PYXIS_REACT__; const { useState } = React;',
      "import { BYTES_PER_ROW } from './binaryUtils';",
      "import { useBinaryEditorDocument } from './useBinaryEditorDocument';",
      'export async function activate(context) { return { context, BYTES_PER_ROW, useBinaryEditorDocument }; }',
    ].join('\n');
    const blobs: Blob[] = [];
    const graph = buildExtensionModuleGraph(
      entryCode,
      {
        'binaryUtils.js': 'export const BYTES_PER_ROW = 16;',
        'useBinaryEditorDocument.js': 'export function useBinaryEditorDocument() {}',
      },
      'index.js',
      blob => {
        blobs.push(blob);
        return `blob:module-${blobs.length}`;
      }
    );
    const rewrittenEntry = await blobs.at(-1)?.text();

    expect(graph.entryUrl).toBe('blob:module-3');
    expect(rewrittenEntry).toContain('const React = window.__PYXIS_REACT__;');
    expect(rewrittenEntry).toContain("from 'blob:module-1'");
    expect(rewrittenEntry).toContain("from 'blob:module-2'");
    expect(rewrittenEntry).not.toMatch(/from 'blob:module-\d+'\d/);
  });

  it('rejects circular relative module graphs and revokes created URLs', () => {
    const revoked: string[] = [];
    let created = 0;

    expect(() =>
      buildExtensionModuleGraph(
        "import './leaf.js';\nimport './nested/first.js';",
        {
          'leaf.js': 'export const value = 1;',
          'nested/first.js': "import '../index.js';",
        },
        'index.js',
        () => `blob:${created++}`,
        url => revoked.push(url)
      )
    ).toThrow('Circular extension module dependency: index.js');
    expect(revoked).toEqual(['blob:0']);
  });
});
