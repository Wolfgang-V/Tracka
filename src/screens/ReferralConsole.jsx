// Referral console — the admin's workspace for store / clinic QR referrals:
// dashboard, partner pages, creating codes, and handing them out (QR, flyer,
// share link).
//
// Self-contained on purpose: it only needs the Supabase client and a few
// app helpers via props, so a future "referral manager" (team) or partner
// view can reuse it. Who may use it is decided server-side by
// can_manage_referrals(); every RPC here enforces that.

import { useEffect, useMemo, useState } from 'react'

const SITE = 'https://trackaplus.app'
const linkFor = (code) => `${SITE}/?ref=${encodeURIComponent(code)}`
const KINDS = ['store', 'clinic', 'spa', 'brand', 'online', 'event']

// Suggest a printable code from partner + branch: "Beauty Hut", "Lekki"
// → "BEAUTYHUT-LEKKI". Matches the DB rule ^[A-Z0-9][A-Z0-9-]{1,23}$.
const suggestCode = (partner, label) => {
  const slug = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')
  const branch = slug((label || '').replace(/\bbranch\b/i, ''))
  return [slug(partner).slice(0, 14), branch.slice(0, 9)].filter(Boolean).join('-').slice(0, 24)
}

const fmtDay = (d, opts = { day: 'numeric', month: 'short' }) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', opts)

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')

// QR library is only needed here — load it on demand so the main app
// bundle doesn't carry it.
let qrModule = null
const loadQr = async () => {
  if (!qrModule) qrModule = (await import('qrcode')).default
  return qrModule
}

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Same card as qr/generate.py (1200×1500, 4:5): title, tagline, QR,
// "SCAN TO START", partner, branch, code.
async function renderFlyer({ code, partner, label }) {
  const QR = await loadQr()
  await document.fonts.load('700 76px Inter')
  await document.fonts.load('400 34px Inter')
  const W = 1200
  const H = 1500
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(24, 24, W - 48, H - 48, 48)
  ctx.stroke()

  const centred = (text, y, font, color) => {
    ctx.font = font
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(text, W / 2, y)
  }
  centred('Tracka+', 92, '700 76px Inter, system-ui, sans-serif', '#2563eb')
  centred('Your skincare routine, remembered.', 196, '400 34px Inter, system-ui, sans-serif', '#64748b')

  const qrCanvas = document.createElement('canvas')
  await QR.toCanvas(qrCanvas, linkFor(code), {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 760,
    color: { dark: '#2563eb', light: '#ffffff' },
  })
  ctx.drawImage(qrCanvas, (W - 760) / 2, 300, 760, 760)

  centred('SCAN TO START', 1116, '600 30px Inter, system-ui, sans-serif', '#64748b')
  centred(partner, 1172, '700 56px Inter, system-ui, sans-serif', '#0f172a')
  let y = 1252
  if (label) {
    centred(label, y, '400 34px Inter, system-ui, sans-serif', '#64748b')
    y += 54
  }
  centred(code, y + 8, '700 30px Inter, system-ui, sans-serif', '#2563eb')

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// One series per chart (scans / sign-ups share a unit but not a scale, so
// they get a chart each rather than two scales on one). Thin rounded bars,
// one accent colour, tap/hover read-out instead of labels on every bar.
function DayBars({ data, field, label, t, isNight, barClass }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...data.map((d) => d[field]))
  const total = data.reduce((sum, d) => sum + d[field], 0)
  const n = data.length
  const W = 300
  const H = 64
  const gap = 2
  const bw = (W - gap * (n - 1)) / n
  const active = hover !== null ? data[hover] : null

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n)
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className={`rounded-2xl ${t.surface} p-4`}>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className={`text-[12px] tabular-nums ${t.muted}`}>
          {active
            ? `${fmtDay(active.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${active[field]}`
            : `${total} in ${n} days`}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-3 block h-16 w-full touch-none"
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${label}: ${total} over the last ${n} days`}
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke={isNight ? 'rgba(237,242,250,0.12)' : 'rgba(16,27,45,0.12)'} />
        {data.map((d, i) => {
          const h = d[field] > 0 ? Math.max(2, (d[field] / max) * (H - 4)) : 0
          return (
            <rect
              key={d.date}
              x={i * (bw + gap)}
              y={H - h}
              width={bw}
              height={h}
              rx={Math.min(2, bw / 2)}
              className={`${barClass} ${hover !== null && hover !== i ? 'opacity-40' : ''}`}
            />
          )
        })}
      </svg>
      <div className={`mt-1.5 flex justify-between text-[10px] ${t.faint}`}>
        <span>{fmtDay(data[0].date)}</span>
        <span>{fmtDay(data[Math.floor(n / 2)].date)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

// Layout pieces live at module level, NOT inside the component: a component
// defined inside another is a new type on every render, which remounts its
// children — inputs would lose focus after every keystroke.
function Shell({ t, children }) {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-7">{children}</div>
    </main>
  )
}

function BackButton({ t, label, onClick }) {
  return (
    <button onClick={onClick} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </button>
  )
}

function Kpis({ t, s }) {
  return (
    <div className="grid min-w-0 grid-cols-4 gap-2">
      {[
        [s.scans, 'Scans'],
        [s.signups, 'Sign-ups'],
        [s.logged_routine, 'Active'],
        [pct(s.signups, s.visitors), 'Convert'],
      ].map(([v, l]) => (
        <div key={l} className={`min-w-0 rounded-2xl ${t.surface} px-2.5 py-3`}>
          <p className="text-[20px] font-semibold leading-none tabular-nums">{v}</p>
          <p className={`mt-1.5 text-[11px] ${t.muted}`}>{l}</p>
        </div>
      ))}
    </div>
  )
}

function Funnel({ t, s }) {
  return (
    // Even five-column grid so the funnel always fits a phone; a flex row of
    // labels + arrows was wider than the screen and pushed the page sideways.
    <div className={`mt-3 grid grid-cols-5 rounded-2xl border ${t.hair} py-2.5 text-center`}>
      {[
        ['Scans', s.scans],
        ['Sign-ups', s.signups],
        ['Onboarded', s.onboarded],
        ['Logged', s.logged_routine],
        ['Perfect day', s.perfect_day],
      ].map(([l, v], i) => (
        <div key={l} className={`min-w-0 px-1 ${i > 0 ? `border-l ${t.hair}` : ''}`}>
          <p className="text-[14px] font-semibold tabular-nums">{v}</p>
          <p className={`truncate text-[9.5px] leading-tight ${t.faint}`}>{l}</p>
        </div>
      ))}
    </div>
  )
}

export default function ReferralConsole({ supabase, t, isNight, notify, confirmAction, onBack, initialView }) {
  const [report, setReport] = useState(null)
  const [activity, setActivity] = useState(null)
  const [view, setView] = useState(initialView || { name: 'overview' })
  const [form, setForm] = useState({ partner: '', kind: 'store', label: '', city: '', phone: '', code: '', codeEdited: false })
  const [saving, setSaving] = useState(false)
  const [qrUrl, setQrUrl] = useState(null)

  const partnerId = view.name === 'partner' ? view.partnerId : null

  const loadReport = async () => {
    const { data, error } = await supabase.rpc('admin_referral_report')
    if (error) {
      notify(error.message === 'Not authorized' ? 'Only the admin account can open the referral console.' : "Couldn't load referrals.")
      return
    }
    setReport(data)
  }

  useEffect(() => {
    let cancelled = false
    supabase.rpc('admin_referral_report').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        notify(error.message === 'Not authorized' ? 'Only the admin account can open the referral console.' : "Couldn't load referrals.")
        return
      }
      setReport(data)
    })
    return () => { cancelled = true }
    // `notify` is a new function on every App render; depending on it would
    // re-fetch (and on an error, toast → re-render → re-fetch in a loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('admin_referral_activity', { p_days: 30, p_partner_id: partnerId })
      .then(({ data, error }) => {
        if (!cancelled && !error) setActivity(data)
      })
    return () => { cancelled = true }
  }, [supabase, partnerId])

  // Partners are built from the per-code rows (which carry partner_id), so
  // drilling in and rolling up always agree.
  const partners = useMemo(() => {
    if (!report) return []
    const map = new Map()
    for (const c of report.codes) {
      const key = c.partner_id || 'none'
      const p = map.get(key) || {
        partnerId: c.partner_id, partner: c.partner, kind: c.kind, city: c.city,
        codes: [], scans: 0, visitors: 0, signups: 0, onboarded: 0, logged_routine: 0, perfect_day: 0, last_scan_at: null,
      }
      p.codes.push(c)
      for (const k of ['scans', 'visitors', 'signups', 'onboarded', 'logged_routine', 'perfect_day']) p[k] += c[k]
      if (c.last_scan_at && (!p.last_scan_at || c.last_scan_at > p.last_scan_at)) p.last_scan_at = c.last_scan_at
      map.set(key, p)
    }
    return [...map.values()].sort((a, b) => b.signups - a.signups || b.scans - a.scans || a.partner.localeCompare(b.partner))
  }, [report])

  const codeRow = view.name === 'code' ? report?.codes.find((c) => c.code === view.code) : null

  // Render the QR for the code page.
  useEffect(() => {
    if (view.name !== 'code') return
    let cancelled = false
    loadQr().then((QR) =>
      QR.toDataURL(linkFor(view.code), {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 640,
        color: { dark: '#2563eb', light: '#ffffff' },
      }).then((url) => { if (!cancelled) setQrUrl(url) })
    )
    return () => { cancelled = true }
  }, [view])

  const openCreate = (preset) => {
    setForm({
      partner: preset?.partner || '',
      kind: preset?.kind || 'store',
      label: '',
      city: preset?.city || '',
      phone: '',
      code: preset ? suggestCode(preset.partner, '') : '',
      codeEdited: false,
    })
    setView({ name: 'create', back: view })
  }

  const updateForm = (patch) =>
    setForm((f) => {
      const next = { ...f, ...patch }
      if (!next.codeEdited) next.code = suggestCode(next.partner, next.label)
      return next
    })

  const createCode = async () => {
    const code = form.code.trim().toUpperCase()
    if (!form.partner.trim()) return notify('Add the partner name.')
    if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) {
      return notify('Code must be 2–24 letters, numbers or dashes, e.g. BEAUTYHUT-LEKKI.')
    }
    if (report?.codes.some((c) => c.code === code)) {
      const ok = await confirmAction(
        `${code} already exists. Move it to ${form.partner.trim()} and reactivate it?`,
        ['Cancel', 'Use it']
      )
      if (!ok) return
    }
    setSaving(true)
    const { error } = await supabase.rpc('admin_upsert_referral_code', {
      p_code: code,
      p_partner_name: form.partner.trim(),
      p_kind: form.kind,
      p_label: form.label.trim() || null,
      p_city: form.city.trim() || null,
      p_contact_phone: form.phone.trim() || null,
    })
    setSaving(false)
    if (error) return notify(error.message)
    await loadReport()
    notify(`${code} is live.`, 'success')
    setView({ name: 'code', code, back: { name: 'overview' } })
  }

  const setActive = async (code, active) => {
    if (!active) {
      const ok = await confirmAction(
        `Retire ${code}? New scans of its flyers will be ignored. Its history and the people it already brought in are kept.`,
        ['Cancel', 'Retire']
      )
      if (!ok) return
    }
    const { error } = await supabase.rpc('admin_set_referral_code_active', { p_code: code, p_active: active })
    if (error) return notify(error.message)
    await loadReport()
    notify(active ? `${code} reactivated.` : `${code} retired.`, 'success')
  }

  const share = async (code, partner) => {
    const url = linkFor(code)
    const text = `Track your skincare routine with Tracka+ — ${partner ? `via ${partner}` : 'join here'}:`
    if (navigator.share) {
      try { await navigator.share({ title: 'Tracka+', text, url }) } catch { /* cancelled */ }
      return
    }
    await navigator.clipboard?.writeText(url)
    notify('Link copied.', 'success')
  }

  // ---------------------------------------------------------------- UI bits

  // A plain JSX value (not a component), so the charts keep their hover
  // state across re-renders.
  const charts =
    activity && activity.length > 0 ? (
      <div className="mt-4 flex flex-col gap-2.5">
        <DayBars data={activity} field="scans" label="Scans per day" t={t} isNight={isNight} barClass={isNight ? 'fill-[#8FB8E8]' : 'fill-[#2554EB]'} />
        <DayBars data={activity} field="signups" label="Sign-ups per day" t={t} isNight={isNight} barClass={isNight ? 'fill-[#8FB8E8]' : 'fill-[#2554EB]'} />
      </div>
    ) : null

  if (!report) {
    return (
      <Shell t={t}>
        <BackButton t={t} label="Admin" onClick={onBack} />
        <p className={`mt-8 text-[14px] ${t.muted}`}>Loading referrals…</p>
      </Shell>
    )
  }

  // ------------------------------------------------------------ Create code
  if (view.name === 'create') {
    const field = (key, label, placeholder, extra = {}) => (
      <label className="block">
        <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>{label}</span>
        <input
          value={form[key]}
          onChange={(e) => updateForm({ [key]: e.target.value })}
          placeholder={placeholder}
          className={`w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-3 text-[14px] outline-none`}
          {...extra}
        />
      </label>
    )
    return (
      <Shell t={t}>
        <BackButton t={t} label="Back" onClick={() => setView(view.back || { name: 'overview' })} />
        <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>Referral console</p>
        <h1 className="mt-1 font-display text-[32px] font-light leading-[1.05] tracking-tight">New code</h1>
        <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>
          One code per flyer location. A chain gets one per branch under the same partner name.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          {field('partner', 'Partner', 'e.g. Beauty Hut', { list: 'referral-partners' })}
          <datalist id="referral-partners">
            {partners.filter((p) => p.partnerId).map((p) => <option key={p.partnerId} value={p.partner} />)}
          </datalist>
          <div className="grid grid-cols-2 gap-3">
            {field('label', 'Branch / label', 'e.g. Lekki branch')}
            {field('city', 'City', 'e.g. Lagos')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Type</span>
              <select
                value={form.kind}
                onChange={(e) => updateForm({ kind: e.target.value })}
                className={`w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-3 text-[14px] outline-none`}
              >
                {KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
              </select>
            </label>
            {field('phone', 'Contact phone', 'Optional', { inputMode: 'tel' })}
          </div>
          <label className="block">
            <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Code</span>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''), codeEdited: true }))}
              placeholder="BEAUTYHUT-LEKKI"
              maxLength={24}
              className={`w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-3 font-mono text-[15px] tracking-wide outline-none`}
            />
            <span className={`mt-1.5 block truncate text-[12px] ${t.faint}`}>
              {form.code ? linkFor(form.code) : 'Filled in from the partner and branch — you can edit it.'}
            </span>
          </label>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={createCode}
          className={`mt-7 w-full rounded-2xl py-4 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
        >
          {saving ? 'Creating…' : 'Create code'}
        </button>
      </Shell>
    )
  }

  // --------------------------------------------- Code page: give it out
  if (view.name === 'code') {
    const c = codeRow
    return (
      <Shell t={t}>
        <BackButton t={t} label="Back" onClick={() => setView(view.back || { name: 'overview' })} />
        <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>{c?.partner || 'Referral code'}</p>
        <h1 className="mt-1 font-mono text-[26px] font-semibold tracking-wide">{view.code}</h1>
        {c?.label && <p className={`mt-1 text-[13px] ${t.muted}`}>{c.label}</p>}
        {c && !c.is_active && (
          <p className={`mt-3 rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.danger}`}>
            Retired — scans of this code are ignored.
          </p>
        )}

        <div className="mt-5 rounded-3xl bg-white p-5">
          {qrUrl ? (
            <img src={qrUrl} alt={`QR code for ${view.code}`} className="mx-auto aspect-square w-full max-w-[280px]" />
          ) : (
            <div className="mx-auto aspect-square w-full max-w-[280px] animate-pulse rounded-2xl bg-slate-100" />
          )}
          <p className="mt-3 break-all text-center font-mono text-[12px] text-slate-500">{linkFor(view.code)}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(linkFor(view.code))
              notify('Link copied.', 'success')
            }}
            className={`rounded-2xl border py-3 text-[13px] font-semibold ${t.hair}`}
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={() => share(view.code, c?.partner)}
            className={`rounded-2xl border py-3 text-[13px] font-semibold ${t.hair}`}
          >
            Share link
          </button>
          <button
            type="button"
            onClick={async () => {
              const blob = await renderFlyer({ code: view.code, partner: c?.partner || 'Tracka+', label: c?.label })
              downloadBlob(blob, `${view.code}-flyer.png`)
            }}
            className={`col-span-2 rounded-2xl py-3.5 text-[14px] font-bold ${t.btn}`}
          >
            Download flyer (PNG)
          </button>
          <button
            type="button"
            onClick={async () => {
              const QR = await loadQr()
              const svg = await QR.toString(linkFor(view.code), {
                type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark: '#2563eb', light: '#0000' },
              })
              downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${view.code}.svg`)
            }}
            className={`rounded-2xl border py-3 text-[13px] font-semibold ${t.hair}`}
          >
            QR for printer (SVG)
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!qrUrl) return
              const blob = await (await fetch(qrUrl)).blob()
              downloadBlob(blob, `${view.code}-qr.png`)
            }}
            className={`rounded-2xl border py-3 text-[13px] font-semibold ${t.hair}`}
          >
            QR image (PNG)
          </button>
        </div>
        <p className={`mt-2 text-[11px] leading-relaxed ${t.faint}`}>
          Give the printer the SVG — it stays sharp at any size. The QR survives up to 30% smudging or folding.
        </p>

        {c && (
          <>
            <p className={`mt-7 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>Results</p>
            <div className="mt-2"><Kpis t={t} s={c} /></div>
            <Funnel t={t} s={c} />
            {c.existing_users > 0 && (
              <p className={`mt-2 text-[12px] ${t.faint}`}>Plus {c.existing_users} existing users who scanned.</p>
            )}
            <button
              type="button"
              onClick={() => setActive(c.code, !c.is_active)}
              className={`mt-6 w-full py-2 text-center text-[13px] font-semibold ${c.is_active ? t.danger : t.mark}`}
            >
              {c.is_active ? 'Retire this code' : 'Reactivate this code'}
            </button>
          </>
        )}
      </Shell>
    )
  }

  // ----------------------------------------------------------- Partner page
  if (view.name === 'partner') {
    const p = partners.find((x) => x.partnerId === view.partnerId)
    if (!p) {
      return (
        <Shell t={t}>
          <BackButton t={t} label="All partners" onClick={() => setView({ name: 'overview' })} />
          <p className={`mt-8 text-[14px] ${t.muted}`}>This partner has no codes.</p>
        </Shell>
      )
    }
    return (
      <Shell t={t}>
        <BackButton t={t} label="All partners" onClick={() => setView({ name: 'overview' })} />
        <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>
          {[p.kind, p.city].filter(Boolean).join(' · ')}
        </p>
        <h1 className="mt-1 font-display text-[34px] font-light leading-[1.05] tracking-tight">{p.partner}</h1>

        <div className="mt-5"><Kpis t={t} s={p} /></div>
        <Funnel t={t} s={p} />
        {charts}

        <div className="mt-7 flex items-baseline justify-between">
          <p className="text-[17px] font-semibold">Codes</p>
          <button type="button" onClick={() => openCreate(p)} className={`text-[13px] font-semibold ${t.mark}`}>
            + Add branch code
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2.5">
          {p.codes.map((c) => (
            <button
              key={c.code_id}
              type="button"
              onClick={() => setView({ name: 'code', code: c.code, back: view })}
              className={`rounded-2xl ${t.surface} p-4 text-left ${c.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[15px] font-semibold">{c.code}</p>
                  <p className={`truncate text-[12px] ${t.faint}`}>{c.label || 'No label'}{c.is_active ? '' : ' · Retired'}</p>
                </div>
                <span className={`shrink-0 text-[12px] font-semibold ${t.mark}`}>QR & link ›</span>
              </div>
              <p className={`mt-2 text-[12px] tabular-nums ${t.muted}`}>
                {c.scans} scans · {c.signups} sign-ups · {c.logged_routine} active
              </p>
            </button>
          ))}
        </div>
      </Shell>
    )
  }

  // --------------------------------------------------------------- Overview
  const T = report.totals
  const house = report.codes.find((c) => c.code === 'TRACKA')
  return (
    <Shell t={t}>
      <BackButton t={t} label="Admin" onClick={onBack} />
      <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>Referral console</p>
      <h1 className="mt-1 font-display text-[34px] font-light leading-[1.05] tracking-tight">Who&apos;s bringing people in</h1>
      <p className={`mt-2 text-[13px] ${t.muted}`}>
        {T.partners} partners · {T.codes} active codes · last 30 days below
      </p>

      <div className="mt-5"><Kpis t={t} s={T} /></div>
      <Funnel t={t} s={T} />
      {charts}

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => openCreate(null)}
          className={`rounded-2xl py-3.5 text-[14px] font-bold ${t.btn}`}
        >
          + New code
        </button>
        <button
          type="button"
          onClick={() => house && setView({ name: 'code', code: 'TRACKA', back: { name: 'overview' } })}
          disabled={!house}
          className={`rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} disabled:opacity-50`}
        >
          Tracka+ house QR
        </button>
      </div>

      <p className="mt-8 text-[17px] font-semibold">Partners</p>
      <p className={`text-[12px] ${t.faint}`}>Ranked by sign-ups</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {partners.length === 0 && <p className={`text-[13px] ${t.muted}`}>No partners yet — create the first code.</p>}
        {partners.map((p, i) => {
          const maxSignups = Math.max(1, ...partners.map((x) => x.signups))
          return (
            <button
              key={p.partnerId || p.partner}
              type="button"
              onClick={() => p.partnerId && setView({ name: 'partner', partnerId: p.partnerId })}
              className={`flex items-center gap-3 rounded-2xl ${t.surface} p-4 text-left`}
            >
              <span className={`w-5 shrink-0 text-center text-[13px] font-semibold tabular-nums ${t.faint}`}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{p.partner}</span>
                <span className={`block truncate text-[12px] capitalize ${t.faint}`}>
                  {[p.kind, p.city, `${p.codes.length} ${p.codes.length === 1 ? 'code' : 'codes'}`].filter(Boolean).join(' · ')}
                </span>
                <span className={`mt-2 block h-1 overflow-hidden rounded-full ${isNight ? 'bg-white/10' : 'bg-[#101B2D]/8'}`}>
                  <span className={`block h-full rounded-full ${t.nodeDone}`} style={{ width: `${(p.signups / maxSignups) * 100}%` }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[16px] font-semibold tabular-nums">{p.signups}</span>
                <span className={`block text-[10px] ${t.faint}`}>{p.scans} scans</span>
              </span>
            </button>
          )
        })}
      </div>
    </Shell>
  )
}
