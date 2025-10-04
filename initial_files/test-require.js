// require()のテスト

console.log('=== Testing require() with node_modules ===');

// ビルトインモジュールのテスト
const fs = require('fs');
const path = require('path');

console.log('✅ fs module loaded');
console.log('✅ path module loaded');

// ファイル書き込みテスト
fs.writeFile('/test-output.txt', 'Hello from require()!', (err) => {
  if (err) {
    console.error('❌ Failed to write file:', err);
  } else {
    console.log('✅ File written successfully!');
  }
});

// pathモジュールテスト
const joined = path.join('/foo', 'bar', 'baz.txt');
console.log('✅ path.join() result:', joined);

console.log('=== Test completed ===');
