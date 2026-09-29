// Renders a shareable streak card to a PNG blob, sized for Instagram
// Stories (1080x1920 = 9:16). Pure canvas — no dependency, since this only
// needs to run once per share tap, not on every render.

const WIDTH = 1080
const HEIGHT = 1920

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

  // Background — same navy the app's own dark mode uses.
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  bg.addColorStop(0, '#0B1E33')
  bg.addColorStop(1, '#132A46')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const milestone = isMilestoneStreak(streak)

  // --- wordmark, top ---
  try {
    const icon = await loadImage('/icons/icon-192.png')
    ctx.save()
    roundRect(ctx, 72, 96, 64, 64, 16)
    ctx.clip()
    ctx.drawImage(icon, 72, 96, 64, 64)
    ctx.restore()
  } catch {
    // Icon failing to load shouldn't block the share — the wordmark text
    // alone is enough to identify the app.
  }

  ctx.fillStyle = '#EDF2FA'
  ctx.font = '600 40px Inter'
  ctx.textBaseline = 'middle'
  ctx.fillText('Tracka+', 152, 128)

  // --- lay out the headline + card as one group, centered in the space
  // between the logo and the footer, instead of pinning both to fixed
  // coordinates — a short product list used to leave a dead gap above the
  // footer, and a long one risked crowding the card against it. ---
  ctx.textAlign = 'center'
  ctx.font = '500 84px "Cormorant Garamond"'
  const dailyLines = milestone ? [] : wrapText(ctx, 'I showed up for my skin today', 860)

  const HEADLINE_H = milestone ? 420 : 130 + dailyLines.length * 96
  const CARD_GAP = 110

  const cardX = 72
  const cardW = WIDTH - 144
  const rowH = 64
  const listedProducts = products.slice(0, 6)
  const overflow = products.length - listedProducts.length
  const cardH = 240 + listedProducts.length * rowH + (overflow > 0 ? rowH : 0)

  const topReserved = 260
  const bottomReserved = 160
  const available = HEIGHT - topReserved - bottomReserved
  const totalContentH = HEADLINE_H + CARD_GAP + cardH
  const startY = topReserved + Math.max(0, (available - totalContentH) / 2)

  // --- headline ---
  if (milestone) {
    ctx.font = '160px Inter'
    ctx.fillText('🔥', WIDTH / 2, startY + 130)

    ctx.fillStyle = '#EDF2FA'
    ctx.font = '600 96px "Cormorant Garamond"'
    ctx.fillText(`${streak} Day Streak`, WIDTH / 2, startY + 270)

    ctx.fillStyle = '#8FB8E8'
    ctx.font = '500 44px Inter'
    ctx.fillText('unlocked', WIDTH / 2, startY + 340)
  } else {
    ctx.fillStyle = '#EDF2FA'
    ctx.font = '500 84px "Cormorant Garamond"'
    let hy = startY + 70
    for (const line of dailyLines) {
      ctx.fillText(line, WIDTH / 2, hy)
      hy += 96
    }

    ctx.fillStyle = '#8FB8E8'
    ctx.font = '500 44px Inter'
    ctx.fillText(`${streak} day streak`, WIDTH / 2, hy + 24)
  }

  // --- routine card ---
  const cardY = startY + HEADLINE_H + CARD_GAP

  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  roundRect(ctx, cardX, cardY, cardW, cardH, 32)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 2
  roundRect(ctx, cardX, cardY, cardW, cardH, 32)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = '#EDF2FA'
  ctx.font = '600 48px Inter'
  ctx.fillText(routineLabel, cardX + 56, cardY + 80)

  ctx.fillStyle = '#9AAFC9'
  ctx.font = '500 36px Inter'
  ctx.fillText(dateLabel, cardX + 56, cardY + 140)

  let rowY = cardY + 210
  ctx.font = '500 38px Inter'
  for (const product of listedProducts) {
    ctx.fillStyle = '#EDF2FA'
    ctx.fillText(product.name, cardX + 56, rowY)

    if (product.category) {
      ctx.fillStyle = '#5F7593'
      ctx.font = '500 30px Inter'
      ctx.textAlign = 'right'
      ctx.fillText(product.category, cardX + cardW - 56, rowY)
      ctx.textAlign = 'left'
      ctx.font = '500 38px Inter'
    }

    rowY += rowH
  }

  if (overflow > 0) {
    ctx.fillStyle = '#8FB8E8'
    ctx.font = '500 34px Inter'
    ctx.fillText(`+${overflow} more`, cardX + 56, rowY)
  }

  // --- footer ---
  ctx.textAlign = 'center'
  ctx.fillStyle = '#5F7593'
  ctx.font = '500 34px Inter'
  ctx.fillText('trackaplus.app', WIDTH / 2, HEIGHT - 96)

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
