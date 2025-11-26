// メインエントリーポイント
console.log("Hello, World!");

// 配列処理の例
const arr = [1, 2, 3, 4];
const squared = arr.map(x => x * x);
console.log("二乗した配列:", squared);

// 非同期処理の例
async function getData() {
  return await new Promise(res => setTimeout(() => res("3秒経ちました。"), 3000));
}
getData().then(console.log);

import { add, multiply } from './math.js';

console.log('1 + 2 =', add(1, 2));
console.log('3 * 4 =', multiply(3, 4));
