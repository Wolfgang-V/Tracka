// Open Beauty Facts (openbeautyfacts.org) — free, public, no API key,
// CORS-open. Legacy search endpoint (not the newer search-a-licious one,
// which has no dedicated beauty deployment yet).
const SEARCH_URL = 'https://world.openbeautyfacts.org/cgi/search.pl'

// categories comes back as a messy comma-separated, mixed-language,
// hierarchical string, e.g. "nl:Beauty, nl:Skincare, fr:Sunscreen" —
// take the most specific (last) tag and strip its language prefix.
function cleanCategory(raw) {
  if (!raw) return ''
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  return last.replace(/^[a-z]{2}:/i, '').replace(/-/g, ' ').trim()
}

export async function searchBrands(query) {
  const term = query.trim()
  if (!term) return []

  const url = `${SEARCH_URL}?search_terms=${encodeURIComponent(term)}&json=1&page_size=20&fields=brands`

  const res = await fetch(url)
  if (!res.ok) return []

  const data = await res.json()
  const names = new Set()

  for (const product of data.products || []) {
    for (const brand of (product.brands || '').split(',')) {
      const trimmed = brand.trim()
      if (trimmed && trimmed.toLowerCase().includes(term.toLowerCase())) {
        names.add(trimmed)
      }
    }
  }

  return [...names]
}

export async function searchProducts(brand, query) {
  const terms = [brand, query].filter(Boolean).join(' ').trim()
  if (!terms) return []

  const fields = 'code,product_name,brands,categories,ingredients_text_en,ingredients_text'
  const url = `${SEARCH_URL}?search_terms=${encodeURIComponent(terms)}&json=1&page_size=10&fields=${fields}`

  const res = await fetch(url)
  if (!res.ok) return []

  const data = await res.json()

  return (data.products || [])
    .filter((p) => p.product_name)
    .map((p) => ({
      code: p.code,
      name: p.product_name,
      brand: (p.brands || '').split(',')[0]?.trim() || brand,
      category: cleanCategory(p.categories),
      ingredients: p.ingredients_text_en || p.ingredients_text || '',
    }))
}
