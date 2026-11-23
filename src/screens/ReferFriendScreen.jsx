// Refer a friend (Settings → Refer a friend): your own invite link, ways to
// share it, and how many friends have joined through it.
//
// Built on the referral platform: the link is ?ref=CODE, so a friend who
// opens it and signs up is credited to you (first link they opened wins).
// my_referral() makes your code the first time you open this screen.
//
// Rewards are switched off until subscriptions exist. Flip
// REFERRAL_REWARDS_ENABLED and set REWARD_TEXT when they launch; sign-ups
// counted before then are already stored, so nobody's invites are lost.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const REFERRAL_REWARDS_ENABLED = false
const REWARD_TEXT = 'You and your friend both get a free month of Tracka+.'

// www directly: the bare domain redirects there anyway (keeping ?ref).
const inviteLink = (code) => `https://www.trackaplus.app/?ref=${encodeURIComponent(code)}`

export default function ReferFriendScreen({ t, isNight, notify, onBack }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('my_referral').then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        console.error('MY REFERRAL ERROR:', err)
        setError(true)
      } else {
        setInfo(data)
      }
    })
    return () => { cancelled = true }
  }, [])

  const link = info?.code ? inviteLink(info.code) : ''
  const message = `I track my skincare routine with Tracka+. Join me: ${link}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify?.("Couldn't copy. Press and hold the link to copy it.")
    }
  }

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Tracka+', text: message })
      } catch { /* closed the share sheet */ }
    } else {
      copy()
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Settings
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>Refer a friend</p>
          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Build better skin habits together.
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Invite your friends to join Tracka+. The more friends you bring on board, the more chances you have to win exciting skincare rewards!
          </p>
        </div>

        {REFERRAL_REWARDS_ENABLED && (
          <div className={`mt-6 rounded-3xl border p-4 text-[14px] font-medium leading-relaxed ${
            isNight ? 'border-white/10 bg-[#13203A]' : 'border-[#1463F4]/10 bg-[#EAF1FF] text-[#14306B]'
          }`}>
            {REWARD_TEXT}
          </div>
        )}

        {error ? (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[15px] font-semibold">Your link didn&apos;t load</p>
            <p className={`mt-1 text-[14px] ${t.muted}`}>Check your connection and open this page again.</p>
          </div>
        ) : !info ? (
          <p className={`mt-8 text-[14px] ${t.muted}`}>Getting your link…</p>
        ) : (
          <>
            <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
              <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Your invite link</p>
              <p className="mt-2 select-all break-all text-[15px] font-semibold">{link}</p>
              <p className={`mt-1 text-[13px] ${t.muted}`}>
                Code <span className="font-semibold tracking-wide">{info.code}</span>
              </p>

              <div className="mt-5 flex flex-col gap-2.5">
                <button type="button" onClick={share} className={`w-full rounded-2xl py-4 text-[15px] font-bold ${t.btn}`}>
                  Share my link
                </button>
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-2xl border py-3.5 text-center text-[14px] font-semibold ${t.hair}`}
                  >
                    WhatsApp
                  </a>
                  <button type="button" onClick={copy} className={`rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair}`}>
                    {copied ? 'Copied ✓' : 'Copy link'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className={`rounded-3xl ${t.surface} p-4`}>
                <p className="text-[28px] font-semibold tabular-nums leading-none">{info.friends_joined}</p>
                <p className={`mt-1.5 text-[13px] ${t.muted}`}>{info.friends_joined === 1 ? 'friend joined' : 'friends joined'}</p>
              </div>
              <div className={`rounded-3xl ${t.surface} p-4`}>
                <p className="text-[28px] font-semibold tabular-nums leading-none">{info.friends_onboarded}</p>
                <p className={`mt-1.5 text-[13px] ${t.muted}`}>set up their routine</p>
              </div>
            </div>

            <p className={`mt-5 px-1 text-[12.5px] leading-relaxed ${t.faint}`}>
              Your friends will be counted once they create a new Tracka+ account using your invite link. To make sure your referral is tracked, they should sign up on the same device and browser they used to open your link.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
