// One-time "Get skincare tips by email?" card on Today (migration
// 20261123050000_marketing_prompt). Shown to anyone who hasn't been asked
// yet (marketing_prompted_at is null), hasn't opted in, and hasn't
// unsubscribed. Either answer sets marketing_prompted_at so it never comes
// back, on any device.
//
// Loads its own row and renders nothing on any error, so the app works
// even if it ships before the migration.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Per session: once answered or checked, don't query again on every visit
// to Today.
const settled = new Set()

export default function EmailOptInCard({ userId, t, isNight, notify }) {
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId || settled.has(userId)) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('marketing_opt_in, email_suppressed, marketing_prompted_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) { settled.add(userId); return }
        const ask = !data.marketing_prompted_at && !data.marketing_opt_in && !data.email_suppressed
        if (!ask) settled.add(userId)
        setShow(ask)
      })
    return () => { cancelled = true }
  }, [userId])

  const answer = async (yes) => {
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update(yes
        ? { marketing_opt_in: true, email_suppressed: false, marketing_prompted_at: new Date().toISOString() }
        : { marketing_prompted_at: new Date().toISOString() })
      .eq('id', userId)
    setSaving(false)
    if (error) {
      console.error('EMAIL OPT-IN ERROR:', error)
      notify?.("Couldn't save that. Try again.")
      return
    }
    settled.add(userId)
    setShow(false)
    if (yes) notify?.("You're in. Look out for tips in your inbox.", 'success')
  }

  if (!show) return null

  return (
    <div className={`mt-8 rounded-3xl border p-5 ${
      isNight ? 'border-white/10 bg-[#13203A]' : 'border-[#1463F4]/10 bg-[#EAF1FF] text-[#14306B]'
    }`}>
      <p className="text-[16px] font-semibold">💌 Get skincare tips by email?</p>
      <p className={`mt-1.5 text-[14px] leading-relaxed ${isNight ? t.muted : 'text-[#14306B]/80'}`}>
        Routine tips, new challenges and the occasional offer. No spam, and you can turn it off anytime in Settings.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" disabled={saving} onClick={() => answer(false)}
          className={`rounded-2xl border py-3 text-[14px] font-semibold disabled:opacity-60 ${isNight ? 'border-white/15' : 'border-[#14306B]/15'}`}>
          No thanks
        </button>
        <button type="button" disabled={saving} onClick={() => answer(true)}
          className={`rounded-2xl py-3 text-[14px] font-bold disabled:opacity-60 ${t.btn}`}>
          Yes, email me
        </button>
      </div>
    </div>
  )
}
