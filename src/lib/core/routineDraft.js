// The routine editor's working copy: which slot each product goes in
// ('AM' | 'PM' | 'BOTH' | 'NONE') and on which days (0=Sun..6=Sat).
// Pure helpers — no React — so the Expo app can reuse them.

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

// A sensible starting slot for a product nobody has placed yet.
export const getDefaultProductTime = (product) => {
  const text = `${product.products?.name || ''} ${product.products?.category || ''}`.toLowerCase()

  if (
    text.includes('sunscreen') ||
    text.includes('spf') ||
    text.includes('vitamin c')
  ) {
    return 'AM'
  }

  if (
    text.includes('retinol') ||
    text.includes('retinoid') ||
    text.includes('tretinoin') ||
    text.includes('aha') ||
    text.includes('bha') ||
    text.includes('exfol')
  ) {
    return 'PM'
  }

  return 'BOTH'
}

// Times and days as saved in the active AM/PM routines.
export function draftFromRoutines(amRoutine, pmRoutine) {
  const times = {}
  const days = {}
  for (const routine of [amRoutine, pmRoutine].filter(Boolean)) {
    for (const step of routine.routine_steps || []) {
      const id = step.user_product_id
      times[id] = times[id] ? 'BOTH' : routine.time_of_day
      days[id] = [...new Set([...(days[id] || []), ...(step.days_of_week || ALL_DAYS)])]
    }
  }
  return { times, days }
}

// Every product gets a slot: editing an existing routine, products not in
// it start out of it ('NONE'); building a first routine, they get a
// sensible default.
export function withDefaultTimes(times, products, editing) {
  const filled = { ...times }
  for (const item of products) {
    if (!filled[item.id]) filled[item.id] = editing ? 'NONE' : getDefaultProductTime(item)
  }
  return filled
}

// Unsaved editor choices set aside while the person adds a product from
// the editor, so they're still there on return (the editor unmounts while
// the add-product screen is open).
let held = null

export const holdRoutineDraft = (draft) => { held = draft }

// Cleared on the next tick rather than immediately: React's development
// mode runs a state initializer twice in a row, and both runs must see it.
export const takeHeldRoutineDraft = () => {
  const draft = held
  if (draft) setTimeout(() => { if (held === draft) held = null }, 0)
  return draft
}

// The product just added from the editor goes straight into the routine:
// its default slot, every day.
export const addProductToHeldDraft = (userProduct) => {
  if (!held) return
  held = {
    times: { ...held.times, [userProduct.id]: getDefaultProductTime(userProduct) },
    days: { ...held.days, [userProduct.id]: ALL_DAYS },
  }
}
