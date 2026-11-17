// Ingredient checker — what's in a product, actives and clashes. Loaded on
// demand. Moved out of App.jsx; shared state comes in as props for now.

import { findIngredientDetails } from '../lib/core/ingredientGuide'
import { analyzeIngredients } from '../lib/core/inciAnalysis'

export default function IngredientCheckerScreen({
  checkerMode,
  checkerPasted,
  checkerProductId,
  checkerShowAll,
  ingredientQuery,
  isNight,
  onboardingCompleted,
  products,
  renderBottomTabs,
  setCheckerMode,
  setCheckerPasted,
  setCheckerProductId,
  setCheckerShowAll,
  setIngredientQuery,
  setScreen,
  t,
}) {
  const details = findIngredientDetails(ingredientQuery)
  const hasQuery = ingredientQuery.trim().length > 0
  const noMatch = hasQuery && !details
  const isGenericList = (s) => /^all\b/i.test(s.trim())

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <button
          onClick={() => setScreen('products')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          My products
        </button>

        <div className="mt-5">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>
            Ingredient checker
          </p>

          <h1 className="mt-1.5 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Know what's inside
          </h1>
        </div>

        <div className={`mt-5 grid grid-cols-2 rounded-xl p-0.5 ${isNight ? 'bg-white/5' : 'bg-[#101B2D]/5'}`}>
          {[['product', 'My products'], ['lookup', 'Look up an ingredient']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCheckerMode(key)}
              className={`rounded-[10px] py-2 text-[12px] font-semibold transition ${
                checkerMode === key ? `${t.surface} shadow-sm` : t.faint
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {checkerMode === 'product' && (() => {
          const withIngredients = products.filter((p) => (p.products?.ingredients || '').trim().length > 0)
          const selected = checkerProductId === 'paste'
            ? null
            : withIngredients.find((p) => p.id === checkerProductId) || withIngredients[0] || null
          const pasting = checkerProductId === 'paste' || withIngredients.length === 0
          const sourceText = pasting ? checkerPasted : selected?.products?.ingredients || ''
          const analysis = sourceText.trim() ? analyzeIngredients(sourceText) : null

          const TONE = {
            active: { bar: 'bg-emerald-500', drop: 'text-emerald-500', label: 'Key actives' },
            helpful: { bar: 'bg-teal-300', drop: 'text-teal-400', label: 'Helpful' },
            flag: { bar: 'bg-amber-400', drop: 'text-amber-500', label: 'Worth knowing' },
            neutral: { bar: isNight ? 'bg-white/15' : 'bg-[#101B2D]/15', drop: t.faint, label: 'Base & texture' },
          }
          const CONTAINS = {
            fragrance: 'Contains fragrance',
            alcohol: 'Contains drying alcohol',
            essentialOil: 'Contains essential oils',
            paraben: 'Contains parabens',
            sulfate: 'Contains sulfates',
            silicone: 'Contains silicones',
          }
          const visible = analysis
            ? (checkerShowAll ? analysis.items : analysis.items.slice(0, 8))
            : []

          return (
            <>
              {withIngredients.length > 0 && (
                <div className="-mx-6 mt-5 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none]">
                  {withIngredients.map((p) => {
                    const on = !pasting && selected?.id === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setCheckerProductId(p.id); setCheckerShowAll(false) }}
                        className={`max-w-[160px] shrink-0 rounded-xl border px-3 py-2 text-left transition ${
                          on ? 'border-emerald-500/60 bg-emerald-500/10' : `${t.hair}`
                        }`}
                      >
                        <span className={`block truncate text-[10px] font-semibold uppercase tracking-wide ${t.faint}`}>
                          {p.products?.brand}
                        </span>
                        <span className="block truncate text-[13px] font-medium">{p.products?.name}</span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => { setCheckerProductId('paste'); setCheckerShowAll(false) }}
                    className={`shrink-0 rounded-xl border border-dashed px-3 py-2 text-[13px] font-medium ${
                      pasting ? 'border-emerald-500/60 bg-emerald-500/10' : `${t.hair} ${t.muted}`
                    }`}
                  >
                    + Paste a list
                  </button>
                </div>
              )}

              {pasting && (
                <div className="mt-4">
                  {withIngredients.length === 0 && (
                    <p className={`mb-3 text-[13px] leading-relaxed ${t.muted}`}>
                      None of your products has an ingredient list saved yet. Paste one from the packaging or the brand's website:
                    </p>
                  )}
                  <textarea
                    value={checkerPasted}
                    onChange={(e) => { setCheckerPasted(e.target.value); setCheckerShowAll(false) }}
                    rows={4}
                    placeholder="Water, Glycerin, Niacinamide, …"
                    className={`w-full resize-none rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 text-[14px] leading-relaxed outline-none`}
                  />
                </div>
              )}

              {analysis && analysis.items.length > 0 && (
                <>
                  <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
                    {!pasting && selected && (
                      <>
                        <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>
                          {selected.products?.brand}
                        </p>
                        <p className="mt-0.5 text-[19px] font-semibold leading-snug">{selected.products?.name}</p>
                      </>
                    )}
                    <div className={`grid grid-cols-3 gap-2 ${!pasting && selected ? 'mt-4' : ''}`}>
                      {[
                        [analysis.composition.total, 'Ingredients', ''],
                        [analysis.composition.active, 'Key actives', 'text-emerald-500'],
                        [analysis.composition.flag, 'Worth knowing', analysis.composition.flag ? 'text-amber-500' : ''],
                      ].map(([value, label, color]) => (
                        <div key={label}>
                          <p className={`text-[24px] font-semibold leading-none tabular-nums ${color}`}>{value}</p>
                          <p className={`mt-1 text-[11px] ${t.faint}`}>{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-7">
                    <h2 className="text-[17px] font-semibold">What's inside</h2>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                      {analysis.freeFrom.map((f) => (
                        <div key={f.key} className="flex items-center gap-2">
                          {f.ok ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                          ) : (
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/20 ${isNight ? "text-amber-300" : "text-amber-600"}`}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="3" strokeLinecap="round">
                                <path d="M12 6v8M12 18v.01" />
                              </svg>
                            </span>
                          )}
                          <span className={`text-[13px] ${f.ok ? '' : t.muted}`}>
                            {f.ok ? f.label : CONTAINS[f.key]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={`mt-7 overflow-hidden rounded-3xl ${t.surface}`}>
                    <div className="px-5 pt-5">
                      <div className="flex items-baseline justify-between">
                        <h2 className="text-[17px] font-semibold">Ingredients</h2>
                        <span className={`text-[12px] ${t.faint}`}>In label order</span>
                      </div>

                      <div className="mt-3 flex h-2 gap-[3px] overflow-hidden rounded-full">
                        {['active', 'helpful', 'flag', 'neutral'].map((tone) =>
                          analysis.composition[tone] > 0 ? (
                            <span
                              key={tone}
                              className={`h-full ${TONE[tone].bar}`}
                              style={{ flexGrow: analysis.composition[tone] }}
                            />
                          ) : null
                        )}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                        {['active', 'helpful', 'flag', 'neutral'].map((tone) =>
                          analysis.composition[tone] > 0 ? (
                            <span key={tone} className={`flex items-center gap-1.5 text-[11px] ${t.muted}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].bar}`} />
                              {TONE[tone].label} · {analysis.composition[tone]}
                            </span>
                          ) : null
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      {visible.map((item) => {
                        const clickable = !!item.guide
                        const Row = clickable ? 'button' : 'div'
                        return (
                          <Row
                            key={item.index}
                            type={clickable ? 'button' : undefined}
                            onClick={clickable ? () => {
                              setIngredientQuery(item.guide.ingredient)
                              setCheckerMode('lookup')
                              window.scrollTo(0, 0)
                            } : undefined}
                            className={`flex w-full items-center gap-3 border-t px-5 py-3 text-left ${t.hair} ${
                              item.tone === 'active' ? 'bg-emerald-500/[0.07]' : ''
                            }`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
                              className={`shrink-0 ${TONE[item.tone].drop}`}>
                              <path d="M12 2.5c3.6 4.4 6.5 8.2 6.5 11.7a6.5 6.5 0 0 1-13 0c0-3.5 2.9-7.3 6.5-11.7Z" />
                            </svg>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-[14px] ${
                                item.tone === 'active' ? `font-semibold ${isNight ? 'text-emerald-400' : 'text-emerald-700'}` : 'font-medium'
                              }`}>
                                {item.name}
                              </span>
                              {item.role && (
                                <span className={`block truncate text-[11px] ${t.faint}`}>{item.role}</span>
                              )}
                            </span>
                            {item.tone === 'active' && (
                              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-600">
                                Learn
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M9 5l7 7-7 7" />
                                </svg>
                              </span>
                            )}
                            {item.tone === 'flag' && (
                              <span className={`shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold ${isNight ? "text-amber-300" : "text-amber-700"}`}>
                                {item.flag}
                              </span>
                            )}
                          </Row>
                        )
                      })}
                    </div>

                    {analysis.items.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setCheckerShowAll(!checkerShowAll)}
                        className={`w-full border-t py-3.5 text-center text-[13px] font-semibold ${t.hair}`}
                      >
                        {checkerShowAll ? 'Show fewer' : `Show all ${analysis.items.length} ingredients`}
                      </button>
                    )}
                  </div>

                  <p className={`mt-4 text-[11px] leading-relaxed ${t.faint}`}>
                    Based on the ingredient list only. "Worth knowing" flags common irritants for sensitive skin — they're not necessarily bad for you.
                  </p>
                </>
              )}
            </>
          )
        })()}

        {checkerMode === 'lookup' && (<>
        <div className="mt-6">
          <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
            Search ingredients
          </label>

          <input
            type="text"
            value={ingredientQuery}
            onChange={(e) => setIngredientQuery(e.target.value)}
            placeholder="e.g. Retinol, Vitamin C, Salicylic Acid"
            className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
          />
        </div>

        {details && (
          <>
            <div className={`mt-5 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[21px] font-semibold">{details.ingredient}</h2>

              {details.class && (
                <span className={`mt-2 inline-block rounded-full px-3 py-1 text-[12px] font-semibold ${t.chip}`}>
                  {details.class}
                </span>
              )}

              <div className={`mt-4 flex gap-6 border-t pt-4 ${t.hair}`}>
                {details.bestTime && (
                  <div>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Best used</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold">
                      {/PM/i.test(details.bestTime) && !/AM/i.test(details.bestTime) ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round" className={t.mark}>
                          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
                        </svg>
                      ) : /AM/i.test(details.bestTime) && !/PM/i.test(details.bestTime) ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round" className={t.mark}>
                          <circle cx="12" cy="12" r="4.2" />
                          <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
                        </svg>
                      ) : null}
                      {details.bestTime}
                    </p>
                  </div>
                )}

                {details.typicalFrequency && (
                  <div>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Frequency</p>
                    <p className="mt-0.5 text-[14px] font-semibold">{details.typicalFrequency}</p>
                  </div>
                )}
              </div>
            </div>

            {details.about && (
              <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                <h3 className="text-[15px] font-semibold">About {details.ingredient}</h3>
                <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>{details.about}</p>
              </div>
            )}

            {details.mainUses && (
              <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={t.mark}>
                    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
                  </svg>
                  Main Uses
                </h3>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {details.mainUses.split(',').map((use) => use.trim()).filter(Boolean).map((use) => (
                    <li key={use} className={`flex items-center gap-2 text-[14px] ${t.muted}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.chip}`} />
                      <span className="capitalize">{use}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(details.howToUse || details.precaution) && (
              <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                <h3 className="text-[15px] font-semibold">How to use</h3>

                {details.howToUse && (
                  <p className="mt-2 text-[14px] leading-relaxed">{details.howToUse}</p>
                )}

                {details.precaution && (
                  <div className={`mt-3 flex items-start gap-2 rounded-2xl ${t.chip} p-3`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                      <path d="M12 3.5 21 19H3L12 3.5Z" />
                      <path d="M12 9.5v4" />
                      <path d="M12 16.5v.01" />
                    </svg>
                    <p className="text-[13px] leading-relaxed">{details.precaution}</p>
                  </div>
                )}
              </div>
            )}

            {(details.compatibleWith || details.useCautionWith) && (
              <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                <h3 className="text-[15px] font-semibold">Compatibility</h3>

                {details.compatibleWith && (
                  <div className="mt-3">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                        <path d="M4 12.5l5.2 5.2L20 7" />
                      </svg>
                      Works well with
                    </p>
                    <p className={`mt-1 text-[14px] leading-relaxed ${t.muted}`}>
                      {isGenericList(details.compatibleWith)
                        ? "Plays well with the rest of your routine."
                        : details.compatibleWith}
                    </p>
                  </div>
                )}

                {details.useCautionWith && (
                  <div className={`${details.compatibleWith ? `mt-4 border-t pt-4 ${t.hair}` : 'mt-3'}`}>
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
                        <path d="M12 3.5 21 19H3L12 3.5Z" />
                        <path d="M12 9.5v4" />
                        <path d="M12 16.5v.01" />
                      </svg>
                      Use caution with
                    </p>
                    <p className={`mt-1 text-[14px] leading-relaxed ${t.muted}`}>{details.useCautionWith}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {noMatch && (
          <div className={`mt-5 rounded-3xl border ${t.hair} p-5`}>
            <p className={`text-[14px] leading-relaxed ${t.muted}`}>
              Can't find "{ingredientQuery.trim()}". We can't confirm how to use it
              or what it mixes with — treat it carefully and check the product's own instructions.
            </p>
          </div>
        )}
        </>)}


      </div>

      {onboardingCompleted && renderBottomTabs('products', t)}
    </main>
  )
}
