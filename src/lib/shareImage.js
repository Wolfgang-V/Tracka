// Renders a shareable streak card to a PNG blob, sized for Instagram
// Stories (1080x1920 = 9:16). Pure canvas — no dependency, since this only
// needs to run once per share tap, not on every render.
//
// Its own dark, editorial layout rather than the app's own light chrome —
// this is the one surface meant to be looked at as an image on its own,
// outside the app — but the accent is the same brand blue the app itself
// uses in dark mode (nightPalette.mark), so it still reads as Tracka+.

import { flameColorForStreak, FLAME_PATH } from './core/flameColor'

const WIDTH = 1080
const HEIGHT = 1920

const ACCENT = '#8FB8E8'
const ACCENT_RGB = '143,184,232'
const INK = '#F3EFE8'
const MUTED = '#9AA3AD'
const FAINT = '#5B6570'

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

function hairline(ctx, centerX, y, width, color = ACCENT) {
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

function drawFlame(ctx, centerX, centerY, size, color) {
  ctx.save()
  ctx.translate(centerX - size / 2, centerY - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.fillStyle = color
  ctx.fill(flamePath)
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
 * @returns Promise<Blob> PNG
 */
export async function generateStreakImage({ streak, routineLabel, dateLabel, products }) {
  await document.fonts.load('600 64px Inter')
  await document.fonts.load('500 96px "Cormorant Garamond"')
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')

  // Background — deep ink rather than flat navy, with a soft glow in the
  // brand blue rising behind where the headline sits, instead of a hard
  // gradient band.
  ctx.fillStyle = '#0C1116'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const glow = ctx.createRadialGradient(WIDTH / 2, 620, 40, WIDTH / 2, 620, 640)
  glow.addColorStop(0, `rgba(${ACCENT_RGB},0.16)`)
  glow.addColorStop(1, `rgba(${ACCENT_RGB},0)`)
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

  ctx.fillStyle = INK
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

  const HEADLINE_H = milestone ? 600 : 300 + dailyLines.length * 92
  const CARD_GAP = 120

  const cardX = 72
  const cardW = WIDTH - 144
  const rowH = 68
  const listedProducts = products.slice(0, 6)
  const overflow = products.length - listedProducts.length
  const cardH = 250 + listedProducts.length * rowH + (overflow > 0 ? rowH : 0)

  const topReserved = 260
  const bottomReserved = 170
  const available = HEIGHT - topReserved - bottomReserved
  const totalContentH = HEADLINE_H + CARD_GAP + cardH
  const startY = topReserved + Math.max(0, (available - totalContentH) / 2)

  // --- headline ---
  const flameColor = flameColorForStreak(streak)

  if (milestone) {
    drawFlame(ctx, WIDTH / 2, startY + 70, 120, flameColor)

    hairline(ctx, WIDTH / 2, startY + 150, 100)

    ctx.fillStyle = ACCENT
    ctx.font = '500 30px Inter'
    ctx.letterSpacing = '6px'
    ctx.fillText('MILESTONE', WIDTH / 2, startY + 210)
    ctx.letterSpacing = '0px'

    ctx.fillStyle = INK
    ctx.font = '600 220px "Cormorant Garamond"'
    ctx.fillText(String(streak), WIDTH / 2, startY + 430)

    ctx.fillStyle = MUTED
    ctx.font = '500 40px Inter'
    ctx.letterSpacing = '4px'
    ctx.fillText('DAY STREAK', WIDTH / 2, startY + 510)
    ctx.letterSpacing = '0px'

    hairline(ctx, WIDTH / 2, startY + 560, 100)
  } else {
    drawFlame(ctx, WIDTH / 2, startY + 50, 80, flameColor)

    ctx.fillStyle = ACCENT
    ctx.font = '500 28px Inter'
    ctx.letterSpacing = '6px'
    ctx.fillText(`DAY ${streak}`, WIDTH / 2, startY + 140)
    ctx.letterSpacing = '0px'

    ctx.fillStyle = INK
    ctx.font = '500 76px "Cormorant Garamond"'
    let hy = startY + 240
    for (const line of dailyLines) {
      ctx.fillText(line, WIDTH / 2, hy)
      hy += 92
    }
  }

  // --- routine card ---
  const cardY = startY + HEADLINE_H + CARD_GAP

  ctx.fillStyle = 'rgba(243,239,232,0.04)'
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.fill()
  ctx.strokeStyle = `rgba(${ACCENT_RGB},0.35)`
  ctx.lineWidth = 1.5
  roundRect(ctx, cardX, cardY, cardW, cardH, 8)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = ACCENT
  ctx.font = '500 26px Inter'
  ctx.letterSpacing = '3px'
  ctx.fillText(routineLabel.toUpperCase(), cardX + 56, cardY + 74)
  ctx.letterSpacing = '0px'

  ctx.fillStyle = FAINT
  ctx.font = '500 32px Inter'
  ctx.fillText(dateLabel, cardX + 56, cardY + 128)

  hairline(ctx, cardX + cardW / 2, cardY + 175, cardW - 112, `rgba(${ACCENT_RGB},0.25)`)

  let rowY = cardY + 230
  for (const product of listedProducts) {
    ctx.fillStyle = INK
    ctx.font = '500 40px "Cormorant Garamond"'
    ctx.fillText(product.name, cardX + 56, rowY)

    if (product.category) {
      ctx.fillStyle = FAINT
      ctx.font = '500 24px Inter'
      ctx.letterSpacing = '1.5px'
      ctx.textAlign = 'right'
      ctx.fillText(product.category.toUpperCase(), cardX + cardW - 56, rowY)
      ctx.textAlign = 'left'
      ctx.letterSpacing = '0px'
    }

    rowY += rowH
  }

  if (overflow > 0) {
    ctx.fillStyle = ACCENT
    ctx.font = '500 30px Inter'
    ctx.fillText(`+ ${overflow} more`, cardX + 56, rowY)
  }

  // --- footer ---
  ctx.textAlign = 'center'
  hairline(ctx, WIDTH / 2, HEIGHT - 150, 60, `rgba(${ACCENT_RGB},0.4)`)

  ctx.fillStyle = FAINT
  ctx.font = '500 30px Inter'
  ctx.letterSpacing = '2px'
  ctx.fillText('TRACKAPLUS.APP', WIDTH / 2, HEIGHT - 96)
  ctx.letterSpacing = '0px'

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
