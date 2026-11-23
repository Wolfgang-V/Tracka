// Settings → Your details: first name, last name, username, and whether
// we may send promotional emails. Replaces the old "Update your username"
// screen. Owns its own state and saves straight to profiles.
//
// marketing_opt_in_at is stamped by the database (a trigger), never here.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ProfileDetailsScreen({ t, user, notify, onBack, setDisplayName }) {
  const [loaded, setLoaded] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [marketingOptIn, setMarketingOptIn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('username, first_name, last_name, marketing_opt_in')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('PROFILE DETAILS LOAD ERROR:', error)
          setStatus("Couldn't load your details. Check your connection and try again.")
        }
        setFirstName(data?.first_name ?? '')
        setLastName(data?.last_name ?? '')
        setUsername(data?.username ?? '')
        setMarketingOptIn(Boolean(data?.marketing_opt_in))
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [user?.id])

  const save = async () => {
    const first = firstName.trim()
    const last = lastName.trim()
    const handle = username.trim()

    if (!handle) { setStatus('Please enter a username.'); return }
    if (handle.length < 2 || handle.length > 30) { setStatus('Your username needs to be 2 to 30 characters.'); return }
    if (first.length > 50 || last.length > 50) { setStatus('Names can be up to 50 characters.'); return }

    setSaving(true)
    setStatus(null)
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: first || null,
        last_name: last || null,
        username: handle,
        marketing_opt_in: marketingOptIn,
        // Ticking this is explicit consent, so it lifts an earlier
        // "Don't email me again" (unsubscribe_email sets email_suppressed).
        ...(marketingOptIn ? { email_suppressed: false } : {}),
      })
      .eq('id', user.id)
    setSaving(false)

    if (error) {
      console.error('PROFILE DETAILS SAVE ERROR:', error)
      setStatus(error.code === '23505'
        ? 'That username is already taken. Try another one.'
        : "Couldn't save your details. Try again.")
      return
    }

    setDisplayName?.(handle)
    notify?.('Your details are saved.', 'success')
  }

  const input = `w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`
  const label = `mb-2 block text-[13px] font-semibold ${t.faint}`

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Settings
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">Your details</h1>
          {user?.email && <p className={`mt-3 text-[15px] ${t.muted}`}>{user.email}</p>}
        </div>

        {!loaded ? (
          <p className={`mt-8 text-[14px] ${t.muted}`}>Loading…</p>
        ) : (
          <>
            <div className={`mt-8 flex flex-col gap-5 rounded-3xl ${t.surface} p-5`}>
              <div>
                <label className={label}>First name</label>
                <input type="text" autoComplete="given-name" value={firstName}
                  onChange={(e) => setFirstName(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Last name</label>
                <input type="text" autoComplete="family-name" value={lastName}
                  onChange={(e) => setLastName(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Username</label>
                <input type="text" autoComplete="username" autoCapitalize="none" value={username}
                  onChange={(e) => setUsername(e.target.value)} className={input} />
                <p className={`mt-1.5 px-1 text-[12px] ${t.faint}`}>Shown on challenge leaderboards.</p>
              </div>
            </div>

            <label className={`mt-4 flex cursor-pointer items-start gap-3 rounded-3xl ${t.surface} p-5`}>
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#2554EB]"
              />
              <span>
                <span className="block text-[15px] font-semibold">Promotional emails</span>
                <span className={`mt-1 block text-[13.5px] leading-relaxed ${t.muted}`}>
                  Skincare tips, challenges and offers from Tracka+. Account emails (like password resets) still come either way.
                </span>
              </span>
            </label>

            <button
              disabled={saving}
              onClick={save}
              className={`mt-5 w-full rounded-2xl py-4 text-base font-bold ${t.btn} disabled:opacity-60`}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}

        {status && <p className={`mt-4 text-center text-[14px] leading-relaxed ${t.muted}`}>{status}</p>}
      </div>
    </main>
  )
}
