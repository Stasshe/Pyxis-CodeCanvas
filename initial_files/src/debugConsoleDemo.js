const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout,
});

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  fg: {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
  },
  bg: {
    black: "\x1b[40m",
    red: "\x1b[41m",
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    blue: "\x1b[44m",
    magenta: "\x1b[45m",
    cyan: "\x1b[46m",
    white: "\x1b[47m",
    gray: "\x1b[100m",
  }
};

readline.question('あなたの名前を入力してください (Enter your name): ', name => {
  console.log(`${colors.fg.green}こんにちは, ${name}!${colors.reset}`);
  console.log(`${colors.bg.blue}これは背景色が青色のメッセージです。${colors.reset}`);
  console.log(`${colors.fg.red}${colors.bright}これは明るい赤色のテキストです。${colors.reset}`);
  console.log(`${colors.underscore}下線付きテキスト${colors.reset}`);
  console.log(`${colors.reverse}反転テキスト${colors.reset}`);

  //セッション終了
  readline.close();
});
