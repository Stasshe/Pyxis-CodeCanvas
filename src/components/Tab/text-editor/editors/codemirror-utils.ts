import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  keymap,
} from '@codemirror/view';
import { history } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches } from '@codemirror/search';

/**
 * CodeMirror用の拡張機能を取得
 */
export const getCMExtensions = (filename: string) => {
  const ext = filename.toLowerCase();
  let lang: any[] = [];
  
  if (
    ext.endsWith('.js') ||
    ext.endsWith('.jsx') ||
    ext.endsWith('.mjs') ||
    ext.endsWith('.ts') ||
    ext.endsWith('.tsx')
  )
    lang = [javascript()];
  else if (ext.endsWith('.md') || ext.endsWith('.markdown')) lang = [markdown()];
  else if (ext.endsWith('.xml')) lang = [xml()];
  else if (ext.endsWith('.css')) lang = [css()];
  else if (ext.endsWith('.py')) lang = [python()];
  else if (ext.endsWith('.yaml') || ext.endsWith('.yml')) lang = [yaml()];
  else if (ext.endsWith('.html') || ext.endsWith('.htm') || ext.endsWith('.xhtml')) lang = [html()];

  return [
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    history(),
    autocompletion(),
    lineNumbers(),
    oneDark,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    highlightSelectionMatches(),
    ...lang,
  ];
};
