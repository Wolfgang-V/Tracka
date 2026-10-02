import { addDays, planNight } from './planNight.js'

export function listScheduledRoutineSessions({ routines, history, startDate, endDate, restrictions = {} }) {
  const scheduled = []

  for (let date = startDate; date < endDate; date = addDays(date, 1)) {
    const dateHistory = history.filter((entry) => entry.local_date < date)

    for (const routine of routines) {
      const steps = (routine.routine_steps || []).filter((step) => step.is_active !== false)
      if (steps.length === 0) continue

      const plan = planNight({
        today: date,
        steps: steps.map((step) => {
          const product = step.user_products?.products
          return {
            id: step.id,
            name: product?.name || step.step_name,
            brand: product?.brand,
            category: product?.category,
            ingredients: product?.ingredients,
            active: routine.time_of_day === 'AM' ? 'none' : undefined,
            frequency: step.frequency,
            daysOfWeek: step.days_of_week,
            step_order: step.step_order,
            opened_date: step.user_products?.opened_date ?? null,
            pao_months: step.user_products?.pao_months ?? null,
          }
        }),
        history: dateHistory,
        restrictions,
      })

      if (plan.steps.length > 0) scheduled.push(`${date}:${routine.time_of_day}`)
    }
  }

  return scheduled
}

export function calculateRoutineCompletion({ routines, history, completions, startDate, endDate, restrictions = {} }) {
  const scheduled = listScheduledRoutineSessions({ routines, history, startDate, endDate, restrictions })
  const completed = new Set(
    completions.map((entry) => `${entry.completed_date}:${entry.time_of_day || 'PM'}`)
  )
  const completedScheduled = scheduled.filter((slot) => completed.has(slot)).length

  return {
    expected: scheduled.length,
    completed: completedScheduled,
    percentage: scheduled.length ? Math.round((completedScheduled / scheduled.length) * 100) : 0,
  }
}

export function countScheduledRoutineSessions(options) {
  return listScheduledRoutineSessions(options).length
}

export function calculateStreaks(completedDates, today, monthStart, monthEnd) {
  const allDates = new Set(completedDates)
  let current = 0

  if (allDates.has(today)) {
    let date = today
    while (allDates.has(date)) {
      current += 1
      date = addDays(date, -1)
    }
  }

  const monthDates = [...allDates]
    .filter((date) => date >= monthStart && date < monthEnd)
    .sort()

  let longest = 0
  let run = 0
  let previous = null
  for (const date of monthDates) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }

  return { current, longest }
}