// Sponsored placements: fetching live ads and recording what people do
// with them. Counting rules (dedupe, campaign dates) are enforced
// server-side in record_ad_event, so the numbers brands see can't be
// inflated from here.

export async function fetchAds(supabase, slot) {
  const { data, error } = await supabase.rpc('active_ads', { p_slot: slot })
  if (error) {
    console.error('ADS ERROR:', error)
    return []
  }
  return data || []
}

// Fire-and-forget: an analytics hiccup must never break the app.
export function recordAdEvent(supabase, placementId, event) {
  if (!placementId) return
  supabase
    .rpc('record_ad_event', { p_placement_id: placementId, p_event: event })
    .then(({ error }) => { if (error) console.error('AD EVENT ERROR:', error) })
}

// Outbound links carry UTM tags so the brand's own analytics can confirm
// the visits we report.
export function withUtm(url, campaignName) {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', 'trackaplus')
    u.searchParams.set('utm_medium', 'sponsored')
    if (campaignName) {
      u.searchParams.set('utm_campaign', campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    }
    return u.toString()
  } catch {
    return url
  }
}

// Per-device "hide this ad" (the × on a banner).
const hiddenKey = (placementId) => `tracka_ad_hidden_${placementId}`

export function isAdHidden(placementId) {
  try {
    return localStorage.getItem(hiddenKey(placementId)) === '1'
  } catch {
    return false
  }
}

export function hideAd(placementId) {
  try {
    localStorage.setItem(hiddenKey(placementId), '1')
  } catch {
    // Private mode etc. — the banner just comes back next visit.
  }
}
