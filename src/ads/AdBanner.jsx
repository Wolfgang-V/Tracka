// A sponsored (or house) banner. Counts an impression only once at least
// half of it has been on screen for a full second — the industry-standard
// "viewable impression", so a banner scrolled past in a blur doesn't count.

import { useRef } from 'react'
import { recordAdClick, useViewableImpression } from './useViewableImpression'

export default function AdBanner({ ad, supabase, t, isNight, onOpen, onHide }) {
  const ref = useRef(null)
  useViewableImpression(ref, supabase, ad.placement_id)

  const open = () => {
    recordAdClick(supabase, ad.placement_id)
    onOpen(ad)
  }

  return (
    <div
      ref={ref}
      className={`relative mt-4 overflow-hidden rounded-3xl p-5 ${
        isNight ? 'bg-[#1463F4]/25 text-white' : 'bg-[#1463F4] text-white shadow-[0_14px_34px_-20px_rgba(20,99,244,0.9)]'
      }`}
    >
      {ad.image_url && (
        <img src={ad.image_url} alt="" className="pointer-events-none absolute inset-y-0 right-0 h-full w-32 object-cover opacity-90" />
      )}
      <svg aria-hidden="true" width="110" height="140" viewBox="0 0 24 30"
        className="pointer-events-none absolute -bottom-9 -right-4 text-white/10">
        <path fill="currentColor" d="M12 1.5c.5 0 .9.3 1.2.8l7.6 14.6A9 9 0 1 1 3.2 16.9L10.8 2.3c.3-.5.7-.8 1.2-.8Z" />
      </svg>

      <div className="relative flex items-start justify-between gap-3">
        {/* Brand ads are always labelled; house promotions say so too. */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75">
          {ad.is_house ? 'From Tracka+' : `Sponsored · ${ad.brand}`}
        </p>
        <button
          type="button"
          aria-label="Hide this"
          onClick={() => onHide(ad)}
          className="-mr-1.5 -mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <button type="button" onClick={open} className={`relative block w-full text-left ${ad.image_url ? 'pr-28' : 'pr-10'}`}>
        <p className="mt-1.5 font-display text-[24px] leading-tight">{ad.headline}</p>
        {ad.body && <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/85">{ad.body}</p>}
        <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold ${
          isNight ? 'bg-white/15 text-white' : `bg-white ${t.mark}`
        }`}>
          {ad.cta_label || 'Learn more'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </button>
    </div>
  )
}
