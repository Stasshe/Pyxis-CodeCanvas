import { STORES, storageService } from '@/engine/storage'

/**
 * Simple adapter to persist AI review metadata using storageService.
 * Stores entries under `AI_REVIEWS` store with keys: `aiReview:${projectId}:${filePath}`
 */
export async function saveAIReviewEntry(
  projectId: string,
  filePath: string,
  originalContent: string,
  suggestedContent: string,
  meta?: { message?: string; parentMessageId?: string }
) {
  if (!projectId) return
  // Normalize filePath to avoid mismatches (leading slash, case differences)
  const normalizedPath = String(filePath || '').replace(/^\/+/, '')
  const key = `aiReview:${projectId}:${normalizedPath}`

  const existing = (await storageService.get(STORES.AI_REVIEWS, key)) as any | null

  const historyEntry = {
    id: `airev-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: new Date(),
    content: originalContent,
    note: meta?.message,
  }

  const payload = {
    projectId,
    filePath: normalizedPath,
    suggestedContent,
    originalSnapshot: originalContent,
    status: 'pending',
    comments: meta?.message,
    parentMessageId: meta?.parentMessageId,
    history:
      existing && Array.isArray(existing.history)
        ? [historyEntry, ...existing.history]
        : [historyEntry],
    updatedAt: Date.now(),
  }

  await storageService.set(STORES.AI_REVIEWS, key, payload, { cache: false })
  console.log('[aiStorageAdapter] Saved AI review entry:', key)
}

export async function clearAIReviewEntry(projectId: string, filePath: string) {
  if (!projectId) return
  const normalizedPath = String(filePath || '').replace(/^\/+/, '')
  const key = `aiReview:${projectId}:${normalizedPath}`
  await storageService.delete(STORES.AI_REVIEWS, key)
}

export async function getAIReviewEntry(projectId: string, filePath: string) {
  if (!projectId) return null
  const normalizedPath = String(filePath || '').replace(/^\/+/, '')
  const key = `aiReview:${projectId}:${normalizedPath}`
  return (await storageService.get(STORES.AI_REVIEWS, key)) as any | null
}

export async function updateAIReviewEntry(
  projectId: string,
  filePath: string,
  patch: Partial<any>
) {
  if (!projectId) return null
  const normalizedPath = String(filePath || '').replace(/^\/+/, '')
  const key = `aiReview:${projectId}:${normalizedPath}`
  const existing = (await storageService.get(STORES.AI_REVIEWS, key)) as any | null
  if (!existing) return null
  const updated = { ...existing, ...patch, updatedAt: Date.now() }
  await storageService.set(STORES.AI_REVIEWS, key, updated, { cache: false })
  return updated
}
