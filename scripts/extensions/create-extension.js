#!/usr/bin/env node

/**
 * Pyxis Extension Template Generator
 * 対話形式で拡張機能のテンプレートを作成
 */

const fs = require('fs');
const path = require('path');

// Improved CLI UX libraries (installed as devDependencies)
const { Input, Select, Confirm } = require('enquirer');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');
const figures = require('figures');

// Prompt wrappers using enquirer for a nicer UX
async function prompt(question, initial) {
  const input = new Input({ message: question, initial: initial || '' });
  try {
    const answer = await input.run();
    return (answer || '').trim();
  } catch (err) {
    return '';
  }
}

async function select(question, options) {
  const choices = options.map(opt => ({ name: opt.value, message: `${opt.label} — ${opt.description}` }));
  const selectPrompt = new Select({ name: 'choice', message: question, choices });
  try {
    const answer = await selectPrompt.run();
    return answer;
  } catch (err) {
    throw err;
  }
}

async function confirm(question) {
  const confirmPrompt = new Confirm({ message: question });
  try {
    return await confirmPrompt.run();
  } catch (err) {
    return false;
  }
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
function replaceTags(content, replacements, options = {}) {
  let result = content;
  // タグの長さ順で降順ソート（長いタグから置換）
  const sortedTags = Object.keys(replacements).sort((a, b) => b.length - a.length);
  // 複数パスで置換（あるプレースホルダの値に別のプレースホルダが含まれる場合に対応）
  let changed = true;
  let passes = 0;
  const MAX_PASSES = 10;
  while (changed && passes < MAX_PASSES) {
    changed = false;
    passes += 1;
    for (const tag of sortedTags) {
      const value = replacements[tag] || '';
      const regex = new RegExp(tag.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1"), 'g');
      const newResult = result.replace(regex, value);
      if (newResult !== result) changed = true;
      result = newResult;
    }
  }

  // 置換後に__[A-Z0-9_]+__形式のタグが残っていないかチェック
  const leftover = result.match(/__([A-Z0-9_]+)__/g);
  const suppress = options && options.suppressLeftoverWarning;
  if (!suppress && leftover && leftover.length > 0) {
    console.warn('⚠️ テンプレートタグの置換漏れ:', Array.from(new Set(leftover)));
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
      // 部分的な置換（まだ他のタグが残る可能性があるため警告は抑制）
      sidebarComponent = replaceTags(sidebarComponent, {
        '__OPEN_TAB_BUTTON__': openTabButton
      }, { suppressLeftoverWarning: true });
    } else {
      sidebarComponent = replaceTags(sidebarComponent, {
        '__OPEN_TAB_BUTTON__': ''
      }, { suppressLeftoverWarning: true });
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

// メイン処理
async function main() {
  console.log('\n' + boxen(chalk.bold.cyan('Pyxis Extension Template Generator'), { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' }));

  try {
    // 拡張機能タイプの選択
    const type = await select('拡張機能のタイプを選択してください:', EXTENSION_TYPES);
    const typeConfig = EXTENSION_TYPES.find(t => t.value === type);

    // 基本情報の入力
    const id = await prompt('拡張機能ID (例: my-extension): ');
    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      console.log(chalk.red(figures.cross + ' IDは小文字英数字とハイフンのみ使用できます'));
      return;
    }

    let name = await prompt('拡張機能名 (例: My Extension): ');
    if (!name) {
      name = id;
      console.log(chalk.yellow(figures.info + ' 拡張機能名が未入力のため、IDと同じ値を使用します: ' + name));
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
    console.log('\n' + boxen(chalk.bold('設定確認'), { padding: 1 }));
    console.log(`  ${chalk.cyan('ID:')} ${config.id}`);
    console.log(`  ${chalk.cyan('名前:')} ${config.name}`);
    console.log(`  ${chalk.cyan('タイプ:')} ${config.type}`);
    if (config.componentType) {
      console.log(`  ${chalk.cyan('コンポーネント:')} ${config.componentType}`);
    }
    console.log(`  ${chalk.cyan('説明:')} ${config.description}`);
    console.log(`  ${chalk.cyan('作者:')} ${config.author}`);
    console.log(`  ${chalk.cyan('タグ:')} ${config.tags.join(', ') || '(なし)'}`);
    console.log(`  ${chalk.cyan('React使用:')} ${config.usesReact ? chalk.green('はい') : chalk.yellow('いいえ')}`);

    const confirmed = await new Confirm({ message: '\nこの設定で作成しますか?', initial: true }).run();
    if (!confirmed) {
      console.log(chalk.yellow(figures.cross + ' キャンセルされました'));
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
      console.log(chalk.red(figures.cross + ` 拡張機能 "${id}" は既に存在します`));
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

    // README.md作成（samples/README.mdを読み込み、プレースホルダを置換して書き出す）
    const readmePath = path.join(extensionDir, 'README.md');
    const sampleReadmePath = path.join(__dirname, 'samples', 'README.md');
    if (fs.existsSync(sampleReadmePath)) {
      try {
        const sampleContent = fs.readFileSync(sampleReadmePath, 'utf8');
        const replacements = {
          '__EXTENSION_NAME__': config.name || '',
          '__EXTENSION_DESCRIPTION__': config.description || '',
          '__EXTENSION_ID__': config.id || '',
          '__FILE_EXTENSION__': config.fileExtension || '',
          '__COMPONENT_NAME__': toComponentName(config.id || ''),
          '__EXTENSION_TYPE__': config.type || '',
          '__COMPONENT_TYPE__': config.componentType || '',
          '__USES_REACT__': config.usesReact ? 'yes' : 'no',
          '__TAGS__': (config.tags && config.tags.length) ? config.tags.join(', ') : '(none)',
          '__AUTHOR__': config.author || '',
          '__USE_PNPM__': config.usePnpm ? 'yes' : 'no',
          '__CREATED_AT__': (new Date()).toISOString()
        };

        const rendered = replaceTags(sampleContent, replacements);
        fs.writeFileSync(readmePath, rendered);
        console.log(`✅ 作成: README.md (samples/README.md -> rendered)`);
      } catch (err) {
        console.log(chalk.red(figures.cross + ' README のレンダリング中にエラーが発生しました:'), err);
        return;
      }
    } else {
      console.log(`⚠️ README.mdのサンプルが見つかりません: ${sampleReadmePath}`);
      return;
    }

    // pnpmライブラリを使用する場合
    if (config.usePnpm) {
      // package.jsonを作成
      const packageJsonPath = path.join(extensionDir, 'package.json');
      const packageJson = {
        name: id,
        version: '1.0.0',
        private: true,
        description: config.description,
        dependencies: {}
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

    console.log('\n' + boxen(chalk.bold.green('拡張機能のテンプレート作成完了！'), { padding: 1 }));
    console.log(chalk.bold('次のステップ:'));
    if (config.usePnpm) {
      console.log(`  1. cd extensions/${id}`);
      console.log('  2. pnpm install (依存関係をインストール)');
      console.log('  3. pnpm add <library-name> (ライブラリを追加)');
      console.log(`  4. extensions/${id}/index.${config.fileExtension} を編集`);
      console.log('  5. node build-extensions.js を実行（プロジェクトルートで）');
      console.log('  6. pnpm run dev で確認');
      console.log('\n⚠️  重要: PNPM-GUIDE.md を必ず読んでください！');
    } else {
      console.log(`  1. extensions/${id}/index.${config.fileExtension} を編集`);
      console.log('  2. node build-extensions.js を実行（registry.jsonも自動生成されます）');
      console.log('  3. pnpm run dev で確認');
    }
    console.log('');

  } catch (error) {
    console.error(chalk.red('❌ エラーが発生しました:'), error);
  }
}

// 実行
main();
