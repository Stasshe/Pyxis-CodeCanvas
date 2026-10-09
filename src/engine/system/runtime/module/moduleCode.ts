import { parser } from '@lezer/javascript';

const NativeFunction = globalThis.Function;

export type ModuleKind = 'require' | 'import';
export type ModuleFormat = 'module' | 'commonjs';
export interface ModuleDependency {
  specifier: string;
  kind: ModuleKind;
}

export type ModuleSyntaxNode = ReturnType<typeof parser.parse>['topNode'];

export interface ModuleAnalysis {
  dependencies: ModuleDependency[];
  hasEsmSyntax: boolean;
  hasDynamicImport: boolean;
  hasTopLevelAwait: boolean;
  staticImports: string[];
}

export class ModuleCode {
  static parse(content: string, filePath = ''): ModuleSyntaxNode {
    const dialects: string[] = [];
    if (ModuleCode.isTypeScript(filePath)) dialects.push('ts');
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) dialects.push('jsx');
    const configuredParser = parser.configure({ dialect: dialects.join(' ') });
    let normalized = content;
    let syntax = configuredParser.parse(normalized);
    while (true) {
      const next = ModuleCode.normalizeNamespaceExportNames(normalized, syntax.topNode);
      if (next === normalized) return syntax.topNode;
      normalized = next;
      syntax = configuredParser.parse(normalized);
    }
  }

  static isTypeScript(filePath: string): boolean {
    return ['.ts', '.tsx', '.mts', '.cts'].some(extension => filePath.endsWith(extension));
  }

  static analyze(content: string, filePath = ''): ModuleAnalysis {
    const root = ModuleCode.parse(content, filePath);
    const dependencies = new Map<string, ModuleDependency>();
    let hasEsmSyntax = false;
    let hasDynamicImport = false;
    let hasTopLevelAwait = false;
    const staticImports = new Set<string>();
    const addDependency = (node: ModuleSyntaxNode, kind: ModuleKind) => {
      const specifier = ModuleCode.stringValue(content, node);
      dependencies.set(`${kind}:${specifier}`, { specifier, kind });
      return specifier;
    };

    root.cursor().iterate(node => {
      if (node.name === 'ImportDeclaration' || node.name === 'ExportDeclaration') {
        if (ModuleCode.isTypeOnly(node.node)) return false;
        hasEsmSyntax = true;
        const literal = ModuleCode.moduleSpecifier(node.node);
        if (literal && ModuleCode.isStaticString(literal)) {
          staticImports.add(addDependency(literal, 'import'));
        }
      }
      if (node.name === 'ImportMeta') hasEsmSyntax = true;
      if (
        (node.name === 'AwaitExpression' ||
          (node.name === 'ForStatement' && node.node.getChild('await'))) &&
        !ModuleCode.insideFunction(node.node)
      ) {
        hasEsmSyntax = true;
        hasTopLevelAwait = true;
      }
      if (node.name === 'DynamicImport') {
        hasDynamicImport = true;
        const literal = node.node.getChild('String') || node.node.getChild('TemplateString');
        if (literal && ModuleCode.isStaticString(literal)) addDependency(literal, 'import');
      }
      if (node.name === 'VariableDeclaration' && node.node.parent?.name === 'Script') {
        const keyword = node.node.firstChild?.name;
        if (keyword === 'const' || keyword === 'let') {
          for (const binding of node.node.getChildren('VariableDefinition')) {
            if (
              ['require', 'module', 'exports', '__filename', '__dirname'].includes(
                content.slice(binding.from, binding.to)
              )
            )
              hasEsmSyntax = true;
          }
        }
      }
      if (node.name === 'ClassDeclaration' && node.node.parent?.name === 'Script') {
        const binding = node.node.getChild('VariableDefinition');
        if (
          binding &&
          ['require', 'module', 'exports', '__filename', '__dirname'].includes(
            content.slice(binding.from, binding.to)
          )
        )
          hasEsmSyntax = true;
      }
      if (node.name !== 'CallExpression') return;
      const callee = node.node.firstChild;
      if (callee?.name !== 'VariableName') return;
      const name = content.slice(callee.from, callee.to);
      let kind: ModuleKind = 'require';
      if (name === '__pyxisImport' || name === '__pyxisRequireImport') kind = 'import';
      else if (name !== 'require' && name !== '__pyxisRequireCommonJs') return;
      const argumentsNode = node.node.getChild('ArgList');
      const literal = argumentsNode?.firstChild?.nextSibling;
      if (!literal || !ModuleCode.isStaticString(literal)) return;
      const following = literal.nextSibling;
      if (following?.name !== ')') return;
      const specifier = addDependency(literal, kind);
      if (name === '__pyxisRequireImport' && !ModuleCode.insideFunction(node.node)) {
        staticImports.add(specifier);
      }
    });

    return {
      dependencies: [...dependencies.values()],
      hasEsmSyntax,
      hasDynamicImport,
      hasTopLevelAwait,
      staticImports: [...staticImports],
    };
  }

  static needsTranspile(
    filePath: string,
    analysis: ModuleAnalysis,
    type?: 'module' | 'commonjs'
  ): boolean {
    if (ModuleCode.isTypeScript(filePath) || filePath.endsWith('.jsx')) return true;
    if (analysis.hasDynamicImport) return true;
    return ModuleCode.format(filePath, analysis, type) === 'module';
  }

  static format(filePath: string, analysis: ModuleAnalysis, type?: ModuleFormat): ModuleFormat {
    if (filePath.endsWith('.mjs') || filePath.endsWith('.mts')) return 'module';
    if (filePath.endsWith('.cjs') || filePath.endsWith('.cts')) return 'commonjs';
    if (type) return type;
    if (analysis.hasEsmSyntax) return 'module';
    return 'commonjs';
  }

  static runtimeCode(content: string, generatedRequires = false, asyncImports = false): string {
    const replacements: { from: number; to: number; text: string }[] = [];
    ModuleCode.parse(content)
      .cursor()
      .iterate(node => {
        if (node.name === 'DynamicImport') {
          const keyword = node.node.firstChild;
          if (keyword)
            replacements.push({ from: keyword.from, to: keyword.to, text: '__pyxisImport' });
        }
        if (asyncImports && node.name === 'CallExpression') {
          const callee = node.node.firstChild;
          if (
            callee?.name === 'VariableName' &&
            content.slice(callee.from, callee.to) === '__pyxisRequireImport'
          ) {
            replacements.push({
              from: callee.from,
              to: callee.to,
              text: '(await __pyxisLoadImport',
            });
            replacements.push({ from: node.to, to: node.to, text: ')' });
          }
        }
        if (!generatedRequires || node.name !== 'CallExpression') return;
        const callee = node.node.firstChild;
        if (
          callee?.name === 'VariableName' &&
          content.slice(callee.from, callee.to) === 'require'
        ) {
          replacements.push({ from: callee.from, to: callee.to, text: '__pyxisRequireImport' });
        }
      });
    let transformed = content;
    replacements.sort((left, right) => right.from - left.from || right.to - left.to);
    for (const replacement of replacements) {
      transformed =
        transformed.slice(0, replacement.from) +
        replacement.text +
        transformed.slice(replacement.to);
    }
    return transformed;
  }

  static insideFunction(node: ModuleSyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction'].includes(parent.name))
        return true;
      if (parent.name === 'Property' || parent.name === 'MethodDeclaration') {
        const parameters = parent.getChild('ParamList');
        const body = parent.getChild('Block');
        if (parameters && body && node.from >= parameters.from && node.to <= body.to) return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  private static stringValue(content: string, node: ModuleSyntaxNode): string {
    // The grammar guarantees a string literal; evaluate only that literal to decode JS escapes.
    const value: string = NativeFunction(
      `"use strict"; return (${content.slice(node.from, node.to)});`
    )();
    return value;
  }

  private static isStaticString(node: ModuleSyntaxNode): boolean {
    if (node.name === 'String') return true;
    return node.name === 'TemplateString' && node.getChild('Interpolation') === null;
  }

  private static moduleSpecifier(node: ModuleSyntaxNode): ModuleSyntaxNode | null {
    let child = node.firstChild;
    while (child) {
      if (
        (child.name === 'String' || child.name === 'TemplateString') &&
        (child.prevSibling?.name === 'from' ||
          (node.name === 'ImportDeclaration' && child.prevSibling?.name === 'import'))
      )
        return child;
      child = child.nextSibling;
    }
    return null;
  }

  private static normalizeNamespaceExportNames(content: string, root: ModuleSyntaxNode): string {
    const replacements: { from: number; to: number; text: string }[] = [];
    root.cursor().iterate(node => {
      if (node.name !== 'ExportDeclaration') return;
      let child = node.node.firstChild;
      while (child && child.name !== 'Star') child = child.nextSibling;
      if (!child) return;
      child = child.nextSibling;
      if (child?.name !== 'as') return;
      const alias = child?.nextSibling;
      if (alias?.name !== 'String' && alias?.name !== '⚠') return;
      const source = content.slice(alias.from);
      const match = /^([A-Za-z_$][\w$]*)/.exec(source);
      if (!match) return;
      const separator = source[match[1].length];
      if (!/\s/.test(separator ?? '') && separator !== '/') return;
      replacements.push({
        from: alias.from,
        to: alias.from + match[1].length,
        text: 'x'.repeat(match[1].length),
      });
    });
    if (replacements.length === 0) return content;
    // Lezer misreads reserved IdentifierName aliases as String nodes; keep source offsets stable.
    let normalized = content;
    for (const replacement of replacements.reverse()) {
      normalized =
        normalized.slice(0, replacement.from) + replacement.text + normalized.slice(replacement.to);
    }
    return normalized;
  }

  private static isTypeOnly(node: ModuleSyntaxNode): boolean {
    if (node.getChild('type')) return true;
    if (
      node.getChild('InterfaceDeclaration') ||
      node.getChild('TypeAliasDeclaration') ||
      node.getChild('AmbientDeclaration')
    )
      return true;
    const group = node.getChild('ImportGroup');
    if (!group || node.getChild('VariableDefinition')) return false;
    let child = group.firstChild;
    while (child) {
      if (child.name === 'VariableDefinition' && child.prevSibling?.name !== 'type') return false;
      child = child.nextSibling;
    }
    return group.getChild('type') !== null;
  }
}
