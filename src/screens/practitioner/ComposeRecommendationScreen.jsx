// Practitioner feature (parked) — write a routine recommendation.
// Loaded only when opened, so it isn't in everyone's download.

export default function ComposeRecommendationScreen({
  addComposeItem,
  clientDetail,
  composeConcerns,
  composeGender,
  composeGoals,
  composeIncludeSkinProfile,
  composeItemBrand,
  composeItemCategory,
  composeItemDays,
  composeItemName,
  composeItemReason,
  composeItemSlot,
  composeItems,
  composeNote,
  composePregnant,
  composeSaving,
  composeSensitivity,
  composeSkinType,
  practitionerClients,
  removeComposeItem,
  selectedClientId,
  setComposeConcerns,
  setComposeGender,
  setComposeGoals,
  setComposeIncludeSkinProfile,
  setComposeItemBrand,
  setComposeItemCategory,
  setComposeItemDays,
  setComposeItemName,
  setComposeItemReason,
  setComposeItemSlot,
  setComposeNote,
  setComposePregnant,
  setComposeSensitivity,
  setComposeSkinType,
  setScreen,
  submitRecommendation,
  t,
}) {
  const client = practitionerClients.find((c) => c.client_id === selectedClientId)

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <button
          onClick={() => setScreen('practitionerClientDetail')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {client?.username || 'Client'}
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[32px] font-light leading-[1.05] tracking-tight">
            Propose a routine
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            They'll review everything and can accept or decline it.
          </p>
        </div>

        <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
          <button
            type="button"
            onClick={() => {
              const next = !composeIncludeSkinProfile
              setComposeIncludeSkinProfile(next)
              if (next && !composeSkinType && clientDetail) {
                setComposeGender(clientDetail.gender || '')
                setComposePregnant(clientDetail.pregnant_or_breastfeeding ?? undefined)
                setComposeSkinType(clientDetail.skin_type || '')
                setComposeConcerns(clientDetail.concerns ? clientDetail.concerns.split(', ').filter(Boolean) : [])
                setComposeGoals(clientDetail.goals ? clientDetail.goals.split(', ').filter(Boolean) : [])
                setComposeSensitivity(clientDetail.sensitivity || '')
              }
            }}
            className="flex w-full items-center justify-between"
          >
            <span className="text-[15px] font-semibold">Include a skin profile</span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                composeIncludeSkinProfile ? t.btn : t.rail
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                  composeIncludeSkinProfile ? 'left-6' : 'left-1'
                }`}
              />
            </span>
          </button>

          {composeIncludeSkinProfile && (
            <div className="mt-6 flex flex-col gap-6">
              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Gender</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setComposeGender(option)}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeGender === option ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Pregnant or breastfeeding?</h3>
                <div className="flex gap-2">
                  {[['Yes', true], ['No', false], ['Rather not say', null]].map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setComposePregnant(value)}
                      className={`flex-1 rounded-xl border px-3 py-3 text-[13px] font-medium ${
                        composePregnant === value ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Skin type</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Normal', 'Dry', 'Oily', 'Combination'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setComposeSkinType(type)}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeSkinType === type ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Main concerns</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Acne', 'Dark circles', 'Dullness', 'Puffiness', 'Uneven texture', 'Visible pores', 'Dryness', 'Hyperpigmentation', 'Sensitivity', 'None'].map((concern) => (
                    <button
                      key={concern}
                      type="button"
                      onClick={() => {
                        setComposeConcerns((current) => {
                          if (concern === 'None') {
                            return current.includes('None') ? [] : ['None']
                          }
                          const withoutNone = current.filter((c) => c !== 'None')
                          return withoutNone.includes(concern)
                            ? withoutNone.filter((c) => c !== concern)
                            : [...withoutNone, concern]
                        })
                      }}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeConcerns.includes(concern) ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {concern}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Goals</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Hydration', 'Clearer skin', 'Even skin tone', 'Healthy skin'].map((goal) => (
                    <button
                      key={goal}
                      type="button"
                      onClick={() =>
                        setComposeGoals((current) =>
                          current.includes(goal)
                            ? current.filter((g) => g !== goal)
                            : [...current, goal]
                        )
                      }
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeGoals.includes(goal) ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {goal}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Sensitivity</h3>
                <div className="flex flex-col gap-2">
                  {['Not sensitive', 'Sometimes sensitive', 'Very sensitive'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setComposeSensitivity(option)}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeSensitivity === option ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[15px] font-semibold">Products</h2>

          {composeItems.length > 0 && (
            <div className="mt-4 flex flex-col gap-2.5">
              {composeItems.map((item) => (
                <div key={item.tempId} className={`flex items-start justify-between rounded-2xl border ${t.hair} p-3.5`}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{item.brand} — {item.name}</p>
                    <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                      {item.category} • {item.slot} • {item.days_of_week.length === 7 ? 'Every day' : `${item.days_of_week.length} days/week`}
                    </p>
                    {item.reason && (
                      <p className={`mt-1 text-[12px] italic ${t.faint}`}>"{item.reason}"</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComposeItem(item.tempId)}
                    className={`shrink-0 text-[12px] font-semibold ${t.danger}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="Brand"
                value={composeItemBrand}
                onChange={(e) => setComposeItemBrand(e.target.value)}
                className={`rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
              />
              <input
                type="text"
                placeholder="Product name"
                value={composeItemName}
                onChange={(e) => setComposeItemName(e.target.value)}
                className={`rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
              />
            </div>

            <select
              value={composeItemCategory}
              onChange={(e) => setComposeItemCategory(e.target.value)}
              className={`mt-2.5 w-full rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
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

            <div className="mt-2.5 flex gap-2">
              {['AM', 'PM'].map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setComposeItemSlot(slot)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-semibold ${
                    composeItemSlot === slot ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex justify-between">
              {[['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]].map(([label, day]) => {
                const selected = composeItemDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setComposeItemDays((current) =>
                        current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
                      )
                    }
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ${
                      selected ? `${t.chip} border-transparent` : `border ${t.hair} ${t.muted}`
                    }`}
                  >
                    {label[0]}
                  </button>
                )
              })}
            </div>

            <input
              type="text"
              placeholder="Why this product? (optional)"
              value={composeItemReason}
              onChange={(e) => setComposeItemReason(e.target.value)}
              className={`mt-2.5 w-full rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
            />

            <button
              type="button"
              onClick={addComposeItem}
              className={`mt-2.5 w-full rounded-xl py-2.5 text-[13px] font-bold ${t.btn}`}
            >
              + Add product
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
            Notes for your client
          </label>
          <textarea
            placeholder='e.g. "Use sunscreen daily. Introduce actives slowly."'
            value={composeNote}
            onChange={(e) => setComposeNote(e.target.value)}
            rows={3}
            className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
          />
        </div>

        <button
          onClick={submitRecommendation}
          disabled={composeSaving}
          className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
        >
          {composeSaving ? 'Sending…' : 'Share Routine'}
        </button>

      </div>
    </main>
  )
}
