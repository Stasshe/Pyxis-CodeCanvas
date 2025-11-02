/**
 * Pyxis Extensions Builder
 * 
 * src/extensions/ 内のTypeScriptファイルをトランスパイルして
 * public/extensions/ に配置する
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSIONS_SRC = path.join(__dirname, 'src', 'extensions');
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
  
  // public/extensions/ をクリーンアップ (registry.json以外)
  if (fs.existsSync(EXTENSIONS_DIST)) {
    const files = fs.readdirSync(EXTENSIONS_DIST);
    for (const file of files) {
      if (file !== 'registry.json') {
        const filePath = path.join(EXTENSIONS_DIST, file);
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    }
  } else {
    fs.mkdirSync(EXTENSIONS_DIST, { recursive: true });
  }
  
  let totalFiles = 0;
  let successFiles = 0;
  
  // TypeScriptファイルのリストを収集
  const tsFiles = [];
  walkDir(EXTENSIONS_SRC, (srcPath) => {
    const ext = path.extname(srcPath);
    if (ext === '.ts') {
      tsFiles.push(srcPath);
      totalFiles++;
    }
  });
  
  // tscでトランスパイル (一括処理)
  if (tsFiles.length > 0) {
    try {
      console.log(`📦 Transpiling ${tsFiles.length} TypeScript files with tsc...\n`);
      
      // 一時的なtsconfig.jsonを作成
      const tsconfigPath = path.join(__dirname, 'tsconfig.extensions.json');
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
        },
        include: ['src/extensions/**/*.ts'],
        exclude: ['node_modules']
      };
      
      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      
      // tscを実行
      execSync(`npx tsc -p ${tsconfigPath}`, {
        stdio: 'inherit',
        cwd: __dirname,
      });
      
      // 一時ファイルを削除
      fs.unlinkSync(tsconfigPath);
      
      successFiles = tsFiles.length;
      console.log(`\n✅ Transpiled ${successFiles} files\n`);
    } catch (error) {
      console.error('❌ TypeScript compilation failed:', error.message);
      
      // エラーが起きても一時ファイルをクリーンアップ
      try {
        const tsconfigPath = path.join(__dirname, 'tsconfig.extensions.json');
        if (fs.existsSync(tsconfigPath)) {
          fs.unlinkSync(tsconfigPath);
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
  
  console.log(`\n✨ Extensions built: ${successFiles}/${totalFiles} TypeScript files`);
}

// 実行
buildExtensions();
