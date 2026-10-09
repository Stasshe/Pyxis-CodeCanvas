import { ModuleCode, type ModuleSyntaxNode } from './moduleCode';

interface Edit {
  from: number;
  to: number;
  text: string;
}

function applyEdits(source: string, edits: Edit[]): string {
  edits.sort((left, right) => right.from - left.from || right.to - left.to);
  for (const edit of edits) {
    source = source.slice(0, edit.from) + edit.text + source.slice(edit.to);
  }
  return source;
}

function intrinsicCall(source: string, node: ModuleSyntaxNode, name: string): boolean {
  const callee = node.firstChild;
  return (
    node.name === 'CallExpression' &&
    callee?.name === 'VariableName' &&
    source.slice(callee.from, callee.to) === name
  );
}

/** Preserve async expressions through esbuild's synchronous CommonJS export lowering. */
export function protectTopLevelAwait(source: string, filePath: string): string {
  const edits: Edit[] = [];
  ModuleCode.parse(source, filePath)
    .cursor()
    .iterate(node => {
      if (ModuleCode.insideFunction(node.node)) return;
      if (node.name === 'AwaitExpression') {
        const keyword = node.node.firstChild;
        if (!keyword) throw new Error('Await expression has no keyword.');
        edits.push({ from: keyword.from, to: keyword.to, text: '__pyxisAwait(' });
        edits.push({ from: node.to, to: node.to, text: ')' });
      }
      if (node.name !== 'ForStatement') return;
      const keyword = node.node.getChild('await');
      if (!keyword) return;
      const spec = node.node.getChild('ForOfSpec');
      const iterable = spec?.getChild('of')?.nextSibling;
      if (!iterable) throw new Error('For-await statement has no iterable.');
      edits.push({ from: keyword.from, to: keyword.to, text: '' });
      edits.push({ from: iterable.from, to: iterable.from, text: '__pyxisAsyncIterable(' });
      edits.push({ from: iterable.to, to: iterable.to, text: ')' });
    });
  return applyEdits(source, edits);
}

/** Restore syntax before compilation into the async module evaluation function. */
export function restoreTopLevelAwait(source: string): string {
  const edits: Edit[] = [];
  ModuleCode.parse(source)
    .cursor()
    .iterate(node => {
      if (intrinsicCall(source, node.node, '__pyxisAwait')) {
        const callee = node.node.firstChild!;
        const argumentsList = callee.nextSibling!;
        edits.push({ from: callee.from, to: argumentsList.from + 1, text: '(await ' });
      }
      if (node.name !== 'ForStatement') return;
      const spec = node.node.getChild('ForOfSpec');
      const iterable = spec?.getChild('of')?.nextSibling;
      if (!iterable || !intrinsicCall(source, iterable, '__pyxisAsyncIterable')) return;
      const keyword = node.node.getChild('for')!;
      const callee = iterable.firstChild!;
      edits.push({ from: keyword.to, to: keyword.to, text: ' await' });
      edits.push({ from: callee.from, to: callee.to, text: '' });
    });
  return applyEdits(source, edits);
}
