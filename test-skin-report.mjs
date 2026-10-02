import assert from 'node:assert/strict'
import { calculateRoutineCompletion, calculateStreaks, countScheduledRoutineSessions } from './src/lib/core/skinReport.js'

const dailyRoutine = (id, timeOfDay) => ({
  id,
  time_of_day: timeOfDay,
  routine_steps: [{
    id: `${id}-step`,
    step_name: 'Cleanser',
    frequency: 'daily',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    step_order: 1,
    user_products: { products: { name: 'Cleanser', category: 'cleanser' } },
  }],
})

assert.equal(countScheduledRoutineSessions({
  routines: [dailyRoutine('am', 'AM'), dailyRoutine('pm', 'PM')],
  history: [],
  startDate: '2026-09-01',
  endDate: '2026-10-01',
}), 60)

assert.equal(calculateRoutineCompletion({
  routines: [dailyRoutine('am', 'AM'), dailyRoutine('pm', 'PM')],
  history: [],
  completions: Array.from({ length: 45 }, (_, index) => ({
    completed_date: `2026-09-${String(Math.floor(index / 2) + 1).padStart(2, '0')}`,
    time_of_day: index % 2 === 0 ? 'AM' : 'PM',
  })),
  startDate: '2026-09-01',
  endDate: '2026-10-01',
}).percentage, 75)

const weekdaysRoutine = dailyRoutine('weekdays', 'AM')
weekdaysRoutine.routine_steps[0].days_of_week = [1, 4]
assert.equal(countScheduledRoutineSessions({
  routines: [weekdaysRoutine],
  history: [],
  startDate: '2026-10-01',
  endDate: '2026-10-08',
}), 2)

const completed = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
assert.deepEqual(calculateStreaks(completed, '2026-10-04', '2026-10-01', '2026-11-01'), {
  current: 4,
  longest: 4,
})
assert.deepEqual(calculateStreaks(completed, '2026-10-05', '2026-10-01', '2026-11-01'), {
  current: 0,
  longest: 4,
})

console.log('Skin report checks passed.')