// Single source of truth for "is this product expired?", shared by the
// Today planner (planNight), the product page and the product lists so
// they can never disagree.
//
// Three signals; expired is whichever fires first:
//   1. marked_expired_at — the person said it's gone off (always wins)
//   2. expiry_date       — the date printed on the pack
//   3. opened_date + pao_months — period-after-opening
// Dates are 'YYYY-MM-DD' strings compared against `today` in the same form
// (the app's 4am-cutoff local date).

// Own copy (same as planNight's) so planNight can import this file without
// a circular import.
const addMonths = (dateString, amount) => {
  const [y, m, d] = dateString.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + amount, d)).toISOString().slice(0, 10)
}

const dayNumber = (dateString) => Math.round(Date.parse(`${dateString}T00:00:00Z`) / 86400000)

export function productExpiry(product, today) {
  if (!product) return null

  if (product.marked_expired_at) {
    const markedOn = String(product.marked_expired_at).slice(0, 10)
    return {
      marked: true,
      expired: true,
      expiresOn: markedOn,
      daysLeft: Math.min(0, dayNumber(markedOn) - dayNumber(today)),
    }
  }

  const paoDate =
    product.opened_date && product.pao_months
      ? addMonths(product.opened_date, product.pao_months)
      : null
  const printedDate = product.expiry_date || null

  if (!paoDate && !printedDate) return null

  // Whichever comes sooner is the real use-by date — PAO only starts once
  // opened, but a printed date applies regardless.
  const expiresOn = paoDate && printedDate ? (paoDate < printedDate ? paoDate : printedDate) : paoDate || printedDate
  const daysLeft = dayNumber(expiresOn) - dayNumber(today)

  return { marked: false, expired: daysLeft <= 0, expiresOn, daysLeft }
}
