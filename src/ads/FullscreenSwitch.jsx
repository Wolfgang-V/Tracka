// Admin panel switch for full-screen ads (feature flag 'fullscreen_ads'),
// in the same style as the practitioners launch card above it. Off by
// default: while the active user base is small, an ad in front of
// someone's routine can cost more than it earns.

import { useEffect, useState } from 'react'

export default function FullscreenSwitch({ supabase, t, notify, confirmAction }) {
  const [on, setOn] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('feature_flags').select('enabled').eq('key', 'fullscreen_ads').maybeSingle()
      .then(({ data }) => setOn(Boolean(data?.enabled)))
  }, [supabase])

  const toggle = async () => {
    const next = !on
    const ok = await confirmAction(
      next
        ? 'Turn on full-screen ads? Anyone with a live full-screen ad running will see it once a day when they open the app.'
        : 'Turn off full-screen ads? They stop showing the next time people open the app.'
    )
    if (!ok) return
    setSaving(true)
    const { error } = await supabase.rpc('admin_set_feature_flag', { flag_key: 'fullscreen_ads', enabled: next })
    setSaving(false)
    if (error) {
      console.error('ADMIN SET FEATURE FLAG ERROR:', error)
      notify(error.message)
      return
    }
    setOn(next)
    notify(next ? 'Full-screen ads are on.' : 'Full-screen ads are off.', 'success')
  }

  return (
    <div className={`mt-3 flex items-center justify-between rounded-2xl ${t.surface} p-4`}>
      <div>
        <p className="text-[14px] font-semibold">Full-screen ads {on ? 'on' : 'off'}</p>
        <p className={`mt-0.5 text-[12px] ${t.muted}`}>
          {on === null
            ? 'Checking…'
            : on
            ? 'Live full-screen ads show once a day when the app opens.'
            : 'Never shown, even if one is set up in the ads console.'}
        </p>
      </div>
      <button
        type="button"
        disabled={on === null || saving}
        onClick={toggle}
        className={`shrink-0 rounded-xl border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 ${t.hair} ${t.muted}`}
      >
        {saving ? '…' : on ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}
