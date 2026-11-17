// Counts an impression once at least half of the element has been on
// screen for a full second — the industry-standard "viewable impression",
// so an ad scrolled past in a blur doesn't count. Shared by every ad slot.

import { useEffect } from 'react'
import { recordAdEvent } from '../lib/ads'

export function useViewableImpression(ref, supabase, placementId) {
  useEffect(() => {
    const el = ref.current
    if (!el || !placementId || !('IntersectionObserver' in window)) return
    let timer = null
    let counted = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (counted) return
        if (entry.intersectionRatio >= 0.5) {
          if (!timer) {
            timer = window.setTimeout(() => {
              counted = true
              recordAdEvent(supabase, placementId, 'impression')
              observer.disconnect()
            }, 1000)
          }
        } else if (timer) {
          window.clearTimeout(timer)
          timer = null
        }
      },
      { threshold: [0, 0.5, 1] }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timer) window.clearTimeout(timer)
    }
  }, [ref, supabase, placementId])
}

// A tap proves the ad was seen, even inside the first second, so the
// impression is recorded with every click (deduped server-side) and clicks
// can't outrun views.
export function recordAdClick(supabase, placementId) {
  recordAdEvent(supabase, placementId, 'impression')
  recordAdEvent(supabase, placementId, 'click')
}
