// Ads console — campaign performance for sponsored placements: pick a brand
// and campaign, pick a period, see impressions / reach / clicks / CTR /
// sign-ups, a day-by-day chart and a breakdown by placement.
//
// Built to double as the brand self-service view later: everything it
// shows comes from ad_console_brands / ad_campaign_report, which return
// only what the signed-in person may see (can_view_ad_brand). `canManage`
// (admin) adds the campaign controls; a brand member just gets the report.

import { useEffect, useState } from 'react'
import { BackButton, DayBars, Shell } from './ReferralConsole'
import { AdForm, BrandForm, CampaignAds, CampaignForm } from './AdsEditor'

const SLOT_LABELS = {
  home_banner: 'Home banner',
  sponsored_challenge: 'Sponsored challenge',
  product_card: 'Product card',
  discover_card: 'Discover card',
  fullscreen: 'Full-screen',
}

const STATUS_STYLES = {
  active: 'bg-emerald-500/10 text-emerald-600',
  paused: 'bg-amber-500/10 text-amber-600',
  draft: 'bg-slate-500/10 text-slate-500',
  ended: 'bg-slate-500/10 text-slate-500',
}

const todayIso = () => new Date().toLocaleDateString('en-CA')
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}
const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
// Unique CTR: people who clicked ÷ people who saw it, so it can't pass
// 100%. Falls back to clicks ÷ impressions for reports from before the
// server returned clickers.
const ctr = (row) => {
  const [num, den] = row.clickers != null ? [row.clickers, row.reach] : [row.clicks, row.impressions]
  return den > 0 ? `${((Math.min(num, den) / den) * 100).toFixed(1)}%` : '—'
}

const downloadCsv = (rows, filename) => {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Tile({ t, value, label, hint }) {
  return (
    <div className={`min-w-0 rounded-2xl ${t.surface} px-3 py-3.5`}>
      <p className="truncate text-[22px] font-semibold leading-none tabular-nums">{value}</p>
      <p className={`mt-1.5 text-[11.5px] font-medium ${t.muted}`}>{label}</p>
      {hint && <p className={`mt-0.5 truncate text-[10.5px] ${t.faint}`}>{hint}</p>}
    </div>
  )
}

export default function AdsConsole({ supabase, t, isNight, notify, confirmAction, onBack, canManage }) {
  const [brands, setBrands] = useState(null)
  const [brandId, setBrandId] = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [period, setPeriod] = useState('30')
  const [report, setReport] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  // 'report' (default) or one of the edit forms (admin only).
  const [view, setView] = useState({ name: 'report' })
  const [adsKey, setAdsKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('ad_console_brands').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        notify("Couldn't load campaigns.")
        setBrands([])
        return
      }
      setBrands(data || [])
      setBrandId((current) => current || data?.[0]?.id || null)
    })
    return () => { cancelled = true }
    // `notify` changes on every App render; see ReferralConsole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, reloadKey])

  const brand = brands?.find((b) => b.id === brandId) || null
  const campaign = brand?.campaigns.find((c) => c.id === campaignId) || null

  // The period resolves to concrete dates. "Campaign" = the campaign's own
  // dates, capped at today.
  const range = (() => {
    const today = todayIso()
    if (period === 'campaign' && campaign) {
      const to = campaign.ends_on < today ? campaign.ends_on : today
      return { from: campaign.starts_on, to: to < campaign.starts_on ? campaign.starts_on : to }
    }
    const days = Number(period) || 30
    return { from: addDaysIso(today, -(days - 1)), to: today }
  })()

  useEffect(() => {
    if (!brandId) return
    let cancelled = false
    supabase
      .rpc('ad_campaign_report', {
        p_brand_id: brandId,
        p_campaign_id: campaignId || null,
        p_from: range.from,
        p_to: range.to,
      })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          notify("Couldn't load the report.")
          return
        }
        setReport(data)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, brandId, campaignId, range.from, range.to, reloadKey])

  const setStatus = async (c, status) => {
    const verb = status === 'active' ? (c.status === 'draft' ? 'Activate' : 'Resume') : { paused: 'Pause', ended: 'End' }[status]
    const question = status === 'active' && c.status === 'draft'
      ? `Activate "${c.name}"? Its ads that are On will show from ${fmtDate(c.starts_on)} to ${fmtDate(c.ends_on)}.`
      : `${verb} "${c.name}"?`
    const ok = await confirmAction(question, ['Cancel', verb])
    if (!ok) return
    const { error } = await supabase.rpc('admin_set_ad_campaign_status', { p_campaign_id: c.id, p_status: status })
    if (error) {
      notify(error.message)
      return
    }
    notify(`Campaign ${status === 'active' ? (c.status === 'draft' ? 'activated' : 'resumed') : status}.`, 'success')
    setReloadKey((k) => k + 1)
  }

  const exportCsv = () => {
    if (!report || !brand) return
    const tt = report.totals
    const rows = [
      ['Brand', brand.name],
      ['Campaign', campaign ? campaign.name : 'All campaigns'],
      ['Period', `${report.from} to ${report.to}`],
      [],
      ['Impressions', tt.impressions],
      ['Reach', tt.reach],
      ['Clicks', tt.clicks],
      ['Unique clickers', tt.clickers],
      ['CTR', ctr(tt)],
      ['Challenge sign-ups (from ads)', tt.challenge_joins_from_ads],
      ['Challenge sign-ups (all)', tt.challenge_joins_total],
      ['Guide completions', tt.guide_completes],
      [],
      ['Placement', 'Impressions', 'Reach', 'Clicks', 'CTR', 'Conversions'],
      ...report.by_slot.map((s) => [SLOT_LABELS[s.slot] || s.slot, s.impressions, s.reach, s.clicks, ctr(s), s.conversions]),
      [],
      ['Date', 'Impressions', 'Reach', 'Clicks', 'CTR'],
      ...report.by_day.map((d) => [d.date, d.impressions, d.reach, d.clicks, ctr(d)]),
    ]
    const slug = (campaign?.name || brand.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    downloadCsv(rows, `tracka-ads-${slug}-${report.from}-to-${report.to}.csv`)
  }

  const header = (
    <>
      <BackButton t={t} label={canManage ? 'Admin' : 'Back'} onClick={onBack} />
      <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>Ads console</p>
      <h1 className="mt-1 font-display text-[32px] font-light leading-[1.05] tracking-tight">Campaign performance</h1>
    </>
  )

  if (!brands) {
    return (
      <Shell t={t}>
        {header}
        <p className={`mt-8 text-[14px] ${t.muted}`}>Loading campaigns…</p>
      </Shell>
    )
  }

  const backToReport = () => setView({ name: 'report' })
  const afterSave = (select) => {
    setView({ name: 'report' })
    setReloadKey((k) => k + 1)
    setAdsKey((k) => k + 1)
    if (select?.brandId) { setBrandId(select.brandId); setCampaignId(select.campaignId || '') }
  }
  if (canManage && view.name === 'brand') {
    return <BrandForm supabase={supabase} t={t} notify={notify} brand={view.brand} onBack={backToReport}
      onDone={(id) => afterSave({ brandId: id })} />
  }
  if (canManage && view.name === 'campaign') {
    return <CampaignForm supabase={supabase} t={t} notify={notify} brand={view.brand} campaign={view.campaign} onBack={backToReport}
      onDone={(id) => afterSave({ brandId: view.brand.id, campaignId: id })} />
  }
  if (canManage && view.name === 'ad') {
    return <AdForm supabase={supabase} t={t} isNight={isNight} notify={notify} brand={view.brand} campaign={view.campaign} ad={view.ad}
      onBack={backToReport} onDone={() => afterSave({ brandId: view.brand.id, campaignId: view.campaign.id })} />
  }

  if (brands.length === 0) {
    return (
      <Shell t={t}>
        {header}
        <p className={`mt-8 text-[14px] leading-relaxed ${t.muted}`}>No brands or campaigns yet.</p>
      </Shell>
    )
  }

  const tt = report?.totals
  const hasChallenge = campaign ? !!campaign.challenge_id : brand?.campaigns.some((c) => c.challenge_id)
  const selectClass = `w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-3 text-[14px] outline-none`

  return (
    <Shell t={t}>
      {header}

      {/* Filters, one row each. */}
      <div className="mt-6 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Brand</span>
            <select
              value={brandId || ''}
              onChange={(e) => { setBrandId(e.target.value); setCampaignId(''); if (period === 'campaign') setPeriod('30') }}
              className={selectClass}
            >
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_house ? ' (house)' : ''}</option>)}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Campaign</span>
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); if (!e.target.value && period === 'campaign') setPeriod('30') }}
              className={selectClass}
            >
              <option value="">All campaigns</option>
              {brand?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-x-5 gap-y-2 px-1">
            <button type="button" onClick={() => setView({ name: 'brand' })} className={`text-[13px] font-semibold ${t.mark}`}>+ New brand</button>
            {brand && (
              <button type="button" onClick={() => setView({ name: 'campaign', brand })} className={`text-[13px] font-semibold ${t.mark}`}>+ New campaign</button>
            )}
            {brand && !brand.is_house && (
              <button type="button" onClick={() => setView({ name: 'brand', brand })} className={`text-[13px] font-semibold ${t.muted}`}>Edit brand</button>
            )}
          </div>
        )}

        <div className={`grid grid-cols-4 gap-1 rounded-2xl border ${t.hair} p-1`}>
          {[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['campaign', 'Campaign']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              disabled={key === 'campaign' && !campaign}
              onClick={() => setPeriod(key)}
              className={`rounded-xl px-2 py-2 text-[12.5px] font-semibold transition disabled:opacity-35 ${
                period === key ? `${t.chip} ${t.mark}` : t.muted
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {report && (
          <p className={`text-[12px] ${t.faint}`}>
            {fmtDate(report.from)} – {fmtDate(report.to)}
          </p>
        )}
      </div>

      {campaign && (
        <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{campaign.name}</p>
              <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                {fmtDate(campaign.starts_on)} – {fmtDate(campaign.ends_on)}
              </p>
              {campaign.objective && <p className={`mt-1.5 text-[12.5px] leading-relaxed ${t.muted}`}>{campaign.objective}</p>}
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_STYLES[campaign.status] || ''}`}>
              {campaign.status}
            </span>
          </div>
          {canManage && campaign.status !== 'ended' && (
            <div className="mt-3 flex gap-4">
              {campaign.status === 'active' ? (
                <button type="button" onClick={() => setStatus(campaign, 'paused')} className={`text-[13px] font-semibold ${t.mark}`}>Pause</button>
              ) : (
                <button type="button" onClick={() => setStatus(campaign, 'active')} className={`text-[13px] font-semibold ${t.mark}`}>
                  {campaign.status === 'draft' ? 'Activate' : 'Resume'}
                </button>
              )}
              <button type="button" onClick={() => setView({ name: 'campaign', brand, campaign })} className={`text-[13px] font-semibold ${t.muted}`}>Edit</button>
              <button type="button" onClick={() => setStatus(campaign, 'ended')} className={`text-[13px] font-semibold ${t.danger}`}>End campaign</button>
            </div>
          )}
          {canManage && (
            <CampaignAds supabase={supabase} t={t} notify={notify} campaign={campaign} reloadKey={adsKey}
              onAdd={() => setView({ name: 'ad', brand, campaign })}
              onEdit={(ad) => setView({ name: 'ad', brand, campaign, ad })} />
          )}
        </div>
      )}

      {!report ? (
        <p className={`mt-8 text-[14px] ${t.muted}`}>Loading report…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Tile t={t} value={tt.impressions.toLocaleString()} label="Impressions" hint="Seen for 1s+, half on screen" />
            <Tile t={t} value={tt.reach.toLocaleString()} label="Reach" hint="Different people" />
            <Tile t={t} value={tt.clicks.toLocaleString()} label="Clicks" hint={`${tt.clickers} people`} />
            <Tile t={t} value={ctr(tt)} label="Click-through rate" hint="People who clicked ÷ people reached" />
            {hasChallenge && (
              <Tile t={t} value={tt.challenge_joins_total.toLocaleString()} label="Challenge sign-ups" hint={`${tt.challenge_joins_from_ads} straight from the ad`} />
            )}
            {tt.guide_completes > 0 || brand?.is_house ? (
              <Tile t={t} value={tt.guide_completes.toLocaleString()} label="Finished the tour" hint="Feature guide" />
            ) : null}
          </div>

          {report.by_day.length > 0 && (
            <div className="mt-4 flex flex-col gap-2.5">
              <DayBars data={report.by_day} field="impressions" label="Impressions per day" t={t} isNight={isNight} barClass={isNight ? 'fill-[#8FB8E8]' : 'fill-[#1463F4]'} />
              <DayBars data={report.by_day} field="clicks" label="Clicks per day" t={t} isNight={isNight} barClass={isNight ? 'fill-[#8FB8E8]' : 'fill-[#1463F4]'} />
            </div>
          )}

          <p className={`mb-2 mt-7 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>By placement</p>
          {report.by_slot.length === 0 ? (
            <p className={`px-1 text-[13px] ${t.muted}`}>No activity in this period yet.</p>
          ) : (
            <div className={`overflow-hidden rounded-2xl ${t.surface}`}>
              <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b ${t.hair} px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide ${t.faint}`}>
                <span>Placement</span><span className="text-right">Seen</span><span className="text-right">Clicks</span><span className="text-right">CTR</span>
              </div>
              {report.by_slot.map((s) => (
                <div key={s.slot} className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b ${t.hair} px-4 py-3 text-[13.5px] last:border-b-0`}>
                  <span className="min-w-0 truncate font-medium">{SLOT_LABELS[s.slot] || s.slot}</span>
                  <span className="text-right tabular-nums">{s.impressions}</span>
                  <span className="text-right tabular-nums">{s.clicks}</span>
                  <span className="text-right tabular-nums">{ctr(s)}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={exportCsv}
            className={`mt-6 w-full rounded-2xl border px-5 py-3.5 text-[14px] font-semibold ${t.hair} ${t.mark}`}
          >
            Export CSV
          </button>
          <p className={`mt-3 text-center text-[11.5px] leading-relaxed ${t.faint}`}>
            Totals only — no individual users are ever shown. Sales and discount-code results come next.
          </p>
        </>
      )}
    </Shell>
  )
}
