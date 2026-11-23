// Admin → Routines: who completed their AM / PM routines recently, grouped
// into segments for personalised emails, with a CSV export ready to import
// into Zoho Campaigns (columns named the way Zoho maps them).
//
// Data: admin_routine_engagement() (one row per confirmed account).
// "Can receive promotional emails" = opted in AND not unsubscribed. It's on
// by default, so an export for a promotional campaign can't include
// people who never agreed to one.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const SEGMENTS = [
  {
    key: 'consistent', label: 'Consistent', blurb: '5+ days this week for every routine they have',
    test: (u) => (u.has_am || u.has_pm) && (!u.has_am || u.am_7d >= 5) && (!u.has_pm || u.pm_7d >= 5),
  },
  { key: 'am', label: 'Did AM this week', blurb: 'Completed their morning routine at least once in 7 days', test: (u) => u.am_7d > 0 },
  { key: 'pm', label: 'Did PM this week', blurb: 'Completed their night routine at least once in 7 days', test: (u) => u.pm_7d > 0 },
  { key: 'am_only', label: 'AM but no PM', blurb: 'Morning this week, but no night routine done', test: (u) => u.am_7d > 0 && u.pm_7d === 0 },
  { key: 'pm_only', label: 'PM but no AM', blurb: 'Night this week, but no morning routine done', test: (u) => u.pm_7d > 0 && u.am_7d === 0 },
  { key: 'slipping', label: 'Slipping', blurb: 'Active in the last 30 days, nothing in the last 7', test: (u) => u.am_7d + u.pm_7d === 0 && u.am_30d + u.pm_30d > 0 },
  { key: 'never', label: 'Never completed', blurb: 'Has a routine but never finished one', test: (u) => (u.has_am || u.has_pm) && !u.last_am && !u.last_pm },
  { key: 'no_routine', label: 'No routine yet', blurb: 'Signed up but never built a routine', test: (u) => !u.has_am && !u.has_pm },
  { key: 'all', label: 'Everyone', blurb: 'All confirmed accounts', test: () => true },
]

const canPromo = (u) => u.marketing_opt_in && !u.email_suppressed

const shortDate = (d) => d
  ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  : '—'

function downloadCsv(rows, segment) {
  const header = ['Contact Email', 'First Name', 'Last Name', 'Username', 'Segment',
    'AM days (7d)', 'PM days (7d)', 'AM days (30d)', 'PM days (30d)', 'Last AM', 'Last PM',
    'Has AM routine', 'Has PM routine', 'Promotional opt-in', 'Unsubscribed', 'Signed up']
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const yes = (b) => (b ? 'Yes' : 'No')
  const lines = [header, ...rows.map((u) => [
    u.email, u.first_name, u.last_name, u.username, segment.label,
    u.am_7d, u.pm_7d, u.am_30d, u.pm_30d, u.last_am, u.last_pm,
    yes(u.has_am_routine), yes(u.has_pm_routine), yes(u.marketing_opt_in), yes(u.email_suppressed),
    u.created_at?.slice(0, 10),
  ])].map((r) => r.map(cell).join(','))

  // BOM so Excel opens names with accents correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tracka-${segment.key}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function RoutineEngagement({ t, notify }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [segmentKey, setSegmentKey] = useState('consistent')
  const [promoOnly, setPromoOnly] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_routine_engagement').then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        console.error('ADMIN ROUTINE ENGAGEMENT ERROR:', err)
        setError(err.message === 'Not authorized' ? 'Not authorized.' : "Couldn't load routine data.")
        return
      }
      // Postgres names the routine flags has_am_routine / has_pm_routine;
      // short aliases keep the segment tests readable.
      setRows((data || []).map((u) => ({ ...u, has_am: u.has_am_routine, has_pm: u.has_pm_routine })))
    })
    return () => { cancelled = true }
  }, [])

  const pool = useMemo(() => (rows || []).filter((u) => !promoOnly || canPromo(u)), [rows, promoOnly])
  const counts = useMemo(
    () => Object.fromEntries(SEGMENTS.map((s) => [s.key, pool.filter(s.test).length])),
    [pool]
  )
  const segment = SEGMENTS.find((s) => s.key === segmentKey)
  const q = query.trim().toLowerCase()
  const shown = pool
    .filter(segment.test)
    .filter((u) => !q || [u.email, u.username, u.first_name, u.last_name].filter(Boolean).some((v) => v.toLowerCase().includes(q)))

  if (error) {
    return <p className={`mt-6 text-[14px] ${t.muted}`}>{error}</p>
  }
  if (!rows) {
    return <p className={`mt-8 text-[15px] ${t.muted}`}>Loading…</p>
  }

  const weekAm = pool.filter((u) => u.am_7d > 0).length
  const weekPm = pool.filter((u) => u.pm_7d > 0).length
  const optedIn = rows.filter(canPromo).length

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2.5">
        <div className={`rounded-2xl ${t.surface} p-3`}>
          <p className="text-[20px] font-semibold">{weekAm}</p>
          <p className={`text-[11px] ${t.muted}`}>Did AM (7d)</p>
        </div>
        <div className={`rounded-2xl ${t.surface} p-3`}>
          <p className="text-[20px] font-semibold">{weekPm}</p>
          <p className={`text-[11px] ${t.muted}`}>Did PM (7d)</p>
        </div>
        <div className={`rounded-2xl ${t.surface} p-3`}>
          <p className="text-[20px] font-semibold">{optedIn}</p>
          <p className={`text-[11px] ${t.muted}`}>Promo opt-ins</p>
        </div>
      </div>

      <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-2xl ${t.surface} p-4`}>
        <input type="checkbox" checked={promoOnly} onChange={(e) => setPromoOnly(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#2554EB]" />
        <span>
          <span className="block text-[14px] font-semibold">Only people who can get promotional emails</span>
          <span className={`mt-0.5 block text-[12px] leading-relaxed ${t.muted}`}>
            Opted in and not unsubscribed ({optedIn} of {rows.length}). Keep this on for Zoho campaigns.
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSegmentKey(s.key)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
              s.key === segmentKey ? t.btn : `border ${t.hair} ${t.muted}`
            }`}
          >
            {s.label} · {counts[s.key]}
          </button>
        ))}
      </div>
      <p className={`mt-2 px-1 text-[12px] ${t.faint}`}>{segment.blurb}</p>

      <input
        type="text"
        placeholder="Search name, email or username…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`mt-3 w-full rounded-2xl border ${t.hair} px-4 py-3 text-[14px] outline-none`}
      />

      <div className="mt-3 flex items-center justify-between">
        <p className={`text-[13px] ${t.faint}`}>{shown.length} {shown.length === 1 ? 'person' : 'people'}</p>
        <button
          type="button"
          disabled={!shown.length}
          onClick={() => {
            downloadCsv(shown, segment)
            notify?.(`Exported ${shown.length} for Zoho.`, 'success')
          }}
          className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${t.hair} ${t.muted} disabled:opacity-40`}
        >
          Export CSV for Zoho
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {shown.map((u) => {
          const name = [u.first_name, u.last_name].filter(Boolean).join(' ')
          return (
            <div key={u.user_id} className={`rounded-2xl border ${t.hair} p-3.5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{name || u.username || 'No name yet'}</p>
                  <p className={`truncate text-[12px] ${t.muted}`}>{u.email}</p>
                </div>
                {!canPromo(u) && (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${t.hair} ${t.faint}`}>
                    {u.email_suppressed ? 'Unsubscribed' : 'No promo'}
                  </span>
                )}
              </div>
              <div className={`mt-2 grid grid-cols-2 gap-2 text-[12px] ${t.muted}`}>
                <span>
                  ☀️ AM {u.has_am ? `${u.am_7d}/7 · ${u.am_30d}/30` : 'no routine'}
                  <span className={t.faint}> · last {shortDate(u.last_am)}</span>
                </span>
                <span>
                  🌙 PM {u.has_pm ? `${u.pm_7d}/7 · ${u.pm_30d}/30` : 'no routine'}
                  <span className={t.faint}> · last {shortDate(u.last_pm)}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
