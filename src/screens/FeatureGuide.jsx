// "Get to know Tracka+" — a step-by-step tour of every feature, opened from
// the house banner on Today. Each card can jump straight to the feature
// ("Show me"); reaching the last card counts as a guide completion for the
// campaign.

import { useState } from 'react'

const FEATURES = [
  {
    title: 'Today',
    body: 'Your morning and night routine for the day, in order. Tick each step as you go — tick them all for a perfect day.',
    screen: 'today',
  },
  {
    title: 'My routine',
    body: "Build your AM and PM routines from your products and choose which days each one is used. Tracka+ plans tonight's routine so actives that shouldn't mix don't land on the same night.",
    screen: 'routinePlanner',
  },
  {
    title: 'My products',
    body: 'Search our catalogue or add your own, with a photo. Everything you own in one place.',
    screen: 'products',
  },
  {
    title: 'Expiry & Empties',
    body: "Add the opened date and PAO (the 6M / 12M symbol on the pack) and we'll warn you before a product expires. Mark products finished to move them to Empties.",
    screen: 'products',
  },
  {
    title: 'Ingredient checker',
    body: "Pick one of your products, or paste any ingredients list, to see what's inside and spot the actives — handy before you buy.",
    screen: 'ingredientChecker',
  },
  {
    title: 'Reminders',
    body: 'Morning and night reminders at times you choose, plus SPF reapply nudges at midday and mid-afternoon.',
    screen: 'reminders',
  },
  {
    title: 'Skin profile',
    body: 'Your skin type and concerns. Keep it up to date so your routine and tips fit your skin.',
    screen: 'skinProfile',
  },
  {
    title: 'Skin diary',
    body: 'Photos and notes of your skin over time — the easiest way to see real change.',
    screen: 'progressPhotos',
  },
  {
    title: 'Streaks & progress',
    body: 'Your streak, perfect days and consistency at a glance, with a monthly skin report.',
    screen: 'progress',
  },
  {
    title: 'Challenges',
    body: 'Join challenges like 30 Days of SPF, earn medals and points, and see where you stand on the leaderboard.',
    screen: 'challenges',
  },
  {
    title: 'Your profile',
    body: 'Tap your picture on Today for everything about you. Change your photo, username and password in settings.',
    screen: 'settings',
  },
  {
    title: 'Add Tracka+ to your home screen',
    body: "Open it like an app, one tap away — and it's how reminders reach you. Find the steps under Reminders.",
    screen: 'reminders',
  },
]

export default function FeatureGuide({ t, isNight, onBack, onShowMe, onComplete }) {
  const [i, setI] = useState(0)
  const f = FEATURES[i]
  const last = i === FEATURES.length - 1

  const next = () => {
    if (last) {
      onComplete()
      return
    }
    const n = i + 1
    setI(n)
    if (n === FEATURES.length - 1) onComplete({ silent: true })
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <p className={`mt-5 text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>The tour</p>
        <h1 className="mt-1 font-display text-[36px] font-light leading-[1.05] tracking-tight">Get to know Tracka+</h1>

        {/* progress segments */}
        <div className="mt-6 flex gap-1" aria-hidden="true">
          {FEATURES.map((_, n) => (
            <span
              key={n}
              className={`h-1 flex-1 rounded-full transition-colors ${
                n <= i ? 'bg-[#1463F4]' : isNight ? 'bg-white/10' : 'bg-[#101B2D]/10'
              }`}
            />
          ))}
        </div>

        <div
          key={i}
          className={`relative mt-6 flex-1 overflow-hidden rounded-3xl border p-6 ${
            isNight ? 'border-white/10' : 'border-[#1463F4]/10 shadow-[0_14px_34px_-22px_rgba(20,99,244,0.6)]'
          }`}
          style={{
            background: isNight
              ? 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(20,99,244,0.2) 100%)'
              : 'linear-gradient(160deg, #FFFFFF 0%, #F3F7FF 55%, #DCE8FF 100%)',
          }}
        >
          <svg aria-hidden="true" width="150" height="190" viewBox="0 0 24 30"
            className={`pointer-events-none absolute -bottom-10 -right-6 ${isNight ? 'text-white/[0.05]' : 'text-[#1463F4]/[0.07]'}`}>
            <path fill="currentColor" d="M12 1.5c.5 0 .9.3 1.2.8l7.6 14.6A9 9 0 1 1 3.2 16.9L10.8 2.3c.3-.5.7-.8 1.2-.8Z" />
          </svg>
          <p className={`relative text-[12px] font-semibold tabular-nums tracking-[0.2em] ${t.faint}`}>
            {String(i + 1).padStart(2, '0')} / {String(FEATURES.length).padStart(2, '0')}
          </p>
          <h2 className="relative mt-3 font-display text-[30px] leading-tight">{f.title}</h2>
          <p className={`relative mt-3 text-[15px] leading-relaxed ${t.muted}`}>{f.body}</p>
          {f.screen !== 'today' && (
            <button
              type="button"
              onClick={() => onShowMe(f.screen)}
              className={`relative mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold ${t.mark}`}
            >
              Show me
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => setI(Math.max(0, i - 1))}
            disabled={i === 0}
            className={`flex-1 rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted} disabled:opacity-40`}
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            className={`flex-[2] rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </main>
  )
}
