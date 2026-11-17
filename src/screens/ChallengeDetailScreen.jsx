// Challenge detail — progress track, awards, join/leave, invite. Loaded on
// demand. Moved out of App.jsx; shared state comes in as props for now.

import { challengeAwards, challengePoints, challengeStreak } from '../lib/core/awards'
import { addDays, localDateString } from '../lib/core/planNight'
import { FLAME_PATH, flameColorForStreak } from '../lib/core/flameColor'
import SponsoredCard from '../ads/SponsoredCard'
import { useAds } from '../data/ads'
import { supabase } from '../lib/supabase'

export default function ChallengeDetailScreen({
  openAd,
  userId,
  awardSaving,
  busyAction,
  challengeMenuOpen,
  challengeReturnScreen,
  challengeStats,
  challengeTarget,
  challengeWindow,
  challenges,
  challengesLoading,
  formatChallengeDate,
  goToMorningRoutine,
  isLiveParticipation,
  isNight,
  joinChallenge,
  leaveChallenge,
  missingAmSunscreen,
  myChallenges,
  renderAchievements,
  renderAwardIcon,
  renderChallengeImage,
  renderLaurelIcon,
  renderSunscreenMissingNotice,
  runBusy,
  saveAward,
  selectedChallengeId,
  setChallengeMenuOpen,
  setScreen,
  shareChallenge,
  t,
  todayString,
}) {
  const sponsoredChallengeAds = useAds(userId, 'sponsored_challenge')
  const mine = myChallenges.filter((p) => p.challenge_id === selectedChallengeId)
  // Live = still ticking: active, or completed inside a running window.
  const participation = mine.find(isLiveParticipation) || null
  const lastCompleted = participation ? null : mine.find((p) => p.status === 'completed')
  // Didn't reach the finish line before the window closed — final result.
  // ('ended' once the database has closed it; still 'active' until then.)
  const endedRow = participation
    ? null
    : mine.find((p) => p.status === 'ended' || (p.status === 'active' && challengeWindow(p.challenges).ended)) || null
  const challenge =
    challenges.find((c) => c.id === selectedChallengeId) ||
    mine[0]?.challenges
  const win = challengeWindow(challenge)
  // A live sponsor campaign for this challenge, if any.
  const sponsorAd = challenge ? sponsoredChallengeAds.find((ad) => ad.challenge_id === challenge.id) || null : null
  const sponsorCard = sponsorAd && (
    <SponsoredCard ad={sponsorAd} supabase={supabase} t={t} isNight={isNight} onOpen={openAd} compact />
  )

  const backLabel = challengeReturnScreen === 'today' ? 'Today' : 'Challenges'

  const backButton = (label) => (
    <button
      onClick={() => setScreen(challengeReturnScreen)}
      className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </button>
  )

  if (!challenge) {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">
          {backButton(backLabel)}
          <p className={`mt-8 text-[14px] ${t.muted}`}>
            {challengesLoading ? 'Loading…' : "This challenge isn't available any more."}
          </p>
        </div>
      </main>
    )
  }

  // Active challenge dashboard.
  if (participation) {
    const { total, target, done, doneToday, day, pct, hasWindow, daysLeft } = challengeStats(participation)
    const reachedTarget = done >= target

    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

          <div className="relative flex items-center justify-between">
            {backButton('Active Challenge')}

            <div className="flex items-center">
              <button
                type="button"
                aria-label="Invite a friend"
                onClick={() => shareChallenge(challenge, participation)}
                className={`flex h-10 w-10 items-center justify-center rounded-full ${t.muted}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" />
                  <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
                </svg>
              </button>

              <button
                type="button"
                aria-label="Challenge options"
                onClick={() => setChallengeMenuOpen(!challengeMenuOpen)}
                className={`flex h-10 w-10 items-center justify-center rounded-full ${t.muted}`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </div>

            {challengeMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[5]"
                  aria-hidden="true"
                  onClick={() => setChallengeMenuOpen(false)}
                />
                <div className={`absolute right-0 top-11 z-10 w-48 overflow-hidden rounded-2xl ${t.surface} shadow-xl`}>
                  <button
                    type="button"
                    onClick={() => {
                      setChallengeMenuOpen(false)
                      leaveChallenge(participation)
                    }}
                    className={`block w-full px-5 py-3.5 text-left text-[15px] ${t.danger}`}
                  >
                    Leave challenge
                  </button>
                </div>
              </>
            )}
          </div>

          {renderChallengeImage(challenge, 'mt-4 h-52 w-full rounded-3xl')}
          {sponsorCard}

          <div className="mt-5 flex items-start justify-between gap-3">
            <h1 className="text-[26px] font-semibold leading-tight">{challenge.title}</h1>
            {reachedTarget ? (
              <span className="mt-1 shrink-0 rounded-full bg-gradient-to-r from-[#F5C451] to-[#E08A1E] px-3 py-1 text-[12px] font-semibold text-white">
                Completed
              </span>
            ) : (
              <span className="mt-1 shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[12px] font-semibold text-emerald-500">
                Active
              </span>
            )}
          </div>
          {challenge.active_subtitle && (
            <p className={`mt-1.5 text-[15px] leading-relaxed ${t.muted}`}>{challenge.active_subtitle}</p>
          )}


          {(() => {
            const dates = (participation.challenge_days || []).map((d) => d.local_date).sort()
            const streak = challengeStreak(dates, todayString)
            const best = (() => {
              let longest = 0, run = 0, prev = null
              for (const d of dates) {
                run = prev && addDays(prev, 1) === d ? run + 1 : 1
                longest = Math.max(longest, run)
                prev = d
              }
              return longest
            })()
            const points = challengePoints(done)
            const awards = challengeAwards(dates, target, { overTheLine: hasWindow })
            const half = Math.ceil(target / 2)
            const tickedSet = new Set(dates)
            // Days before you joined aren't "missed" — you weren't in yet.
            const joinedOn = participation.joined_at
              ? localDateString(new Date(participation.joined_at))
              : challenge.starts_on

            // The nearest unearned reward, phrased as what it takes to get it.
            // Next milestone, shown quietly under the track. Skipped before
            // the first day — the check-in card below already covers that.
            // In a shared-window challenge, late joiners can't reach every
            // award — only point at ones still reachable in the days left.
            const tickableLeft = hasWindow ? daysLeft - (doneToday ? 1 : 0) : Infinity
            const needed = (a) =>
              a.key === 'week' ? 7 - streak : (a.key === 'half' ? half : target) - done
            const nextAward = awards.find(
              (a) => !a.earned && a.key !== 'first' && needed(a) <= tickableLeft
            )
            const remaining = nextAward ? needed(nextAward) : 0
            const nextLine = !nextAward || done === 0
              ? null
              : {
                  name: nextAward.key === 'week' ? 'Silver medal' : nextAward.key === 'half' ? 'Gold medal' : 'The cup',
                  detail: nextAward.key === 'week'
                    ? `${remaining} ${remaining === 1 ? 'day' : 'days'} in a row`
                    : `${remaining} ${remaining === 1 ? 'day' : 'days'} to go`,
                }

            // Progress ring geometry.
            const R = 52
            const C = 2 * Math.PI * R

            return (
              <>
                <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
                  <div className="flex items-center gap-5">
                    <div className="relative h-[124px] w-[124px] shrink-0">
                      <svg width="124" height="124" viewBox="0 0 124 124" className="-rotate-90">
                        <defs>
                          <linearGradient id="challenge-ring" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#F5C451" />
                            <stop offset="1" stopColor="#E08A1E" />
                          </linearGradient>
                        </defs>
                        <circle cx="62" cy="62" r={R} fill="none" strokeWidth="10"
                          className={isNight ? 'stroke-white/10' : 'stroke-[#101B2D]/8'} />
                        <circle cx="62" cy="62" r={R} fill="none" strokeWidth="10"
                          stroke="url(#challenge-ring)" strokeLinecap="round"
                          strokeDasharray={C}
                          strokeDashoffset={C * (1 - Math.min(done, target) / target)}
                          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[30px] font-semibold leading-none">{done}</span>
                        <span className={`mt-1 text-[11px] font-medium ${t.faint}`}>{reachedTarget ? `days · goal ${target}` : `of ${target} days`}</span>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-3">
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Points</p>
                        <p className="text-[22px] font-semibold leading-tight text-amber-500">{points}</p>
                      </div>
                      <div className="flex gap-5">
                        <div>
                          <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Streak</p>
                          <p className="flex items-center gap-1 text-[17px] font-semibold leading-tight">
                            {streak}
                            {streak > 0 && (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill={flameColorForStreak(streak)}>
                                <path d={FLAME_PATH} />
                              </svg>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Best</p>
                          <p className="text-[17px] font-semibold leading-tight">{best}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className={`mt-4 text-[13px] ${t.muted}`}>
                    Day {day} of {total} · {hasWindow ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : `${pct}% complete`}
                  </p>

                  {/* 30-dot journey. The halfway medal and the cup sit on the
                      track itself so the distance to each is visible. */}
                  {hasWindow ? (
                  // Shared-window challenge: one dot per calendar day, so a
                  // missed day shows as a grey dot in its place. The medal
                  // and cup sit on the day they were won.
                  <div className="mt-3 grid grid-cols-10 gap-1.5">
                    {Array.from({ length: total }).map((_, i) => {
                      const date = addDays(challenge.starts_on, i)
                      const ticked = tickedSet.has(date)
                      const awardKey = date === dates[target - 1] ? 'complete' : date === dates[half - 1] ? 'half' : null
                      if (awardKey) {
                        const award = awards.find((a) => a.key === awardKey)
                        return (
                          <span key={date} className="flex aspect-square items-center justify-center"
                            title={`${award.label} · ${formatChallengeDate(date)}`}>
                            {renderAwardIcon(award, 26, false)}
                          </span>
                        )
                      }
                      const isToday = date === todayString
                      const missed = !ticked && date < todayString && date >= joinedOn
                      return (
                        <span key={date} className="flex aspect-square items-center justify-center"
                          title={`${formatChallengeDate(date)}${ticked ? ' · done' : missed ? ' · missed' : ''}`}>
                          <span
                            className={`block h-3.5 w-3.5 rounded-full transition ${
                              ticked
                                ? 'bg-gradient-to-br from-[#F5C451] to-[#E08A1E]'
                                : missed
                                ? isNight ? 'bg-white/35' : 'bg-[#101B2D]/25'
                                : isToday
                                ? 'animate-pulse border-2 border-amber-500'
                                : isNight ? 'bg-white/10' : 'bg-[#101B2D]/8'
                            }`}
                          />
                        </span>
                      )
                    })}
                  </div>
                  ) : (
                  <div className="mt-3 grid grid-cols-10 gap-1.5">
                    {Array.from({ length: total }).map((_, i) => {
                      const n = i + 1
                      const filled = n <= done
                      const isNext = n === done + 1 && !doneToday
                      if (n === half || n === target) {
                        const award = awards.find((a) => a.key === (n === target ? 'complete' : 'half'))
                        return (
                          <span key={n} className="flex aspect-square items-center justify-center"
                            title={award.label}>
                            {renderAwardIcon(award, 26, !award.earned)}
                          </span>
                        )
                      }
                      return (
                        <span key={n} className="flex aspect-square items-center justify-center">
                          <span
                            className={`block h-3.5 w-3.5 rounded-full transition ${
                              filled
                                ? 'bg-gradient-to-br from-[#F5C451] to-[#E08A1E]'
                                : isNext
                                ? 'animate-pulse border-2 border-amber-500'
                                : isNight ? 'bg-white/10' : 'bg-[#101B2D]/8'
                            }`}
                          />
                        </span>
                      )
                    })}
                  </div>
                  )}

                  {hasWindow && (
                    <div className={`mt-3 flex items-center gap-4 text-[11px] ${t.faint}`}>
                      <span className="flex items-center gap-1.5">
                        <span className="block h-2 w-2 rounded-full bg-gradient-to-br from-[#F5C451] to-[#E08A1E]" />Done
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className={`block h-2 w-2 rounded-full ${isNight ? 'bg-white/35' : 'bg-[#101B2D]/25'}`} />Missed
                      </span>
                    </div>
                  )}

                  {nextLine && (
                    <div className={`mt-5 flex items-center justify-between gap-3 border-t pt-4 ${t.hair}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="shrink-0">{renderAwardIcon(nextAward, 28, true)}</span>
                        <div className="min-w-0">
                          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>Next</p>
                          <p className="truncate text-[14px] font-medium">{nextLine.name}</p>
                        </div>
                      </div>
                      <p className={`shrink-0 text-[13px] ${t.muted}`}>{nextLine.detail}</p>
                    </div>
                  )}

                  {hasWindow && !reachedTarget && done + tickableLeft < target && (
                    <p className={`mt-4 border-t pt-4 text-[13px] leading-relaxed ${t.hair} ${t.muted}`}>
                      Not enough days left to reach {target} this round — every day you tick still counts on the leaderboard.
                    </p>
                  )}
                </div>

                {missingAmSunscreen && challenge.rule === 'am_sunscreen' && !doneToday &&
                  renderSunscreenMissingNotice('mt-4')}

                <div className={`mt-4 rounded-3xl border p-5 ${
                  doneToday ? 'border-emerald-400/30 bg-emerald-400/5' : `${t.hair} ${t.surface}`
                }`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      doneToday ? 'bg-emerald-500 text-white' : 'bg-amber-400/15 text-amber-500'
                    }`}>
                      {doneToday ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <circle cx="12" cy="12" r="4" />
                          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[16px] font-semibold">Today's sunscreen check-in</p>
                      {!doneToday && (
                        <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                          {challenge.goal_text || 'Complete the sunscreen step in your morning routine.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {doneToday ? (
                    <p className="mt-4 rounded-2xl bg-emerald-500/10 py-3 text-center text-[14px] font-semibold text-emerald-600">
                      Checked in for today ✓
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={goToMorningRoutine}
                        className={`mt-4 w-full rounded-2xl py-4 text-[15px] font-bold ${t.btn}`}
                      >
                        Go to morning routine
                      </button>
                      <p className={`mt-2 text-center text-[12px] ${t.faint}`}>
                        Progress updates automatically when you tick sunscreen.
                      </p>
                    </>
                  )}
                </div>
              </>
            )
          })()}

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setScreen('challengeLeaderboard')}
              className={`flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair}`}
            >
              {renderLaurelIcon(22)}
              Leaderboard
            </button>
            <button
              type="button"
              onClick={() => shareChallenge(challenge, participation)}
              className={`flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} ${t.mark}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
              </svg>
              Invite a friend
            </button>
          </div>

          {renderAchievements(participation)}

        </div>
      </main>
    )
  }

  // Before joining (or after completing / leaving — they can join again).
  const HOW_IT_WORKS = [
    ['Apply your sunscreen', 'Follow your usual morning skincare routine.'],
    ['Tick it in Tracka+', 'Complete the sunscreen step in your existing morning routine. Your challenge progress updates automatically.'],
    win.hasWindow
      ? [`Keep going until ${formatChallengeDate(challenge.ends_on)}`, `Tick sunscreen on ${challengeTarget(challenge)} of the ${challenge.duration_days} days. Missed days are fine.`]
      : [`Keep going for ${challenge.duration_days} days`, 'Track your progress as you build the habit.'],
  ]
  const canJoin = !win.ended && !(win.hasWindow && lastCompleted)

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        {backButton(challengeReturnScreen === 'today' ? 'Today' : 'Discover Challenges')}

        {renderChallengeImage(challenge, 'mt-4 h-60 w-full rounded-3xl')}
        {sponsorCard}

        {!sponsorAd && challenge.sponsor_name && (
          <p className={`mt-3 text-[12px] font-medium ${t.faint}`}>
            In partnership with {challenge.sponsor_name}
          </p>
        )}

        <h1 className="mt-5 font-display text-[34px] font-light leading-[1.05] tracking-tight">
          {challenge.title}
        </h1>
        <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>
          A little consistency goes a long way.
        </p>

        {lastCompleted && (() => {
          const cup = challengeAwards(
            (lastCompleted.challenge_days || []).map((d) => d.local_date),
            challengeTarget(challenge)
          ).find((a) => a.kind === 'cup')

          return (
            <>
              <div className="mt-5 rounded-3xl border border-amber-400/40 bg-amber-400/10 p-5 text-center">
                <div className="flex justify-center">{renderAwardIcon(cup, 96)}</div>
                <p className="mt-2 text-[18px] font-semibold">Challenge complete!</p>
                <p className={`mt-1 text-[13px] ${t.muted}`}>
                  You reached {challengeTarget(challenge)} days on{' '}
                  {new Date(lastCompleted.completed_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}.
                </p>
                <button
                  type="button"
                  disabled={!!awardSaving}
                  onClick={() => saveAward(cup, lastCompleted)}
                  className={`mt-4 w-full rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-60`}
                >
                  {awardSaving === 'complete' ? 'Preparing…' : 'Save my trophy'}
                </button>
              </div>
              {renderAchievements(lastCompleted)}
            </>
          )
        })()}

        {win.ended && !lastCompleted && (
          <div className={`mt-5 rounded-3xl border ${t.hair} ${t.surface} p-5`}>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>
              Ended {formatChallengeDate(challenge.ends_on, true)}
            </p>
            <p className="mt-1.5 text-[18px] font-semibold">This challenge is over</p>
            {endedRow && (
              <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                You checked in for {endedRow.days_completed} of {challenge.duration_days} days.
              </p>
            )}
          </div>
        )}
        {endedRow && renderAchievements(endedRow)}

        {!win.ended && challenge.description && (
          <section className="mt-7">
            <h2 className="text-[17px] font-semibold">What's the challenge?</h2>
            <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>{challenge.description}</p>
          </section>
        )}

        {!win.ended && <section className="mt-7">
          <h2 className="text-[17px] font-semibold">How it works</h2>
          <ol className="mt-3 flex flex-col gap-4">
            {HOW_IT_WORKS.map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${t.node}`}>
                  {i + 1}
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{title}</span>
                  <span className={`mt-0.5 block text-[14px] leading-relaxed ${t.muted}`}>{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>}

        <div className={`mt-7 overflow-hidden rounded-2xl border ${t.hair}`}>
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className={`text-[14px] ${t.muted}`}>{win.hasWindow ? 'Runs' : 'Duration'}</span>
            <span className="text-[15px] font-semibold">
              {win.hasWindow
                ? `${formatChallengeDate(challenge.starts_on)} – ${formatChallengeDate(challenge.ends_on)}`
                : `${challenge.duration_days} days`}
            </span>
          </div>
          {win.hasWindow && !win.ended && (
            <div className={`flex items-center justify-between border-t px-4 py-3.5 ${t.hair}`}>
              <span className={`text-[14px] ${t.muted}`}>{win.notStarted ? 'Starts in' : 'Days left'}</span>
              <span className="text-[15px] font-semibold text-amber-600">
                {win.notStarted
                  ? `${1 - win.challengeDay} ${1 - win.challengeDay === 1 ? 'day' : 'days'}`
                  : `${win.daysLeft} of ${challenge.duration_days}`}
              </span>
            </div>
          )}
        </div>

        {canJoin ? (
          <>
            {win.hasWindow && !win.notStarted && win.daysLeft < challengeTarget(challenge) && (
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3.5">
                <p className="text-[14px] font-semibold text-amber-700">
                  Too late to complete this challenge
                </p>
                <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                  Only {win.daysLeft} {win.daysLeft === 1 ? 'day is' : 'days are'} left. The challenge requires {challengeTarget(challenge)} check-ins, but every check-in still counts on the leaderboard.
                </p>
              </div>
            )}

            <p className={`mt-4 text-[12px] leading-relaxed ${t.faint}`}>
              Joining adds your username and days to this challenge's public leaderboard. You can hide your name at any time from the leaderboard.
            </p>

            <button
              type="button"
              disabled={!!busyAction}
              onClick={() => runBusy(`joinChallenge-${challenge.id}`, () => joinChallenge(challenge, sponsorAd?.placement_id))}
              className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
            >
              {busyAction === `joinChallenge-${challenge.id}`
                ? 'Joining…'
                : lastCompleted ? 'Join again' : 'Join challenge'}
            </button>

            <div className="mt-3 flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => setScreen('challengeLeaderboard')}
                className={`flex items-center gap-1.5 py-2 text-[14px] font-semibold ${t.mark}`}
              >
                {renderLaurelIcon(20)}
                See the leaderboard
              </button>
              <button
                type="button"
                onClick={() => shareChallenge(challenge, null)}
                className={`py-2 text-[14px] font-semibold ${t.mark}`}
              >
                Invite a friend
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setScreen('challengeLeaderboard')}
            className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            {win.ended ? 'See final results' : 'See the leaderboard'}
          </button>
        )}

      </div>
    </main>
  )
}
