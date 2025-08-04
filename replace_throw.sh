#!/bin/bash

# 対象ディレクトリ
TARGET_DIR="./src"

# 置き換え処理
find "$TARGET_DIR" \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/ThemeContext.tsx" | while read -r file; do
  # "use client" または 'use client' の下にインポート文を追加
  if grep -q "^\"use client\"" "$file" || grep -q "^'use client'" "$file"; then
    sed -i "/^\"use client\"/a import { showToastMessage } from '@/components/Toast';" "$file"
    sed -i "/^'use client'/a import { showToastMessage } from '@/components/Toast';" "$file"
  else
    # インポート文をファイルの先頭に追加
    if ! grep -q "import { showToastMessage } from" "$file"; then
      sed -i "1i import { showToastMessage } from '@/components/Toast';" "$file"
    fi
  fi

  # throw new Error を showToastMessage に置き換え (複数行対応)
  perl -0777 -i -pe "s/throw\s+new\s+Error\s*\((.*?)\)/showToastMessage(\1)/gs" "$file"
done