// Runs every few minutes. Finds whoever is due a reminder in their own
// timezone, works out what their routine actually is, and sends it.
// Also checks four other things on the same tick: a ~30-minute follow-up
// for a missed reminder, 24/48-hour login inactivity nudges, a once-only nudge for
// signups who never finished onboarding, and SPF reapply reminders every
// 2h after sunscreen was ticked — no separate cron job needed for any of
// them.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? ''

let vapidError: string | null = null
try {
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
} catch (err: any) {
  vapidError = err?.message ?? String(err)
}

async function buildNightMessage(userId: string) {
  const { data: routines } = await supabase
    .from('routines').select('id')
    .eq('user_id', userId).eq('is_active', true).eq('time_of_day', 'PM')

  const routineId = routines?.[0]?.id
  if (!routineId) return null

  const { data: steps } = await supabase
    .from('routine_steps')
    .select('step_name, user_products(products(name))')
    .eq('routine_id', routineId).eq('is_active', true).order('step_order')

  if (!steps?.length) return null

  return "It's time for your night routine."
}

async function buildMorningMessage(userId: string) {
  const { data: routines } = await supabase
    .from('routines').select('id')
    .eq('user_id', userId).eq('is_active', true).eq('time_of_day', 'AM')

  const routineId = routines?.[0]?.id
  if (!routineId) return null

  const { data: steps } = await supabase
    .from('routine_steps')
    .select('step_name, user_products(products(name))')
    .eq('routine_id', routineId).eq('is_active', true).order('step_order')

  if (!steps?.length) return null

  return "Let's kickstart your day with your morning skincare routine!"
}

type SendResult = { sent: number; skipped: number; failed: number; errors: any[] }

// Shared by all three notification loops: sends the push, deletes the
// subscription if it's gone stale (404/410), and lets the caller decide
// how this particular kind of send gets logged for dedup.
async function sendPush(
  subscription: any,
  payload: Record<string, unknown>,
  userId: string,
  dryRun: boolean,
  result: SendResult,
  onSent: () => Promise<void>
) {
  if (dryRun) {
    result.skipped++
    result.errors.push({ user: userId, dryRun: payload })
    return
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
    await onSent()
    result.sent++
  } catch (err: any) {
    result.failed++
    result.errors.push({
      user: userId,
      statusCode: err?.statusCode ?? null,
      message: err?.message ?? String(err),
      responseBody: typeof err?.body === 'string' ? err.body.slice(0, 300) : null,
    })
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId)
    }
  }
}

Deno.serve(async (req) => {
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const diag: any = {
    vapidError,
    vapidPublicHead: vapidPublic.slice(0, 12),
    vapidPublicLength: vapidPublic.length,
  }

  const result: SendResult = { sent: 0, skipped: 0, failed: 0, errors: [] }

  // --- primary reminders, at the time the user set ---

  const { data: due, error } = await supabase.rpc('due_reminders', { window_minutes: 6 })

  if (error) {
    return new Response(JSON.stringify({ error: error.message, diag }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  diag.dueCount = due?.length ?? 0

  for (const row of due ?? []) {
    const name = row.username ? `, ${row.username}` : ''
    const body = row.slot === 'night'
      ? await buildNightMessage(row.user_id)
      : await buildMorningMessage(row.user_id)

    if (!body) {
      result.skipped++
      result.errors.push({ user: row.user_id, reason: 'no routine steps' })
      continue
    }

    const payload = {
      title: row.slot === 'night' ? `Good evening${name}` : `Good morning${name}`,
      body,
      url: '/',
      tag: `routine-${row.slot}`,
    }

    await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
      await supabase.from('reminder_log').insert({
        user_id: row.user_id, slot: row.slot, local_date: row.local_date,
      })
    })
  }

  // --- follow-ups, ~30 minutes after a missed reminder ---

  const { data: followups, error: followupsError } = await supabase.rpc('due_followups', { window_minutes: 6 })

  if (followupsError) {
    diag.followupsError = followupsError.message
  } else {
    diag.followupsDueCount = followups?.length ?? 0

    for (const row of followups ?? []) {
      const name = row.username ? `, ${row.username}` : ''
      const payload = row.slot === 'morning'
        ? {
            title: `Hey${name} ☀️`,
            body: 'Your morning routine is still waiting for you. Take a few minutes to show your skin some love.',
            url: '/',
            tag: 'routine-followup-morning',
          }
        : {
            title: `Hey${name} 🌙`,
            body: 'Before you sleep… did you forget something? 👀',
            url: '/',
            tag: 'routine-followup-night',
          }

      await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
        await supabase.from('reminder_followup_log').insert({
          user_id: row.user_id, slot: row.slot, local_date: row.local_date,
        })
      })
    }
  }

  // --- 24-hour / 48-hour login inactivity nudges ---

  const { data: inactive, error: inactiveError } = await supabase.rpc('due_login_nudges', { window_minutes: 6 })

  if (inactiveError) {
    diag.inactiveError = inactiveError.message
  } else {
    diag.loginNudgesDueCount = inactive?.length ?? 0

    for (const row of inactive ?? []) {
      const payload = {
        title: 'Tracka+',
        body: row.hours_since_login === 24
          ? "Hey, where did you go? 👀 You haven't checked in with Tracka+ today"
          : "You've been gone for 2 days. Ready to get back into your routine?",
        url: '/',
        tag: `login-inactivity-${row.hours_since_login}`,
      }

      await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
        await supabase.from('login_nudge_log').insert({
          user_id: row.user_id,
          hours_since_login: row.hours_since_login,
          login_at: row.login_at,
        })
      })
    }
  }

  // --- once-only nudge for signups who never finished onboarding ---

  const { data: onboarding, error: onboardingError } = await supabase.rpc('due_onboarding_nudges')

  if (onboardingError) {
    diag.onboardingError = onboardingError.message
  } else {
    diag.onboardingDueCount = onboarding?.length ?? 0

    for (const row of onboarding ?? []) {
      const name = row.username ? `, ${row.username}` : ''
      const payload = {
        title: `Hey${name} 👋`,
        body: "You're a few steps away from your first routine — pick up where you left off.",
        url: '/',
        tag: 'onboarding-nudge',
      }

      await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
        await supabase.from('onboarding_nudge_log').insert({ user_id: row.user_id })
      })
    }
  }

  // --- SPF reapply reminders, fixed at 12:00 and 15:00 local time ---

  const { data: spf, error: spfError } = await supabase.rpc('due_spf_reminders', { window_minutes: 6 })

  if (spfError) {
    diag.spfError = spfError.message
  } else {
    diag.spfDueCount = spf?.length ?? 0

    for (const row of spf ?? []) {
      const payload = row.reapply_number === 1
        ? {
            title: 'SPF check! ☀️',
            body: 'Time to reapply your sunscreen.',
            url: '/',
            tag: `spf-reapply-${row.reapply_number}`,
          }
        : {
            title: 'Sunscreen reminder ☀️',
            body: "It's time for another sunscreen application.",
            url: '/',
            tag: `spf-reapply-${row.reapply_number}`,
          }

      await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
        await supabase.from('spf_reminder_log').insert({
          user_id: row.user_id,
          local_date: row.local_date,
          reapply_number: row.reapply_number,
        })
      })
    }
  }

  // --- Diary nudge, once a day around 14:00 local, if nothing's logged yet ---

  const { data: diaryNudges, error: diaryError } = await supabase.rpc('due_diary_nudges', { window_minutes: 6 })

  if (diaryError) {
    diag.diaryError = diaryError.message
  } else {
    diag.diaryDueCount = diaryNudges?.length ?? 0

    for (const row of diaryNudges ?? []) {
      const payload = {
        title: 'How\'s your skin today? 📝',
        body: "You haven't logged a note yet — takes a second.",
        url: '/',
        tag: 'diary-nudge',
      }

      await sendPush(row.subscription, payload, row.user_id, dryRun, result, async () => {
        await supabase.from('diary_nudge_log').insert({
          user_id: row.user_id,
          local_date: row.local_date,
        })
      })
    }
  }

  return new Response(JSON.stringify({ ...result, diag }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
