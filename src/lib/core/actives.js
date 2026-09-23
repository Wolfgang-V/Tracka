// Works out what a product actually is, from its name, brand and category.
// Guessed rather than asked, so users never have to answer chemistry questions.
// Anything guessed wrong can be corrected later and stored on the step.

export const ACTIVES = {
  RETINOID: 'retinoid',
  AHA: 'aha',
  BHA: 'bha',
  VITAMIN_C: 'vitaminC',
  BENZOYL_PEROXIDE: 'benzoylPeroxide',
  NIACINAMIDE: 'niacinamide',
  AZELAIC: 'azelaic',
  NONE: 'none',
}

// Friendly names for the notes shown to users
export const ACTIVE_LABELS = {
  [ACTIVES.RETINOID]: 'retinol',
  [ACTIVES.AHA]: 'an exfoliating acid',
  [ACTIVES.BHA]: 'salicylic acid',
  [ACTIVES.VITAMIN_C]: 'vitamin C',
  [ACTIVES.BENZOYL_PEROXIDE]: 'benzoyl peroxide',
  [ACTIVES.NIACINAMIDE]: 'niacinamide',
  [ACTIVES.AZELAIC]: 'azelaic acid',
  [ACTIVES.NONE]: 'nothing active',
}

export const activeLabel = (active) => ACTIVE_LABELS[active] || 'an active'

// Order matters: the strongest, most specific match wins.
// Retinoids are checked first so "Retinol Cleanser" is treated as a retinoid.
const PATTERNS = [
  [ACTIVES.RETINOID, [
    'retinol', 'retinal', 'retinaldehyde', 'retinoid', 'retinyl',
    'tretinoin', 'adapalene', 'differin', 'granactive',
  ]],
  [ACTIVES.BENZOYL_PEROXIDE, ['benzoyl peroxide', 'benzoyl', 'bpo']],
  [ACTIVES.BHA, ['salicylic', 'beta hydroxy', 'bha']],
  [ACTIVES.AHA, [
    'glycolic', 'lactic acid', 'mandelic', 'alpha hydroxy', 'aha',
    'exfoliant', 'exfoliating', 'exfoliator', 'chemical peel', 'peeling',
  ]],
  [ACTIVES.VITAMIN_C, ['vitamin c', 'ascorbic', 'ascorbate', 'l-aa']],
  [ACTIVES.AZELAIC, ['azelaic']],
  [ACTIVES.NIACINAMIDE, ['niacinamide']],
]

// Short tokens like "aha" need word boundaries, or a brand name
// such as "Mahalo" would match them.
const matches = (text, word) =>
  word.length <= 3
    ? new RegExp(`\\b${word}\\b`, 'i').test(text)
    : text.includes(word)

export function detectActive(product = {}) {
  // ingredients (when we have them) go first — an INCI list naming
  // "Retinol" or "Salicylic Acid" is more reliable than a product name
  // that doesn't mention its actives at all.
  const text = [product.ingredients, product.name, product.brand, product.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!text.trim()) return ACTIVES.NONE

  for (const [active, keywords] of PATTERNS) {
    if (keywords.some((word) => matches(text, word))) return active
  }

  return ACTIVES.NONE
}

// Thin to thick. Decides the order steps are shown in, regardless of
// the order the user happened to add them.
export const SLOT_ORDER = {
  cleanser: 1,
  toner: 2,
  essence: 3,
  exfoliant: 4,
  serum: 5,
  treatment: 6,
  mask: 7,
  moisturizer: 8,
  oil: 9,
  other: 9,
  sunscreen: 10,
}

export const slotRank = (category) =>
  SLOT_ORDER[String(category || 'other').toLowerCase()] ?? 9