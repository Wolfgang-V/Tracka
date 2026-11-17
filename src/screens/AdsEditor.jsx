// Ads console — creating and editing brands, campaigns and their ads.
// Admin only (every save goes through an admin_* function that checks
// can_manage_ads). New campaigns start as drafts; nothing reaches users
// until the campaign is activated from the report view.

import { useEffect, useState } from 'react'
import SponsoredCard from '../ads/SponsoredCard'
import { BackButton, Shell } from './ReferralConsole'

// Slots a brand can buy. (The Today banner stays for Tracka+'s own
// promotions for now.)
const BRAND_SLOTS = {
  sponsored_challenge: { label: 'Sponsored challenge', hint: 'A "Sponsored by" card on the challenge page. Joins from that page count for the campaign.' },
  product_card: { label: 'Product card', hint: 'A sponsored card on My products, below the person\'s own products.' },
}

const todayIso = () => new Date().toLocaleDateString('en-CA')
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}

function Field({ t, label, hint, children }) {
  return (
    <label className="block">
      <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>{label}</span>
      {children}
      {hint && <span className={`mt-1.5 block text-[12px] leading-relaxed ${t.faint}`}>{hint}</span>}
    </label>
  )
}

const inputClass = (t) => `w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-3 text-[14px] outline-none`

function FormShell({ t, title, eyebrow, onBack, saving, onSave, saveLabel, children }) {
  return (
    <Shell t={t}>
      <BackButton t={t} label="Back" onClick={onBack} />
      <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>{eyebrow}</p>
      <h1 className="mt-1 font-display text-[32px] font-light leading-[1.05] tracking-tight">{title}</h1>
      <div className="mt-6 flex flex-col gap-4">{children}</div>
      <button
        type="button"
        disabled={saving}
        onClick={onSave}
        className={`mt-7 w-full rounded-2xl py-4 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </Shell>
  )
}

// ---------------------------------------------------------------- brand

export function BrandForm({ supabase, t, notify, brand, onDone, onBack }) {
  const [form, setForm] = useState({
    name: brand?.name || '',
    website: brand?.website || '',
    contact_email: brand?.contact_email || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!form.name.trim()) return notify('Add the brand name.')
    setSaving(true)
    const { data, error } = await supabase.rpc('admin_upsert_ad_brand', {
      p_id: brand?.id || null,
      p_name: form.name,
      p_website: form.website,
      p_contact_email: form.contact_email,
    })
    setSaving(false)
    if (error) return notify(error.message.includes('duplicate') ? 'A brand with that name already exists.' : error.message)
    notify(brand ? 'Brand updated.' : 'Brand added.', 'success')
    onDone(data)
  }

  return (
    <FormShell t={t} eyebrow="Ads console" title={brand ? 'Edit brand' : 'New brand'} onBack={onBack} saving={saving} onSave={save} saveLabel={brand ? 'Save brand' : 'Add brand'}>
      <Field t={t} label="Brand name"><input value={form.name} onChange={set('name')} placeholder="e.g. Glow Labs" className={inputClass(t)} /></Field>
      <Field t={t} label="Website"><input value={form.website} onChange={set('website')} placeholder="https://" inputMode="url" className={inputClass(t)} /></Field>
      <Field t={t} label="Contact email" hint="Who to send campaign reports to. Optional.">
        <input value={form.contact_email} onChange={set('contact_email')} placeholder="marketing@brand.com" inputMode="email" className={inputClass(t)} />
      </Field>
    </FormShell>
  )
}

// ---------------------------------------------------------------- campaign

export function CampaignForm({ supabase, t, notify, brand, campaign, onDone, onBack }) {
  const [form, setForm] = useState({
    name: campaign?.name || '',
    objective: campaign?.objective || '',
    starts_on: campaign?.starts_on || todayIso(),
    ends_on: campaign?.ends_on || addDaysIso(todayIso(), 29),
    landing_url: campaign?.landing_url || '',
    challenge_id: campaign?.challenge_id || '',
  })
  const [challenges, setChallenges] = useState([])
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    supabase.from('challenges').select('id, title').order('created_at').then(({ data }) => setChallenges(data || []))
  }, [supabase])

  const save = async () => {
    if (!form.name.trim()) return notify('Add a campaign name.')
    setSaving(true)
    const { data, error } = await supabase.rpc('admin_upsert_ad_campaign', {
      p_id: campaign?.id || null,
      p_brand_id: brand.id,
      p_name: form.name,
      p_objective: form.objective,
      p_starts_on: form.starts_on,
      p_ends_on: form.ends_on,
      p_landing_url: form.landing_url,
      p_challenge_id: form.challenge_id || null,
    })
    setSaving(false)
    if (error) return notify(error.message)
    notify(campaign ? 'Campaign updated.' : 'Campaign created as a draft — add its ads, then activate it.', 'success')
    onDone(data)
  }

  return (
    <FormShell t={t} eyebrow={brand.name} title={campaign ? 'Edit campaign' : 'New campaign'} onBack={onBack} saving={saving} onSave={save} saveLabel={campaign ? 'Save campaign' : 'Create draft campaign'}>
      <Field t={t} label="Campaign name"><input value={form.name} onChange={set('name')} placeholder="e.g. SPF December" className={inputClass(t)} /></Field>
      <Field t={t} label="Goal" hint="For your own notes and the brand's report. Optional.">
        <input value={form.objective} onChange={set('objective')} placeholder="e.g. Get people trying our SPF" className={inputClass(t)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field t={t} label="Starts"><input type="date" value={form.starts_on} onChange={set('starts_on')} className={inputClass(t)} /></Field>
        <Field t={t} label="Ends"><input type="date" value={form.ends_on} onChange={set('ends_on')} className={inputClass(t)} /></Field>
      </div>
      <Field t={t} label="Landing page" hint="Where the ads' buttons go unless an ad has its own link. Tracka+ adds tracking tags so the brand can see the visits too.">
        <input value={form.landing_url} onChange={set('landing_url')} placeholder="https://" inputMode="url" className={inputClass(t)} />
      </Field>
      <Field t={t} label="Sponsored challenge" hint="Needed for a sponsored-challenge ad. Leave as none for product cards only.">
        <select value={form.challenge_id} onChange={set('challenge_id')} className={inputClass(t)}>
          <option value="">None</option>
          {challenges.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </Field>
    </FormShell>
  )
}

// ---------------------------------------------------------------- ad

export function AdForm({ supabase, t, isNight, notify, brand, campaign, ad, onDone, onBack }) {
  const [form, setForm] = useState({
    slot: ad?.slot || (campaign.challenge_id ? 'sponsored_challenge' : 'product_card'),
    headline: ad?.headline || '',
    body: ad?.body || '',
    cta_label: ad?.cta_label || 'Shop now',
    image_url: ad?.image_url || '',
    action_target: ad?.action_target || '',
    is_active: ad?.is_active ?? true,
  })
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const upload = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('Choose an image file.')
    if (file.size > 2 * 1024 * 1024) return notify('Keep ad images under 2 MB.')
    setUploading(true)
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${campaign.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('ad-images').upload(path, file, { contentType: file.type })
    setUploading(false)
    if (error) return notify("Couldn't upload the image: " + error.message)
    const { data } = supabase.storage.from('ad-images').getPublicUrl(path)
    setForm((f) => ({ ...f, image_url: data.publicUrl }))
  }

  const save = async () => {
    if (!form.headline.trim()) return notify('Add a headline.')
    setSaving(true)
    const { data, error } = await supabase.rpc('admin_upsert_ad_placement', {
      p_id: ad?.id || null,
      p_campaign_id: campaign.id,
      p_slot: form.slot,
      p_headline: form.headline,
      p_body: form.body,
      p_cta_label: form.cta_label,
      p_image_url: form.image_url,
      p_action: 'url',
      p_action_target: form.action_target,
      p_is_active: form.is_active,
    })
    setSaving(false)
    if (error) return notify(error.message)
    notify(ad ? 'Ad updated.' : 'Ad added.', 'success')
    onDone(data)
  }

  // What it will look like — no placement id, so the preview records nothing.
  const preview = { brand: brand.name, headline: form.headline || 'Your headline', body: form.body, cta_label: form.cta_label, image_url: form.image_url }

  return (
    <FormShell t={t} eyebrow={`${brand.name} · ${campaign.name}`} title={ad ? 'Edit ad' : 'New ad'} onBack={onBack} saving={saving || uploading} onSave={save} saveLabel={ad ? 'Save ad' : 'Add ad'}>
      <Field t={t} label="Where it shows" hint={BRAND_SLOTS[form.slot]?.hint}>
        <select value={form.slot} onChange={set('slot')} className={inputClass(t)}>
          {Object.entries(BRAND_SLOTS).map(([k, v]) => (
            <option key={k} value={k} disabled={k === 'sponsored_challenge' && !campaign.challenge_id}>
              {v.label}{k === 'sponsored_challenge' && !campaign.challenge_id ? ' (pick a challenge on the campaign first)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field t={t} label="Headline"><input value={form.headline} onChange={set('headline')} maxLength={70} placeholder="e.g. Daily SPF that doesn't leave a cast" className={inputClass(t)} /></Field>
      {form.slot === 'product_card' && (
        <Field t={t} label="Short text" hint="One or two lines. Optional.">
          <input value={form.body} onChange={set('body')} maxLength={120} placeholder="e.g. 20% off for Tracka+ members this month" className={inputClass(t)} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field t={t} label="Button label"><input value={form.cta_label} onChange={set('cta_label')} maxLength={20} className={inputClass(t)} /></Field>
        <Field t={t} label="Status">
          <select value={form.is_active ? 'on' : 'off'} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'on' }))} className={inputClass(t)}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </Field>
      </div>
      <Field t={t} label="Button link" hint={campaign.landing_url ? `Leave empty to use the campaign's landing page (${campaign.landing_url}).` : 'The campaign has no landing page, so add a link here.'}>
        <input value={form.action_target} onChange={set('action_target')} placeholder="https://" inputMode="url" className={inputClass(t)} />
      </Field>
      <Field t={t} label="Image" hint="Square works best. Under 2 MB.">
        <div className="flex items-center gap-3">
          {form.image_url && <img src={form.image_url} alt="" className="h-14 w-14 rounded-xl bg-white object-contain p-0.5" />}
          <label className={`cursor-pointer rounded-xl border ${t.hair} px-4 py-2.5 text-[13px] font-semibold ${t.mark}`}>
            {uploading ? 'Uploading…' : form.image_url ? 'Change image' : 'Upload image'}
            <input type="file" accept="image/*" className="hidden" disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(f) }} />
          </label>
          {form.image_url && (
            <button type="button" onClick={() => setForm((f) => ({ ...f, image_url: '' }))} className={`text-[12px] font-semibold ${t.faint}`}>Remove</button>
          )}
        </div>
      </Field>

      <div>
        <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Preview</p>
        <SponsoredCard ad={preview} supabase={supabase} t={t} isNight={isNight} onOpen={() => {}} compact={form.slot === 'sponsored_challenge'} />
      </div>
    </FormShell>
  )
}

// ---------------------------------------------------------------- list

// A campaign's ads, under the campaign card in the report view.
export function CampaignAds({ supabase, t, notify, campaign, reloadKey, onAdd, onEdit }) {
  const [ads, setAds] = useState(null)
  useEffect(() => {
    let cancelled = false
    supabase.rpc('ad_campaign_placements', { p_campaign_id: campaign.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) notify("Couldn't load this campaign's ads.")
      setAds(data || [])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, campaign.id, reloadKey])

  return (
    <div className={`mt-3 border-t ${t.hair} pt-3`}>
      <div className="flex items-center justify-between">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Ads in this campaign</p>
        <button type="button" onClick={onAdd} className={`text-[13px] font-semibold ${t.mark}`}>+ Add an ad</button>
      </div>
      {ads === null ? (
        <p className={`mt-2 text-[13px] ${t.muted}`}>Loading…</p>
      ) : ads.length === 0 ? (
        <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>No ads yet. Add one before activating the campaign.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {ads.map((ad) => (
            <button key={ad.id} type="button" onClick={() => onEdit(ad)} className={`flex items-center gap-3 rounded-xl ${t.surface} p-2.5 text-left`}>
              {ad.image_url
                ? <img src={ad.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-0.5" />
                : <span className={`h-10 w-10 shrink-0 rounded-lg border ${t.hair}`} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{ad.headline}</span>
                <span className={`block text-[11.5px] ${t.faint}`}>{BRAND_SLOTS[ad.slot]?.label || ad.slot}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${ad.is_active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-500'}`}>
                {ad.is_active ? 'On' : 'Off'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
