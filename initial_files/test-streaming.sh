#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "ストリーミング出力テスト"
echo "=========================================="
echo ""

# Test with streaming-test.js to verify real-time output
if [ -f "src/streaming-test.js" ]; then
  echo "--- ストリーミングテストを実行中 ---"
  echo "各行が1秒ごとにリアルタイムで表示されるはずです"
  echo ""
  
  # Use stdbuf for unbuffered output
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -o0 -e0 node src/streaming-test.js
  else
    node src/streaming-test.js
  fi
  
  echo ""
fi

echo "=========================================="
echo "テスト完了"
echo "=========================================="
