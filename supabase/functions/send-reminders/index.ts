// Runs every few minutes. Finds whoever is due a reminder in their own
// timezone, works out what their routine actually is, and sends it.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { planNight } from './planNight.js'

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

const listWords = (names: string[]) =>
  names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

async function buildNightMessage(userId: string, today: string) {
  const { data: routines } = await supabase
    .from('routines').select('id')
    .eq('user_id', userId).eq('is_active', true).eq('time_of_day', 'PM')

  const routineId = routines?.[0]?.id
  if (!routineId) return null

  const { data: steps } = await supabase
    .from('routine_steps')
    .select('id, step_order, step_name, frequency, days_of_week, user_products(products(name, brand, category, ingredients))')
    .eq('routine_id', routineId).eq('is_active', true).order('step_order')

  if (!steps?.length) return null

  const { data: history } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id, local_date')
    .eq('user_id', userId).lt('local_date', today)

  const plan = planNight({
    today,
    steps: steps.map((step: any) => ({
      id: step.id,
      name: step.user_products?.products?.name || step.step_name,
      brand: step.user_products?.products?.brand,
      category: step.user_products?.products?.category,
      ingredients: step.user_products?.products?.ingredients,
      frequency: step.frequency,
      daysOfWeek: step.days_of_week,
      step_order: step.step_order,
    })),
    history: history ?? [],
  })

  const names = plan.steps.map((s: any) => s.name)
  const hasActive = plan.steps.some((s: any) => s.active && s.active !== 'none')
  if (!names.length) return null

  return hasActive
    ? `Tonight: ${listWords(names)}.`
    : `Rest night — ${listWords(names)}. Nothing strong.`
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

Deno.serve(async (req) => {
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'

  const diag: any = {
    vapidError,
    vapidPublicHead: vapidPublic.slice(0, 12),
    vapidPublicLength: vapidPublic.length,
  }

  const { data: due, error } = await supabase.rpc('due_reminders', { window_minutes: 6 })

  if (error) {
    return new Response(JSON.stringify({ error: error.message, diag }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  diag.dueCount = due?.length ?? 0

  let sent = 0, skipped = 0, failed = 0
  const errors: any[] = []

  for (const row of due ?? []) {
    const name = row.username ? `, ${row.username}` : ''
    const body = row.slot === 'night'
      ? await buildNightMessage(row.user_id, row.local_date)
      : await buildMorningMessage(row.user_id)

    if (!body) {
      skipped++
      errors.push({ user: row.user_id, reason: 'no routine steps' })
      continue
    }

    const payload = {
      title: row.slot === 'night' ? `Good evening${name}` : `Good morning${name}`,
      body,
      url: '/',
      tag: `routine-${row.slot}`,
    }

    if (dryRun) {
      skipped++
      errors.push({ user: row.user_id, dryRun: payload })
      continue
    }

    try {
      await webpush.sendNotification(row.subscription, JSON.stringify(payload))
      await supabase.from('reminder_log').insert({
        user_id: row.user_id, slot: row.slot, local_date: row.local_date,
      })
      sent++
    } catch (err: any) {
      failed++
      errors.push({
        user: row.user_id,
        statusCode: err?.statusCode ?? null,
        message: err?.message ?? String(err),
        responseBody: typeof err?.body === 'string' ? err.body.slice(0, 300) : null,
      })
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('user_id', row.user_id)
      }
    }
  }

  return new Response(JSON.stringify({ sent, skipped, failed, errors, diag }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
