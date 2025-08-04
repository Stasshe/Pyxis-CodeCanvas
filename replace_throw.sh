#!/bin/bash

# 対象ディレクトリ
TARGET_DIR="./src"

# 置き換え処理
find "$TARGET_DIR" \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/ThemeContext.tsx" | while read -r file; do
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

  # console.error を showToast.error に置き換え
  perl -0777 -i -pe "s/console\.error\s*\((.*?)\)/showToast.error(\1)/gs" "$file"

  # console.warn を showToast.warn に置き換え
  perl -0777 -i -pe "s/console\.warn\s*\((.*?)\)/showToast.warn(\1)/gs" "$file"

  # console.info を showToast.info に置き換え
  perl -0777 -i -pe "s/console\.info\s*\((.*?)\)/showToast.info(\1)/gs" "$file"

  # console.log を showToast.success に置き換え (例として成功メッセージ扱い)
  perl -0777 -i -pe "s/console\.log\s*\((.*?)\)/showToast.success(\1)/gs" "$file"
done