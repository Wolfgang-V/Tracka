// Renders a shareable streak card to a PNG blob, sized for Instagram
// Stories (1080x1920 = 9:16). Pure canvas — no dependency, since this only
// needs to run once per share tap, not on every render.
//
// Follows the app's own light/dark preference (isNight) rather than a
// fixed look — someone who prefers the app in light mode gets a light
// share card too, not a surprise dark one.

import { flameColorForStreak, FLAME_PATH, lighten, darken } from './core/flameColor'
import { METALS, CUP_SHAPES, MEDAL_SHAPES } from './core/awards'
import { isMilestoneStreak } from './milestones'

export { isMilestoneStreak }

const WIDTH = 1080
const HEIGHT = 1920

const PALETTES = {
  dark: {
    bg: '#0C1116',
    ink: '#F3EFE8',
    muted: '#9AA3AD',
    faint: '#5B6570',
    accent: '#8FB8E8',
    accentRgb: '143,184,232',
    cardFill: 'rgba(243,239,232,0.04)',
  },
  light: {
    bg: '#F5F8FC',
    ink: '#101B2D',
    muted: '#51637E',
    faint: '#7488A3',
    accent: '#2554EB',
    accentRgb: '37,84,235',
    cardFill: 'rgba(16,27,45,0.03)',
  },
}



function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function hairline(ctx, centerX, y, width, color) {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(centerX - width / 2, y)
  ctx.lineTo(centerX + width / 2, y)
  ctx.stroke()
}

// Same 24x24 flame the in-app icons use, drawn as a path rather than the
// 🔥 emoji glyph — an emoji's color is baked into the font and can't be
// tinted, so it can't reflect how long the streak actually is. This can.
const flamePath = new Path2D(FLAME_PATH)

// A single flat-filled path read as a dull icon next to a real emoji.
// This layers the same shape three times — a darker rim, a mid-tone body
// with a volume gradient, and a small bright inner tongue near the base —
// the way a glossy flame icon actually shades: dark at the edges, hot at
// the core. Still entirely driven by one input color, so the day-to-blue
// progression still reads at every layer.
function drawFlame(ctx, centerX, centerY, size, color) {
  ctx.save()
  ctx.translate(centerX - size / 2, centerY - size / 2)
  ctx.scale(size / 24, size / 24)

  // Rim — slightly larger and darker, peeking out from behind the body.
  ctx.save()
  ctx.translate(12, 12)
  ctx.scale(1.08, 1.08)
  ctx.translate(-12, -12)
  ctx.fillStyle = darken(color, 0.35)
  ctx.fill(flamePath)
  ctx.restore()

  // Body — the main shape, with a radial gradient for volume rather than
  // a flat fill.
  const bodyGrad = ctx.createRadialGradient(12, 15, 1, 12, 13, 14)
  bodyGrad.addColorStop(0, lighten(color, 0.5))
  bodyGrad.addColorStop(0.6, color)
  bodyGrad.addColorStop(1, darken(color, 0.15))
  ctx.fillStyle = bodyGrad
  ctx.fill(flamePath)

  // Inner tongue — a smaller, brighter core near the base, where a real
  // flame burns hottest.
  ctx.save()
  ctx.translate(12.4, 15.5)
  ctx.scale(0.42, 0.5)
  ctx.translate(-12, -12)
  const coreGrad = ctx.createRadialGradient(12, 15, 0.5, 12, 13, 10)
  coreGrad.addColorStop(0, lighten(color, 0.85))
  coreGrad.addColorStop(1, lighten(color, 0.4))
  ctx.fillStyle = coreGrad
  ctx.fill(flamePath)
  ctx.restore()

  // Gloss — a soft highlight, upper-left, for the glassy/emoji-like pop.
  ctx.beginPath()
  ctx.ellipse(9.3, 7.5, 1.6, 2.4, -0.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fill()

  ctx.restore()
}

// Greedy word wrap — returns the lines and doesn't draw anything, so the
// caller can measure total height before deciding where to start.
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let line = ''

  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/**
 * @param streak       current streak count (already includes tonight)
 * @param routineLabel e.g. "Night Routine"
 * @param dateLabel    e.g. "Tuesday, 29 September"
 * @param products     [{ name, category }] — what was actually ticked off
 * @param isNight      whether the app itself is currently in dark mode
 * @returns Promise<Blob> PNG
 */
export async function generateStreakImage({ streak, routineLabel, dateLabel, products, isNight = true }) {
  await document.fonts.load('600 64px Inter')
  await document.fonts.load('500 96px "Cormorant Garamond"')
  await document.fonts.ready

  const p = isNight ? PALETTES.dark : PALETTES.light

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const glow = ctx.createRadialGradient(WIDTH / 2, 620, 40, WIDTH / 2, 620, 640)
  glow.addColorStop(0, `rgba(${p.accentRgb},0.16)`)
  glow.addColorStop(1, `rgba(${p.accentRgb},0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const milestone = isMilestoneStreak(streak)

  // --- wordmark, top ---
  try {
    const icon = await loadImage('/icons/icon-192.png')
    ctx.save()
    roundRect(ctx, 72, 96, 56, 56, 14)
    ctx.clip()
    ctx.drawImage(icon, 72, 96, 56, 56)
    ctx.restore()
  } catch {
    // Icon failing to load shouldn't block the share — the wordmark text
    // alone is enough to identify the app.
  }

  ctx.fillStyle = p.ink
  ctx.font = '600 34px Inter'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('TRACKA+', 148, 124)

  // --- lay out the headline + card as one group, centered in the space
  // between the logo and the footer, instead of pinning both to fixed
  // coordinates — a short product list used to leave a dead gap above the
  // footer, and a long one risked crowding the card against it. ---
  ctx.textAlign = 'center'
  ctx.font = '500 76px "Cormorant Garamond"'
  const dailyLines = milestone ? [] : wrapText(ctx, 'I showed up for my skin today', 820)

  const HEADLINE_H = milestone ? 640 : 380 + dailyLines.length * 92
  const CARD_GAP = 120

  const cardX = 72
  const cardW = WIDTH - 144
  const rowH = 68
  // No cap — every product actually completed shows, not just the first
  // few. Realistic routines (even a full 8-10 step one) still fit fine;
  // the layout below is already fully dynamic on product count.
  const cardH = 250 + products.length * rowH

  const topReserved = 260
  const bottomReserved = 170
  const available = HEIGHT - topReserved - bottomReserved
  const totalContentH = HEADLINE_H + CARD_GAP + cardH
  const startY = topReserved + Math.max(0, (available - totalContentH) / 2)

  // --- headline ---
  const flameColor = flameColorForStreak(streak)

  if (milestone) {
    drawFlame(ctx, WIDTH / 2, startY + 90, 160, flameColor)

    hairline(ctx, WIDTH / 2, startY + 190, 100, p.accent)

    ctx.fillStyle = p.accent
    ctx.font = '500 30px Inter'
    ctx.letterSpacing = '6px'
    ctx.fillText('MILESTONE', WIDTH / 2, startY + 250)
    ctx.letterSpacing = '0px'

    ctx.fillStyle = p.ink
    ctx.font = '600 220px "Cormorant Garamond"'
    ctx.fillText(String(streak), WIDTH / 2, startY + 470)

    ctx.fillStyle = p.muted
    ctx.font = '500 40px Inter'
    ctx.letterSpacing = '4px'
    ctx.fillText('DAY STREAK', WIDTH / 2, startY + 550)
    ctx.letterSpacing = '0px'

    hairline(ctx, WIDTH / 2, startY + 600, 100, p.accent)
  } else {
    drawFlame(ctx, WIDTH / 2, startY + 80, 140, flameColor)

    ctx.fillStyle = p.accent
    ctx.font = '600 48px Inter'
    ctx.letterSpacing = '4px'
    ctx.fillText(`DAY ${streak}`, WIDTH / 2, startY + 200)
    ctx.letterSpacing = '0px'

    ctx.fillStyle = p.ink
    ctx.font = '500 76px "Cormorant Garamond"'
    let hy = startY + 300
    for (const line of dailyLines) {
      ctx.fillText(line, WIDTH / 2, hy)
      hy += 92
    }
  }

  // --- routine card ---
  const cardY = startY + HEADLINE_H + CARD_GAP

  ctx.fillStyle = p.cardFill
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.fill()
  ctx.strokeStyle = `rgba(${p.accentRgb},0.35)`
  ctx.lineWidth = 1.5
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = p.accent
  ctx.font = '500 26px Inter'
  ctx.letterSpacing = '3px'
  ctx.fillText(routineLabel.toUpperCase(), cardX + 56, cardY + 74)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = p.faint
  ctx.font = '500 32px Inter'
  ctx.fillText(dateLabel, cardX + 56, cardY + 128)

  hairline(ctx, cardX + cardW / 2, cardY + 175, cardW - 112, `rgba(${p.accentRgb},0.25)`)

  let rowY = cardY + 230
  for (const product of products) {
    ctx.fillStyle = p.ink
    ctx.font = '500 40px "Cormorant Garamond"'
    ctx.fillText(product.name, cardX + 56, rowY)

    if (product.category) {
      ctx.fillStyle = p.faint
      ctx.font = '500 24px Inter'
      ctx.letterSpacing = '1.5px'
      ctx.textAlign = 'right'
      ctx.fillText(product.category.toUpperCase(), cardX + cardW - 56, rowY)
      ctx.textAlign = 'left'
      ctx.letterSpacing = '0px'
    }

    rowY += rowH
  }

  // --- footer ---
  ctx.textAlign = 'center'
  hairline(ctx, WIDTH / 2, HEIGHT - 150, 60, `rgba(${p.accentRgb},0.4)`)

  ctx.fillStyle = p.faint
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '2px'
  ctx.fillText('TRACKAPLUS.APP', WIDTH / 2, HEIGHT - 96)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/**
 * A "Wrapped"-style month-to-date stat sheet, same card visually as the
 * streak share — same palette, same wordmark, same theme-awareness — just
 * a list of numbers instead of a routine.
 *
 * @param report  { monthLabel, routineCompletionPct, sunscreenDays,
 *                  productsUsed, currentStreak, longestStreak, photosAdded }
 * @param isNight whether the app itself is currently in dark mode
 * @returns Promise<Blob> PNG
 */
export async function generateSkinReportImage({ report, isNight = true }) {
  await document.fonts.load('600 64px Inter')
  await document.fonts.load('500 96px "Cormorant Garamond"')
  await document.fonts.ready

  const p = isNight ? PALETTES.dark : PALETTES.light

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const glow = ctx.createRadialGradient(WIDTH / 2, 480, 40, WIDTH / 2, 480, 640)
  glow.addColorStop(0, `rgba(${p.accentRgb},0.16)`)
  glow.addColorStop(1, `rgba(${p.accentRgb},0)`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // --- wordmark, top ---
  try {
    const icon = await loadImage('/icons/icon-192.png')
    ctx.save()
    roundRect(ctx, 72, 96, 56, 56, 14)
    ctx.clip()
    ctx.drawImage(icon, 72, 96, 56, 56)
    ctx.restore()
  } catch {
    // Icon failing to load shouldn't block the share.
  }

  ctx.fillStyle = p.ink
  ctx.font = '600 34px Inter'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('TRACKA+', 148, 124)

  // --- headline ---
  ctx.textAlign = 'center'
  ctx.fillStyle = p.accent
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '6px'
  ctx.fillText('SKIN REPORT', WIDTH / 2, 260)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = p.ink
  ctx.font = '600 84px "Cormorant Garamond"'
  ctx.fillText(report.monthLabel.toUpperCase(), WIDTH / 2, 350)

  // --- stat card ---
  const stats = [
    ['Routine completion', `${report.routineCompletionPct}%`],
    ['Sunscreen days', String(report.sunscreenDays)],
    ['Products used', String(report.productsUsed)],
    ['Current streak', `${report.currentStreak} ${report.currentStreak === 1 ? 'day' : 'days'}`],
    ['Longest streak', `${report.longestStreak} ${report.longestStreak === 1 ? 'day' : 'days'}`],
    ['Progress photos added', String(report.photosAdded)],
  ]

  const cardX = 72
  const cardW = WIDTH - 144
  const rowH = 130
  const cardY = 460
  const cardH = 60 + stats.length * rowH

  ctx.fillStyle = p.cardFill
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.fill()
  ctx.strokeStyle = `rgba(${p.accentRgb},0.35)`
  ctx.lineWidth = 1.5
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.stroke()

  let rowY = cardY + 74
  stats.forEach(([label, value], i) => {
    ctx.textAlign = 'left'
    ctx.fillStyle = p.muted
    ctx.font = '500 28px Inter'
    ctx.letterSpacing = '1px'
    ctx.fillText(label.toUpperCase(), cardX + 56, rowY)
    ctx.letterSpacing = '0px'

    ctx.textAlign = 'right'
    ctx.fillStyle = p.ink
    ctx.font = '600 52px "Cormorant Garamond"'
    ctx.fillText(value, cardX + cardW - 56, rowY + 56)

    if (i < stats.length - 1) {
      hairline(ctx, cardX + cardW / 2, rowY + 92, cardW - 112, `rgba(${p.accentRgb},0.15)`)
    }

    rowY += rowH
  })

  // --- footer ---
  ctx.textAlign = 'center'
  hairline(ctx, WIDTH / 2, HEIGHT - 150, 60, `rgba(${p.accentRgb},0.4)`)

  ctx.fillStyle = p.faint
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '2px'
  ctx.fillText('TRACKAPLUS.APP', WIDTH / 2, HEIGHT - 96)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// Draws a cup or medal from the shared shapes in core/awards.js, centred on
// (cx, cy) at `size` px across. Same artwork as the in-app icons.
function drawAward(ctx, award, cx, cy, size) {
  const metal = METALS[award.metal] || METALS.gold
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(size / 100, size / 100)

  const shine = ctx.createLinearGradient(20, 10, 80, 95)
  shine.addColorStop(0, metal.light)
  shine.addColorStop(0.45, metal.mid)
  shine.addColorStop(1, metal.dark)

  if (award.kind === 'cup') {
    ctx.strokeStyle = metal.mid
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.stroke(new Path2D(CUP_SHAPES.handles))
    ctx.fillStyle = shine
    ctx.fill(new Path2D(CUP_SHAPES.stem))
    ctx.fill(new Path2D(CUP_SHAPES.base))
    ctx.fill(new Path2D(CUP_SHAPES.bowl))
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fill(new Path2D(CUP_SHAPES.star))
    // Gloss on the bowl.
    ctx.beginPath()
    ctx.ellipse(37, 30, 3.5, 10, -0.15, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.fill()
  } else {
    ctx.fillStyle = metal.ribbon
    ctx.fill(new Path2D(MEDAL_SHAPES.ribbonLeft))
    ctx.fillStyle = darken(metal.ribbon, 0.25)
    ctx.fill(new Path2D(MEDAL_SHAPES.ribbonRight))

    ctx.beginPath()
    ctx.arc(50, 64, 30, 0, Math.PI * 2)
    ctx.fillStyle = shine
    ctx.fill()
    ctx.beginPath()
    ctx.arc(50, 64, 23, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = metal.dark
    ctx.font = '700 26px Inter'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(award.badge, 50, 65)
  }

  ctx.restore()
}

/**
 * A saveable cup/medal card — same frame as the streak share.
 *
 * @param award          one entry from challengeAwards()
 * @param challengeTitle e.g. "30 Days of SPF"
 * @param dateLabel      when it was earned
 * @param isNight        whether the app itself is currently in dark mode
 * @returns Promise<Blob> PNG
 */
export async function generateAwardImage({ award, challengeTitle, dateLabel, isNight = true }) {
  await document.fonts.load('600 64px Inter')
  await document.fonts.load('700 26px Inter')
  await document.fonts.load('500 96px "Cormorant Garamond"')
  await document.fonts.ready

  const p = isNight ? PALETTES.dark : PALETTES.light

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Warm gold glow behind the award instead of the usual blue.
  const glow = ctx.createRadialGradient(WIDTH / 2, 760, 40, WIDTH / 2, 760, 700)
  glow.addColorStop(0, 'rgba(232,185,49,0.28)')
  glow.addColorStop(1, 'rgba(232,185,49,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Rays.
  ctx.save()
  ctx.translate(WIDTH / 2, 760)
  ctx.strokeStyle = 'rgba(232,185,49,0.18)'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16)
    ctx.beginPath()
    ctx.moveTo(0, -400)
    ctx.lineTo(0, -470)
    ctx.stroke()
  }
  ctx.restore()

  try {
    const icon = await loadImage('/icons/icon-192.png')
    ctx.save()
    roundRect(ctx, 72, 96, 56, 56, 14)
    ctx.clip()
    ctx.drawImage(icon, 72, 96, 56, 56)
    ctx.restore()
  } catch {
    // Wordmark text alone is enough if the icon fails to load.
  }

  ctx.fillStyle = p.ink
  ctx.font = '600 34px Inter'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('TRACKA+', 148, 124)

  drawAward(ctx, award, WIDTH / 2, 760, award.kind === 'cup' ? 620 : 560)

  ctx.textAlign = 'center'
  hairline(ctx, WIDTH / 2, 1170, 100, '#E8B931')

  ctx.fillStyle = '#C99A1E'
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '6px'
  ctx.fillText(award.kind === 'cup' ? (award.headline || 'CHALLENGE COMPLETE') : 'MEDAL EARNED', WIDTH / 2, 1235)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = p.ink
  ctx.font = '500 92px "Cormorant Garamond"'
  let y = 1350
  for (const line of wrapText(ctx, award.kind === 'cup' ? challengeTitle : award.label, 900)) {
    ctx.fillText(line, WIDTH / 2, y)
    y += 100
  }

  ctx.fillStyle = p.muted
  ctx.font = '500 38px Inter'
  ctx.fillText(award.kind === 'cup' ? award.blurb : `${challengeTitle} · ${award.blurb}`, WIDTH / 2, y + 10)

  if (dateLabel) {
    ctx.fillStyle = p.faint
    ctx.font = '500 30px Inter'
    ctx.fillText(dateLabel, WIDTH / 2, y + 80)
  }

  hairline(ctx, WIDTH / 2, HEIGHT - 150, 60, `rgba(${p.accentRgb},0.4)`)
  ctx.fillStyle = p.faint
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '2px'
  ctx.fillText('TRACKAPLUS.APP', WIDTH / 2, HEIGHT - 96)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// Shortens a line to fit, with an ellipsis — product names can be long.
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/**
 * The Strava-style version: the person's own photo, full bleed, with the
 * streak and the routine they just finished laid over it. Same 9:16 size
 * as the plain card so it drops straight into a Story.
 *
 * @param photo        a File/Blob from the camera or photo library
 * @param streak, routineLabel, dateLabel, products — as generateStreakImage
 * @returns Promise<Blob> JPEG (photos are far smaller as JPEG than PNG)
 */
export async function generatePhotoStreakImage({ photo, streak, routineLabel, dateLabel, products }) {
  await document.fonts.load('600 64px Inter')
  await document.fonts.load('500 96px "Cormorant Garamond"')
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0C1116'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // --- photo, cover-fit (crop to fill, centred) ---
  const url = URL.createObjectURL(photo)
  try {
    const img = await loadImage(url)
    const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
  } finally {
    URL.revokeObjectURL(url)
  }

  // Shade top and bottom so white text reads on any photo.
  const top = ctx.createLinearGradient(0, 0, 0, 420)
  top.addColorStop(0, 'rgba(0,0,0,0.55)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, WIDTH, 420)

  const shown = products.slice(0, 5)
  const extra = products.length - shown.length
  const panelH = 600 + (shown.length + (extra > 0 ? 1 : 0)) * 64
  const bottom = ctx.createLinearGradient(0, HEIGHT - panelH - 260, 0, HEIGHT)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(0.35, 'rgba(0,0,0,0.55)')
  bottom.addColorStop(1, 'rgba(0,0,0,0.88)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, HEIGHT - panelH - 260, WIDTH, panelH + 260)

  // --- wordmark, top ---
  try {
    const icon = await loadImage('/icons/icon-192.png')
    ctx.save()
    roundRect(ctx, 72, 96, 56, 56, 14)
    ctx.clip()
    ctx.drawImage(icon, 72, 96, 56, 56)
    ctx.restore()
  } catch {
    // The wordmark text alone still identifies the app.
  }
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '600 34px Inter'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('TRACKA+', 148, 124)

  // --- stats, bottom-left (Strava-style) ---
  const x = 80
  let y = HEIGHT - panelH

  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = '600 28px Inter'
  ctx.letterSpacing = '4px'
  ctx.fillText(`${routineLabel.toUpperCase()} · DONE`, x, y)
  ctx.letterSpacing = '0px'

  y += 150
  drawFlame(ctx, x + 60, y, 120, flameColorForStreak(streak))
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '600 170px "Cormorant Garamond"'
  ctx.fillText(String(streak), x + 140, y + 6)
  const numW = ctx.measureText(String(streak)).width
  ctx.font = '600 34px Inter'
  ctx.letterSpacing = '3px'
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillText('DAY STREAK', x + 160 + numW, y + 34)
  ctx.letterSpacing = '0px'

  y += 130
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '500 32px Inter'
  ctx.fillText(dateLabel, x, y)

  y += 56
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillRect(x, y, WIDTH - x * 2, 2)
  y += 70

  for (const product of shown) {
    ctx.fillStyle = '#8FB8E8'
    ctx.beginPath()
    ctx.arc(x + 12, y, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '500 40px "Cormorant Garamond"'
    ctx.fillText(fitText(ctx, product.name, WIDTH - x * 2 - 260), x + 44, y)
    if (product.category) {
      ctx.textAlign = 'right'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = '500 24px Inter'
      ctx.letterSpacing = '1.5px'
      ctx.fillText(product.category.toUpperCase(), WIDTH - x, y)
      ctx.letterSpacing = '0px'
      ctx.textAlign = 'left'
    }
    y += 64
  }
  if (extra > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = '500 30px Inter'
    ctx.fillText(`+ ${extra} more ${extra === 1 ? 'step' : 'steps'}`, x + 44, y)
  }

  // --- footer ---
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '500 28px Inter'
  ctx.letterSpacing = '2px'
  ctx.fillText('TRACKAPLUS.APP', WIDTH / 2, HEIGHT - 90)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
}

/**
 * A digital certificate for a finished challenge. Landscape, A4 ratio
 * (2000x1414), always light so it prints well, whatever the app theme.
 *
 * @param name           the person's full name (or username if no name set)
 * @param challengeTitle e.g. "30 Days of SPF"
 * @param achieved       reached the goal → "of Achievement", else "of Participation"
 * @param detail         e.g. "27 of 30 days checked in · 10 Oct – 8 Nov 2026"
 * @param sponsor        optional sponsor name
 * @param issuedLabel    e.g. "8 November 2026"
 * @param certificateId  short reference printed in the corner
 * @returns Promise<Blob> PNG
 */
export async function generateCertificateImage({ name, challengeTitle, achieved, detail, sponsor, issuedLabel, certificateId }) {
  await document.fonts.load('600 40px Inter')
  await document.fonts.load('500 120px "Cormorant Garamond"')
  await document.fonts.load('italic 500 60px "Cormorant Garamond"')
  await document.fonts.ready

  const W = 2000
  const H = 1414
  const INK = '#101B2D'
  const MUTED = '#51637E'
  const GOLD = '#B98A1B'
  const GOLD_SOFT = 'rgba(185,138,27,0.35)'

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#FBF8F2'
  ctx.fillRect(0, 0, W, H)

  // Soft gold glow from the top so it doesn't look flat.
  const glow = ctx.createRadialGradient(W / 2, 0, 60, W / 2, 0, 1100)
  glow.addColorStop(0, 'rgba(232,185,49,0.14)')
  glow.addColorStop(1, 'rgba(232,185,49,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Double frame.
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 6
  ctx.strokeRect(60, 60, W - 120, H - 120)
  ctx.strokeStyle = GOLD_SOFT
  ctx.lineWidth = 2
  ctx.strokeRect(84, 84, W - 168, H - 168)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Mark: cup for achievement, medal for participation.
  drawAward(ctx, achieved
    ? { kind: 'cup', metal: 'gold', badge: '' }
    : { kind: 'medal', metal: 'gold', badge: '★' }, W / 2, 250, 190)

  ctx.fillStyle = INK
  ctx.font = '600 34px Inter'
  ctx.letterSpacing = '10px'
  ctx.fillText('TRACKA+', W / 2, 400)

  ctx.fillStyle = GOLD
  ctx.font = '600 30px Inter'
  ctx.letterSpacing = '8px'
  ctx.fillText(achieved ? 'CERTIFICATE OF ACHIEVEMENT' : 'CERTIFICATE OF PARTICIPATION', W / 2, 470)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = MUTED
  ctx.font = 'italic 500 50px "Cormorant Garamond"'
  ctx.fillText('This certifies that', W / 2, 575)

  ctx.fillStyle = INK
  let size = 130
  do {
    ctx.font = `500 ${size}px "Cormorant Garamond"`
    size -= 6
  } while (ctx.measureText(name).width > 1550 && size > 60)
  ctx.fillText(name, W / 2, 690)
  hairline(ctx, W / 2, 770, 900, GOLD_SOFT)

  ctx.fillStyle = MUTED
  ctx.font = 'italic 500 50px "Cormorant Garamond"'
  ctx.fillText(achieved ? 'successfully completed' : 'took part in', W / 2, 845)

  ctx.fillStyle = INK
  ctx.font = '500 84px "Cormorant Garamond"'
  let y = 945
  const titleLines = wrapText(ctx, challengeTitle, 1500).slice(0, 2)
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y)
    y += 90
  }

  ctx.fillStyle = MUTED
  ctx.font = '500 34px Inter'
  if (detail) ctx.fillText(detail, W / 2, y + 5)
  if (sponsor) {
    ctx.font = '500 28px Inter'
    ctx.fillText(`In partnership with ${sponsor}`, W / 2, y + 62)
  }

  // Footer: issued date (left), signature (right), reference (centre).
  const footY = H - 210
  ctx.fillStyle = INK
  ctx.font = '600 32px Inter'
  ctx.fillText(issuedLabel || '', 470, footY)
  ctx.fillText('The Tracka+ Team', W - 470, footY)
  hairline(ctx, 470, footY + 40, 380, GOLD_SOFT)
  hairline(ctx, W - 470, footY + 40, 380, GOLD_SOFT)
  ctx.fillStyle = MUTED
  ctx.font = '500 24px Inter'
  ctx.letterSpacing = '3px'
  ctx.fillText('DATE', 470, footY + 78)
  ctx.fillText('ISSUED BY', W - 470, footY + 78)
  if (certificateId) ctx.fillText(`REF ${certificateId}`, W / 2, footY + 78)
  ctx.fillText('TRACKAPLUS.APP', W / 2, footY + 2)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
