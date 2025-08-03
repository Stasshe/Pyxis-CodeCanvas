const fs = require('fs');
const util = require('util');

// fsモジュールの非同期関数をPromiseベースに変換
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

async function processFile(inputFilePath, outputFilePath) {
  try {
    // ファイルを非同期で読み取る
    const data = await readFile(inputFilePath, 'utf8');
    console.log('ファイルの内容を読み取りました:', data);

    // 内容を大文字に変換
    const upperCaseData = data.toUpperCase();

    // 新しいファイルに書き込む
    await writeFile(outputFilePath, upperCaseData);
    console.log('変換された内容を新しいファイルに書き込みました:', outputFilePath);
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

// 使用例
const inputFilePath = './input.txt';
const outputFilePath = './output.txt';

processFile(inputFilePath, outputFilePath);