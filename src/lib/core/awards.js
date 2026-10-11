// Challenge awards: medals earned along the way plus the cup for finishing.
// Derived purely from the challenge's recorded days — nothing extra stored —
// so they can never disagree with the progress count.
//
// Shapes live here as SVG path strings on a 100x100 grid so the in-app
// icons (JSX <svg>) and the saved PNG (canvas Path2D) draw the exact same
// thing.

import { addDays } from './planNight.js'

export const METALS = {
  bronze: { light: '#F2C59A', mid: '#C9844A', dark: '#8A5328', ribbon: '#2554EB' },
  silver: { light: '#FFFFFF', mid: '#C4CCD6', dark: '#7D8896', ribbon: '#2554EB' },
  gold: { light: '#FFF1B8', mid: '#E8B931', dark: '#A67712', ribbon: '#2554EB' },
}

export const CUP_SHAPES = {
  handles: 'M30 22 H17 C17 38 23 46 33 48 M70 22 H83 C83 38 77 46 67 48',
  bowl: 'M28 14 H72 V38 C72 54 62 64 50 64 C38 64 28 54 28 38 Z',
  stem: 'M45 63 H55 L57 76 H43 Z',
  base: 'M33 76 H67 V84 H33 Z M27 84 H73 Q76 84 76 87 V94 H24 V87 Q24 84 27 84 Z',
  star: 'M50 24 L53.5 32 L62 32.6 L55.5 38 L57.6 46.4 L50 41.8 L42.4 46.4 L44.5 38 L38 32.6 L46.5 32 Z',
}

export const MEDAL_SHAPES = {
  ribbonLeft: 'M30 4 H45 L57 38 H42 Z',
  ribbonRight: 'M70 4 H55 L43 38 H58 Z',
}

// Points are just completed days × 10 — derived, never stored, so they
// can't drift from the day count.
export const POINTS_PER_DAY = 10

export function challengePoints(daysCompleted) {
  return (daysCompleted || 0) * POINTS_PER_DAY
}

function longestRun(sortedDates) {
  let longest = 0
  let run = 0
  let previous = null
  for (const date of sortedDates) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }
  return longest
}

// Consecutive challenge days ending today, or yesterday if today isn't
// ticked yet (same rule as the main streak).
export function challengeStreak(sortedDates, today) {
  const set = new Set(sortedDates)
  let date = set.has(today) ? today : addDays(today, -1)
  let current = 0
  while (set.has(date)) {
    current += 1
    date = addDays(date, -1)
  }
  return current
}

export function challengeAwards(dates, duration) {
  const sorted = [...new Set(dates)].sort()
  const done = sorted.length
  const half = Math.ceil(duration / 2)
  const longest = longestRun(sorted)

  return [
    { key: 'first', kind: 'medal', metal: 'bronze', badge: '1', label: 'First day', earned: done >= 1,
      blurb: 'Day one done — the hardest one.' },
    { key: 'week', kind: 'medal', metal: 'silver', badge: '7', label: '7-day streak', earned: longest >= 7,
      blurb: 'Seven days in a row.' },
    { key: 'half', kind: 'medal', metal: 'gold', badge: String(half), label: 'Halfway', earned: done >= half,
      blurb: `${half} days in — halfway there.` },
    { key: 'complete', kind: 'cup', metal: 'gold', badge: '', label: 'Challenge complete', earned: done >= duration,
      blurb: `All ${duration} days complete.` },
  ]
}
