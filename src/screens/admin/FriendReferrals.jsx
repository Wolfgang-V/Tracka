// Admin → Friend referrals: everyone who has an invite code (Settings →
// Refer a friend), how many people opened their link and signed up, and
// who those friends are. Tap an inviter to see their friends.
//
// Data: admin_friend_referrals() (migration 20261125010000). "Sign-ups"
// counts new accounts only; an existing user who opens a friend's link is
// shown but not counted, same as the inviter's own screen.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const fullName = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ')
const label = (p) => fullName(p) || (p.username ? `@${p.username}` : p.email || 'Unknown')

const shortDate = (ts) => ts
  ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

function downloadCsv(inviters) {
  const header = ['Inviter Email', 'Inviter First Name', 'Inviter Last Name', 'Inviter Username', 'Code',
    'Link opens', 'Friend sign-ups', 'Friends onboarded', 'Friends logged a routine',
    'Friend Email', 'Friend First Name', 'Friend Last Name', 'Friend Username', 'Friend joined',
    'New account', 'Onboarded', 'Logged a routine']
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const yes = (b) => (b ? 'Yes' : 'No')
  const rows = []
  for (const i of inviters) {
    const base = [i.email, i.first_name, i.last_name, i.username, i.code,
      i.link_opens, i.signups, i.onboarded, i.logged_routine]
    if (!i.friends.length) rows.push([...base, '', '', '', '', '', '', '', ''])
    for (const f of i.friends) {
      rows.push([...base, f.email, f.first_name, f.last_name, f.username, f.joined_at?.slice(0, 10),
        yes(f.new_signup), yes(f.onboarded), yes(f.logged_routine)])
    }
  }
  const lines = [header, ...rows].map((r) => r.map(cell).join(','))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tracka-friend-referrals-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function FriendReferrals({ t, notify }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [onlyWithSignups, setOnlyWithSignups] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_friend_referrals').then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        console.error('ADMIN FRIEND REFERRALS ERROR:', err)
        setError(err.message === 'Not authorized' ? 'Not authorized.' : "Couldn't load friend referrals.")
        return
      }
      setReport(data)
    })
    return () => { cancelled = true }
  }, [])

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (report?.inviters || [])
    .filter((i) => !onlyWithSignups || i.signups > 0)
    .filter((i) => !q || [i.email, i.username, i.first_name, i.last_name, i.code,
      ...i.friends.flatMap((f) => [f.email, f.username, f.first_name, f.last_name])]
      .filter(Boolean).some((v) => v.toLowerCase().includes(q))),
  [report, onlyWithSignups, q])

  if (error) return <p className={`mt-6 text-[14px] ${t.muted}`}>{error}</p>
  if (!report) return <p className={`mt-8 text-[15px] ${t.muted}`}>Loading…</p>

  const T = report.totals
  const stat = (value, text) => (
    <div className={`rounded-2xl ${t.surface} p-3`}>
      <p className="text-[20px] font-semibold">{value}</p>
      <p className={`text-[11px] ${t.muted}`}>{text}</p>
    </div>
  )

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2.5">
        {stat(T.inviters, 'Have an invite code')}
        {stat(T.link_opens, 'Link opens')}
        {stat(T.signups, 'Friends signed up')}
        {stat(T.inviters_with_signups, 'Inviters with a sign-up')}
        {stat(T.onboarded, 'Friends onboarded')}
        {stat(T.logged_routine, 'Friends logged a routine')}
      </div>

      <label className={`mt-3 flex cursor-pointer items-center gap-3 rounded-2xl ${t.surface} p-4`}>
        <input type="checkbox" checked={onlyWithSignups} onChange={(e) => setOnlyWithSignups(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-[#2554EB]" />
        <span className="text-[14px] font-semibold">Only inviters who brought someone in</span>
      </label>

      <input
        type="text"
        placeholder="Search inviter, friend or code…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`mt-3 w-full rounded-2xl border ${t.hair} px-4 py-3 text-[14px] outline-none`}
      />

      <div className="mt-3 flex items-center justify-between">
        <p className={`text-[13px] ${t.faint}`}>{shown.length} {shown.length === 1 ? 'inviter' : 'inviters'}</p>
        <button
          type="button"
          disabled={!shown.length}
          onClick={() => {
            downloadCsv(shown)
            notify?.('Exported friend referrals.', 'success')
          }}
          className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${t.hair} ${t.muted} disabled:opacity-40`}
        >
          Export CSV
        </button>
      </div>

      {!shown.length && (
        <p className={`mt-6 text-[14px] leading-relaxed ${t.muted}`}>
          {report.inviters.length
            ? 'Nobody matches.'
            : 'No one has opened Refer a friend yet. An invite code is made the first time someone opens it in Settings.'}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2.5">
        {shown.map((i) => {
          const isOpen = open === i.code
          const existing = i.existing_users
          return (
            <div key={i.code} className={`rounded-2xl border ${t.hair}`}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i.code)}
                className="w-full p-3.5 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{label(i)}</p>
                    <p className={`truncate text-[12px] ${t.muted}`}>
                      {i.email}{i.username && fullName(i) ? ` · @${i.username}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${t.hair} ${t.muted}`}>
                    {i.code}
                  </span>
                </div>
                <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.muted}`}>
                  <span><b className="font-semibold">{i.signups}</b> signed up</span>
                  <span>{i.onboarded} onboarded</span>
                  <span>{i.logged_routine} logged a routine</span>
                  <span>{i.link_opens} link {i.link_opens === 1 ? 'open' : 'opens'}</span>
                  {existing > 0 && <span>{existing} existing {existing === 1 ? 'user' : 'users'}</span>}
                </div>
                <p className={`mt-1.5 text-[11.5px] ${t.faint}`}>
                  Code since {shortDate(i.code_created_at)}
                  {i.last_signup_at ? ` · last sign-up ${shortDate(i.last_signup_at)}` : ''}
                  {!i.is_active ? ' · code switched off' : ''}
                  {i.friends.length ? (isOpen ? ' · hide friends ▲' : ' · show friends ▼') : ''}
                </p>
              </button>

              {isOpen && i.friends.length > 0 && (
                <div className={`border-t ${t.hair} px-3.5 py-2`}>
                  {i.friends.map((f) => (
                    <div key={f.user_id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold">{label(f)}</p>
                        <p className={`truncate text-[11.5px] ${t.muted}`}>{f.email}</p>
                      </div>
                      <div className={`shrink-0 text-right text-[11px] ${t.muted}`}>
                        <p>{shortDate(f.joined_at)}</p>
                        <p className={t.faint}>
                          {!f.new_signup ? 'Existing user' : f.logged_routine ? 'Logged a routine' : f.onboarded ? 'Onboarded' : 'Signed up'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
