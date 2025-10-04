// chalkパッケージのテスト（npm install chalk が必要）

console.log('=== Testing chalk package ===');

// chalkをインポート
import chalk from 'chalk';

console.log(chalk.blue('Hello world!'));
console.log(chalk.red.bold('This is red and bold!'));
console.log(chalk.green.underline('This is green and underlined!'));
console.log(chalk.yellow.bgBlue('Yellow text on blue background!'));

console.log('=== Test completed ===');
