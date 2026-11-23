// Tracka+ Wrapped: a full-screen story of the person's year. Tap the right
// side for next, the left side for back (like Instagram stories). The last
// slide makes a shareable 9:16 card.
//
// Numbers: my_year_in_review() (one call). Slides: buildWrappedSlides in
// core/wrapped, which drops anything with nothing to say.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { WRAPPED_YEAR, buildWrappedSlides, personality as personalityOf } from '../lib/core/wrapped'

const THEMES = {
  blue: 'linear-gradient(160deg, #0B1E5B 0%, #1B3FD0 55%, #2C6BFF 100%)',
  green: 'linear-gradient(160deg, #0C3B2E 0%, #12805C 60%, #3CC59A 100%)',
  sunset: 'linear-gradient(160deg, #2A1B5C 0%, #B3407A 55%, #F59E5B 100%)',
  fire: 'linear-gradient(160deg, #3A0F0F 0%, #C2381E 55%, #FFB13B 100%)',
  night: 'linear-gradient(160deg, #050B24 0%, #1A1F6B 60%, #5B4BD6 100%)',
  sunrise: 'linear-gradient(160deg, #5B2A0B 0%, #E07B24 55%, #FFD36B 100%)',
  violet: 'linear-gradient(160deg, #1E0B4A 0%, #6B2FD0 55%, #C084FC 100%)',
  gold: 'linear-gradient(160deg, #2E2205 0%, #9C6B0E 55%, #E8B931 100%)',
  teal: 'linear-gradient(160deg, #052A33 0%, #0E7A8A 55%, #4FD1C5 100%)',
  navy: 'linear-gradient(160deg, #07122B 0%, #0B1E5B 50%, #2554EB 100%)',
}

export default function WrappedScreen({ notify, onClose, onOpenRewards }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [index, setIndex] = useState(0)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('my_year_in_review', { p_year: WRAPPED_YEAR }).then(({ data: d, error: err }) => {
      if (cancelled) return
      if (err) {
        console.error('WRAPPED ERROR:', err)
        setError(true)
      } else {
        setData(d)
      }
    })
    return () => { cancelled = true }
  }, [])

  const slides = data ? buildWrappedSlides(data) : []
  const slide = slides[index]
  const last = index === slides.length - 1

  const go = (step) => setIndex((i) => Math.min(Math.max(i + step, 0), slides.length - 1))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const share = async () => {
    if (sharing || !data) return
    setSharing(true)
    try {
      const { generateWrappedImage } = await import('../lib/shareImage')
      const blob = await generateWrappedImage({ data, personality: personalityOf(data) })
      const file = new File([blob], `tracka-wrapped-${data.year}.png`, { type: 'image/png' })
      const text = `My ${data.year} in skincare ✨ ${data.days_showed_up} days showed up on Tracka+`
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Tracka+ Wrapped', text })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        URL.revokeObjectURL(url)
        notify?.('Saved. Find it in your downloads.', 'success')
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('WRAPPED SHARE ERROR:', err)
        notify?.("Couldn't make your card. Please try again.")
      }
    } finally {
      setSharing(false)
    }
  }

  const shell = (children, theme = 'blue') => (
    <div className="fixed inset-0 z-50 flex justify-center bg-black text-white" style={{ background: THEMES[theme] }}>
      <style>{`@keyframes wrapped-up { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
        .wrapped-up { animation: wrapped-up .55s ease-out both }
        @media (prefers-reduced-motion: reduce) { .wrapped-up { animation: none } }`}</style>
      <div className="relative flex h-full w-full max-w-md flex-col px-6 pb-8 pt-5">{children}</div>
    </div>
  )

  const closeButton = (
    <button type="button" onClick={onClose} aria-label="Close"
      className="relative z-20 -mr-2 rounded-full p-2 text-white/80">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )

  if (error) {
    return shell(
      <>
        <div className="flex justify-end">{closeButton}</div>
        <div className="my-auto">
          <p className="text-[22px] font-semibold">Your Wrapped didn&apos;t load</p>
          <p className="mt-2 text-[15px] text-white/75">Check your connection and try again.</p>
        </div>
      </>
    )
  }

  if (!data) {
    return shell(
      <>
        <div className="flex justify-end">{closeButton}</div>
        <p className="wrapped-up my-auto text-center text-[16px] text-white/80">Wrapping up your year…</p>
      </>
    )
  }

  const p = slide.personality

  return shell(
    <>
      {/* Progress bars */}
      <div className="relative z-20 flex gap-1.5">
        {slides.map((s, i) => (
          <span key={s.key} data-wrapped-bar className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
            <span className={`block h-full bg-white transition-all duration-300 ${i <= index ? 'w-full' : 'w-0'}`} />
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="relative z-20 text-[13px] font-semibold tracking-wide text-white/80">Tracka+</p>
        {closeButton}
      </div>

      {/* Tap zones: left third back, rest forward. Below the buttons (z-10). */}
      <button type="button" aria-label="Previous" onClick={() => go(-1)} className="absolute inset-y-0 left-0 z-10 w-1/3" />
      {!last && <button type="button" aria-label="Next" onClick={() => go(1)} className="absolute inset-y-0 right-0 z-10 w-2/3" />}

      <div key={slide.key} className="relative my-auto">
        <p className="wrapped-up text-[13px] font-semibold uppercase tracking-[0.18em] text-white/75">{slide.kicker}</p>

        {slide.emoji && <p className="wrapped-up mt-4 text-[64px] leading-none" style={{ animationDelay: '.08s' }}>{slide.emoji}</p>}

        {slide.big !== undefined && (
          <p className="wrapped-up mt-3 font-display text-[120px] font-light leading-none tabular-nums" style={{ animationDelay: '.1s' }}>
            {slide.big}
          </p>
        )}
        {slide.unit && <p className="wrapped-up text-[24px] font-semibold" style={{ animationDelay: '.18s' }}>{slide.unit}</p>}

        {slide.title && (
          <h1 className="wrapped-up mt-3 font-display text-[44px] font-light leading-[1.05]" style={{ animationDelay: '.1s' }}>
            {slide.title}
          </h1>
        )}

        {slide.split && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {slide.split.map((s, i) => (
              <div key={s.label} className="wrapped-up rounded-3xl bg-white/12 p-4" style={{ animationDelay: `${0.1 + i * 0.1}s`, background: 'rgba(255,255,255,0.12)' }}>
                <p className="text-[28px]">{s.emoji}</p>
                <p className="mt-2 font-display text-[64px] font-light leading-none tabular-nums">{s.value}</p>
                <p className="mt-1 text-[14px] text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {slide.stats && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {slide.stats.map((s, i) => (
              <div key={s.label} className="wrapped-up rounded-3xl p-4" style={{ animationDelay: `${0.08 + i * 0.07}s`, background: 'rgba(255,255,255,0.12)' }}>
                <p className="font-display text-[48px] font-light leading-none tabular-nums">{s.value}</p>
                <p className="mt-1.5 text-[13px] text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {slide.items && (
          <ol className="mt-5 flex flex-col gap-2.5">
            {slide.items.map((it, i) => (
              <li key={`${it.label}-${i}`} className="wrapped-up flex items-center gap-3 rounded-2xl p-3" style={{ animationDelay: `${0.1 + i * 0.08}s`, background: 'rgba(255,255,255,0.12)' }}>
                {it.image ? (
                  <img src={it.image} alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold" style={{ background: 'rgba(255,255,255,0.18)' }}>{i + 1}</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{it.label}</span>
                  <span className="block text-[13px] text-white/75">{it.sub}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {slide.lines.map((line, i) => (
          <p key={line} className="wrapped-up mt-4 text-[18px] leading-relaxed text-white/90" style={{ animationDelay: `${0.25 + i * 0.1}s` }}>{line}</p>
        ))}

        {slide.key === 'summary' && (
          <div className="relative z-20">
            <h1 className="wrapped-up mt-3 font-display text-[40px] font-light leading-[1.05]">
              {p.emoji} {p.title}
            </h1>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {[[data.days_showed_up, data.days_showed_up === 1 ? 'day showed up' : 'days showed up'], [data.best_streak, 'day best streak'], [data.am, data.am === 1 ? 'morning routine' : 'morning routines'], [data.pm, data.pm === 1 ? 'night routine' : 'night routines']].map(([v, l], i) => (
                <div key={l} className="wrapped-up rounded-2xl p-3.5" style={{ animationDelay: `${0.1 + i * 0.06}s`, background: 'rgba(255,255,255,0.12)' }}>
                  <p className="text-[34px] font-semibold leading-none tabular-nums">{v ?? 0}</p>
                  <p className="mt-1 text-[12.5px] text-white/80">{l}</p>
                </div>
              ))}
            </div>
            {data.days_showed_up > 0 && (
              <button type="button" disabled={sharing} onClick={share}
                className="wrapped-up mt-6 w-full rounded-2xl bg-white py-4 text-[16px] font-bold text-[#0B1E5B] disabled:opacity-70"
                style={{ animationDelay: '.35s' }}>
                {sharing ? 'Making your card…' : 'Share my Wrapped'}
              </button>
            )}
            {data.challenges?.length > 0 && (
              <button type="button" onClick={onOpenRewards}
                className="mt-2.5 w-full rounded-2xl border border-white/30 py-3.5 text-[15px] font-semibold">
                See my rewards
              </button>
            )}
            <button type="button" onClick={onClose} className="mt-2.5 w-full py-3 text-[15px] font-semibold text-white/80">
              Done
            </button>
          </div>
        )}
      </div>

      {!last && <p className="relative text-center text-[12px] text-white/60">Tap to continue</p>}
    </>,
    slide.theme
  )
}
