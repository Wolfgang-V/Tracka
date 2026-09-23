// Works out what a product actually is.
//
// Two sources, treated differently:
//  - The NAME is trusted broadly. Anything called "Retinol Serum" is a retinoid.
//  - The INGREDIENT LIST is scanned only for strong, unambiguous actives.
//    Lists are full of trace ingredients — lactic acid as a pH adjuster,
//    retinyl palmitate at a fraction of a percent — that don't behave like
//    the real thing. Counting those would schedule ordinary moisturisers
//    as treatments.
//
// Ingredient lists are ignored for cleansers entirely: they're on the skin
// for thirty seconds and rinsed off.

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

// Checked against name, brand and category. Order matters: first match wins.
const NAME_PATTERNS = [
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

// Checked against the ingredient list. Deliberately narrow.
const INGREDIENT_PATTERNS = [
  [ACTIVES.RETINOID, [
    'retinol', 'retinaldehyde', 'retinal,', 'tretinoin', 'adapalene',
    'hydroxypinacolone retinoate',
  ]],
  [ACTIVES.BENZOYL_PEROXIDE, ['benzoyl peroxide']],
  [ACTIVES.BHA, ['salicylic acid']],
  [ACTIVES.AHA, ['glycolic acid', 'mandelic acid']],
  [ACTIVES.VITAMIN_C, [
    'ascorbic acid', 'ethyl ascorbic acid', 'tetrahexyldecyl ascorbate',
  ]],
  [ACTIVES.AZELAIC, ['azelaic acid']],
]

const matches = (text, word) =>
  word.length <= 3
    ? new RegExp(`\\b${word}\\b`, 'i').test(text)
    : text.includes(word)

const firstMatch = (text, patterns) => {
  for (const [active, keywords] of patterns) {
    if (keywords.some((word) => matches(text, word))) return active
  }
  return null
}

export function detectActive(product = {}) {
  const nameText = [product.name, product.brand, product.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const fromName = nameText.trim() ? firstMatch(nameText, NAME_PATTERNS) : null
  if (fromName) return fromName

  const isCleanser = String(product.category || '').toLowerCase() === 'cleanser'
  const ingredients = String(product.ingredients || '').toLowerCase()

  if (ingredients && !isCleanser) {
    // trailing comma lets 'retinal,' match "Retinal, Glycerin" but not "Retinaldehyde"
    const fromIngredients = firstMatch(`${ingredients},`, INGREDIENT_PATTERNS)
    if (fromIngredients) return fromIngredients
  }

  return ACTIVES.NONE
}

// Thin to thick.
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
