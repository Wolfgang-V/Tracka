import { createClient } from '@supabase/supabase-js'

// Read BEFORE createClient: the client signs in from the recovery link's
// #access_token…&type=recovery and then strips it from the address bar, so
// by the time the app checks the URL the marker is often already gone and
// a password-reset link would land on onboarding/Today instead.
const readRecoveryMarker = () => {
  if (typeof window === 'undefined') return false
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return (
    search.get('recovery') === 'true' ||
    search.get('type') === 'recovery' ||
    hash.get('recovery') === 'true' ||
    hash.get('type') === 'recovery'
  )
}

export const OPENED_FROM_RECOVERY_LINK = readRecoveryMarker()

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
