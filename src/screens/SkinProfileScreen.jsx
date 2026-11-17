// Skin profile — skin type, concerns, sensitivities (onboarding step 1 and
// from the profile menu). Moved out of App.jsx; shared state comes in as props.

import { supabase } from '../lib/supabase'

export default function SkinProfileScreen({
  busyAction,
  concerns,
  gender,
  goals,
  loadSkinProfile,
  notify,
  onboardingCompleted,
  practitionersLaunched,
  pregnantOrBreastfeeding,
  profilePhotoUploading,
  profilePhotoUrl,
  renderProfileAvatar,
  runBusy,
  saveProfilePhoto,
  sensitivity,
  setConcerns,
  setGender,
  setGoals,
  setOnboardingCompleted,
  setPregnantOrBreastfeeding,
  setScreen,
  setSensitivity,
  setSkinProfileEditing,
  setSkinType,
  skinProfileEditing,
  skinType,
  t,
  toggleOption,
  user,
}) {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <button
          onClick={() => window.history.back()}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>

        {onboardingCompleted && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['My progress', 'progress'],
              ['Skin reports', 'skinTrends'],
              ['Skin diary', 'progressPhotos'],
            ].map(([label, target]) => (
              <button
                key={target}
                onClick={() => setScreen(target)}
                className={`rounded-2xl px-2 py-2.5 text-center text-[12px] font-semibold leading-tight ${t.chip}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {onboardingCompleted && !skinProfileEditing && skinType ? (
          <>
            <div className="mt-5">
              <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
                Your skin profile
              </h1>

              <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
                What Tracka+ knows about your skin right now.
              </p>
            </div>

            <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
              {[
                ['Gender', gender || '—'],
                [
                  'Pregnant or breastfeeding',
                  pregnantOrBreastfeeding === true
                    ? 'Yes'
                    : pregnantOrBreastfeeding === false
                      ? 'No'
                      : pregnantOrBreastfeeding === null
                        ? 'Rather not say'
                        : '—',
                ],
                ['Skin type', skinType || '—'],
                ['Main concerns', concerns.length > 0 ? concerns.join(', ') : '—'],
                ['Goals', goals.length > 0 ? goals.join(', ') : '—'],
                ['Sensitivity', sensitivity || '—'],
              ].map(([label, value], index, arr) => (
                <div
                  key={label}
                  className={`py-3.5 ${index < arr.length - 1 ? `border-b ${t.hair}` : ''}`}
                >
                  <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
                    {label}
                  </p>
                  <p className="mt-1 text-[15px] font-medium">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSkinProfileEditing(true)}
              className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              Update
            </button>
          </>
        ) : (
          <>
        <div className="mt-5">
          {!onboardingCompleted && (
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Step 1 of 3
            </p>
          )}

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            {onboardingCompleted ? 'Update your skin profile' : 'Tell us about your skin'}
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            {onboardingCompleted
              ? "Skin changes — update this any time it does."
              : 'This helps Tracka+ organize your skincare journey around you.'}
          </p>

          {!onboardingCompleted && (
            <div className={`mt-5 flex items-center gap-4 rounded-2xl ${t.surface} p-4`}>
              {renderProfileAvatar('h-16 w-16 text-xl')}
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">Profile picture</p>
                <label className={`mt-1 inline-block cursor-pointer text-[13px] font-semibold ${t.mark}`}>
                  {profilePhotoUploading ? 'Uploading…' : profilePhotoUrl ? 'Change photo' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={profilePhotoUploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) saveProfilePhoto(file)
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {!onboardingCompleted && practitionersLaunched && (
            <button
              onClick={async () => {
                if (!user) return
                setOnboardingCompleted(true)
                // The login/checkUser routing decides "already onboarded"
                // by whether a skin_profiles row exists at all, not by
                // onboarding_completed — so flipping only that flag would
                // still bounce them straight back into this screen next
                // time they log in. A blank row (everything but user_id
                // left null) satisfies that check without claiming any
                // skin data that was never actually given.
                await Promise.all([
                  supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id),
                  supabase.from('skin_profiles').upsert({ user_id: user.id }, { onConflict: 'user_id' }),
                ])
                setScreen('applyPractitioner')
              }}
              className={`mt-3 text-[13px] font-semibold ${t.mark}`}
            >
              Signing up as a professional, not a client? Skip this →
            </button>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-8">

          <section>
            <h2 className="mb-3 text-[17px] font-semibold">
              What is your gender?
            </h2>

            <div className="grid grid-cols-2 gap-2.5">
              {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((option) => (
                <button
                  key={option}
                  onClick={() => setGender(option)}
                  className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                    gender === option
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold">
              Are you pregnant or breastfeeding?
            </h2>

            <p className={`mb-4 text-sm leading-relaxed ${t.muted}`}>
              Some ingredients are usually avoided during pregnancy. We'll leave those
              out of your routine. You can change this any time.
            </p>

            <div className="flex gap-3">
              {[
                ['Yes', true],
                ['No', false],
                ['Rather not say', null],
              ].map(([label, value]) => (
                <button
                  key={label}
                  onClick={() => setPregnantOrBreastfeeding(value)}
                  className={`flex-1 rounded-2xl border px-4 py-3.5 text-[15px] font-medium ${
                    pregnantOrBreastfeeding === value ? `${t.chip} border-transparent` : `${t.surface} ${t.hair}`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[17px] font-semibold">
              What is your skin type?
            </h2>

            <div className="grid grid-cols-2 gap-2.5">
              {['Normal', 'Dry', 'Oily', 'Combination'].map((type) => (
                <button
                  key={type}
                  onClick={() => setSkinType(type)}
                  className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                    skinType === type
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-[17px] font-semibold">
              What are your main skin concerns?
            </h2>

            <p className={`mb-3 text-[13px] ${t.faint}`}>
              Select all that apply.
            </p>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[
                'Acne',
                'Dark circles',
                'Dullness',
                'Puffiness',
                'Uneven texture',
                'Visible pores',
                'Dryness',
                'Hyperpigmentation',
                'Sensitivity',
                'None',
              ].map((concern) => (
                <button
                  key={concern}
                  onClick={() => {
                    // "None" is an exclusive choice, not just another
                    // item in the list — picking it clears everything
                    // else, and picking anything else clears "None".
                    // Functional update throughout, same reasoning as
                    // toggleOption above.
                    setConcerns((current) => {
                      if (concern === 'None') {
                        return current.includes('None') ? [] : ['None']
                      }
                      const withoutNone = current.filter((c) => c !== 'None')
                      return withoutNone.includes(concern)
                        ? withoutNone.filter((c) => c !== concern)
                        : [...withoutNone, concern]
                    })
                  }}
                  className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                    concerns.includes(concern)
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {concern}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-[17px] font-semibold">
              What are your skincare goals?
            </h2>

            <p className={`mb-3 text-[13px] ${t.faint}`}>
              Select all that apply.
            </p>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[
                'Hydration',
                'Clearer skin',
                'Even skin tone',
                'Healthy skin',
              ].map((goal) => (
                <button
                  key={goal}
                  onClick={() =>
                    toggleOption(goal, setGoals)
                  }
                  className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                    goals.includes(goal)
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {goal}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[17px] font-semibold">
              How sensitive is your skin?
            </h2>

            <div className="flex flex-col gap-2.5">
              {[
                'Not sensitive',
                'Sometimes sensitive',
                'Very sensitive',
              ].map((option) => (
                <button
                  key={option}
                  onClick={() => setSensitivity(option)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                    sensitivity === option
                      ? `${t.chip} border-transparent`
                      : `${t.hair} ${t.muted}`
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </section>

          <button
            disabled={busyAction === 'saveSkinProfile'}
            onClick={() =>
              runBusy('saveSkinProfile', async () => {
                // getSession() reads the persisted session (no network
                // round trip in the normal case) instead of getUser(),
                // which validates the token against the auth server every
                // time — a signed-in person on a slow connection used to
                // get bounced with "Please create an account first," which
                // was exactly backwards from what actually happened.
                const { data: { session }, error: sessionError } = await supabase.auth.getSession()

                if (sessionError) {
                  notify("Couldn't reach the server. Check your connection and try again.")
                  return
                }

                if (!session?.user) {
                  notify('Your session ended. Please log in again.')
                  setScreen('login')
                  return
                }

                const { error } = await supabase
                  .from('skin_profiles')
                  .upsert(
                    {
                      user_id: session.user.id,
                      gender: gender,
                      pregnant_or_breastfeeding: pregnantOrBreastfeeding ?? null,
                      skin_type: skinType,
                      concerns: concerns.join(', '),
                      goals: goals.join(', '),
                      sensitivity: sensitivity,
                    },
                    { onConflict: 'user_id' }
                  )

                if (error) {
                  notify(error.message)
                  return
                }

                if (onboardingCompleted) {
                  notify('Skin profile updated!', 'success')
                  setSkinProfileEditing(false)
                } else {
                  notify('Skin profile saved!', 'success')
                  setScreen('products')
                }
              })
            }
            className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'saveSkinProfile' ? 'Saving…' : onboardingCompleted ? 'Save changes' : 'Continue'}
          </button>

          {onboardingCompleted && (
            <button
              onClick={async () => {
                await loadSkinProfile()
                setSkinProfileEditing(false)
              }}
              className={`w-full rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
            >
              Cancel
            </button>
          )}

        </div>
          </>
        )}
      </div>

    </main>
  )
}
