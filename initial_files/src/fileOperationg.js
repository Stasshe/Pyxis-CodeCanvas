const fs = require('fs').promises;
const triviaList = [
  'カンガルーの赤ちゃんは生まれたとき2cmしかない！',
  '富士山は1707年に噴火している！',
  'バナナは実はベリー類に分類される！',
  '日本では縦書きが一般的だけど、横書きの起源はタイプライターにあると言われてる！'
];

async function saveRandomTrivia() {
  const randomTrivia = triviaList[Math.floor(Math.random() * triviaList.length)];
  const data = { date: new Date().toISOString(), trivia: randomTrivia };
  try {
    await fs.writeFile('trivia.json', JSON.stringify(data, null, 2), 'utf8');
    console.log('今日の豆知識を保存しました:');
    console.log(randomTrivia);
  } catch (error) {
    console.error('保存中にエラーが発生しました:', error.message);
  }
}

saveRandomTrivia();
