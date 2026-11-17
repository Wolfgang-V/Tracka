// A sponsored card for the product-card and sponsored-challenge slots.
// Always labelled with the brand, so it's clear it's paid placement.
// `compact` is the challenge-page style (a sponsor line under the hero).

import { useRef } from 'react'
import { recordAdClick, useViewableImpression } from './useViewableImpression'

export default function SponsoredCard({ ad, supabase, t, isNight, onOpen, compact = false }) {
  const ref = useRef(null)
  useViewableImpression(ref, supabase, ad.placement_id)

  const open = () => {
    recordAdClick(supabase, ad.placement_id)
    onOpen(ad)
  }

  if (compact) {
    return (
      <div ref={ref} className={`mt-4 flex items-center gap-3 rounded-2xl border ${t.hair} p-3.5`}>
        {ad.image_url && (
          <img src={ad.image_url} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-white object-contain p-0.5" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>Sponsored by {ad.brand}</p>
          <p className="mt-0.5 truncate text-[14px] font-semibold">{ad.headline}</p>
        </div>
        {ad.cta_label && (
          <button type="button" onClick={open} className={`shrink-0 text-[13px] font-semibold ${t.mark}`}>
            {ad.cta_label} →
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={`overflow-hidden rounded-3xl border ${
        isNight ? 'border-white/10' : 'border-[#1463F4]/10 shadow-[0_10px_30px_-20px_rgba(20,99,244,0.6)]'
      } ${t.surface}`}
    >
      <button type="button" onClick={open} className="flex w-full items-stretch gap-4 p-4 text-left">
        {ad.image_url && (
          <img src={ad.image_url} alt="" className="h-20 w-20 shrink-0 rounded-2xl bg-white object-contain p-1" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block text-[10px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>Sponsored · {ad.brand}</span>
          <span className="mt-1 block text-[15px] font-semibold leading-snug">{ad.headline}</span>
          {ad.body && <span className={`mt-1 block text-[13px] leading-relaxed ${t.muted}`}>{ad.body}</span>}
          {ad.cta_label && <span className={`mt-2 inline-block text-[13px] font-semibold ${t.mark}`}>{ad.cta_label} →</span>}
        </span>
      </button>
    </div>
  )
}
