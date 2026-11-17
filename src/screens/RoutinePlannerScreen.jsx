// My routine — build or edit the AM/PM routine: which products, when, and on
// which days. Moved out of App.jsx (step 3); shared state still comes in as
// props until each screen reads its own data.

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRoutines } from '../data/routine'
import { draftFromRoutines, withDefaultTimes, holdRoutineDraft, takeHeldRoutineDraft } from '../lib/core/routineDraft'

export default function RoutinePlannerScreen({
  busyAction,
  displayName,
  loadRoutineHistory,
  loadRoutines,
  notify,
  onboardingCompleted,
  products,
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
  const setProductTimes = (valueOrFn) =>
    setDraft((d) => {
      const cur = d ?? base
      const times = typeof valueOrFn === 'function' ? valueOrFn(withDefaultTimes(cur.times, products, routineEditMode)) : valueOrFn
      return { ...cur, times }
    })
  const setProductDays = (valueOrFn) =>
    setDraft((d) => {
      const cur = d ?? base
      return { ...cur, days: typeof valueOrFn === 'function' ? valueOrFn(cur.days) : valueOrFn }
    })
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

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>

          <h2 className="text-[17px] font-semibold">
            Your products
          </h2>

          <div className="mt-5 flex flex-col gap-3">

            {products.length === 0 ? (
              <div className={`rounded-2xl border ${t.hair} p-5 text-center`}>
                <p className={`text-[15px] ${t.muted}`}>
                  You haven't added any products yet.
                </p>

                <button
                  onClick={goAddProduct}
                  className={`mt-4 rounded-xl px-5 py-3 text-[13px] font-semibold ${t.btn}`}
                >
                  + Add a product
                </button>

              </div>
            ) : (
              products.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border ${t.hair} p-4`}
                >
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>
                    {item.products?.brand}
                  </p>

                  <p className="mt-1 text-[15px] font-medium">
                    {item.products?.name}
                  </p>

                  <p className={`mt-1 text-[12px] ${t.muted}`}>
                    {item.products?.category}
                  </p>

                  <div className="mt-4">
                    <label className={`text-[12px] font-semibold ${t.faint}`}>
                      When do you want to use this?
                    </label>

                    <select
                      className={`mt-2 w-full rounded-xl ${t.surface} border ${t.hair} px-4 py-3 text-[14px] outline-none`}
                      value={productTimes[item.id] || ''}
                      onChange={(e) =>
                        setProductTimes({
                          ...productTimes,
                          [item.id]: e.target.value,
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose time
                      </option>

                      <option value="NONE">
                        Not in routine
                      </option>

                      <option value="AM">
                        Morning (AM)
                      </option>

                      <option value="PM">
                        Night (PM)
                      </option>

                      <option value="BOTH">
                        Morning & Night (AM & PM)
                      </option>
                    </select>
                  </div>

                  <div className="mt-4">
                    <label className={`text-[12px] font-semibold ${t.faint}`}>
                      How often? <span className="font-normal">(choose the days you want to use this product)</span>
                    </label>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4],
                        ['Fri', 5], ['Sat', 6], ['Sun', 0],
                      ].map(([label, day]) => {
                        const selectedDays = productDays[item.id] || []
                        const selected = selectedDays.includes(day)

                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              setProductDays((current) => {
                                const currentDays = current[item.id] || []
                                return {
                                  ...current,
                                  [item.id]: currentDays.includes(day)
                                    ? currentDays.filter((d) => d !== day)
                                    : [...currentDays, day],
                                }
                              })
                            }
                            className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold transition ${
                              selected
                                ? `${t.chip} border border-transparent`
                                : `border ${t.hair} ${t.muted}`
                            }`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}

          </div>

          <button
            type="button"
            onClick={goAddProduct}
            className={`mt-5 w-full rounded-xl border px-4 py-3 text-[14px] font-semibold ${t.hair} ${t.muted}`}
          >
            + Add a product
          </button>
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
