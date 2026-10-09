import { loader } from '@monaco-editor/react';
import monacoPackage from '../../../node_modules/monaco-editor/package.json';

export const monacoVsPath = `https://cdn.jsdelivr.net/npm/monaco-editor@${monacoPackage.version}/min/vs`;

loader.config({ paths: { vs: monacoVsPath } });
