// A sponsored product's page, opened from its ad ("Explore product").
// Always labelled as sponsored. "Shop now" goes to the brand's own shop;
// "Add to My Products" pre-fills the add form so the person can save it.
// Both are counted for the brand's report (once per person).

import { useMemo, useState } from 'react'
import { detectKnownIngredients } from '../lib/core/ingredientGuide'

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function SponsoredProductScreen({ ad, t, isNight, backLabel, onBack, onShop, onAddProduct }) {
  const product = ad?.product || {}
  const [allIngredients, setAllIngredients] = useState(false)
  const known = useMemo(() => detectKnownIngredients(product.ingredients), [product.ingredients])
  const shopHost = hostOf(product.shop_url)

  const card = `rounded-3xl border p-5 ${t.surface} ${
    isNight ? 'border-white/10' : 'border-[#1463F4]/[0.08] shadow-[0_8px_22px_-18px_rgba(20,99,244,0.45)]'
  }`
  const label = `text-[12px] font-semibold uppercase tracking-[0.12em] ${t.faint}`

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-36 pt-7">
        <button type="button" onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {backLabel}
        </button>

        {/* Hero */}
        <div className="relative mt-4 overflow-hidden rounded-[28px] bg-gradient-to-b from-[#EEF3FA] to-[#D9E2EE]">
          {ad.image_url ? (
            <img src={ad.image_url} alt={product.name || ad.headline} className="aspect-[4/5] w-full object-cover" />
          ) : (
            <div className="aspect-[4/5] w-full" />
          )}
          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 backdrop-blur">
            Sponsored
          </span>
          {shopHost && (
            <span className="absolute bottom-4 left-4 rounded-full bg-black/55 px-3 py-1 text-[12px] font-medium text-white backdrop-blur">
              {shopHost}
            </span>
          )}
        </div>

        <p className={`mt-6 text-[13px] font-semibold uppercase tracking-[0.14em] ${t.mark}`}>{ad.brand}</p>
        <h1 className="mt-1 font-display text-[34px] font-light leading-[1.05] tracking-tight">{product.name}</h1>
        {product.category && <p className={`mt-2 text-[14px] ${t.muted}`}>{product.category}</p>}
        <p className="mt-4 text-[17px] font-semibold leading-snug">{ad.headline}</p>
        {ad.body && <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>{ad.body}</p>}

        <div className="mt-6 flex flex-col gap-3">
          {product.about && (
            <section className={card}>
              <h2 className="text-[16px] font-semibold">About this product</h2>
              <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>{product.about}</p>
            </section>
          )}

          {product.how_to_use && (
            <section className={card}>
              <h2 className="text-[16px] font-semibold">How to use</h2>
              <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>{product.how_to_use}</p>
            </section>
          )}

          {product.cautions?.length > 0 && (
            <section className={card}>
              <h2 className="text-[16px] font-semibold">Caution</h2>
              <ul className={`mt-2 space-y-1.5 text-[15px] leading-relaxed ${t.muted}`}>
                {product.cautions.map((c) => (
                  <li key={c} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {product.ingredients && (
            <section className={card}>
              <h2 className="text-[16px] font-semibold">Ingredients</h2>
              {known.length > 0 && (
                <>
                  <p className={`mt-3 ${label}`}>Key ingredients</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {known.map((name) => (
                      <span key={name} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                        isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-[#1463F4]/10 text-[#1463F4]'
                      }`}>
                        {name}
                      </span>
                    ))}
                  </div>
                  <p className={`mt-4 ${label}`}>Full list</p>
                </>
              )}
              <p className={`mt-2 text-[14px] leading-relaxed ${t.muted} ${allIngredients ? '' : 'line-clamp-4'}`}>
                {product.ingredients}
              </p>
              {product.ingredients.length > 200 && (
                <button
                  type="button"
                  onClick={() => setAllIngredients(!allIngredients)}
                  className={`mt-3 w-full rounded-full border py-3 text-[14px] font-semibold ${t.hair}`}
                >
                  {allIngredients ? 'Show less' : 'View all ingredients'}
                </button>
              )}
            </section>
          )}

          <section className={card}>
            <h2 className="text-[16px] font-semibold">Add to your skincare collection</h2>
            <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>
              Want to include this {product.category ? product.category.toLowerCase() : 'product'} in your routine? Save it to your Tracka+ products.
            </p>
            <button
              type="button"
              onClick={onAddProduct}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] py-3.5 text-[15px] font-semibold ${
                isNight ? 'border-[#5B8CFF] text-[#8DB4FF]' : 'border-[#1463F4] text-[#1463F4]'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v8M8 12h8" />
              </svg>
              Add to My Products
            </button>
          </section>

          <p className={`px-1 text-[12px] leading-relaxed ${t.faint}`}>
            Sponsored by {ad.brand}. Product details are provided by the brand.
          </p>
        </div>
      </div>

      {/* Shop now stays in reach while reading. */}
      {product.shop_url && (
        <div className={`fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-md border-t px-6 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 ${t.surface} ${t.hair}`}>
          <button
            type="button"
            onClick={onShop}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B4FD6] py-4 text-[16px] font-bold text-white shadow-[0_12px_28px_-14px_rgba(11,79,214,0.9)]"
          >
            Shop now
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </button>
          {shopHost && <p className={`mt-1.5 text-center text-[11.5px] ${t.faint}`}>Opens {shopHost}</p>}
        </div>
      )}
    </main>
  )
}
