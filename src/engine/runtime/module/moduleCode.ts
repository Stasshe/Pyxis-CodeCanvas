import { parser } from '@lezer/javascript';

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
}

export class ModuleCode {
  static parse(content: string, filePath = ''): ModuleSyntaxNode {
    const dialects: string[] = [];
    if (ModuleCode.isTypeScript(filePath)) dialects.push('ts');
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) dialects.push('jsx');
    return parser.configure({ dialect: dialects.join(' ') }).parse(content).topNode;
  }

  static isTypeScript(filePath: string): boolean {
    return ['.ts', '.tsx', '.mts', '.cts'].some(extension => filePath.endsWith(extension));
  }

  static analyze(content: string, filePath = ''): ModuleAnalysis {
    const root = ModuleCode.parse(content, filePath);
    const dependencies = new Map<string, ModuleDependency>();
    let hasEsmSyntax = false;
    let hasDynamicImport = false;
    const addDependency = (node: ModuleSyntaxNode, kind: ModuleKind) => {
      const specifier = ModuleCode.stringValue(content, node);
      dependencies.set(`${kind}:${specifier}`, { specifier, kind });
    };

    root.cursor().iterate(node => {
      if (node.name === 'ImportDeclaration' || node.name === 'ExportDeclaration') {
        if (ModuleCode.isTypeOnly(node.node)) return false;
        hasEsmSyntax = true;
        const literal = node.node.getChild('String') || node.node.getChild('TemplateString');
        if (literal && ModuleCode.isStaticString(literal)) addDependency(literal, 'import');
      }
      if (node.name === 'ImportMeta') hasEsmSyntax = true;
      if (node.name === 'AwaitExpression' && !ModuleCode.insideFunction(node.node)) {
        hasEsmSyntax = true;
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
      addDependency(literal, kind);
    });

    return {
      dependencies: [...dependencies.values()],
      hasEsmSyntax,
      hasDynamicImport,
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

  static runtimeCode(content: string, generatedRequires = false): string {
    const replacements: { from: number; to: number; text: string }[] = [];
    ModuleCode.parse(content)
      .cursor()
      .iterate(node => {
        if (node.name === 'DynamicImport') {
          const keyword = node.node.firstChild;
          if (keyword)
            replacements.push({ from: keyword.from, to: keyword.to, text: '__pyxisImport' });
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
    for (const replacement of replacements.reverse()) {
      transformed =
        transformed.slice(0, replacement.from) +
        replacement.text +
        transformed.slice(replacement.to);
    }
    return transformed;
  }

  private static insideFunction(node: ModuleSyntaxNode): boolean {
    let parent = node.parent;
    while (parent) {
      if (
        [
          'FunctionDeclaration',
          'FunctionExpression',
          'ArrowFunction',
          'MethodDeclaration',
        ].includes(parent.name)
      )
        return true;
      parent = parent.parent;
    }
    return false;
  }

  private static stringValue(content: string, node: ModuleSyntaxNode): string {
    // The grammar guarantees a string literal; evaluate only that literal to decode JS escapes.
    const value: string = Function(
      `"use strict"; return (${content.slice(node.from, node.to)});`
    )();
    return value;
  }

  private static isStaticString(node: ModuleSyntaxNode): boolean {
    if (node.name === 'String') return true;
    return node.name === 'TemplateString' && node.getChild('Interpolation') === null;
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
