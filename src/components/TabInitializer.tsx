// src/components/TabInitializer.tsx
'use client'
import { useEffect } from 'react'

import { registerBuiltinTabs } from '@/engine/tabs/registerBuiltinTabs'

/**
 * タブシステムの初期化コンポーネント
 * アプリケーション起動時にビルトインタブタイプを登録
 */
export default function TabInitializer() {
  useEffect(() => {
    registerBuiltinTabs()
  }, [])

  return null
}
