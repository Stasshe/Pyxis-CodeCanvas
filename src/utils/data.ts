import { FileItem, Tab } from '../types';

export const defaultTabs: Tab[] = [
  {
    id: '1',
    name: 'welcome.txt',
    content: '// Pyxis Editor\n// VS Code風のエディターです\n\nこんにちは！\nこちらはPyxisエディターです。\n\n機能:\n- ファイル管理\n- コードエディティング\n- ターミナル（準備中）\n- 検索機能（準備中）',
    isDirty: false,
    path: '/welcome.txt'
  }
];

export const defaultFiles: FileItem[] = [
  {
    id: '1',
    name: 'src',
    type: 'folder',
    path: '/src',
    children: [
      {
        id: '2',
        name: 'components',
        type: 'folder',
        path: '/src/components',
        children: [
          { id: '3', name: 'Button.tsx', type: 'file', path: '/src/components/Button.tsx', content: 'export default function Button() {\n  return <button>Click me</button>;\n}' },
          { id: '4', name: 'Input.tsx', type: 'file', path: '/src/components/Input.tsx', content: 'export default function Input() {\n  return <input type="text" />;\n}' }
        ]
      },
      { id: '5', name: 'index.ts', type: 'file', path: '/src/index.ts', content: 'console.log("Hello, Pyxis!");' }
    ]
  },
  { id: '6', name: 'package.json', type: 'file', path: '/package.json', content: '{\n  "name": "pyxis-project",\n  "version": "1.0.0"\n}' },
  { id: '7', name: 'README.md', type: 'file', path: '/README.md', content: '# Pyxis Project\n\nThis is a sample project in Pyxis Editor.' }
];
