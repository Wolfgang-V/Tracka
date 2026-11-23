// Tracka+ Wrapped: when it's open, and how a year's numbers become slides.
// Pure functions (no React, no Supabase) so they carry over to the Expo app.
//
// Window: 10 Dec → 31 Jan. Before 10 Dec there's too little December data;
// after January nobody wants last year's recap. Anyone can preview early by
// opening the app once with ?wrapped=preview (remembered on that device).

export const WRAPPED_YEAR = 2026
const OPENS = new Date(WRAPPED_YEAR, 11, 10) // 10 Dec, local time
const CLOSES = new Date(WRAPPED_YEAR + 1, 1, 1) // until the end of 31 Jan

const PREVIEW_KEY = 'trackaWrappedPreview'

export function rememberWrappedPreview() {
  try {
    if (new URLSearchParams(window.location.search).get('wrapped') === 'preview') {
      localStorage.setItem(PREVIEW_KEY, '1')
      return true
    }
  } catch { /* storage blocked: preview just isn't remembered */ }
  return false
}

export function wrappedAvailable(now = new Date()) {
  if (now >= OPENS && now < CLOSES) return true
  try { return localStorage.getItem(PREVIEW_KEY) === '1' } catch { return false }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

export const monthName = (m) => MONTHS[(m || 1) - 1]

// Below this many days there isn't a story to tell yet, so they get the
// short "just getting started" version instead.
export const MIN_DAYS_FOR_FULL = 3

export function personality({ am = 0, pm = 0, days_showed_up: days = 0 }) {
  const total = am + pm
  if (days < MIN_DAYS_FOR_FULL || total < 4) {
    return { key: 'fresh', emoji: '🌱', title: 'The Fresh Start',
      line: 'Every routine starts with day one, and yours has started.' }
  }
  if (am / total >= 0.6) {
    return { key: 'morning', emoji: '☀️', title: 'The Morning Glow',
      line: 'Mornings are your moment. Cleanse, protect, go.' }
  }
  if (pm / total >= 0.6) {
    return { key: 'night', emoji: '🌙', title: 'The Night Owl',
      line: 'You do your best skincare after dark, when the actives come out.' }
  }
  return { key: 'balanced', emoji: '✨', title: 'The All-Day Glow',
    line: 'Morning and night, you show up for both.' }
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Turns my_year_in_review() into the ordered list of slides. Slides with
 * nothing to say are left out, so a light user gets a short story rather
 * than a row of zeros.
 *
 * Each slide: { key, theme, kicker, big?, unit?, title?, lines[], items? }
 */
export function buildWrappedSlides(d) {
  const name = d.first_name || 'You'
  const p = personality(d)
  const slides = []

  slides.push({
    key: 'intro', theme: 'blue', kicker: `Tracka+ Wrapped ${d.year}`,
    title: `${name}, here's your ${d.year} in skincare`,
    lines: [d.joined_on
      ? `Since you joined on ${new Date(`${d.joined_on}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}, here's what you built.`
      : "Here's what you built."],
  })

  if (d.days_showed_up < MIN_DAYS_FOR_FULL) {
    slides.push({
      key: 'starting', theme: 'green', kicker: 'Your story so far',
      big: d.days_showed_up, unit: d.days_showed_up === 1 ? 'day you showed up' : 'days you showed up',
      lines: [
        "That's how every glow-up starts.",
        'Tick off your routine a few days this week, and next year\'s Wrapped will have a lot more to say.',
      ],
    })
    slides.push({ key: 'summary', theme: 'navy', kicker: 'See you next year', personality: p, lines: [] })
    return slides
  }

  slides.push({
    key: 'days', theme: 'blue', kicker: 'You showed up',
    big: d.days_showed_up, unit: 'days',
    lines: [
      'for your skin this year.',
      d.percentile >= 50 ? `That's more than ${d.percentile}% of Tracka+ members.` : null,
    ].filter(Boolean),
  })

  if (d.am + d.pm > 0) {
    slides.push({
      key: 'ampm', theme: 'sunset', kicker: 'Morning and night',
      split: [
        { emoji: '☀️', value: d.am, label: d.am === 1 ? 'morning routine' : 'morning routines' },
        { emoji: '🌙', value: d.pm, label: d.pm === 1 ? 'night routine' : 'night routines' },
      ],
      lines: [d.both > 0 ? `You did both on ${plural(d.both, 'day')}.` : null].filter(Boolean),
    })
  }

  if (d.best_streak >= 2) {
    slides.push({
      key: 'streak', theme: 'fire', kicker: 'Your longest streak',
      big: d.best_streak, unit: 'days in a row',
      lines: [d.busiest_month ? `${monthName(d.busiest_month)} was your strongest month.` : null].filter(Boolean),
    })
  }

  slides.push({
    key: 'personality', theme: p.key === 'night' ? 'night' : p.key === 'morning' ? 'sunrise' : 'violet',
    kicker: 'Your skincare personality', emoji: p.emoji, title: p.title, lines: [p.line],
  })

  if (d.top_products?.length) {
    const [first] = d.top_products
    slides.push({
      key: 'products', theme: 'gold', kicker: 'Your most-used products',
      lines: [`Your #1 was ticked ${plural(first.times, 'time')}.`],
      items: d.top_products.map((x) => ({
        label: [x.brand, x.name].filter(Boolean).join(' '),
        sub: plural(x.times, 'time'),
        image: x.image_url,
      })),
    })
  }

  const shelf = [
    d.steps_ticked > 0 && { value: d.steps_ticked, label: 'steps ticked' },
    d.products_added > 0 && { value: d.products_added, label: d.products_added === 1 ? 'product added' : 'products added' },
    d.empties > 0 && { value: d.empties, label: d.empties === 1 ? 'product finished' : 'products finished' },
    d.photos > 0 && { value: d.photos, label: d.photos === 1 ? 'progress photo' : 'progress photos' },
    d.skin_logs > 0 && { value: d.skin_logs, label: d.skin_logs === 1 ? 'skin check-in' : 'skin check-ins' },
  ].filter(Boolean)
  if (shelf.length >= 2) {
    slides.push({ key: 'shelf', theme: 'teal', kicker: 'By the numbers', stats: shelf, lines: [] })
  }

  if (d.challenges?.length) {
    slides.push({
      key: 'challenges', theme: 'gold', kicker: d.challenges.length === 1 ? 'Your challenge' : 'Your challenges',
      items: d.challenges.map((c) => ({
        label: c.title,
        sub: c.days >= c.target ? `🏆 ${c.days} days, over the line` : `${plural(c.days, 'day')} checked in`,
      })),
      lines: ['Your certificates are waiting in My rewards.'],
    })
  }

  slides.push({ key: 'summary', theme: 'navy', kicker: `My ${d.year} in skincare`, personality: p, lines: [] })
  return slides
}
