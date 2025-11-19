/**
 * Pyxis Extensions Builder (esbuild version)
 * 
 * extensions/ 内のTypeScript/TSXファイルをバンドルして
 * public/extensions/ に配置する
 * 
 * 【対応機能】
 * - TypeScript/TSX のトランスパイル
 * - npm/pnpm ライブラリのバンドル (package.json がある場合)
 * - React/React-DOM の外部化 (Pyxis本体のReactを使用)
 * - 追加ファイル(.js)のサポート
 * - registry.json の自動生成
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const esbuild = require('esbuild');

// Resolve project root (script is in scripts/build/) and use it for paths
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const EXTENSIONS_SRC = path.join(ROOT_DIR, 'extensions');
const EXTENSIONS_DIST = path.join(ROOT_DIR, 'public', 'extensions');

/**
 * .buildignoreファイルを読み込み
 */
function loadBuildIgnore() {
  const buildIgnorePath = path.join(__dirname, '.buildignore');
  
  if (!fs.existsSync(buildIgnorePath)) {
    return [];
  }
  
  const content = fs.readFileSync(buildIgnorePath, 'utf-8');
  
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#')); // 空行とコメントを除外
}

/**
 * ファイル/ディレクトリが除外対象かチェック
 */
function shouldIgnore(relativePath, basename, ignorePatterns) {
  // node_modulesディレクトリは常に除外
  if (relativePath.includes('node_modules')) {
    return true;
  }
  
  // ignoreパターンとマッチするかチェック
  for (const pattern of ignorePatterns) {
    // 完全一致（ファイル名）
    if (basename === pattern) {
      return true;
    }
    
    // 拡張子パターン (*.ts など)
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // '*.ts' -> '.ts'
      if (basename.endsWith(ext)) {
        return true;
      }
    }
    
    // パスに含まれるパターン
    if (relativePath.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

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
 * package.jsonが存在するかチェック
 */
function hasPackageJson(dir) {
  return fs.existsSync(path.join(dir, 'package.json'));
}

/**
 * node_modulesが存在するかチェック
 */
function hasNodeModules(dir) {
  return fs.existsSync(path.join(dir, 'node_modules'));
}

/**
 * 依存関係をインストール
 */
function installDependencies(dir) {
  console.log(`Installing dependencies in ${path.basename(dir)}...`);
  
  try {
    // pnpm, npm, yarn の優先順で試す
    const packageManager = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' :
                          fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' :
                          'npm';

    // CI 環境では pnpm の frozen-lockfile が有効になっていることがあるため
    // ロックファイルの不整合でビルドが止まらないように --no-frozen-lockfile を付与
    let installCmd = `${packageManager} install`;
    if (packageManager === 'pnpm') {
      installCmd += ' --no-frozen-lockfile';
    }

    execSync(installCmd, {
      cwd: dir,
      stdio: 'inherit',
    });

    console.log(`✅ Dependencies installed with ${packageManager}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to install dependencies:`, error.message);
    return false;
  }
}

/**
 * esbuildでバンドル
 */
async function bundleWithEsbuild(entryPoint, outfile, extDir) {
  try {
    console.log(`📦 Bundling ${path.basename(entryPoint)} with esbuild...`);
    
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outfile,
      platform: 'browser',
      format: 'esm',
      target: 'es2020',
      mainFields: ['module', 'main'],
      keepNames: true,
      // TypeScriptのコンパイラオプションを明示的に上書き
      tsconfigRaw: {
        compilerOptions: {
          jsx: 'react', // react-jsxではなくreactを使用
          jsxFactory: 'React.createElement',
          jsxFragmentFactory: 'React.Fragment',
        }
      },
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        // // Avoid bundling heavy math rendering libs into extensions; prefer host-provided
        // // or dynamic loading at runtime to prevent module-eval crashes.
        // 'katex',
        // 'rehype-katex',
      ],
      loader: {
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.js': 'jsx',
        '.jsx': 'jsx',
      },
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      minify: false, // デバッグしやすいように圧縮しない
      sourcemap: false,
      logLevel: 'warning',
      banner: {
        js: 'export { activate }'
      },
    });
    
    console.log(`✅ Bundled to ${path.relative(__dirname, outfile)}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Bundling failed:`, error.message);
    return false;
  }
}

/**
 * package.jsonがない全ての拡張機能をtscで一括トランスパイル
 */
async function transpileAllWithTsc() {
  try {
    // package.jsonがない拡張機能のディレクトリを収集
    const nonBundledDirs = [];
    
    const extensionDirs = fs.readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .filter(dirent => !dirent.name.startsWith('_'))
      .map(dirent => dirent.name);
    
    for (const dirName of extensionDirs) {
      const extSrcDir = path.join(EXTENSIONS_SRC, dirName);
      const hasManifest = fs.existsSync(path.join(extSrcDir, 'manifest.json'));
      
      if (hasManifest && !hasPackageJson(extSrcDir)) {
        nonBundledDirs.push(dirName);
      } else if (!hasManifest) {
        // サブディレクトリをチェック (lang-packs など)
        const subDirs = fs.readdirSync(extSrcDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name);
        
        for (const subDir of subDirs) {
          const subSrcDir = path.join(extSrcDir, subDir);
          if (fs.existsSync(path.join(subSrcDir, 'manifest.json')) && !hasPackageJson(subSrcDir)) {
            nonBundledDirs.push(`${dirName}/${subDir}`);
          }
        }
      }
    }
    
    if (nonBundledDirs.length === 0) {
      console.log('⚠️  No non-bundled extensions found to transpile\n');
      return true;
    }
    
    console.log(`📦 Found ${nonBundledDirs.length} non-bundled extensions to transpile:`);
    nonBundledDirs.forEach(dir => console.log(`   - ${dir}`));
    console.log('');
    
  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.extensions.json');
  const tsbuildInfoPath = path.join(ROOT_DIR, 'tsconfig.extensions.tsbuildinfo');
    
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
        jsx: 'react',
        jsxFactory: 'React.createElement',
        jsxFragmentFactory: 'React.Fragment',
      },
      include: ['extensions/**/*.ts', 'extensions/**/*.tsx'],
      exclude: [
        'node_modules',
        'extensions/**/node_modules',
        // package.jsonがある拡張機能を除外
        ...fs.readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .filter(dirent => !dirent.name.startsWith('_'))
          .filter(dirent => hasPackageJson(path.join(EXTENSIONS_SRC, dirent.name)))
          .map(dirent => `extensions/${dirent.name}`),
      ]
    };
    
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
    
    if (fs.existsSync(tsbuildInfoPath)) {
      fs.unlinkSync(tsbuildInfoPath);
    }
    
    // pnpmを使用してtscを実行（.npmrcの設定warningを回避）
    execSync(`pnpm exec tsc -p ${tsconfigPath}`, {
      stdio: 'inherit',
      cwd: ROOT_DIR,
    });
    
    fs.unlinkSync(tsconfigPath);
    
    if (fs.existsSync(tsbuildInfoPath)) {
      fs.unlinkSync(tsbuildInfoPath);
    }
    
    console.log(`\n✅ Transpiled ${nonBundledDirs.length} extensions with tsc\n`);
    
    // .buildignoreを読み込み
    const ignorePatterns = loadBuildIgnore();
    
    // JSON, 画像, Markdownファイルをコピー (非バンドル拡張機能のみ)
    for (const dirPath of nonBundledDirs) {
      const srcDir = path.join(EXTENSIONS_SRC, dirPath);
      const distDir = path.join(EXTENSIONS_DIST, dirPath);
      
      walkDir(srcDir, (srcPath) => {
        const relativePath = path.relative(srcDir, srcPath);
        const ext = path.extname(srcPath);
        const basename = path.basename(srcPath);
        
        // .buildignoreのパターンでチェック
        if (shouldIgnore(relativePath, basename, ignorePatterns)) {
          return;
        }
        
        // manifest.json, 画像, Markdown, CSSファイルのみコピー
        if (basename === 'manifest.json' || ['.svg', '.png', '.jpg', '.md', '.css'].includes(ext)) {
          const distPath = path.join(distDir, relativePath);
          fs.mkdirSync(path.dirname(distPath), { recursive: true });
          fs.copyFileSync(srcPath, distPath);
        }
      });
      
      // manifest.json内のfilesフィールドを更新
      updateManifestWithFiles(distDir);
    }
    
    return true;
  } catch (error) {
    console.error('❌ TypeScript compilation failed:', error.message);
    
    try {
        const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.extensions.json');
        const tsbuildInfoPath = path.join(ROOT_DIR, 'tsconfig.extensions.tsbuildinfo');
      
      if (fs.existsSync(tsconfigPath)) {
        fs.unlinkSync(tsconfigPath);
      }
      if (fs.existsSync(tsbuildInfoPath)) {
        fs.unlinkSync(tsbuildInfoPath);
      }
    } catch {}
    
    return false;
  }
}

/**
 * メイン処理
 */
async function buildExtensions() {
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
  
  // 拡張機能ディレクトリを走査
  const extensionDirs = fs.readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => !dirent.name.startsWith('_')) // _shared などを除外
    .filter(dirent => {
      // emptyフォルダはパス
      const extSrcDir = path.join(EXTENSIONS_SRC, dirent.name);
      const files = fs.readdirSync(extSrcDir);
      return files.length > 0;
    })
    .map(dirent => dirent.name);
  
  let totalSuccess = 0;
  let totalFailed = 0;
  
  // 各拡張機能をビルド
  for (const dirName of extensionDirs) {
    const extSrcDir = path.join(EXTENSIONS_SRC, dirName);
    const extDistDir = path.join(EXTENSIONS_DIST, dirName);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Building: ${dirName}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // サブディレクトリ (lang-packs など) の場合は再帰的に処理
    const hasManifest = fs.existsSync(path.join(extSrcDir, 'manifest.json'));
    
    if (!hasManifest) {
      // manifest.json がない場合はサブディレクトリをスキャン
      const subDirs = fs.readdirSync(extSrcDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .filter(dirent => {
          // emptyフォルダはパス
          const subSrcDir = path.join(extSrcDir, dirent.name);
          const files = fs.readdirSync(subSrcDir);
          return files.length > 0;
        })
        .map(dirent => dirent.name);

      if (subDirs.length > 0) {
        console.log(`📁 Processing subdirectories: ${subDirs.join(', ')}\n`);

        for (const subDir of subDirs) {
          const subSrcDir = path.join(extSrcDir, subDir);
          const subDistDir = path.join(extDistDir, subDir);

          const result = await buildSingleExtension(subSrcDir, subDistDir, `${dirName}/${subDir}`);
          if (result) {
            totalSuccess++;
          } else {
            console.error(`❌ Build failed for ${dirName}/${subDir}. Stopping further builds.`);
            process.exit(1);
          }
        }

        continue;
      } else {
        // No manifest and no non-empty subdirectories: skip this folder instead of failing
        console.log(`⚠️  No manifest.json and no subdirectories in ${dirName}, skipping...\n`);
        continue;
      }
    }
    
    // manifest.json がある場合は直接ビルド
    const result = await buildSingleExtension(extSrcDir, extDistDir, dirName);
    if (result) {
      totalSuccess++;
    } else {
      console.error(`❌ Build failed for ${dirName}. Stopping further builds.`);
      process.exit(1);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✨ Build Summary (esbuild mode)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Success: ${totalSuccess}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // package.jsonがない拡張機能をtscで一括トランスパイル
  console.log('📦 Transpiling non-bundled extensions with tsc...\n');
  const tscSuccess = await transpileAllWithTsc();
  if (!tscSuccess) {
    console.error('❌ tsc transpile failed. Exiting.');
    process.exit(1);
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✨ Final Build Summary`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ esbuild bundled: ${totalSuccess}`);
  console.log(`✅ tsc transpiled: ${tscSuccess ? 'Success' : 'Failed'}`);
  console.log(`❌ esbuild failed: ${totalFailed}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // registry.jsonを自動生成
  console.log('📝 Generating registry.json...\n');
  generateRegistry();
  
  console.log(`\n✨ Extensions build completed!`);
}

/**
 * 単一の拡張機能をビルド
 */
async function buildSingleExtension(srcDir, distDir, displayName) {
  try {
    // manifest.json を確認
    const manifestPath = path.join(srcDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.log(`⚠️  No manifest.json found in ${displayName}, skipping...\n`);
      return false;
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const entryFile = manifest.entry || 'index.js';
    const entryBasename = path.basename(entryFile, path.extname(entryFile));
    
    // TypeScript/TSXエントリーポイントを探す
    const possibleEntries = [
      path.join(srcDir, `${entryBasename}.tsx`),
      path.join(srcDir, `${entryBasename}.ts`),
      path.join(srcDir, `${entryBasename}.jsx`),
      path.join(srcDir, `${entryBasename}.js`),
    ];
    
    const entryPoint = possibleEntries.find(p => fs.existsSync(p));
    
    if (!entryPoint) {
      console.error(`❌ Entry point not found: ${entryBasename}.{ts,tsx,js,jsx}\n`);
      return false;
    }
    
    // 出力ディレクトリを作成
    fs.mkdirSync(distDir, { recursive: true });
    
    // package.json がある場合
    if (hasPackageJson(srcDir)) {
      console.log(`Found package.json - using esbuild bundler`);
      
      // node_modules がない場合はインストール
      if (!hasNodeModules(srcDir)) {
        const installed = installDependencies(srcDir);
        if (!installed) {
          return false;
        }
      }
      
      // esbuild でバンドル
      const outfile = path.join(distDir, entryFile);
  const success = await bundleWithEsbuild(entryPoint, outfile, srcDir);
      
      if (!success) {
        return false;
      }
    } else {
      // package.json がない場合は後でまとめてtscでトランスパイル
      console.log(`📝 No package.json - will transpile with tsc (batch mode)\n`);
    }
    
    // .buildignoreを読み込み
    const ignorePatterns = loadBuildIgnore();
    
    // JSON, 画像, Markdownファイルをコピー
    walkDir(srcDir, (srcPath) => {
      const relativePath = path.relative(srcDir, srcPath);
      const ext = path.extname(srcPath);
      const basename = path.basename(srcPath);
      
      // .buildignoreのパターンでチェック
      if (shouldIgnore(relativePath, basename, ignorePatterns)) {
        return;
      }
      
      // manifest.json, 画像, Markdown, CSSファイルのみコピー
      if (basename === 'manifest.json' || ['.svg', '.png', '.jpg', '.md', '.css'].includes(ext)) {
        const distPath = path.join(distDir, relativePath);
        fs.mkdirSync(path.dirname(distPath), { recursive: true });
        fs.copyFileSync(srcPath, distPath);
        console.log(`📄 Copied: ${relativePath}`);
      }
    });
    
    // manifest.json内のfilesフィールドを更新（追加ファイルのリスト）
    updateManifestWithFiles(distDir);
    
    console.log(`✅ Built: ${displayName}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to build ${displayName}:`, error.message);
    console.error(error.stack);
    return false;
  }
}

/**
 * manifest.jsonを更新して追加ファイルリストを自動生成
 */
function updateManifestWithFiles(distDir) {
  const manifestPath = path.join(distDir, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    return;
  }
  
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const entryFile = manifest.entry || 'index.js';
    
    const allFiles = [];
    walkDir(distDir, (filePath) => {
      const relativePath = path.relative(distDir, filePath);
      const ext = path.extname(filePath);

      if (ext === '.js' && relativePath !== entryFile && relativePath !== 'manifest.json') {
        allFiles.push(relativePath);
      }
    });

    // Always attempt to attach README.md if present in the distDir, regardless of allFiles
    let changed = false;
    // First, prefer README in the distDir (was copied). If not present (for example
    // it's excluded via .buildignore), try to read README from the source extension
    // directory and embed its contents into the manifest without copying the file.
    try {
      const readmeInDist = fs.existsSync(path.join(distDir, 'README.md')) || fs.existsSync(path.join(distDir, 'readme.md'));
      if (readmeInDist) {
        const readmePath = fs.existsSync(path.join(distDir, 'README.md')) ? path.join(distDir, 'README.md') : path.join(distDir, 'readme.md');
        const readmeContent = fs.readFileSync(readmePath, 'utf-8');
        manifest.readme = readmeContent;
        changed = true;
      } else {
        // Try to locate the original source README.md inside extensions/ and read it
        const relative = path.relative(EXTENSIONS_DIST, distDir).replace(/\\/g, '/');
        const srcDir = path.join(EXTENSIONS_SRC, relative);
        const srcReadmePath = fs.existsSync(path.join(srcDir, 'README.md')) ? path.join(srcDir, 'README.md') :
                              fs.existsSync(path.join(srcDir, 'readme.md')) ? path.join(srcDir, 'readme.md') : null;

        if (srcReadmePath) {
          try {
            const readmeContent = fs.readFileSync(srcReadmePath, 'utf-8');
            manifest.readme = readmeContent;
            // Note: we intentionally DO NOT copy README.md into distDir when it was ignored.
            console.log(`📝 Attached README to manifest (source only): ${path.relative(EXTENSIONS_SRC, srcReadmePath)}`);
            changed = true;
          } catch (e) {
            console.error(`❌ Failed to read README.md from source for manifest augmentation: ${e.message}`);
          }
        }
      }
    } catch (e) {
      // If reading fails for any reason, continue without README
      console.error(`❌ Error while attempting to attach README to manifest: ${e.message}`);
    }

    if (allFiles.length > 0) {
      manifest.files = allFiles;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`📝 Updated manifest${allFiles.length > 0 ? ` with ${allFiles.length} additional files` : ''}${manifest.readme ? ' and README' : ''}`);
    }
  } catch (error) {
    console.error(`❌ Failed to update manifest:`, error.message);
  }
}

/**
 * registry.jsonを自動生成
 */
function generateRegistry() {
  const registry = {
    version: '1.0.0',
    extensions: []
  };
  
  function scanExtensions(dir, basePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const fullPath = path.join(dir, entry.name);
      const manifestPath = path.join(fullPath, 'manifest.json');
      
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
          
          // console.log(`✅ Added to registry: ${manifest.id}`);
        } catch (error) {
          console.error(`❌ Failed to read manifest: ${manifestPath}`, error.message);
        }
      } else {
        scanExtensions(fullPath, path.join(basePath, entry.name));
      }
    }
  }
  
  scanExtensions(EXTENSIONS_DIST);
  
  const registryPath = path.join(EXTENSIONS_DIST, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  
  console.log(`\n✅ Generated registry.json with ${registry.extensions.length} extensions`);
  
  const devRegistryPath = path.join(EXTENSIONS_SRC, 'registry.json');
  fs.copyFileSync(registryPath, devRegistryPath);
  console.log(`✅ Copied to extensions/registry.json`);
}

// 実行
buildExtensions().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
