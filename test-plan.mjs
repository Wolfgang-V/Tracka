// Simulates ten nights so you can watch the engine make decisions.
// Run with:  node test-plan.mjs
//
// Night 5 is deliberately skipped, to prove the schedule shifts
// instead of breaking.

import { planNight, addDays } from './src/lib/core/planNight.js'
import { detectActive } from './src/lib/core/actives.js'

const steps = [
  { id: 'a', name: 'Gentle Cleanser', brand: 'CeraVe', category: 'cleanser',    frequency: 'daily',      step_order: 1 },
  { id: 'b', name: 'Retinol 0.3%',    brand: 'CC',     category: 'treatment',   frequency: 'every3',     step_order: 2 },
  { id: 'c', name: 'AHA Exfoliant',   brand: 'Cerave', category: 'exfoliant',   frequency: 'twice_week', step_order: 3 },
  { id: 'd', name: 'Niacinamide',     brand: 'Ordi',   category: 'serum',       frequency: 'daily',      step_order: 4 },
  { id: 'e', name: 'Moisturiser',     brand: 'Gy',     category: 'moisturizer', frequency: 'daily',      step_order: 5 },
]

console.log('\nWhat the engine thinks each product is:')
for (const s of steps) {
  console.log(`  ${s.name.padEnd(18)} → ${detectActive(s)}`)
}

const SKIP_NIGHT = 5
let today = '2026-09-20'
const history = []

console.log('\n--- ten nights ---')

for (let night = 1; night <= 10; night++) {
  const { steps: plan, notes } = planNight({ today, steps, history })

  console.log(`\nNight ${night}  (${today})`)

  if (night === SKIP_NIGHT) {
    console.log('  [user skipped tonight entirely]')
  } else {
    for (const step of plan) {
      const flag = step.active === 'none' ? ' ' : '*'
      console.log(`  ${flag} ${step.name}`)
    }
    for (const note of notes) {
      console.log(`    · ${note}`)
    }
    // user completes everything suggested
    for (const step of plan) {
      history.push({ routine_step_id: step.id, local_date: today })
    }
  }

  today = addDays(today, 1)
}

console.log('\n(* marks an active ingredient)\n')
