// readline モジュールのテストファイル
const readline = require('readline');

console.log('Readline Test Started');

// 基本的な質問テスト
async function basicTest() {
  console.log('\n=== Basic Question Test ===');
  
  const answer = await readline.question('What is your name? ');
  console.log(`Hello, ${answer}!`);
}

// インターフェースを使った対話テスト
async function interfaceTest() {
  console.log('\n=== Interface Test ===');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'MyApp> '
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
}

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
