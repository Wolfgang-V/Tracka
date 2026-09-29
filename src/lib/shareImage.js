// Renders a shareable streak card to a PNG blob, sized for Instagram
// Stories (1080x1920 = 9:16). Pure canvas — no dependency, since this only
// needs to run once per share tap, not on every render.
//
// Follows the app's own light/dark preference (isNight) rather than a
// fixed look — someone who prefers the app in light mode gets a light
// share card too, not a surprise dark one.

import { flameColorForStreak, FLAME_PATH } from './core/flameColor'

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

const MILESTONES = [7, 14, 30, 60, 90, 100, 180, 365]

export function isMilestoneStreak(streak) {
  return MILESTONES.includes(streak)
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

function lighten(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `rgb(${lr},${lg},${lb})`
}

function darken(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`
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
