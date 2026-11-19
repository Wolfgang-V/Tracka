// Today — the day's AM and PM routine, skin tip, challenges, report and
// the profile menu. Moved out of App.jsx (step 3 of the restructure); it
// still gets shared state and helpers from App as props for now, and will
// take over its own data hooks as the other screens move out too.

import AdBanner from '../ads/AdBanner'
import { checkRoutineConflicts } from '../lib/core/ingredientGuide'
import { PREGNANCY_NOTE } from '../lib/core/planNight'
import { supabase } from '../lib/supabase'
import { useCompletedSteps } from '../data/routine'

export default function TodayScreen({
  amPlan,
  amFinished,
  pmFinished,
  careRelationships,
  challengesLoading,
  userId,
  dailySkinTip,
  displayName,
  finishRoutine,
  getInstallEnv,
  hideHomeAd,
  homeAd,
  isLiveParticipation,
  isNight,
  loadSkinProfile,
  menuOpen,
  missingAmSunscreen,
  monthlyReport,
  myChallenges,
  nightPlan,
  notify,
  onboardingCompleted,
  openAd,
  openProduct,
  openSetupGuide,
  pendingRecommendations,
  productImageFor,
  renderBottomTabs,
  renderChallengeProgressCard,
  renderProductArt,
  renderProfileAvatar,
  renderSunscreenMissingNotice,
  reportSharing,
  routinesLoading,
  setMenuOpen,
  setScreen,
  shareSkinReport,
  showLocalNotification,
  t,
  todayAmRoutine,
  todayPmRoutine,
  todayString,
  toggleStepCompletion,
}) {
  // Today owns its ticks: tapping a step re-renders this screen only.
  const { completedSteps } = useCompletedSteps(userId)
  const amSteps = amPlan.steps

  const pmSteps = nightPlan.steps

  const amDone = amSteps.filter((s) => completedSteps.includes(s.id)).length
  const pmDone = pmSteps.filter((s) => completedSteps.includes(s.id)).length

  const amIngredientWarnings = checkRoutineConflicts(amSteps)
  const pmIngredientWarnings = checkRoutineConflicts(pmSteps)

  // Products the person marked as expired are left out of the plan
  // (planNight → skipped, reason 'expired_marked'). Say so, so it never
  // looks like a step silently vanished — firmer wording for sunscreen.
  const renderExpiredNotice = (plan) => {
    const gone = plan.skipped.filter((s) => s.reason === 'expired_marked')
    if (gone.length === 0) return null
    return (
      <div className="mt-4 flex flex-col gap-2">
        {gone.map(({ step }) => {
          const isSpf = (step.category || '').toLowerCase() === 'sunscreen'
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => step.userProduct?.id && openProduct(step.userProduct.id)}
              className="w-full border-l-2 border-rose-400/70 py-1 pl-3.5 text-left"
            >
              <span className="block text-[13px] font-medium">
                {isSpf ? 'Your sunscreen is marked expired' : `${step.name} is left out today`}
              </span>
              <span className={`block text-[12px] leading-relaxed ${t.muted}`}>
                {isSpf
                  ? `${step.name} isn't in today's routine. Replace it before you rely on it for protection.`
                  : 'You marked it as expired. Replace it, then swap it in My routine.'}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  // `locked`: the routine is complete for today, so its ticks stay as they are.
  const renderSteps = (steps, palette, locked = false) => (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const done = completedSteps.includes(step.id)
        const stepImage = productImageFor(step.userProduct)

        return (
          <button
            key={step.id}
            disabled={locked}
            onClick={() => { if (!locked) toggleStepCompletion(step.id) }}
            className={`relative flex min-h-[88px] w-full items-center gap-4 overflow-hidden rounded-2xl p-4 pr-28 text-left transition ${
              done ? palette.chip : `border ${palette.hair}`
            }`}
          >
            {/* Product photo (or its category art) fills the card's right
                edge and fades into it; muted to grey once ticked. */}
            {(() => {
              const fade = {
                WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 55%)',
                maskImage: 'linear-gradient(to right, transparent 0%, #000 55%)',
              }
              const muted = done ? 'opacity-50 grayscale' : ''
              return stepImage ? (
                <img
                  src={stepImage}
                  alt=""
                  loading="lazy"
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 right-0 h-full w-32 object-cover transition ${muted}`}
                  style={fade}
                />
              ) : (
                <span className={`pointer-events-none absolute inset-y-0 right-0 w-32 transition ${muted}`} style={fade}>
                  {renderProductArt(step.category, 'h-full w-full pl-8', 'h-[72%] w-[72%]')}
                </span>
              )
            })()}
            <span
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                done ? palette.nodeDone : palette.node
              }`}
            >
              {done ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12.5l5.2 5.2L20 7" />
                </svg>
              ) : (
                index + 1
              )}
            </span>

            <span className="relative min-w-0 flex-1">
              {step.brand && (
                <span className={`block truncate text-[12px] font-medium ${palette.faint}`}>
                  {step.brand}
                </span>
              )}

              <span
                className={`mt-0.5 block text-[16px] font-semibold ${
                  done ? 'line-through' : ''
                }`}
              >
                {step.name}
              </span>

              {step.category && (
                <span className={`mt-0.5 block text-[12px] capitalize ${palette.muted}`}>
                  {step.category}
                </span>
              )}

              {!done && step.expired && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <span className={`inline-block rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold ${palette.danger}`}>
                    Past use-by date
                  </span>
                </span>
              )}
            </span>

          </button>
        )
      })}
    </div>
  )

  return (
    <main className="min-h-screen">

      <div className={`${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pt-7">

        <div className="relative">
          <button
            type="button"
            aria-label="Open profile menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className="absolute right-0 top-1 rounded-full"
          >
            {renderProfileAvatar('h-14 w-14 text-lg')}
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-[5]"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />

              <div className={`absolute right-0 top-16 z-10 w-52 overflow-hidden rounded-2xl ${t.surface} shadow-xl`}>
                {[
                  ['Skin profile', 'skinProfile'],
                  ['Skin progress', 'progress'],
                  ['Challenges', 'challenges'],
                  ['Skin diary', 'progressPhotos'],
                  ['My profile & settings', 'settings'],
                ].map(([label, target]) => (
                  <button
                    key={target}
                    onClick={async () => {
                      setMenuOpen(false)
                      if (target === 'skinProfile') await loadSkinProfile()
                      setScreen(target)
                    }}
                    className={`block w-full px-5 py-3.5 text-left text-[15px] ${t.muted}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-1 pr-16">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Today
            </p>

            <h1 className="mt-1.5 font-display text-[44px] font-light leading-[1.02] tracking-tight">
              Hello, {displayName}
            </h1>

            {!onboardingCompleted && (
              <button
                onClick={() => setScreen('routinePlanner')}
                className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}
              >
                Complete your profile →
              </button>
            )}

          <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>
            Here's your skincare routine for today
          </p>

          <p className={`mt-2.5 text-sm ${t.muted}`}>
            {new Date(todayString + 'T00:00:00').toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          </div>
        </div>

        {/* Skin tip: white melting into soft brand blue, with a faint drop
            watermark in the corner. */}
        <div
          className={`relative mt-4 overflow-hidden rounded-3xl border p-5 ${
            isNight ? 'border-white/10' : 'border-[#1463F4]/10 shadow-[0_10px_30px_-18px_rgba(20,99,244,0.45)]'
          }`}
          style={{
            background: isNight
              ? 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(20,99,244,0.22) 100%)'
              : 'linear-gradient(135deg, #FFFFFF 0%, #F3F7FF 45%, #DCE8FF 100%)',
          }}
        >
          <svg aria-hidden="true" width="120" height="150" viewBox="0 0 24 30"
            className={`pointer-events-none absolute -bottom-8 -right-5 ${isNight ? 'text-white/[0.06]' : 'text-[#1463F4]/[0.08]'}`}>
            <path fill="currentColor" d="M12 1.5c.5 0 .9.3 1.2.8l7.6 14.6A9 9 0 1 1 3.2 16.9L10.8 2.3c.3-.5.7-.8 1.2-.8Z" />
          </svg>
          <div className="relative flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1463F4] text-white shadow-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isNight ? 'text-[#9BBEFF]' : 'text-[#1463F4]'}`}>
              {dailySkinTip[0]}
            </p>
          </div>
          <p className="relative mt-3 pr-10 font-display text-[21px] leading-snug">{dailySkinTip[1]}</p>
        </div>

        {homeAd && (
          <AdBanner
            key={homeAd.placement_id}
            ad={homeAd}
            supabase={supabase}
            t={t}
            isNight={isNight}
            onOpen={openAd}
            onHide={hideHomeAd}
          />
        )}

        {(() => {
          const pendingInvites = careRelationships.filter((r) => r.status === 'invited')
          const totalPending = pendingRecommendations.length + pendingInvites.length
          if (totalPending === 0) return null

          const label =
            pendingRecommendations.length > 0 && pendingInvites.length === 0
              ? pendingRecommendations.length === 1
                ? `${pendingRecommendations[0].practitioners?.display_name || 'A professional'} sent you a routine`
                : `${pendingRecommendations.length} new recommendations waiting`
              : pendingInvites.length > 0 && pendingRecommendations.length === 0
              ? pendingInvites.length === 1
                ? `${pendingInvites[0].practitioners?.display_name || 'A professional'} wants to connect`
                : `${pendingInvites.length} professionals want to connect`
              : `${totalPending} things need your attention`

          return (
            <button
              onClick={() => setScreen('notifications')}
              className={`mt-5 flex w-full items-center justify-between rounded-2xl ${t.chip} px-4 py-3.5 text-left`}
            >
              <span className="text-[14px] font-semibold">{label}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )
        })()}

        {(() => {
          const env = getInstallEnv()
          if (env.standalone && env.notifications === 'granted') return null
          return (
            <button
              type="button"
              onClick={openSetupGuide}
              className={`mt-6 flex w-full items-center gap-3 border-l-2 border-amber-400/80 py-1 pl-3.5 text-left`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">
                  {env.standalone ? 'Turn on reminders' : 'Add Tracka+ to your home screen'}
                </span>
                <span className={`block text-[12px] ${t.muted}`}>
                  {env.standalone
                    ? 'Get a nudge when it’s time for your routine.'
                    : 'One tap to open, plus morning and night reminders.'}
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-amber-600">Show me how</span>
            </button>
          )
        })()}

        <div id="am-routine" className="mt-10 scroll-mt-6">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Morning
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            AM Routine
          </h2>

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${t.muted}`}>Getting your routine…</p>
            ) : !todayAmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${t.muted}`}>
                  You haven't set up a morning routine yet.
                </p>
                <button
                  onClick={() => {
                    showLocalNotification('New product alert 👀', 'Remember: introduce slowly.')
                    setScreen('routinePlanner')
                  }}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              <>
                {renderSteps(amSteps, t, amFinished)}
                {renderExpiredNotice(amPlan)}
              </>
            )}
          </div>

          {amIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${t.hair} p-4`}>
              {amIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${t.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayAmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${t.faint}`}>
                {amDone} of {amSteps.length} done
              </p>

              {amFinished ? (
                <RoutineDoneBadge t={t} label="Morning routine complete" />
              ) : (
                <button
                  onClick={() => {
                    if (amSteps.length === 0 || amDone < amSteps.length) {
                      notify(amSteps.length === 0 ? 'Nothing is scheduled for this routine today.' : 'Complete every scheduled step first.')
                      return
                    }
                    finishRoutine('AM')
                  }}
                  className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
                >
                  Complete morning routine
                </button>
              )}
            </div>
          )}
        </div>

      </div>
      </div>

      <div className={`${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-28">
          <div className={`mt-10 border-t ${t.hair}`} aria-hidden="true" />

          <p className={`mt-10 text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Night
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            PM Routine
          </h2>

          {(() => {
            const held = nightPlan.skipped.filter((s) => s.reason === 'restricted')
            if (held.length === 0) return null

            return (
              <div className={`mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4`}>
                <p className="text-[13px] font-semibold text-amber-300">
                  Held back: {held.map((s) => s.step.name).join(', ')}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-amber-200/90">
                  {PREGNANCY_NOTE}
                </p>
              </div>
            )
          })()}

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${t.muted}`}>Getting your routine…</p>
            ) : !todayPmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${t.muted}`}>
                  You haven't set up a night routine yet.
                </p>
                <button
                  onClick={() => {
                    showLocalNotification('New product alert 👀', 'Remember: introduce slowly.')
                    setScreen('routinePlanner')
                  }}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              <>
                {renderSteps(pmSteps, t, pmFinished)}
                {renderExpiredNotice(nightPlan)}
              </>
            )}
          </div>

          {pmIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${t.hair} p-4`}>
              {pmIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${t.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayPmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${t.faint}`}>
                {pmDone} of {pmSteps.length} done
              </p>

              {pmFinished ? (
                <RoutineDoneBadge t={t} label="Night routine complete" />
              ) : (
                <button
                  onClick={() => {
                    if (pmSteps.length === 0 || pmDone < pmSteps.length) {
                      notify(pmSteps.length === 0 ? 'Nothing is scheduled for this routine today.' : 'Complete every scheduled step first.')
                      return
                    }
                    finishRoutine('PM')
                  }}
                  className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
                >
                  Complete night routine
                </button>
              )}
            </div>
          )}

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <h2 className={`text-[15px] font-semibold ${t.text}`}>
            Skin diary log
          </h2>

          <p className={`mt-1 text-[13px] ${t.muted}`}>
            How are you feeling today?
          </p>

          <button
            onClick={() => setScreen('progressPhotos')}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-bold ${t.btn}`}
          >
            Log skin diary
          </button>
        </div>

        {monthlyReport && (
          <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-[15px] font-semibold ${t.text}`}>
                {monthlyReport.monthLabel} report
              </h2>
              <button
                onClick={() => setScreen('skinTrends')}
                className={`text-[12px] font-semibold ${t.mark}`}
              >
                View full report
              </button>
            </div>

            <div className="mt-4 flex gap-5">
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.routineCompletionPct}%
                </p>
                <p className={`text-[11px] ${t.faint}`}>Routine completion</p>
              </div>
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.currentStreak}
                </p>
                <p className={`text-[11px] ${t.faint}`}>Current streak</p>
              </div>
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.photosAdded}
                </p>
                <p className={`text-[11px] ${t.faint}`}>Photos added</p>
              </div>
            </div>

            <button
              disabled={reportSharing}
              onClick={shareSkinReport}
              className={`mt-4 w-full rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-60`}
            >
              {reportSharing ? 'Preparing…' : 'Save report'}
            </button>
          </div>
        )}

        {(() => {
          const activeChallenges = myChallenges.filter(isLiveParticipation)

          return (
            <div className={`mt-8 mb-4 rounded-3xl border ${t.hair} p-4`}>
              <button
                type="button"
                onClick={() => setScreen('challenges')}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2.5">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                    strokeLinejoin="round" className={t.mark}>
                    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
                    <path d="M17 5h2.5a1.5 1.5 0 0 1 0 3H17M7 5H4.5a1.5 1.5 0 0 0 0 3H7" />
                  </svg>
                  <span className="text-[16px] font-semibold">Active Challenges</span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" className={t.muted}>
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {challengesLoading && myChallenges.length === 0 ? null : activeChallenges.length === 0 ? (
                <div className="mt-3">
                  <p className={`text-[14px] leading-relaxed ${t.muted}`}>
                    You're not participating in any challenges yet. Explore challenges and find one that fits your routine.
                  </p>
                  <button
                    type="button"
                    onClick={() => setScreen('challenges')}
                    className={`mt-3 text-[14px] font-semibold ${t.mark}`}
                  >
                    Explore challenges →
                  </button>
                </div>
              ) : (
                <div className="mt-3.5 flex flex-col gap-3">
                  {missingAmSunscreen &&
                    activeChallenges.some((p) => p.challenges?.rule === 'am_sunscreen') &&
                    renderSunscreenMissingNotice()}
                  {activeChallenges.slice(0, 2).map((p) => renderChallengeProgressCard(p, 'today'))}
                  {activeChallenges.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setScreen('challenges')}
                      className={`text-left text-[13px] font-semibold ${t.mark}`}
                    >
                      View all ({activeChallenges.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

      </div>
      </div>

      {renderBottomTabs('today', t)}
    </main>
  )
}

// Shown in place of the "Complete … routine" button once it's done for the
// day: a routine can only be completed once a day.
function RoutineDoneBadge({ t, label }) {
  return (
    <div
      role="status"
      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-[18px] text-base font-bold ${t.chip}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 12.5l5.2 5.2L20 7" />
      </svg>
      {label}
    </div>
  )
}
