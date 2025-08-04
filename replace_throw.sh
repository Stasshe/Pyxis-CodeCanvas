#!/bin/bash

# 対象ディレクトリ
TARGET_DIR="./src"

# 置き換え処理
find "$TARGET_DIR" -type f -name "*.ts" -o -name "*.tsx" | while read -r file; do
  # インポート文を追加
  if ! grep -q "import { showToast } from" "$file"; then
    sed -i "1i import { showToast } from '@/components/Toast';" "$file"
  fi

  # throw new Error を showToast に置き換え
  sed -i "s/throw new Error(/showToast(/g" "$file"
done