// ストリーミング出力のテスト
// このファイルは、リアルタイムでの出力を確認するためのものです

console.log("開始: ストリーミングテスト");

// 1秒ごとに出力する
for (let i = 1; i <= 5; i++) {
  console.log(`出力 ${i}/5 - 時刻: ${new Date().toLocaleTimeString()}`);
  // 同期的に1秒待機
  const start = Date.now();
  while (Date.now() - start < 1000) {
    // busy wait
  }
}

console.log("完了: すべての出力が終了しました");
