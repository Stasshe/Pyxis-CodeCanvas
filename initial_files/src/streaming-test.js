// ストリーミング出力のテスト
// このファイルは、リアルタイムでの出力を確認するためのものです

// sleep関数 - Promiseを使用してCPUに優しい待機
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("開始: ストリーミングテスト");

  // 1秒ごとに出力する
  for (let i = 1; i <= 5; i++) {
    console.log(`出力 ${i}/5 - 時刻: ${new Date().toLocaleTimeString()}`);
    await sleep(1000);
  }

  console.log("完了: すべての出力が終了しました");
}

main();
