#!/usr/bin/env node

/**
 * Pyxis Extension Template Generator
 * 対話形式で拡張機能のテンプレートを作成
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// プロンプト関数
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// 選択肢プロンプト
function select(question, options) {
  return new Promise((resolve) => {
    console.log('\n' + question);
    options.forEach((opt, idx) => {
      console.log(`  ${idx + 1}. ${opt.label} - ${opt.description}`);
    });
    rl.question('\n選択してください (1-' + options.length + '): ', (answer) => {
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < options.length) {
        resolve(options[index].value);
      } else {
        console.log('❌ 無効な選択です。もう一度入力してください。');
        resolve(select(question, options));
      }
    });
  });
}

// 確認プロンプト
function confirm(question) {
  return new Promise((resolve) => {
    rl.question(question + ' (y/n): ', (answer) => {
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// 拡張機能タイプの定義
const EXTENSION_TYPES = [
  {
    value: 'ui',
    label: 'UI Extension',
    description: 'カスタムタブやサイドバーパネルを追加',
    usesReact: true,
    fileExtension: 'tsx'
  },
  {
    value: 'transpiler',
    label: 'Transpiler',
    description: 'コードのトランスパイル機能を提供',
    usesReact: false,
    fileExtension: 'ts'
  },
  {
    value: 'service',
    label: 'Service',
    description: '言語パックやテーマなどのサービス',
    usesReact: false,
    fileExtension: 'ts'
  },
  {
    value: 'builtin-module',
    label: 'Built-in Module',
    description: 'Node.js互換モジュール (fs, pathなど)',
    usesReact: false,
    fileExtension: 'ts'
  }
];

// UIコンポーネントタイプ
const UI_COMPONENT_TYPES = [
  { value: 'tab', label: 'Custom Tab', description: 'カスタムタブのみ' },
  { value: 'sidebar', label: 'Sidebar Panel', description: 'サイドバーパネルのみ' },
  { value: 'both', label: 'Tab + Sidebar', description: 'タブとサイドバー両方' }
];

// テンプレート生成関数
function generateManifest(config) {
  const manifest = {
    id: `pyxis.${config.id}`,
    name: config.name,
    version: '1.0.0',
    type: config.type,
    description: config.description,
    author: config.author,
    entry: 'index.js'
  };

  if (config.tags && config.tags.length > 0) {
    manifest.metadata = {
      publishedAt: new Date().toISOString(),
      tags: config.tags
    };
  }

  return JSON.stringify(manifest, null, 2) + '\n';
}

function generateUIExtension(config) {
  const { id, name, componentType } = config;
  const componentName = id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  
  let code = `/**
 * ${name}
 * ${config.description}
 */

import React, { useState, useEffect } from 'react';
import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

`;

  // Tab Component
  if (componentType === 'tab' || componentType === 'both') {
    code += `// カスタムタブコンポーネント
function ${componentName}TabComponent({ tab, isActive }: { tab: any; isActive: boolean }) {
  const [data, setData] = useState((tab as any).data || {});

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '16px',
        background: '#1e1e1e',
        color: '#d4d4d4',
      }}
    >
      <h2>${name} Tab</h2>
      <p>タブID: {tab.id}</p>
      <p>アクティブ: {isActive ? 'Yes' : 'No'}</p>
      {/* ここにタブのコンテンツを追加 */}
    </div>
  );
}

`;
  }

  // Sidebar Panel
  if (componentType === 'sidebar' || componentType === 'both') {
    code += `// サイドバーパネルコンポーネント
function create${componentName}Panel(context: ExtensionContext) {
  return function ${componentName}Panel({ extensionId, panelId, isActive, state }: any) {
    const [items, setItems] = useState<any[]>([]);

    useEffect(() => {
      if (isActive) {
        // パネルがアクティブになった時の処理
        context.logger?.info('Panel activated');
      }
    }, [isActive]);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          padding: '8px',
          background: '#1e1e1e',
          color: '#d4d4d4',
          overflow: 'auto',
        }}
      >
        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
          ${name}
        </div>
        {/* ここにパネルのコンテンツを追加 */}
        <div style={{ fontSize: '12px', color: '#888' }}>
          パネルID: {panelId}
        </div>
      </div>
    );
  };
}

`;
  }

  // Activate function
  code += `/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('${name} activating...');

`;

  if (componentType === 'tab' || componentType === 'both') {
    code += `  // タブコンポーネントを登録
  if (context.tabs) {
    context.tabs.registerTabType(${componentName}TabComponent);
    context.logger?.info('Tab component registered');
  }

`;
  }

  if (componentType === 'sidebar' || componentType === 'both') {
    code += `  // サイドバーパネルを登録
  if (context.sidebar) {
    const Panel = create${componentName}Panel(context);
    
    context.sidebar.createPanel({
      id: '${id}-panel',
      title: '${name}',
      icon: 'Package',
      component: Panel,
      order: 50,
    });

    context.sidebar.onPanelActivate('${id}-panel', async (panelId: string) => {
      context.logger?.info(\`Panel activated: \${panelId}\`);
    });

    context.logger?.info('Sidebar panel registered');
  }

`;
  }

  code += `  return {};
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('${name} deactivated');
}
`;

  return code;
}

function generateTranspilerExtension(config) {
  const { name, description } = config;
  
  return `/**
 * ${name}
 * ${description}
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * コードをトランスパイル
 */
async function transpile(code: string, options: any): Promise<{ code: string }> {
  // ここにトランスパイル処理を実装
  context.logger?.info('Transpiling code...');
  
  // 例: 単純な変換
  const transformedCode = code;
  
  return { code: transformedCode };
}

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('${name} activating...');

  const runtimeFeatures = {
    transpiler: transpile,
    
    // サポートするファイルタイプ
    canTranspile: (filePath: string): boolean => {
      return /\\.(ext)$/.test(filePath); // 適切な拡張子に変更
    },
  };

  context.logger?.info('${name} activated');

  return {
    runtimeFeatures,
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('${name} deactivated');
}
`;
}

function generateServiceExtension(config) {
  const { name, description } = config;
  
  return `/**
 * ${name}
 * ${description}
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('${name} activating...');

  // サービスの実装
  const myService = {
    // ここにサービスのAPIを実装
    version: '1.0.0',
    
    doSomething: () => {
      context.logger?.info('Service method called');
    },
  };

  context.logger?.info('${name} activated');

  return {
    services: {
      'my-service': myService,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('${name} deactivated');
}
`;
}

function generateBuiltinModuleExtension(config) {
  const { name, description } = config;
  
  return `/**
 * ${name}
 * ${description}
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types';

/**
 * モジュールの実装
 */
const myModule = {
  // ここにモジュールのAPIを実装
  version: '1.0.0',
  
  someFunction: () => {
    return 'Hello from built-in module';
  },
};

/**
 * 拡張機能のactivate関数
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('${name} activating...');

  context.logger?.info('${name} activated');

  return {
    builtInModules: {
      'my-module': myModule,
    },
  };
}

/**
 * 拡張機能のdeactivate関数
 */
export async function deactivate(): Promise<void> {
  console.log('${name} deactivated');
}
`;
}

function generateREADME(config) {
  return `# ${config.name}

${config.description}

## 概要

このディレクトリには \`${config.name}\` 拡張機能が含まれています。

## 開発

\`\`\`bash
# 拡張機能をビルド
node build-extensions.js

# 開発サーバー起動
npm run dev
\`\`\`

## 使い方

1. Pyxisを開く
2. 拡張機能パネルから「${config.name}」を有効化
${config.type === 'ui' && config.componentType === 'tab' ? '3. タブバーから新しいタブを作成' : ''}
${config.type === 'ui' && config.componentType === 'sidebar' ? '3. サイドバーに「${config.name}」パネルが表示されます' : ''}

## ファイル構成

- \`index.${config.fileExtension}\` - メインコード
- \`manifest.json\` - 拡張機能のメタデータ
- \`README.md\` - このファイル

## License

MIT
`;
}

// メイン処理
async function main() {
  console.log('');
  console.log('🚀 Pyxis Extension Template Generator');
  console.log('=====================================\n');

  try {
    // 拡張機能タイプの選択
    const type = await select('拡張機能のタイプを選択してください:', EXTENSION_TYPES);
    const typeConfig = EXTENSION_TYPES.find(t => t.value === type);

    // 基本情報の入力
    const id = await prompt('拡張機能ID (例: my-extension): ');
    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      console.log('❌ IDは小文字英数字とハイフンのみ使用できます');
      rl.close();
      return;
    }

    const name = await prompt('拡張機能名 (例: My Extension): ');
    if (!name) {
      console.log('❌ 拡張機能名は必須です');
      rl.close();
      return;
    }

    const description = await prompt('説明: ');
    const author = await prompt('作者名 (デフォルト: Pyxis Team): ') || 'Pyxis Team';
    const tagsInput = await prompt('タグ (カンマ区切り、例: ui,productivity): ');
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()) : [];

    // UI拡張機能の場合はコンポーネントタイプを選択
    let componentType = null;
    if (type === 'ui') {
      componentType = await select('UIコンポーネントのタイプを選択してください:', UI_COMPONENT_TYPES);
    }

    const config = {
      id,
      name,
      type,
      description,
      author,
      tags,
      componentType,
      fileExtension: typeConfig.fileExtension,
      usesReact: typeConfig.usesReact
    };

    // 確認
    console.log('\n📋 設定確認:');
    console.log('  ID:', config.id);
    console.log('  名前:', config.name);
    console.log('  タイプ:', config.type);
    if (config.componentType) {
      console.log('  コンポーネント:', config.componentType);
    }
    console.log('  説明:', config.description);
    console.log('  作者:', config.author);
    console.log('  タグ:', config.tags.join(', ') || '(なし)');
    console.log('  React使用:', config.usesReact ? 'はい' : 'いいえ');

    const confirmed = await confirm('\nこの設定で作成しますか?');
    if (!confirmed) {
      console.log('❌ キャンセルされました');
      rl.close();
      return;
    }

    // ディレクトリ作成
    const extensionDir = path.join(__dirname, '..', 'extensions', id);
    if (fs.existsSync(extensionDir)) {
      console.log(`❌ 拡張機能 "${id}" は既に存在します`);
      rl.close();
      return;
    }

    fs.mkdirSync(extensionDir, { recursive: true });
    console.log(`\n✅ ディレクトリ作成: extensions/${id}/`);

    // manifest.json作成
    const manifestPath = path.join(extensionDir, 'manifest.json');
    fs.writeFileSync(manifestPath, generateManifest(config));
    console.log(`✅ 作成: manifest.json`);

    // index.ts/tsx作成
    const indexPath = path.join(extensionDir, `index.${config.fileExtension}`);
    let indexContent = '';
    
    if (type === 'ui') {
      indexContent = generateUIExtension(config);
    } else if (type === 'transpiler') {
      indexContent = generateTranspilerExtension(config);
    } else if (type === 'service') {
      indexContent = generateServiceExtension(config);
    } else if (type === 'builtin-module') {
      indexContent = generateBuiltinModuleExtension(config);
    }

    fs.writeFileSync(indexPath, indexContent);
    console.log(`✅ 作成: index.${config.fileExtension}`);

    // README.md作成
    const readmePath = path.join(extensionDir, 'README.md');
    fs.writeFileSync(readmePath, generateREADME(config));
    console.log(`✅ 作成: README.md`);

    // レジストリに追加するかどうか
    const addToRegistry = await confirm('\nregistry.jsonに追加しますか?');
    if (addToRegistry) {
      const registryPath = path.join(__dirname, '..', 'extensions', 'registry.json');
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      
      registry.extensions.push({
        id: `pyxis.${id}`,
        type: type,
        manifestUrl: `/extensions/${id}/manifest.json`,
        defaultEnabled: false,
        recommended: false
      });

      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
      console.log('✅ registry.jsonに追加しました');
    }

    console.log('\n🎉 拡張機能のテンプレート作成完了！\n');
    console.log('次のステップ:');
    console.log(`  1. extensions/${id}/index.${config.fileExtension} を編集`);
    console.log('  2. node build-extensions.js を実行');
    console.log('  3. npm run dev で確認\n');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
  } finally {
    rl.close();
  }
}

// 実行
main();
