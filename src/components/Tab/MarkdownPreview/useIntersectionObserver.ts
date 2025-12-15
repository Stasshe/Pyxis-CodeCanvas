import { useCallback, useEffect, useRef, useState } from 'react'

interface UseIntersectionObserverOptions {
  threshold?: number | number[]
  rootMargin?: string
  triggerOnce?: boolean
}

/**
 * Custom hook to observe element visibility using IntersectionObserver
 * Used for lazy loading mermaid diagrams and images
 */
export const useIntersectionObserver = (
  options: UseIntersectionObserverOptions = {}
): {
  ref: React.RefObject<HTMLDivElement | null>
  isIntersecting: boolean
  hasIntersected: boolean
} => {
  const { threshold = 0, rootMargin = '200px 0px', triggerOnce = true } = options
  const ref = useRef<HTMLDivElement | null>(null)
  const [isIntersecting, setIsIntersecting] = useState(false)
  const [hasIntersected, setHasIntersected] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const disconnect = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.IntersectionObserver) {
      // SSR or old browser - always render
      setIsIntersecting(true)
      setHasIntersected(true)
      return
    }

    const element = ref.current
    if (!element) return

    // If already intersected and triggerOnce, don't observe again
    if (hasIntersected && triggerOnce) return

    disconnect()

    observerRef.current = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry) {
          setIsIntersecting(entry.isIntersecting)
          if (entry.isIntersecting) {
            setHasIntersected(true)
            if (triggerOnce) {
              disconnect()
            }
          }
        }
      },
      { threshold, rootMargin }
    )

    observerRef.current.observe(element)

    return () => {
      disconnect()
    }
  }, [threshold, rootMargin, triggerOnce, hasIntersected, disconnect])

  return { ref, isIntersecting, hasIntersected }
}
