// カスタムモジュールのrequire()テスト

console.log('=== Testing custom module with require() ===');

// ./math.jsを作成
const fs = require('fs');

// math.jsモジュールを作成
fs.writeFileSync('/math.js', `
module.exports = {
  add: (a, b) => a + b,
  multiply: (a, b) => a * b
};
`);

console.log('✅ math.js created');

// math.jsを読み込み
const math = require('./math.js');

console.log('✅ math module loaded');
console.log('2 + 3 =', math.add(2, 3));
console.log('2 × 3 =', math.multiply(2, 3));

console.log('=== Test completed ===');
