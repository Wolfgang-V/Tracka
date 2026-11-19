// My routine — build or edit the AM/PM routine: which products, when, and on
// which days. Moved out of App.jsx (step 3); shared state still comes in as
// props until each screen reads its own data.

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoutines } from '../data/routine'
import { ALL_DAYS, draftFromRoutines, withDefaultTimes, holdRoutineDraft, takeHeldRoutineDraft } from '../lib/core/routineDraft'

const DAYS = [['M', 'Mon', 1], ['T', 'Tue', 2], ['W', 'Wed', 3], ['T', 'Thu', 4], ['F', 'Fri', 5], ['S', 'Sat', 6], ['S', 'Sun', 0]]

const SLOTS = [
  ['NONE', 'Off'],
  ['AM', 'Morning'],
  ['PM', 'Night'],
  ['BOTH', 'Both'],
]

const SUN = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
const MOON = <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />

const Glyph = ({ children, size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
    {children}
  </svg>
)

// "Every day" / "Weekdays" / "Weekends" / "Mon, Wed, Fri" / "No days yet".
function daysSummary(days = []) {
  const set = new Set(days)
  if (set.size === 7) return 'Every day'
  if (set.size === 0) return 'No days chosen'
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  return DAYS.filter(([, , d]) => set.has(d)).map(([, name]) => name).join(', ')
}

export default function RoutinePlannerScreen({
  busyAction,
  displayName,
  loadRoutineHistory,
  loadRoutines,
  notify,
  onboardingCompleted,
  products,
  isNight,
  productImageFor,
  renderProductArt,
  renderBottomTabs,
  routinesLoading,
  runBusy,
  setAddProductReturnScreen,
  setOnboardingCompleted,
  setScreen,
  showLocalNotification,
  t,
  user,
}) {
  // The editor owns its working copy, so tapping a day or a slot only
  // re-renders this screen. It starts from the saved routine (or from what
  // was set aside while adding a product), and becomes a draft on first edit.
  const { amRoutine, pmRoutine, routinesReady } = useRoutines(user?.id)
  const routineEditMode = Boolean(amRoutine || pmRoutine)
  const [draft, setDraft] = useState(takeHeldRoutineDraft)
  const [routineSaving, setRoutineSaving] = useState(false)
  const base = draft ?? (routinesReady ? draftFromRoutines(amRoutine, pmRoutine) : { times: {}, days: {} })
  const productTimes = withDefaultTimes(base.times, products, routineEditMode)
  const productDays = base.days
  const setProductDays = (valueOrFn) =>
    setDraft((d) => {
      const cur = d ?? base
      return { ...cur, days: typeof valueOrFn === 'function' ? valueOrFn(cur.days) : valueOrFn }
    })
  // Picking a slot for a product with no days yet starts it on every day,
  // so a new product doesn't need seven taps before the routine can save.
  const setSlot = (id, slot) => {
    setDraft((d) => {
      const cur = d ?? base
      const times = { ...withDefaultTimes(cur.times, products, routineEditMode), [id]: slot }
      const days = slot !== 'NONE' && !(cur.days[id] || []).length ? { ...cur.days, [id]: [...ALL_DAYS] } : cur.days
      return { ...cur, times, days }
    })
  }
  const toggleDay = (id, day) =>
    setProductDays((current) => {
      const currentDays = current[id] || []
      return { ...current, [id]: currentDays.includes(day) ? currentDays.filter((x) => x !== day) : [...currentDays, day] }
    })
  const everyDay = (id) => setProductDays((current) => ({ ...current, [id]: [...ALL_DAYS] }))

  const amCount = products.filter((p) => productTimes[p.id] === 'AM' || productTimes[p.id] === 'BOTH').length
  const pmCount = products.filter((p) => productTimes[p.id] === 'PM' || productTimes[p.id] === 'BOTH').length

  // Leaving to add a product: set the unsaved choices aside for the return.
  const goAddProduct = () => {
    holdRoutineDraft({ times: productTimes, days: productDays })
    setAddProductReturnScreen('routinePlanner')
    setScreen('addProduct')
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <div className="flex items-center justify-between">
          <button
            onClick={() => setScreen('today')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Today
          </button>

          <button
            disabled={busyAction === 'routineHistory'}
            onClick={() =>
              runBusy('routineHistory', async () => {
                await loadRoutineHistory()
                setScreen('routineHistory')
              })
            }
            className={`rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
          >
            {busyAction === 'routineHistory' ? 'Loading…' : 'History'}
          </button>
        </div>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            {routineEditMode ? 'Routine settings' : 'Step 3 of 3'}
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            {routineEditMode ? 'Edit your routine' : 'Build your routine'}
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Choose which products belong in your morning and night routines.
          </p>
        </div>

        {/* Overview: what's in each routine right now (updates as you edit). */}
        {products.length > 0 && (
          <div className="mt-7 grid grid-cols-2 gap-3">
            {[
              ['Morning', amCount, SUN, isNight ? 'bg-amber-400/15 text-amber-300' : 'bg-amber-400/15 text-amber-600'],
              ['Night', pmCount, MOON, isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-[#1463F4]/10 text-[#1463F4]'],
            ].map(([label, count, icon, tint]) => (
              <div key={label} className={`flex items-center gap-3 rounded-2xl ${t.surface} p-3.5`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
                  <Glyph size={20}>{icon}</Glyph>
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold leading-tight">{label}</span>
                  <span className={`block text-[12px] ${t.faint}`}>
                    <span className="tabular-nums">{count}</span> {count === 1 ? 'product' : 'products'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 flex items-end justify-between px-1">
          <h2 className="text-[18px] font-semibold">Your products</h2>
          {products.length > 0 && (
            <span className={`text-[12.5px] ${t.faint}`}>
              <span className="tabular-nums">{products.filter((p) => productTimes[p.id] !== 'NONE').length}</span> of{' '}
              <span className="tabular-nums">{products.length}</span> in use
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {products.length === 0 ? (
            <div className={`rounded-3xl ${t.surface} p-6 text-center`}>
              <p className="text-[16px] font-semibold">No products yet</p>
              <p className={`mt-1.5 text-[14px] leading-relaxed ${t.muted}`}>
                Add the products you use, then choose when each one goes in your routine.
              </p>
              <button onClick={goAddProduct} className={`mt-4 rounded-xl px-5 py-3 text-[13px] font-semibold ${t.btn}`}>
                + Add a product
              </button>
            </div>
          ) : (
            products.map((item) => {
              const slot = productTimes[item.id] || ''
              const off = slot === 'NONE'
              const days = productDays[item.id] || []
              const image = productImageFor?.(item)
              return (
                <div key={item.id} className={`rounded-3xl ${t.surface} p-4 transition ${off ? 'opacity-70' : ''}`}>
                  <div className="flex items-center gap-3">
                    {image ? (
                      <img src={image} alt="" loading="lazy"
                        className={`h-14 w-14 shrink-0 rounded-xl bg-white object-contain p-1 ${off ? 'grayscale' : ''}`} />
                    ) : (
                      renderProductArt?.(item.products?.category, `h-14 w-14 shrink-0 rounded-xl ${off ? 'grayscale' : ''}`, 'h-[82%] w-[82%]')
                    )}
                    <div className="min-w-0 flex-1">
                      {item.products?.brand && (
                        <p className={`truncate text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>{item.products.brand}</p>
                      )}
                      <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{item.products?.name}</p>
                      {item.products?.category && (
                        <p className={`mt-0.5 truncate text-[12px] capitalize ${t.muted}`}>{item.products.category}</p>
                      )}
                    </div>
                  </div>

                  {/* When: Off / Morning / Night / Both */}
                  <div
                    role="radiogroup"
                    aria-label={`When to use ${item.products?.name || 'this product'}`}
                    className={`mt-4 grid grid-cols-4 gap-1 rounded-2xl p-1 ${isNight ? 'bg-white/5' : 'bg-[#101B2D]/[0.04]'}`}
                  >
                    {SLOTS.map(([value, label]) => {
                      const on = slot === value
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setSlot(item.id, value)}
                          className={`flex items-center justify-center gap-1 rounded-xl py-2.5 text-[12.5px] font-semibold transition ${
                            on ? (value === 'NONE' ? `${t.surface} shadow-sm` : t.chip) : t.muted
                          }`}
                        >
                          {value === 'AM' && <Glyph size={13}>{SUN}</Glyph>}
                          {value === 'PM' && <Glyph size={13}>{MOON}</Glyph>}
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Which days — hidden while the product is off. */}
                  {!off && slot && (
                    <div className="mt-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={`truncate text-[12.5px] font-semibold ${days.length ? t.muted : 'text-amber-600'}`}>
                          {daysSummary(days)}
                        </p>
                        {days.length < 7 && (
                          <button type="button" onClick={() => everyDay(item.id)} className={`shrink-0 text-[12.5px] font-semibold ${t.mark}`}>
                            Every day
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-7 gap-1.5">
                        {DAYS.map(([short, name, day]) => {
                          const on = days.includes(day)
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-label={name}
                              aria-pressed={on}
                              onClick={() => toggleDay(item.id, day)}
                              className={`flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold transition ${
                                on ? `${t.chip} border border-transparent` : `border ${t.hair} ${t.faint}`
                              }`}
                            >
                              {short}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {products.length > 0 && (
            <button
              type="button"
              onClick={goAddProduct}
              className={`w-full rounded-2xl border border-dashed px-4 py-3.5 text-[14px] font-semibold ${t.hair} ${t.muted}`}
            >
              + Add a product
            </button>
          )}
        </div>

        <button
  disabled={routineSaving || routinesLoading}
  onClick={async () => {
    // Same double-tap guard as Add product — without it, a second tap
    // while routines/routine_steps were still being inserted created a
    // second full set, which then doubled up in routine history views.
    if (routineSaving) return

    if (products.length === 0) {
      notify('Please add at least one product.')
      return
    }

    const selectedProducts = products.filter((item) => productTimes[item.id] !== 'NONE')

    if (selectedProducts.length === 0) {
      notify('Choose at least one product for your routine.')
      return
    }

    const missingTime = selectedProducts.find(
  (item) => !productTimes[item.id]
)

if (missingTime) {
  notify('Please choose a time for every product.')
  return
}

const missingDays = selectedProducts.find(
  (item) => !productDays[item.id] || productDays[item.id].length === 0
)

if (missingDays) {
  notify('Please choose at least one day for every product.')
  return
}

    if (!user) {
      notify('Please log in first.')
      return
    }

    setRoutineSaving(true)

    const routineCode = `TRK-${Date.now().toString().slice(-6)}`

    const buildSteps = (time) =>
      selectedProducts
        .filter((item) => {
          const selectedTime = productTimes[item.id]
          return selectedTime === time || selectedTime === 'BOTH'
        })
        .map((item, index) => ({
          user_product_id: item.id,
          step_order: index + 1,
          step_name: item.products?.name || 'Skincare product',
          frequency: 'daily',
          days_of_week: productDays[item.id] || [0, 1, 2, 3, 4, 5, 6],
        }))

    // A dropped connection surfaces here as a raw fetch error ("TypeError:
    // Load failed" on Safari/WebKit, "Failed to fetch" on Chrome) rather
    // than a structured Postgrest error — not something to show verbatim,
    // and on a weak mobile connection often clears up in a couple of
    // seconds. One silent retry before bothering the user with anything.
    const isNetworkError = (err) =>
      err instanceof TypeError || /load failed|failed to fetch|network/i.test(err.message || '')

    // One DB function doing deactivate-old + insert-new in a single
    // transaction, instead of two separate requests from the client — a
    // dropped connection between them used to leave someone with no
    // active routine at all despite their products still being there.
    // Safe to retry even if the first attempt actually landed server-side
    // before the response was lost: create_routine always deactivates
    // whatever's currently active first, so re-running it with the same
    // steps just re-creates the same end state.
    let { error } = await supabase.rpc('create_routine', {
      p_routine_code: routineCode,
      p_am_steps: buildSteps('AM'),
      p_pm_steps: buildSteps('PM'),
    })

    if (error && isNetworkError(error)) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      ;({ error } = await supabase.rpc('create_routine', {
        p_routine_code: routineCode,
        p_am_steps: buildSteps('AM'),
        p_pm_steps: buildSteps('PM'),
      }))
    }

    setRoutineSaving(false)

    if (error) {
      notify(
        isNetworkError(error)
          ? "Couldn't save your routine — check your connection and try again."
          : 'Could not save your routine: ' + error.message
      )
      return
    }

    notify(routineEditMode ? 'Routine updated.' : 'Your routine is ready.', 'success')
    showLocalNotification(
      routineEditMode ? 'Routine updated' : `Your routine is ready, ${displayName}`,
      'Time to stay consistent.'
    )

    if (!onboardingCompleted) {
      setOnboardingCompleted(true)
      if (user) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
      }
    }

    setScreen('today')
    loadRoutines()
  }}
  className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
>
  {routineSaving ? 'Saving…' : routinesLoading ? 'Loading routine…' : routineEditMode ? 'Save routine changes' : 'Create my routine'}
</button>

        <button
          onClick={() => setScreen('products')}
          className={`mt-3 w-full rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
        >
          Back to my products
        </button>

      </div>
      {onboardingCompleted && renderBottomTabs('routinePlanner', t)}
    </main>
  )
}
