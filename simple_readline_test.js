// 簡単なreadlineテスト
const readline = require('readline');

console.log('Readline Simple Test');
console.log('This will test the readline module in the Debug Console');

// シンプルな質問テスト
readline.question('What is your favorite color? ')
  .then(answer => {
    console.log(`Nice! I like ${answer} too!`);
    return readline.question('How old are you? ');
  })
  .then(age => {
    console.log(`${age} is a great age!`);
    console.log('Test completed successfully!');
  })
  .catch(error => {
    console.error('Error:', error);
  });
