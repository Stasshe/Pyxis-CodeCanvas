'use client'

import { useEffect } from 'react'

import { initializeExtensions } from '@/engine/extensions/autoInstaller'
import { initializeBuiltinRuntimes } from '@/engine/runtime/builtinRuntimes'

export default function ExtensionInitializer() {
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        // ビルトインランタイムを初期化
        initializeBuiltinRuntimes()

        // 拡張機能を初期化
        await initializeExtensions()
        if (mounted) {
          // noop: initialization complete
        }
      } catch (err) {
        // don't throw in client render path
        // log to console for debugging
        console.error('[ExtensionInitializer] failed to init extensions', err)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  return null
}
