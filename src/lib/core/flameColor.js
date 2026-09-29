// A flame's color tells you its temperature — red is coolest, blue is
// hottest. Used the same way here: the streak flame starts red/orange at
// day one and works its way to blue as the streak gets long, rather than
// staying a flat orange regardless of how far someone's gotten.
const STOPS = [
  { at: 0, color: [239, 68, 68] },    // red-400  #EF4444
  { at: 7, color: [249, 115, 22] },   // orange-500 #F97316
  { at: 14, color: [251, 191, 36] },  // amber-400 #FBBF24
  { at: 30, color: [250, 204, 21] },  // yellow-400 #FACC15
  { at: 60, color: [147, 197, 253] }, // blue-300 #93C5FD
  { at: 100, color: [59, 130, 246] }, // blue-500 #3B82F6
]

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

export function flameColorForStreak(streak) {
  const n = Math.max(0, streak || 0)

  if (n <= STOPS[0].at) return rgbToHex(STOPS[0].color)
  if (n >= STOPS[STOPS.length - 1].at) return rgbToHex(STOPS[STOPS.length - 1].color)

  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (n >= a.at && n <= b.at) {
      const t = (n - a.at) / (b.at - a.at)
      return rgbToHex([
        lerp(a.color[0], b.color[0], t),
        lerp(a.color[1], b.color[1], t),
        lerp(a.color[2], b.color[2], t),
      ])
    }
  }

  return rgbToHex(STOPS[STOPS.length - 1].color)
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

// 24x24 viewBox flame path, shared between the in-app SVG icons and the
// canvas-drawn share image so both draw the exact same shape.
export const FLAME_PATH =
  'M12 2c1.5 3 .5 4.5-.5 6C10 6.5 9.5 5 10 3c-2.5 2-5 5.5-5 9a7 7 0 0 0 14 0c0-4-2.5-7-3.5-8.5.3 2-.5 3.3-1.5 4.2C13.8 6 13 4 12 2Z'
