/**
 * Custom build script for r-runtime extension
 * Copies necessary WASM files from node_modules to public directory
 */

const fs = require('fs');
const path = require('path');

function copyWasmFiles(distDir) {
  console.log('📦 Copying webR WASM files from node_modules...');
  
  try {
    // Find the webr package in node_modules
    const rootDir = path.resolve(__dirname, '..', '..');
    const webrSrc = path.join(rootDir, 'node_modules', 'webr', 'dist');
    
    if (!fs.existsSync(webrSrc)) {
      console.warn('⚠️  webR package not found in node_modules');
      return;
    }
    
    // Create dist directory if it doesn't exist
    fs.mkdirSync(distDir, { recursive: true });
    
    // Only copy .wasm files
    const copyWasmFilesRecursive = (src, dest) => {
      if (!fs.existsSync(src)) return;
      
      const entries = fs.readdirSync(src, { withFileTypes: true });
      
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          copyWasmFilesRecursive(srcPath, destPath);
        } else if (entry.name.endsWith('.wasm')) {
          fs.mkdirSync(dest, { recursive: true });
          fs.copyFileSync(srcPath, destPath);
          console.log(`  ✅ Copied: ${path.relative(rootDir, destPath)}`);
        }
      }
    };
    
    // Copy only .wasm files from webr dist
    copyWasmFilesRecursive(webrSrc, distDir);
    
    console.log('✅ webR WASM files copied successfully');
  } catch (error) {
    console.error('❌ Failed to copy webR WASM files:', error.message);
    // Don't fail the build, just warn
  }
}

// Main execution
const distDir = process.argv[2];
if (!distDir) {
  console.error('❌ No dist directory provided');
  process.exit(1);
}

copyWasmFiles(distDir);
