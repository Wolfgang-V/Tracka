// Add product — search the catalogue or add your own, with expiry details.
// Moved out of App.jsx; shared state comes in as props for now.

import { addMonths, localDateString } from '../lib/core/planNight'
import { searchNigerianBrands } from '../lib/core/nigerianProducts'
import { BRANDS } from '../lib/core/brands'
import { supabase } from '../lib/supabase'
import { addProductToHeldDraft } from '../lib/core/routineDraft'

export default function AddProductScreen({
  PRODUCT_SUGGESTIONS_ENABLED,
  addProductReturnScreen,
  brandSuggestionsOpen,
  guessCategory,
  isNight,
  liveBrandMatches,
  liveProductMatches,
  notify,
  productBrand,
  productCategory,
  productExpiryDate,
  productImageUrl,
  productIngredients,
  productName,
  productOpenedDate,
  productPaoMonths,
  productSaving,
  productSuggestionsOpen,
  reloadProducts,
  setBrandSuggestionsOpen,
  setProductBrand,
  setProductCategory,
  setProductExpiryDate,
  setProductImageUrl,
  setProductIngredients,
  setProductName,
  setProductOpenedDate,
  setProductPaoMonths,
  setProductSaving,
  setProductSuggestionsOpen,
  setScreen,
  t,
}) {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen(addProductReturnScreen)}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {addProductReturnScreen === 'routinePlanner' ? 'Edit routine' : 'Products'}
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Add a product
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Add a skincare product you already own.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">

          <div className="relative">
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Brand
            </label>

            <input
              type="text"
              placeholder="Search or type a brand"
              value={productBrand}
              onChange={(e) => {
                setProductBrand(e.target.value)
                setBrandSuggestionsOpen(true)
              }}
              onFocus={() => setBrandSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setBrandSuggestionsOpen(false), 150)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            {PRODUCT_SUGGESTIONS_ENABLED && brandSuggestionsOpen && productBrand.trim() && (() => {
              const merged = searchNigerianBrands(productBrand)

              for (const brand of BRANDS) {
                if (
                  brand.toLowerCase().includes(productBrand.trim().toLowerCase()) &&
                  !merged.some((m) => m.toLowerCase() === brand.toLowerCase())
                ) {
                  merged.push(brand)
                }
              }

              for (const brand of liveBrandMatches) {
                if (!merged.some((m) => m.toLowerCase() === brand.toLowerCase())) {
                  merged.push(brand)
                }
              }
              const matches = merged.slice(0, 8)

              if (matches.length === 0) {
                return (
                  <div className={`absolute z-10 mt-1 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 shadow-lg`}>
                    <p className={`text-[13px] ${t.muted}`}>
                      Can't find "{productBrand.trim()}"? Save it as a new brand.
                    </p>
                  </div>
                )
              }

              return (
                <div className={`absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border ${t.hair} ${t.surface} shadow-lg`}>
                  {matches.map((brand) => (
                    <button
                      key={brand}
                      type="button"
                      onMouseDown={() => {
                        setProductBrand(brand)
                        setBrandSuggestionsOpen(false)
                      }}
                      className={`block w-full px-4 py-2.5 text-left text-[14px] ${t.muted}`}
                    >
                      {brand}
                    </button>
                  ))}
                </div>
              )
            })()}

            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              Type the brand name.
            </p>
          </div>

          <div className="relative">
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Product name
            </label>

            <input
              type="text"
              placeholder="e.g. Hydrating Cleanser"
              value={productName}
              onChange={(e) => {
                setProductName(e.target.value)
                setProductIngredients('')
                setProductImageUrl('')
                setProductSuggestionsOpen(true)
              }}
              onFocus={() => setProductSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setProductSuggestionsOpen(false), 150)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            {PRODUCT_SUGGESTIONS_ENABLED && productSuggestionsOpen && productBrand.trim() && liveProductMatches.length > 0 && (
              <div className={`absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border ${t.hair} ${t.surface} shadow-lg`}>
                {liveProductMatches.slice(0, 8).map((match) => (
                  <button
                    key={match.code}
                    type="button"
                    onMouseDown={() => {
                      setProductName(match.name)
                      const guessed = guessCategory(match.category)
                      if (guessed) setProductCategory(guessed)
                      setProductIngredients(match.ingredients || '')
                      setProductImageUrl(match.image || '')
                      setProductSuggestionsOpen(false)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    {match.image ? (
                      <img
                        src={match.image}
                        alt=""
                        loading="lazy"
                        className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain"
                      />
                    ) : (
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold uppercase ${
                        isNight ? 'bg-white/5' : 'bg-[#101B2D]/5'
                      } ${t.faint}`}>
                        {(match.brand || match.name || '?').slice(0, 2)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{match.name}</span>
                      <span className={`block truncate text-[12px] capitalize ${t.faint}`}>
                        {[match.brand, match.category].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {PRODUCT_SUGGESTIONS_ENABLED && productSuggestionsOpen && productBrand.trim() && productName.trim() && liveProductMatches.length === 0 && (
              <div className={`absolute z-10 mt-1 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 shadow-lg`}>
                <p className={`text-[13px] ${t.muted}`}>
                  Can't find "{productName.trim()}"? Save it as a new product.
                </p>
              </div>
            )}

            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              Type the product name.
            </p>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Category
            </label>

            <select
              value={productCategory}
              onChange={(e) => setProductCategory(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            >
              <option value="">Select a category</option>
              <option value="cleanser">Cleanser</option>
              <option value="toner">Toner</option>
              <option value="essence">Essence</option>
              <option value="serum">Serum</option>
              <option value="treatment">Treatment</option>
              <option value="moisturizer">Moisturizer</option>
              <option value="body_wash">Body wash</option>
              <option value="body_moisturizer">Body moisturizer</option>
              <option value="body_oil">Body oil</option>
              <option value="body_scrub">Body scrub</option>
              <option value="sunscreen">Sunscreen</option>
              <option value="exfoliant">Exfoliant</option>
              <option value="mask">Mask</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Opened date
            </label>

            <input
              type="date"
              value={productOpenedDate}
              onChange={(e) => setProductOpenedDate(e.target.value)}
              min={addMonths(localDateString(), -120)}
              max={localDateString()}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Expiry date
            </label>

            <input
              type="date"
              value={productExpiryDate}
              onChange={(e) => setProductExpiryDate(e.target.value)}
              min={localDateString()}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Use within (after opening)
            </label>

            <div className="mt-2 flex flex-wrap gap-2">
              {[
                ['None', 0],
                ['3 months', 3],
                ['6 months', 6],
                ['9 months', 9],
                ['12 months', 12],
                ['18 months', 18],
                ['24 months', 24],
                ['36 months', 36],
              ].map(([label, months]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setProductPaoMonths(months)}
                  className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                    productPaoMonths === months
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            disabled={productSaving}
            onClick={async () => {
              // Guards against double-tap creating two identical products —
              // there was no submitting state before, so a second tap while
              // the first request was still in flight fired a second insert.
              if (productSaving) return

              if (!productBrand || !productName || !productCategory) {
                notify('Please fill in all fields.')
                return
              }

              setProductSaving(true)

              const { data: { session }, error: sessionError } = await supabase.auth.getSession()

              if (sessionError) {
                notify("Couldn't reach the server. Check your connection and try again.")
                setProductSaving(false)
                return
              }

              if (!session?.user) {
                notify('Your session ended. Please log in again.')
                setProductSaving(false)
                setScreen('login')
                return
              }

              const {
                data: product,
                error: productError,
              } = await supabase
                .from('products')
                .insert({
                  brand: productBrand,
                  name: productName,
                  category: productCategory,
                  ingredients: productIngredients || null,
                  // Only Open Beauty Facts' own image host is accepted.
                  image_url: productImageUrl.startsWith('https://images.openbeautyfacts.org/') ? productImageUrl : null,
                })
                .select()
                .single()

              if (productError) {
                notify(productError.message)
                setProductSaving(false)
                return
              }

              const { error: userProductError } =
                await supabase
                  .from('user_products')
                  .insert({
                    user_id: session.user.id,
                    product_id: product.id,
                    is_active: true,
                    opened_date: productOpenedDate || null,
                    pao_months: productPaoMonths || null,
                    expiry_date: productExpiryDate || null,
                  })

              if (userProductError) {
                notify(userProductError.message)
                setProductSaving(false)
                return
              }

              // Same loader as everywhere else, so photos and images stay.
              let updatedProducts = null
              let updatedProductsError = null
              try {
                updatedProducts = await reloadProducts()
              } catch (err) {
                updatedProductsError = err
              }

              if (updatedProductsError) {
                console.error(updatedProductsError)
              } else {
                const addedProduct = (updatedProducts || []).find((item) => item.product_id === product.id)
                if (addedProduct && addProductReturnScreen === 'routinePlanner') {
                  addProductToHeldDraft(addedProduct)
                }
              }

              setProductBrand('')
              setProductName('')
              setProductCategory('')
              setProductIngredients('')
              setProductImageUrl('')
              setProductOpenedDate('')
              setProductPaoMonths(0)
              setProductExpiryDate('')
              setProductSaving(false)
              setScreen(addProductReturnScreen)
            }}
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {productSaving ? 'Saving…' : 'Save product'}
          </button>

        </div>
      </div>
    </main>
  )
}
