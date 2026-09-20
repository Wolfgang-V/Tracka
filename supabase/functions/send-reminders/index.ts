// Cron target. Invoked every 5 minutes (see supabase/migrations for the
// pg_cron schedule). Finds every user whose morning/night reminder time
// falls in the current 5-minute window, in their own timezone, and sends
// them a web push notification.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@tracka.app'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Compares a 'HH:MM' reminder time against "now" in the given IANA
// timezone. Due if within 5 minutes, matching the cron interval so no
// user is skipped between runs.
function isDue(nowUtc: Date, timeOfDay: string | null, timezone: string) {
  if (!timeOfDay) return false

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(nowUtc)

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')

  const [targetH, targetM] = timeOfDay.slice(0, 5).split(':').map(Number)

  const nowMinutes = hour * 60 + minute
  const targetMinutes = targetH * 60 + targetM

  return Math.abs(nowMinutes - targetMinutes) < 5
}

Deno.serve(async () => {
  const now = new Date()

  const { data: settings, error: settingsError } = await supabase
    .from('reminder_settings')
    .select('user_id, morning_enabled, morning_time, night_enabled, night_time, timezone')

  if (settingsError) {
    console.error('SETTINGS ERROR:', settingsError)
    return new Response(JSON.stringify({ error: settingsError.message }), { status: 500 })
  }

  const due = (settings ?? [])
    .map((row) => {
      const timezone = row.timezone || 'UTC'
      const morningDue = row.morning_enabled && isDue(now, row.morning_time, timezone)
      const nightDue = row.night_enabled && isDue(now, row.night_time, timezone)
      return { ...row, morningDue, nightDue }
    })
    .filter((row) => row.morningDue || row.nightDue)

  if (due.length === 0) {
    return new Response(JSON.stringify({ checked: settings?.length ?? 0, sent: 0 }), { status: 200 })
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('user_id, subscription')
    .in('user_id', due.map((row) => row.user_id))

  if (subError) {
    console.error('SUBSCRIPTIONS ERROR:', subError)
    return new Response(JSON.stringify({ error: subError.message }), { status: 500 })
  }

  let sent = 0

  for (const sub of subscriptions ?? []) {
    const row = due.find((r) => r.user_id === sub.user_id)
    if (!row) continue

    const payload = JSON.stringify({
      title: 'Tracka',
      body: row.morningDue ? 'Time for your morning routine.' : 'Time for your night routine.',
      url: '/',
      tag: row.morningDue ? 'morning' : 'night',
    })

    try {
      await webpush.sendNotification(sub.subscription, payload)
      sent += 1
    } catch (err) {
      console.error('SEND ERROR for', sub.user_id, err)

      // Browser dropped the subscription (uninstalled, cleared data, etc).
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id)
      }
    }
  }

  return new Response(JSON.stringify({ checked: settings?.length ?? 0, due: due.length, sent }), {
    status: 200,
  })
})
