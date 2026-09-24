// Works out tonight's routine at the moment it's needed, from the user's
// rules plus what they actually did. Nothing is scheduled in advance, so
// nothing can go stale when someone skips a night.

import { ACTIVES, activeLabel, detectActive, slotRank } from './actives.js'

export const FREQUENCIES = {
  daily: { label: 'Every night', nights: 1 },
  alternate: { label: 'Every other night', nights: 2 },
  every3: { label: 'Every 3 nights', nights: 3 },
  twice_week: { label: 'Twice a week', nights: 3 },
  once_week: { label: 'Once a week', nights: 7 },
}

// 0=Sunday..6=Saturday — matches JS Date.getDay() and Postgres extract(dow).
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

// sameNight: don't put these two in the same routine.
// nextNight: don't use this the night after one of these.
// General layering convention, not medical advice — a dermatologist's
// instructions should always win.
const CONFLICTS = {
  [ACTIVES.RETINOID]: {
    sameNight: [ACTIVES.AHA, ACTIVES.BHA, ACTIVES.BENZOYL_PEROXIDE, ACTIVES.VITAMIN_C],
    nextNight: [ACTIVES.AHA, ACTIVES.BHA],
  },
  [ACTIVES.AHA]: {
    sameNight: [ACTIVES.RETINOID, ACTIVES.BHA, ACTIVES.BENZOYL_PEROXIDE],
    nextNight: [ACTIVES.RETINOID],
  },
  [ACTIVES.BHA]: {
    sameNight: [ACTIVES.RETINOID, ACTIVES.AHA],
    nextNight: [ACTIVES.RETINOID],
  },
  [ACTIVES.BENZOYL_PEROXIDE]: {
    sameNight: [ACTIVES.RETINOID, ACTIVES.AHA],
    nextNight: [],
  },
  [ACTIVES.VITAMIN_C]: {
    sameNight: [ACTIVES.RETINOID],
    nextNight: [],
  },
}

// --- date helpers, all on 'YYYY-MM-DD' strings in the user's own timezone ---

export function addDays(dateString, amount) {
  const [y, m, d] = dateString.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + amount)
  return dt.toISOString().slice(0, 10)
}

export function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86400000)
}

export function dayOfWeek(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// A routine logged at 1am belongs to the night before, so the day
// doesn't roll over until 4am.
export function localDateString(date = new Date(), cutoffHour = 4) {
  const shifted = new Date(date.getTime() - cutoffHour * 3600000)
  return (
    shifted.getFullYear() +
    '-' +
    String(shifted.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(shifted.getDate()).padStart(2, '0')
  )
}

function nextAllowedLabel(daysOfWeek, todayDow) {
  if (!daysOfWeek.length) return null
  for (let offset = 1; offset <= 7; offset++) {
    const d = (todayDow + offset) % 7
    if (daysOfWeek.includes(d)) {
      return offset === 1 ? 'tomorrow' : `on ${DAY_NAMES[d]}`
    }
  }
  return null
}

// --- the engine ---

/**
 * @param today    'YYYY-MM-DD'
 * @param steps    [{ id, name, brand, category, frequency, daysOfWeek, step_order, active? }]
 * @param history  [{ routine_step_id, local_date }]  past completions
 * @param pregnantOrBreastfeeding  when true, retinoid steps are held back
 *   entirely rather than scheduled. Defaults false — the caller in this
 *   function (index.ts) doesn't currently fetch skin_profiles to pass a
 *   real value, so this only takes effect once that's wired up too.
 *
 * frequency (cadence, resolved against history) and daysOfWeek (a fixed
 * constraint on top of it) answer different questions — see the longer
 * note in src/lib/core/planNight.js. A step due by cadence but landing on
 * a day it's not allowed just waits for the next allowed day; it doesn't
 * lose its place.
 */
export function planNight({ today, steps = [], history = [], pregnantOrBreastfeeding = false }) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const todayDow = dayOfWeek(today)

  // most recent completion per step
  const lastUsed = new Map()
  for (const entry of history) {
    const seen = lastUsed.get(entry.routine_step_id)
    if (!seen || entry.local_date > seen) {
      lastUsed.set(entry.routine_step_id, entry.local_date)
    }
  }

  const yesterday = addDays(today, -1)
  const usedLastNight = new Set(
    history
      .filter((e) => e.local_date === yesterday)
      .map((e) => byId.get(e.routine_step_id))
      .filter(Boolean)
      .map((s) => s.active ?? detectActive(s))
      .filter((a) => a !== ACTIVES.NONE)
  )

  const enriched = steps.map((step) => {
    const active = step.active ?? detectActive(step)
    const freq = FREQUENCIES[step.frequency] ?? FREQUENCIES.daily
    const last = lastUsed.get(step.id) ?? null
    const nightsSince = last ? daysBetween(last, today) : Infinity
    const daysOfWeek =
      step.daysOfWeek && step.daysOfWeek.length > 0 ? step.daysOfWeek : ALL_DAYS

    return {
      ...step,
      active,
      frequency: step.frequency ?? 'daily',
      daysOfWeek,
      allowedToday: daysOfWeek.includes(todayDow),
      lastUsed: last,
      nightsSince,
      overdue: nightsSince - freq.nights,
      _intervalNights: freq.nights,
    }
  })

  const base = enriched.filter(
    (s) => s._intervalNights === 1 && s.active === ACTIVES.NONE
  )

  const candidates = enriched
    .filter((s) => !(s._intervalNights === 1 && s.active === ACTIVES.NONE))
    .sort(
      (a, b) =>
        b.overdue - a.overdue || (a.step_order ?? 0) - (b.step_order ?? 0)
    )

  const chosen = []
  const skipped = []
  const notes = []
  const pregnancyHeld = []

  for (const step of base) {
    if (step.allowedToday) {
      chosen.push(step)
    } else {
      skipped.push({ step, reason: 'day_restricted' })
    }
  }

  for (const step of candidates) {
    if (pregnantOrBreastfeeding && step.active === ACTIVES.RETINOID) {
      skipped.push({ step, reason: 'pregnancy' })
      pregnancyHeld.push(step)
      continue
    }

    if (step.overdue < 0) {
      const waitNights = -step.overdue
      skipped.push({ step, reason: 'not_due' })
      if (step.active !== ACTIVES.NONE) {
        notes.push(
          `${step.name} isn't due yet — next in ${waitNights} night${waitNights === 1 ? '' : 's'}.`
        )
      }
      continue
    }

    if (!step.allowedToday) {
      skipped.push({ step, reason: 'day_restricted' })
      const next = nextAllowedLabel(step.daysOfWeek, todayDow)
      notes.push(
        `${step.name} is due, but today's set aside — next ${next || 'when a scheduled day comes up'}.`
      )
      continue
    }

    const rules = CONFLICTS[step.active]

    if (rules) {
      const clashedYesterday = rules.nextNight.find((a) => usedLastNight.has(a))
      if (clashedYesterday) {
        skipped.push({ step, reason: 'rest' })
        notes.push(
          `Resting ${step.name} tonight — you used ${activeLabel(clashedYesterday)} last night.`
        )
        continue
      }

      const clashesTonight = chosen.find((c) => rules.sameNight.includes(c.active))
      if (clashesTonight) {
        skipped.push({ step, reason: 'clash' })
        notes.push(
          `${step.name} moved to another night — it doesn't mix with ${clashesTonight.name}.`
        )
        continue
      }
    }

    chosen.push(step)
  }

  const plan = chosen.sort(
    (a, b) =>
      slotRank(a.category) - slotRank(b.category) ||
      (a.step_order ?? 0) - (b.step_order ?? 0)
  )

  const hasActiveTonight = chosen.some((s) => s.active !== ACTIVES.NONE)
  const ownsAnyActive = enriched.some((s) => s.active !== ACTIVES.NONE)

  if (!hasActiveTonight && ownsAnyActive) {
    notes.unshift(
      'Recovery night — nothing strong tonight. Cleanse, hydrate, protect your barrier.'
    )
  }

  const nightType = chosen.some((s) => s.active === ACTIVES.RETINOID)
    ? 'retinol'
    : chosen.some((s) => s.active === ACTIVES.AHA || s.active === ACTIVES.BHA)
      ? 'exfoliation'
      : !hasActiveTonight && ownsAnyActive
        ? 'recovery'
        : 'plain'

  return { date: today, steps: plan, notes, skipped, nightType, pregnancyHeld }
}
