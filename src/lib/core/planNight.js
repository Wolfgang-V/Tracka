// Works out tonight's routine at the moment it's needed, from the user's
// rules plus what they actually did. Nothing is scheduled in advance, so
// nothing can go stale when someone skips a night.

import { ACTIVES, activeLabel, detectActive, slotRank } from './actives.js'

// 0=Sunday..6=Saturday, matching JS Date.getDay() — lets the engine compare
// today's weekday against a step's days_of_week directly, no lookup table.
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

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

// Clinical restrictions, not scheduling preferences — these override
// due-ness and conflict rules rather than competing with them.
const RESTRICTED_IN_PREGNANCY = [ACTIVES.RETINOID]

export const PREGNANCY_NOTE =
  "Retinol is set aside while you're pregnant or breastfeeding — it's usually advised against. " +
  "Your doctor or pharmacist can tell you what's right for you."

// --- date helpers, all on 'YYYY-MM-DD' strings in the user's own timezone ---

export function addDays(dateString, amount) {
  const [y, m, d] = dateString.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + amount)
  return dt.toISOString().slice(0, 10)
}

export function addMonths(dateString, amount) {
  const [y, m, d] = dateString.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + amount, d))
  return dt.toISOString().slice(0, 10)
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

// When a step isn't due today, says which day it next is — "tomorrow" or
// a day name, whichever reads more naturally.
function nextDueLabel(daysOfWeek, todayDow) {
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
 * @param today        'YYYY-MM-DD'
 * @param steps        [{ id, name, brand, category, daysOfWeek, step_order, active?, opened_date?, pao_months? }]
 * @param history      [{ routine_step_id, local_date }]  past completions
 * @param restrictions { pregnancy?: boolean }  clinical restrictions, not
 *   scheduling preferences — checked before due-ness so they apply even
 *   on a night the step would have been skipped anyway.
 */
export function planNight({ today, steps = [], history = [], restrictions = {} }) {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const todayDow = dayOfWeek(today)

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
    const daysOfWeek =
      step.daysOfWeek && step.daysOfWeek.length > 0 ? step.daysOfWeek : ALL_DAYS

    const expiresOn =
      step.opened_date && step.pao_months
        ? addMonths(step.opened_date, step.pao_months)
        : null
    const expired = expiresOn ? today >= expiresOn : false

    return {
      ...step,
      active,
      daysOfWeek,
      dueToday: daysOfWeek.includes(todayDow),
      expiresOn,
      expired,
    }
  })

  const candidates = enriched
    .filter((s) => s.dueToday)
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))

  const chosen = []
  const skipped = []
  const notes = []
  let restrictionApplied = false

  for (const step of candidates) {
    if (restrictions.pregnancy && RESTRICTED_IN_PREGNANCY.includes(step.active)) {
      skipped.push({ step, reason: 'restricted' })
      if (!notes.includes(PREGNANCY_NOTE)) notes.push(PREGNANCY_NOTE)
      restrictionApplied = true
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

  for (const step of enriched) {
    if (step.dueToday) continue
    skipped.push({ step, reason: 'not_due' })
    if (step.active !== ACTIVES.NONE) {
      const next = nextDueLabel(step.daysOfWeek, todayDow)
      notes.push(`${step.name} isn't scheduled for today${next ? ` — next ${next}.` : '.'}`)
    }
  }

  const plan = chosen.sort(
    (a, b) =>
      slotRank(a.category) - slotRank(b.category) ||
      (a.step_order ?? 0) - (b.step_order ?? 0)
  )

  for (const step of plan) {
    if (step.expired) {
      notes.push(`${step.name} is past its use-by date — consider replacing it.`)
    }
  }

  const hasActiveTonight = chosen.some((s) => s.active !== ACTIVES.NONE)
  const ownsAnyActive = enriched.some((s) => s.active !== ACTIVES.NONE)

  if (!hasActiveTonight && ownsAnyActive && !restrictionApplied) {
    notes.unshift(
      'Recovery night — nothing strong tonight. Cleanse, hydrate, protect your barrier.'
    )
  }

  // A simple label for the night, in priority order: a retinoid always
  // reads as the headline treatment even alongside an exfoliant elsewhere
  // in the routine (the conflict rules keep them off the same night anyway).
  const nightType = chosen.some((s) => s.active === ACTIVES.RETINOID)
    ? 'retinol'
    : chosen.some((s) => s.active === ACTIVES.AHA || s.active === ACTIVES.BHA)
      ? 'exfoliation'
      : !hasActiveTonight && ownsAnyActive
        ? 'recovery'
        : 'plain'

  return { date: today, steps: plan, notes, skipped, nightType }
}
