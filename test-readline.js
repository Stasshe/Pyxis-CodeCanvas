const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('=== Readline Test ===');

rl.question('What is your name? ', (name) => {
  console.log(`Hello, ${name}!`);
  
  rl.question('How old are you? ', (age) => {
    console.log(`You are ${age} years old.`);
    
    rl.question('What is your favorite color? ', (color) => {
      console.log(`Your favorite color is ${color}.`);
      console.log('\n=== Summary ===');
      console.log(`Name: ${name}`);
      console.log(`Age: ${age}`);
      console.log(`Favorite Color: ${color}`);
      
      rl.close();
    });
  });
});

rl.on('close', () => {
  console.log('\nGoodbye!');
});
