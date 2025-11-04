/**
 * Pyxis Extensions Builder
 * 
 * extensions/ 内のTypeScriptファイルをトランスパイルして
 * public/extensions/ に配置する
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSIONS_SRC = path.join(__dirname, 'extensions');
const EXTENSIONS_DIST = path.join(__dirname, 'public', 'extensions');

/**
 * ディレクトリを再帰的に走査
 */
function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) {
    return;
  }
  
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      walkDir(filePath, callback);
    } else {
      callback(filePath);
    }
  }
}

/**
 * メイン処理
 */
function buildExtensions() {
  console.log('🔧 Building extensions...\n');
  
  if (!fs.existsSync(EXTENSIONS_SRC)) {
    console.log('⚠️  No extensions directory found. Skipping...');
    return;
  }
  
  // public/extensions/ を完全にクリーンアップ
  console.log('🧹 Cleaning output directory...');
  if (fs.existsSync(EXTENSIONS_DIST)) {
    fs.rmSync(EXTENSIONS_DIST, { recursive: true, force: true });
  }
  fs.mkdirSync(EXTENSIONS_DIST, { recursive: true });
  console.log('✅ Output directory cleaned\n');
  
  let totalFiles = 0;
  let successFiles = 0;
  
  // TypeScript/TSXファイルのリストを収集
  const tsFiles = [];
  walkDir(EXTENSIONS_SRC, (srcPath) => {
    const ext = path.extname(srcPath);
    if (ext === '.ts' || ext === '.tsx') {
      tsFiles.push(srcPath);
      totalFiles++;
    }
  });
  
  // tscでトランスパイル (一括処理)
  if (tsFiles.length > 0) {
    try {
      console.log(`📦 Transpiling ${tsFiles.length} TypeScript/TSX files with tsc...\n`);
      
      // 一時的なtsconfig.jsonを作成
      const tsconfigPath = path.join(__dirname, 'tsconfig.extensions.json');
      const tsbuildInfoPath = path.join(__dirname, 'tsconfig.extensions.tsbuildinfo');
      
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'ES2020',
          moduleResolution: 'bundler',
          outDir: EXTENSIONS_DIST,
          rootDir: EXTENSIONS_SRC,
          declaration: false,
          sourceMap: false,
          skipLibCheck: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: false,
          incremental: false,
          // JSX設定
          jsx: 'react',  // TSXをReact.createElementに変換
          jsxFactory: 'React.createElement',
          jsxFragmentFactory: 'React.Fragment',
        },
        include: ['extensions/**/*.ts', 'extensions/**/*.tsx'],
        exclude: ['node_modules']
      };
      
      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      
      // 既存のビルド情報ファイルを削除（念のため）
      if (fs.existsSync(tsbuildInfoPath)) {
        fs.unlinkSync(tsbuildInfoPath);
      }
      
      // tscを実行（incremental: falseで毎回クリーンビルド）
      execSync(`npx tsc -p ${tsconfigPath}`, {
        stdio: 'inherit',
        cwd: __dirname,
      });
      
      // 一時ファイルを削除
      fs.unlinkSync(tsconfigPath);
      
      // ビルド情報ファイルが生成されていたら削除
      if (fs.existsSync(tsbuildInfoPath)) {
        fs.unlinkSync(tsbuildInfoPath);
      }
      
      successFiles = tsFiles.length;
      console.log(`\n✅ Transpiled ${successFiles} files\n`);
    } catch (error) {
      console.error('❌ TypeScript compilation failed:', error.message);
      
      // エラーが起きても一時ファイルをクリーンアップ
      try {
        const tsconfigPath = path.join(__dirname, 'tsconfig.extensions.json');
        const tsbuildInfoPath = path.join(__dirname, 'tsconfig.extensions.tsbuildinfo');
        
        if (fs.existsSync(tsconfigPath)) {
          fs.unlinkSync(tsconfigPath);
        }
        if (fs.existsSync(tsbuildInfoPath)) {
          fs.unlinkSync(tsbuildInfoPath);
        }
      } catch {}
    }
  }
  
  // JSONファイルやその他のファイルをコピー
  walkDir(EXTENSIONS_SRC, (srcPath) => {
    const relativePath = path.relative(EXTENSIONS_SRC, srcPath);
    const ext = path.extname(srcPath);
    
    if (['.json', '.svg', '.png', '.jpg', '.md'].includes(ext)) {
      const distPath = path.join(EXTENSIONS_DIST, relativePath);
      fs.mkdirSync(path.dirname(distPath), { recursive: true });
      fs.copyFileSync(srcPath, distPath);
      console.log(`📄 ${relativePath} (copied)`);
    }
  });
  
  // manifest.jsonを更新して追加ファイルリストを自動生成
  console.log('\n📝 Updating manifests with file lists...\n');
  updateManifestsWithFileLists();
  
  // registry.jsonを自動生成
  console.log('\n📝 Generating registry.json...\n');
  generateRegistry();
  
  console.log(`\n✨ Extensions built: ${successFiles}/${totalFiles} TypeScript/TSX files`);
}

/**
 * 各拡張機能のmanifest.jsonを更新して、追加ファイルのリストを自動生成
 */
function updateManifestsWithFileLists() {
  const extensionDirs = fs.readdirSync(EXTENSIONS_DIST, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const extDir of extensionDirs) {
    const extPath = path.join(EXTENSIONS_DIST, extDir);
    const manifestPath = path.join(extPath, 'manifest.json');
    
    // manifest.jsonがない場合はスキップ
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    
    try {
      // manifestを読み込み
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      
      // エントリーポイントを取得（デフォルトはindex.js）
      const entryFile = manifest.entry || 'index.js';
      
      // ディレクトリ内の全.jsファイルを取得
      const allFiles = [];
      walkDir(extPath, (filePath) => {
        const relativePath = path.relative(extPath, filePath);
        const ext = path.extname(filePath);
        
        // .jsファイルのみ対象、manifest.jsonとエントリーファイルは除外
        if (ext === '.js' && relativePath !== entryFile && relativePath !== 'manifest.json') {
          allFiles.push(relativePath);
        }
      });
      
      // 追加ファイルがある場合のみfilesフィールドを追加
      if (allFiles.length > 0) {
        manifest.files = allFiles;
        
        // manifestを書き戻し
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        
        console.log(`✅ Updated ${extDir}/manifest.json with ${allFiles.length} additional files:`);
        allFiles.forEach(file => console.log(`   - ${file}`));
      }
    } catch (error) {
      console.error(`❌ Failed to update manifest for ${extDir}:`, error.message);
    }
  }
}

/**
 * registry.jsonを自動生成
 * 各拡張機能のmanifest.jsonを読み取り、レジストリエントリを作成
 */
function generateRegistry() {
  const registry = {
    version: '1.0.0',
    extensions: []
  };
  
  // EXTENSIONS_DISTを走査して全ての拡張機能を見つける
  function scanExtensions(dir, basePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const fullPath = path.join(dir, entry.name);
      const manifestPath = path.join(fullPath, 'manifest.json');
      
      // manifest.jsonがあればレジストリに追加
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/');
          
          registry.extensions.push({
            id: manifest.id,
            type: manifest.type,
            manifestUrl: `/extensions/${relativePath}/manifest.json`,
            defaultEnabled: manifest.defaultEnabled || false
          });
          
          console.log(`✅ Added to registry: ${manifest.id} (defaultEnabled: ${manifest.defaultEnabled || false})`);
        } catch (error) {
          console.error(`❌ Failed to read manifest: ${manifestPath}`, error.message);
        }
      } else {
        // サブディレクトリを再帰的にスキャン（例: lang-packs/ja/）
        scanExtensions(fullPath, path.join(basePath, entry.name));
      }
    }
  }
  
  scanExtensions(EXTENSIONS_DIST);
  
  // registry.jsonを書き出し
  const registryPath = path.join(EXTENSIONS_DIST, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  
  console.log(`\n✅ Generated registry.json with ${registry.extensions.length} extensions`);
  
  // extensions/registry.jsonもコピー（開発用）
  const devRegistryPath = path.join(EXTENSIONS_SRC, 'registry.json');
  fs.copyFileSync(registryPath, devRegistryPath);
  console.log(`✅ Copied to extensions/registry.json`);
}

// 実行
buildExtensions();
