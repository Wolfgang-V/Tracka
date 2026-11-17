// "Add a photo" share, Strava-style: pick a selfie (camera or library), we
// lay the streak and the routine just finished over it, show a preview,
// then hand it to the phone's share sheet. The preview step matters: phones
// only allow the share sheet straight from a tap, and building the image
// takes a moment, so the Share tap has to come after it's ready.

import { useEffect, useRef, useState } from 'react'

export default function PhotoStreakShare({ streak, steps, routineLabel, t, notify, shareUrl }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { blob, url }

  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result])

  const build = async (photo) => {
    if (!photo) return
    setBusy(true)
    try {
      const { generatePhotoStreakImage } = await import('../lib/shareImage')
      const blob = await generatePhotoStreakImage({
        photo,
        streak,
        routineLabel,
        dateLabel: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        products: steps.map((s) => ({ name: s.name, category: s.category })),
      })
      setResult({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      console.error('PHOTO SHARE ERROR:', err)
      notify("Couldn't use that photo. Try another one.")
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    const file = new File([result.blob], 'tracka-streak.jpg', { type: 'image/jpeg' })
    const caption = `${routineLabel} done ✓ ${streak}-day streak on Tracka+`
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Tracka+', text: caption })
        setResult(null)
        return
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
      console.error('PHOTO SHARE ERROR:', err)
    }
    // No file sharing here (desktop, older browsers): save it instead.
    save()
    if (navigator.share) {
      try { await navigator.share({ title: 'Tracka+', text: `${caption} ${shareUrl}` }) } catch { /* closed */ }
    }
  }

  const save = () => {
    const a = document.createElement('a')
    a.href = result.url
    a.download = 'tracka-streak.jpg'
    a.click()
    notify('Image saved — share it from your photos.', 'success')
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border py-4 text-[15px] font-semibold ${t.hair} disabled:opacity-60`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-9Z" />
          <circle cx="12" cy="12.5" r="3.5" />
        </svg>
        {busy ? 'Making your card…' : 'Add a photo & share'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          build(f)
        }}
      />

      {result && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/90 px-6 py-8" onClick={() => setResult(null)}>
          <img
            src={result.url}
            alt="Your streak card"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[68vh] w-auto rounded-2xl shadow-2xl"
          />
          <div className="flex w-full max-w-sm flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={share} className="w-full rounded-2xl bg-white py-4 text-[16px] font-bold text-[#101B2D]">
              Share
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => inputRef.current?.click()} className="rounded-2xl border border-white/25 py-3 text-[14px] font-semibold text-white">
                Change photo
              </button>
              <button type="button" onClick={save} className="rounded-2xl border border-white/25 py-3 text-[14px] font-semibold text-white">
                Save image
              </button>
            </div>
            <button type="button" onClick={() => setResult(null)} className="py-2 text-[14px] font-semibold text-white/70">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
