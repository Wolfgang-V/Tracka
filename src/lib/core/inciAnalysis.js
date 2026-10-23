// Breaks a product's ingredient (INCI) list down for the ingredient checker:
// what each ingredient does, which are notable actives, which are worth
// knowing about for sensitive skin, and "free-from" checks.
//
// Only checks the list itself can prove are included. Things like vegan,
// cruelty-free or reef-safe depend on sourcing and testing, not the label,
// so they're deliberately not claimed here.

import { findIngredientDetails } from './ingredientGuide.js'

// Split on top-level commas — some INCI names contain commas inside
// parentheses, e.g. "Hydrogenated Lecithin (and) Sodium Lactate, ...".
export function parseIngredientList(text) {
  if (!text) return []
  const cleaned = text
    .replace(/^\s*(ingredients|ingr[eé]dients|inci)\s*[:.-]\s*/i, '')
    .replace(/\(?\s*may contain\b[\s\S]*$/i, '') // trailing colourant lists
    .replace(/\r?\n/g, ', ')

  const parts = []
  let depth = 0
  let current = ''
  for (const ch of cleaned) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';' || ch === '•') && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)

  const seen = new Set()
  return parts
    .map((p) => p.replace(/[*.]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 1 && p.length < 120)
    .filter((p) => {
      const key = p.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// What a common ingredient does, in plain words. First match wins.
const ROLES = [
  [/^(aqua|water|eau)\b|aqua\/water/i, 'Base'],
  [/glycerin|butylene glycol|propanediol|pentylene glycol|propylene glycol|sodium hyaluronate|hyaluronic|sorbitol|urea|^betaine$|sodium pca|trehalose|panthenol/i, 'Hydrating'],
  [/ceramide|cholesterol|phytosphingosine/i, 'Barrier support'],
  [/dimethicone|siloxane|cyclopentasiloxane|methicone|silica dimethyl/i, 'Smoothing (silicone)'],
  [/squalane|caprylic\/capric|triglyceride|ester|isononanoate|isopropyl|c12-15|shea|butter|petrolatum|paraffinum|mineral oil|jojoba|seed oil|fruit oil|kernel oil/i, 'Softening'],
  [/cetearyl alcohol|cetyl alcohol|stearyl alcohol|behenyl alcohol/i, 'Texture (fatty alcohol)'],
  [/phenoxyethanol|ethylhexylglycerin|paraben|sodium benzoate|potassium sorbate|benzyl alcohol|chlorphenesin|caprylyl glycol|1,2-hexanediol|methylisothiazolinone|dehydroacetic/i, 'Preservative'],
  [/carbomer|xanthan|acrylates|acrylate|cellulose|gum\b|polyacrylate|ammonium acryloyldimethyltaurate/i, 'Thickener'],
  [/polysorbate|peg-|ceteareth|glyceryl stearate|lecithin|sorbitan|polyglyceryl|cetearyl glucoside|emulsif/i, 'Emulsifier'],
  [/sodium hydroxide|citric acid|lactic acid|triethanolamine|tromethamine|arginine|potassium hydroxide/i, 'pH balance'],
  [/edta|phytate|gluconate|etidronic/i, 'Stabiliser'],
  [/tocopher|ascorb|ferulic|resveratrol|green tea|camellia sinensis|ubiquinone|astaxanthin/i, 'Antioxidant'],
  [/zinc oxide|titanium dioxide|avobenzone|butyl methoxydibenzoylmethane|methylene bis-benzotriazolyl|bis-ethylhexyloxyphenol|octocrylene|homosalate|octisalate|oxybenzone|octinoxate|tinosorb|bemotrizinol|bisoctrizole|uvinul|ethylhexyl triazone|diethylamino hydroxybenzoyl|ensulizole|ethylhexyl methoxycinnamate|ethylhexyl salicylate/i, 'Sun filter'],
  [/allantoin|bisabolol|centella|madecassoside|asiaticoside|aloe|oat|avena|chamomil|licorice|glycyrrh|beta-glucan|zinc pca|panthenol/i, 'Soothing'],
  [/sodium lauryl sulfate|sodium laureth sulfate|cocamidopropyl|coco-glucoside|decyl glucoside|lauryl glucoside|sulfosuccinate|glutamate|isethionate/i, 'Cleansing'],
  [/parfum|fragrance|aroma/i, 'Fragrance'],
  [/limonene|linalool|citronellol|geraniol|citral|eugenol|coumarin|benzyl salicylate|benzyl benzoate|hexyl cinnamal|farnesol|isoeugenol/i, 'Fragrance component'],
  [/alcohol denat|sd alcohol|ethanol|isopropyl alcohol|^alcohol$/i, 'Solvent (alcohol)'],
  [/ci \d{5}|iron oxides|mica/i, 'Colour'],
  [/dimethyl isosorbide|ethoxydiglycol|isododecane|dipropylene glycol/i, 'Solvent'],
  [/isoceteth|steareth|laureth-\d/i, 'Emulsifier'],
  [/extract|leaf|root|flower/i, 'Plant extract'],
]

// Worth knowing for sensitive skin — not "bad", just the usual suspects.
const FLAGS = [
  [/parfum|fragrance|aroma\b/i, 'Fragrance'],
  [/limonene|linalool|citronellol|geraniol|citral|eugenol|coumarin|benzyl salicylate|hexyl cinnamal|isoeugenol|farnesol/i, 'Fragrance allergen'],
  [/alcohol denat|sd alcohol|^ethanol$|isopropyl alcohol|^alcohol$/i, 'Drying alcohol'],
  [/(lavender|lavandula|peppermint|mentha|eucalyptus|tea tree|melaleuca|citrus|lemon|orange|bergamot|rosemary|ylang|clove|cinnamon)[^,]*\boil\b/i, 'Essential oil'],
  [/sodium lauryl sulfate|ammonium lauryl sulfate/i, 'Harsh cleanser'],
  [/methylisothiazolinone|methylchloroisothiazolinone/i, 'Sensitising preservative'],
  [/oxybenzone|benzophenone-3/i, 'Sensitising filter'],
]

const FREE_FROM = [
  { key: 'fragrance', label: 'Fragrance-free', test: /parfum|fragrance|aroma\b|limonene|linalool|citronellol|geraniol|citral|eugenol|coumarin|hexyl cinnamal/i },
  { key: 'alcohol', label: 'Drying-alcohol-free', test: /alcohol denat|sd alcohol|^ethanol$|isopropyl alcohol|^alcohol$/i },
  { key: 'essentialOil', label: 'Essential-oil-free', test: /(lavender|lavandula|peppermint|mentha|eucalyptus|tea tree|melaleuca|citrus|lemon|orange|bergamot|rosemary|ylang|clove|cinnamon)[^,]*\boil\b/i },
  { key: 'paraben', label: 'Paraben-free', test: /paraben/i },
  { key: 'sulfate', label: 'Sulfate-free', test: /lauryl sulfate|laureth sulfate|ammonium lauryl sulfate/i },
  { key: 'silicone', label: 'Silicone-free', test: /dimethicone|siloxane|methicone|cone\b/i },
]

// Label (INCI) names that mean an ingredient the guide knows by its
// everyday name.
const GUIDE_ALIASES = [
  [/sodium hyaluronate|hydrolyzed hyaluronic|hyaluronic/i, 'Hyaluronic Acid'],
  [/ascorbyl glucoside|sodium ascorbyl phosphate|ascorbic acid|ethyl ascorbic/i, 'L-Ascorbic Acid (Vitamin C)'],
  [/centella asiatica|madecassoside|asiaticoside/i, 'Centella Asiatica'],
  [/snail secretion filtrate/i, 'Snail mucin'],
  [/acetyl glucosamine/i, 'N-Acetyl Glucosamine (NAG)'],
]

// Supporting ingredients that do something good for skin — counted as
// "helpful" in the breakdown, though they aren't headline actives.
const HELPFUL_ROLES = new Set(['Hydrating', 'Barrier support', 'Soothing', 'Antioxidant', 'Sun filter'])

export function analyzeIngredients(text) {
  const names = parseIngredientList(text)

  const items = names.map((name, index) => {
    const alias = GUIDE_ALIASES.find(([re]) => re.test(name))?.[1]
    const guide = findIngredientDetails(alias || name)
    const flag = FLAGS.find(([re]) => re.test(name))?.[1] || null
    const role = ROLES.find(([re]) => re.test(name))?.[1] || guide?.class || null
    // Known active > flagged > helpful supporting ingredient > base.
    const tone = guide ? 'active' : flag ? 'flag' : HELPFUL_ROLES.has(role) ? 'helpful' : 'neutral'
    return { name, index, role: guide?.class || role || flag, tone, flag, guide }
  })

  const freeFrom = FREE_FROM.map((f) => ({
    key: f.key,
    label: f.label,
    ok: !names.some((n) => f.test.test(n)),
  }))

  const count = (tone) => items.filter((i) => i.tone === tone).length
  return {
    items,
    freeFrom,
    composition: {
      active: count('active'),
      helpful: count('helpful'),
      flag: count('flag'),
      neutral: count('neutral'),
      total: items.length,
    },
  }
}
