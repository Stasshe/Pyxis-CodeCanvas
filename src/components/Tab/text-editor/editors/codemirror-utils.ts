import { autocompletion } from '@codemirror/autocomplete';
import { history } from '@codemirror/commands';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { indentUnit } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';

/**
 * CodeMirror用の拡張機能を取得
 */
export const getCMExtensions = (filename: string, tabSize = 2, insertSpaces = true) => {
  const ext = filename.toLowerCase();
  let lang: any[] = [];
  if (
    ext.endsWith('.js') ||
    ext.endsWith('.jsx') ||
    ext.endsWith('.mjs') ||
    ext.endsWith('.ts') ||
    ext.endsWith('.tsx')
  ) {
    lang = [javascript()];
  } else if (ext.endsWith('.json')) {
    lang = [json()];
  } else if (ext.endsWith('.md') || ext.endsWith('.markdown')) {
    lang = [markdown()];
  } else if (ext.endsWith('.xml')) {
    lang = [xml()];
  } else if (ext.endsWith('.css')) {
    lang = [css()];
  } else if (ext.endsWith('.py')) {
    lang = [python()];
  } else if (ext.endsWith('.yaml') || ext.endsWith('.yml')) {
    lang = [yaml()];
  } else if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) {
    lang = [html()];
  }

  // インデント設定
  const indentStr = insertSpaces ? ' '.repeat(tabSize) : '\t';

  return [
    keymap.of(defaultKeymap),
    keymap.of(historyKeymap),
    history(),
    autocompletion(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    indentUnit.of(indentStr),
    ...lang,
  ];
};
