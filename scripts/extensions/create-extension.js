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
    fileExtension: 'tsx',
    templateFile: 'ui-extension.template.tsx'
  },
  {
    value: 'tool',
    label: 'Command/Tool',
    description: 'ターミナルコマンドやツールを追加',
    usesReact: false,
    fileExtension: 'ts',
    templateFile: 'command-extension.template.ts'
  },
  {
    value: 'transpiler',
    label: 'Transpiler',
    description: 'コードのトランスパイル機能を提供',
    usesReact: false,
    fileExtension: 'ts',
    templateFile: 'transpiler-extension.template.ts'
  },
  {
    value: 'service',
    label: 'Service',
    description: '言語パックやテーマなどのサービス',
    usesReact: false,
    fileExtension: 'ts',
    templateFile: 'service-extension.template.ts'
  },
  {
    value: 'builtin-module',
    label: 'Built-in Module',
    description: 'Node.js互換モジュール (fs, pathなど)',
    usesReact: false,
    fileExtension: 'ts',
    templateFile: 'builtin-module-extension.template.ts'
  }
];

// UIコンポーネントタイプ
const UI_COMPONENT_TYPES = [
  { value: 'tab', label: 'Custom Tab', description: 'カスタムタブのみ(開くボタンを作成できないので非推奨)' },
  { value: 'sidebar', label: 'Sidebar Panel', description: 'サイドバーパネルのみ' },
  { value: 'both', label: 'Tab + Sidebar', description: 'タブとサイドバー両方' }
];

// テンプレートファイルを読み込む
function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, 'samples', templateName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${templatePath}`);
  }
  return fs.readFileSync(templatePath, 'utf8');
}

// テンプレートタグを置換
function replaceTags(content, replacements) {
  let result = content;
  for (const [tag, value] of Object.entries(replacements)) {
    const regex = new RegExp(tag, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

// コンポーネント名を生成（キャメルケース）
function toComponentName(id) {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

// テンプレート生成関数
function generateManifest(config) {
  const manifest = {
    id: `pyxis.${config.id}`,
    name: config.name,
    version: '1.0.0',
    type: config.type,
    description: config.description,
    author: config.author,
    defaultEnabled: false,
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
  const componentName = toComponentName(id);
  
  // メインテンプレートを読み込む
  let template = loadTemplate('ui-extension.template.tsx');
  
  // コンポーネントの生成
  let tabComponent = '';
  let sidebarComponent = '';
  let tabRegistration = '';
  let sidebarRegistration = '';
  
  if (componentType === 'tab' || componentType === 'both') {
    tabComponent = loadTemplate('tab-component.template.tsx');
    tabRegistration = loadTemplate('tab-registration.template.ts');
  }
  
  if (componentType === 'sidebar' || componentType === 'both') {
    sidebarComponent = loadTemplate('sidebar-component.template.tsx');
    sidebarRegistration = loadTemplate('sidebar-registration.template.ts');
    
    // タブを開くボタンを含めるかどうか
    if (componentType === 'both') {
      const openTabButton = loadTemplate('open-tab-button.template.tsx');
      sidebarComponent = replaceTags(sidebarComponent, {
        '__OPEN_TAB_BUTTON__': openTabButton
      });
    } else {
      sidebarComponent = replaceTags(sidebarComponent, {
        '__OPEN_TAB_BUTTON__': ''
      });
    }
  }
  
  // すべてのタグを置換
  const replacements = {
    '__EXTENSION_NAME__': name,
    '__EXTENSION_DESCRIPTION__': config.description,
    '__EXTENSION_ID__': id,
    '__COMPONENT_NAME__': componentName,
    '__TAB_COMPONENT__': tabComponent,
    '__SIDEBAR_COMPONENT__': sidebarComponent,
    '__TAB_REGISTRATION__': tabRegistration,
    '__SIDEBAR_REGISTRATION__': sidebarRegistration
  };
  
  return replaceTags(template, replacements);
}

function generateExtensionFromTemplate(config, templateFile) {
  const template = loadTemplate(templateFile);
  
  const replacements = {
    '__EXTENSION_NAME__': config.name,
    '__EXTENSION_DESCRIPTION__': config.description,
    '__EXTENSION_ID__': config.id,
    '__COMPONENT_NAME__': toComponentName(config.id)
  };
  
  return replaceTags(template, replacements);
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
  console.log('��� Pyxis Extension Template Generator');
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
      usesReact: typeConfig.usesReact,
      templateFile: typeConfig.templateFile
    };

    // 確認
    console.log('\n��� 設定確認:');
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

    // npm/pnpmライブラリを使用するか確認
    const usePnpm = await confirm('\nnpm/pnpmライブラリを使用しますか? (chart.js, lodash-esなど)');
    if (usePnpm) {
      config.usePnpm = true;
    }

    // ディレクトリ作成
    const extensionDir = path.join(__dirname, '..', '..', 'extensions', id);
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
    } else {
      indexContent = generateExtensionFromTemplate(config, config.templateFile);
    }

    fs.writeFileSync(indexPath, indexContent);
    console.log(`✅ 作成: index.${config.fileExtension}`);

    // README.md作成
    const readmePath = path.join(extensionDir, 'README.md');
    fs.writeFileSync(readmePath, generateREADME(config));
    console.log(`✅ 作成: README.md`);

    // pnpmライブラリを使用する場合
    if (config.usePnpm) {
      // package.jsonを作成
      const packageJsonPath = path.join(extensionDir, 'package.json');
      const packageJson = {
        name: id,
        version: '1.0.0',
        private: true,
        description: config.description,
        dependencies: {},
        devDependencies: {
          '@types/react': '^19'
        }
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      console.log(`✅ 作成: package.json`);

      // ガイドをコピー
      const guideSrc = path.join(__dirname, 'EXTENSION-PNPM-GUIDE.md');
      const guideDest = path.join(extensionDir, 'PNPM-GUIDE.md');
      if (fs.existsSync(guideSrc)) {
        fs.copyFileSync(guideSrc, guideDest);
        console.log(`✅ コピー: PNPM-GUIDE.md (重要な注意事項)`);
      }
    }

    console.log('\n��� 拡張機能のテンプレート作成完了！\n');
    console.log('次のステップ:');
    if (config.usePnpm) {
      console.log(`  1. cd extensions/${id}`);
      console.log('  2. pnpm install (依存関係をインストール)');
      console.log('  3. pnpm add <library-name> (ライブラリを追加)');
      console.log(`  4. extensions/${id}/index.${config.fileExtension} を編集`);
      console.log('  5. node build-extensions.js を実行（プロジェクトルートで）');
      console.log('  6. npm run dev で確認');
      console.log('\n⚠️  重要: PNPM-GUIDE.md を必ず読んでください！');
    } else {
      console.log(`  1. extensions/${id}/index.${config.fileExtension} を編集`);
      console.log('  2. node build-extensions.js を実行（registry.jsonも自動生成されます）');
      console.log('  3. npm run dev で確認');
    }
    console.log('');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
  } finally {
    rl.close();
  }
}

// 実行
main();
