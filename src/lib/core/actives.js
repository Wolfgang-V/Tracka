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
  const text = [product.name, product.brand, product.category]
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
  exfoliant: 3,
  serum: 4,
  treatment: 5,
  mask: 6,
  moisturizer: 7,
  oil: 8,
  other: 8,
  sunscreen: 9,
}

export const slotRank = (category) =>
  SLOT_ORDER[String(category || 'other').toLowerCase()] ?? 8