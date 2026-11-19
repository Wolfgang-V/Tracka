// src/lib/referral.js — the client half of the referral platform.
// (Reviewer's file; three small changes: only the `ref` param is stripped
// from the URL so recovery/invite/challenge params survive, storage access
// can't throw in private mode, and a pending flag means claim only runs
// while there's an unclaimed scan rather than on every sign-in forever.)
import { supabase } from './supabase'

const VISITOR = 'tracka_visitor'
const PENDING = 'tracka_referral_pending'

const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

// Call once on app load. Returns who to credit in the greeting, or null for
// a normal visit / retired code:
//   { partner: 'Beauty Hut' }                — a store/clinic code
//   { friend: true, inviter: 'Deeyah'|null } — a friend's invite link
export async function captureReferral() {
  const url = new URL(location.href)
  const code = url.searchParams.get('ref')
  if (!code) return null

  // Don't leave ?ref= in the URL — but keep every other parameter.
  url.searchParams.delete('ref')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)

  let visitor = store.get(VISITOR)
  if (!visitor) {
    visitor = crypto.randomUUID()
    store.set(VISITOR, visitor)
  }

  const { data } = await supabase.rpc('record_referral_scan', {
    p_code: code, p_visitor: visitor, p_user_agent: navigator.userAgent,
  })

  if (!data?.ok) return null
  store.set(PENDING, '1')
  return { partner: data.partner ?? null, friend: !!data.friend, inviter: data.inviter ?? null }
}

// Call whenever a session exists (after signup/login, or on app open).
// Only does anything while a scan is waiting to be claimed. The server side
// is insert-only, so the first attribution can never be re-pointed later.
export async function claimReferral() {
  const visitor = store.get(VISITOR)
  if (!visitor || !store.get(PENDING)) return
  const { error } = await supabase.rpc('claim_referral', { p_visitor: visitor })
  // Done either way (claimed now, or already attributed); keep the flag only
  // if the call itself failed, so it's retried next time.
  if (!error) store.del(PENDING)
}
