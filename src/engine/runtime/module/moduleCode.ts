export class ModuleCode {
  static async contentVersion(content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  static requireDependencies(content: string): string[] {
    const dependencies = new Set<string>();
    const patterns = [
      /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
      /\b__pyxisImport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const dependency = match[2];
        if (/[{}<>]/.test(dependency)) continue;
        dependencies.add(dependency);
      }
    }
    return Array.from(dependencies);
  }

  static needsTranspile(filePath: string, content: string): boolean {
    if (/\.(ts|tsx|mts|cts|jsx)$/.test(filePath)) return true;
    if (/\.mjs$/.test(filePath)) return true;
    if (/\bimport\s*\(/.test(content)) return true;
    if (
      /new\s+Function\s*\(\s*(['"])module\1\s*,\s*(['"])return\s+import\(module\)\2\s*\)/.test(
        content
      )
    ) {
      return true;
    }
    return ModuleCode.isESModule(content);
  }

  static isESModule(content: string): boolean {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '');
    return /\b(import|export)\b/.test(cleaned);
  }
}
