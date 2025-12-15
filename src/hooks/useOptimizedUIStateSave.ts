import { useCallback, useEffect, useRef } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { sessionStorage, PyxisSession } from '@/stores/sessionStorage'

const MIN_SAVE_INTERVAL = 3000

export function useOptimizedUIStateSave() {
  const timerRef = useRef<number | null>(null)
  const lastSaveRef = useRef<number>(0)

  const saveUIState = useCallback(async (uiState: PyxisSession['ui']) => {
    const now = Date.now()

    if (now - lastSaveRef.current < MIN_SAVE_INTERVAL) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        saveUIState(uiState)
      }, MIN_SAVE_INTERVAL)
      return
    }

    const projectId = useProjectStore.getState().currentProjectId || null
    if (!projectId) return

    await sessionStorage.saveUIState(uiState, projectId)
    lastSaveRef.current = Date.now()
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return { saveUIState, timerRef } as const
}
