// Full-screen sponsored ad, shown on Today a moment after the app opens —
// at most once a day per device, and never over another pop-up (the parent
// passes `blocked` while the setup guide or a celebration is up). Always
// labelled "Sponsored" with the brand, and always closable.

import { useEffect, useRef, useState } from 'react'
import { useAds } from '../data/ads'
import { recordAdClick, useViewableImpression } from './useViewableImpression'

// Whether these show at all is the 'fullscreen_ads' feature flag, switched
// from the admin panel (off by default — see FullscreenSwitch.jsx).

const SHOWN_KEY = 'tracka_fullscreen_ad_shown'
const today = () => new Date().toLocaleDateString('en-CA')

function shownToday() {
  try {
    return localStorage.getItem(SHOWN_KEY) === today()
  } catch {
    return false
  }
}

function markShown() {
  try {
    localStorage.setItem(SHOWN_KEY, today())
  } catch {
    // Private mode: it may show again on the next open — acceptable.
  }
}

export default function FullscreenAd({ userId, supabase, blocked, onOpen }) {
  const ad = useAds(userId, 'fullscreen')[0] || null
  const [visible, setVisible] = useState(false)

  // A short pause so it doesn't land on top of the app's first paint.
  useEffect(() => {
    if (!ad || blocked || shownToday()) return undefined
    const timer = setTimeout(() => {
      markShown()
      setVisible(true)
    }, 1800)
    return () => clearTimeout(timer)
  }, [ad, blocked])

  if (!ad || !visible) return null
  return <Overlay ad={ad} supabase={supabase} onClose={() => setVisible(false)} onOpen={onOpen} />
}

// Also used as the preview in the ads console (`preview` skips tracking
// and pins it inside its container instead of the whole screen).
export function Overlay({ ad, supabase, onClose, onOpen, preview = false }) {
  const ref = useRef(null)
  useViewableImpression(ref, preview ? null : supabase, preview ? null : ad.placement_id)

  useEffect(() => {
    if (preview) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, preview])

  const open = () => {
    if (!preview) recordAdClick(supabase, ad.placement_id)
    onClose()
    onOpen(ad)
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Sponsored by ${ad.brand}`}
      className={`${preview ? 'relative aspect-[9/16] w-full overflow-hidden rounded-3xl' : 'fixed inset-0 z-[70]'} flex flex-col bg-[#0B1220] text-white`}
    >
      {ad.image_url ? (
        <img src={ad.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1463F4] via-[#5B3FD9] to-[#B04FD1]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/85" />

      <div className={`relative flex items-center justify-between px-5 ${preview ? 'pt-4' : 'pt-[max(16px,env(safe-area-inset-top))]'}`}>
        <span className="rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] backdrop-blur">
          Sponsored · {ad.brand}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close ad"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 backdrop-blur"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className={`relative mt-auto px-6 ${preview ? 'pb-6' : 'pb-[max(28px,env(safe-area-inset-bottom))]'}`}>
        <h2 className={`${preview ? 'text-[22px]' : 'text-[30px]'} font-semibold leading-tight`}>{ad.headline}</h2>
        {ad.body && <p className="mt-2 text-[15px] leading-relaxed text-white/85">{ad.body}</p>}
        <button
          type="button"
          onClick={open}
          className="mt-5 w-full rounded-2xl bg-white py-4 text-[16px] font-bold text-[#101B2D]"
        >
          {ad.cta_label || 'Learn more'}
        </button>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2.5 text-[14px] font-semibold text-white/75">
          Not now
        </button>
      </div>
    </div>
  )
}
