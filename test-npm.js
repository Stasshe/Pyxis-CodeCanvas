//========
まだ使えない
//=======


// util.promisifyのテスト
const util = require('util');
const fs = require('fs');

console.log('Testing util.promisify...');

const readFileAsync = util.promisify(fs.readFile);

async function testPromisify() {
  try {
    // package.jsonを読み込んでテスト
    const content = await readFileAsync('/package.json', 'utf8');
    const packageData = JSON.parse(content);
    console.log('Package name:', packageData.name);
    console.log('util.promisify test: SUCCESS');
  } catch (error) {
    console.error('util.promisify test: FAILED', error.message);
  }
}

testPromisify();

// 小さなnpmモジュールのテスト（CDNから）
// 注意: 実際のnpmモジュールは複雑な場合があるため、まずは小さなライブラリで試します
console.log('Testing npm module loading...');

// ここで実際のnpmモジュールを試すことができます
// 例: const lodash = require('lodash');
