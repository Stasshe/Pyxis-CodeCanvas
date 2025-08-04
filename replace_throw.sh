#!/bin/bash

# 対象ディレクトリ
TARGET_DIR="./src"

# 置き換え処理
find "$TARGET_DIR" -type f -name "*.ts" -o -name "*.tsx" | while read -r file; do
  # "use client" または 'use client' の下にインポート文を追加
  if grep -q "^\"use client\"" "$file" || grep -q "^'use client'" "$file"; then
    sed -i "/^\"use client\"/a import { showToast } from '@/components/Toast';" "$file"
    sed -i "/^'use client'/a import { showToast } from '@/components/Toast';" "$file"
  else
    # インポート文をファイルの先頭に追加
    if ! grep -q "import { showToast } from" "$file"; then
      sed -i "1i import { showToast } from '@/components/Toast';" "$file"
    fi
  fi

  # throw new Error を showToast に置き換え
  sed -i "s/throw new Error(/showToast(/g" "$file"
done