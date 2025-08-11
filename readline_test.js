const readline = require('readline');

console.log('🚀 ReadLine モジュールテスト開始');

// 基本的なインターフェース
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'REPL> ',
  historySize: 100,
  removeHistoryDuplicates: true
});

console.log('✅ インターフェース作成完了');

// まず履歴に何かを追加するためのテスト質問
console.log('📝 最初の質問');
rl.question('最初の質問 - 何か入力してください: ', (answer1) => {
  console.log(`入力1: "${answer1}"`);
  console.log('📋 現在の履歴:', rl.getHistory());
  
  console.log('📝 二番目の質問');
  rl.question('二番目の質問 - 別の何かを入力してください: ', (answer2) => {
    console.log(`入力2: "${answer2}"`);
    console.log('📋 現在の履歴:', rl.getHistory());
    
    console.log('🎯 カーソル制御テスト開始');
    
    // カーソル制御テスト
    console.log('移動前の位置');
    const result1 = readline.cursorTo(process.stdout, 10, 5);
    console.log('カーソル移動結果:', result1);
    
    const result2 = readline.clearLine(process.stdout, 0);
    console.log('行クリア結果:', result2);
    
    console.log('カーソル制御完了');
    
    // 履歴クリアテスト
    console.log('🗑️ 履歴クリア前:', rl.getHistory());
    rl.clearHistory();
    console.log('🗑️ 履歴クリア後:', rl.getHistory());
    
    rl.close();
    console.log('🏁 テスト完了');
  });
});

  rl.setPrompt('Enter a command (type "exit" to quit): ');
  rl.prompt();

  rl.on('line', (input) => {
    const command = input.trim();
    
    if (command === 'exit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }
    
    if (command === 'hello') {
      console.log('Hello there!');
    } else if (command === 'time') {
      console.log('Current time:', new Date().toLocaleString());
    } else if (command === 'help') {
      console.log('Available commands: hello, time, help, exit');
    } else if (command === '') {
      // 空の入力は無視
    } else {
      console.log(`Unknown command: ${command}. Type "help" for available commands.`);
    }
    
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Interface closed');
  });


// プロンプトテスト
async function promptTest() {
  console.log('\n=== Promise-based Question Test ===');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const name = await rl.questionAsync('Enter your name: ');
    const age = await rl.questionAsync('Enter your age: ');
    const city = await rl.questionAsync('Enter your city: ');
    
    console.log(`\nProfile:`);
    console.log(`Name: ${name}`);
    console.log(`Age: ${age}`);
    console.log(`City: ${city}`);
    
    rl.close();
  } catch (error) {
    console.error('Error during input:', error);
    rl.close();
  }
}

// メイン実行
async function main() {
  console.log('Choose a test:');
  console.log('1. Basic question test');
  console.log('2. Interactive interface test');
  console.log('3. Promise-based questions test');
  
  const choice = await readline.question('Enter your choice (1-3): ');
  
  switch (choice.trim()) {
    case '1':
      await basicTest();
      break;
    case '2':
      await interfaceTest();
      break;
    case '3':
      await promptTest();
      break;
    default:
      console.log('Invalid choice. Running basic test...');
      await basicTest();
      break;
  }
  
  console.log('\nTest completed!');
}

// テスト実行
main().catch(console.error);
