// Challenges: three tabs (Available / In progress / Past), each a list of
// compact cards: picture, a status pill, title, one progress line and one
// clear action. In progress is the default while you're in a challenge.
// The challenge helpers live in App (Today and Discover share them), so
// they come in as props.

import { useState } from 'react'

// Remembered for the session, so coming back from a challenge returns to
// the same tab.
const remembered = { tab: null }
const rememberTab = (tab) => { remembered.tab = tab }

export default function ChallengesScreen({
  challenges,
  challengesLoading,
  challengeStats,
  challengeWindow,
  formatChallengeDate,
  isLiveParticipation,
  isNight,
  myChallenges,
  openChallenge,
  renderChallengeImage,
  setScreen,
  t,
}) {
  const active = myChallenges.filter(isLiveParticipation)
  const activeIds = new Set(active.map((p) => p.challenge_id))
  const available = challenges.filter((c) => !activeIds.has(c.id) && !challengeWindow(c).ended)
  // Finished or closed while you were in them, plus ended ones you never
  // joined (still worth seeing the results).
  const finished = myChallenges.filter(
    (p) => !isLiveParticipation(p) && (p.status === 'completed' || p.status === 'ended' || (p.status === 'active' && challengeWindow(p.challenges).ended))
  )
  const joinedIds = new Set(myChallenges.map((p) => p.challenge_id))
  const pastUnjoined = challenges.filter((c) => challengeWindow(c).ended && !joinedIds.has(c.id))

  const [tab, setTabState] = useState(remembered.tab || (active.length ? 'progress' : 'available'))
  const setTab = (next) => {
    rememberTab(next)
    setTabState(next)
  }

  const TABS = [
    ['available', 'Available', available.length],
    ['progress', 'In progress', active.length],
    ['past', 'Past', finished.length + pastUnjoined.length],
  ]

  const pill = isNight ? 'bg-white text-[#101B2D]' : 'bg-[#101B2D] text-white'
  const pillQuiet = isNight ? 'bg-white/10 text-white/75' : 'bg-[#101B2D]/[0.07] text-[#101B2D]/70'

  // One card. `action` is { label, onClick, done?, quiet? }.
  const card = ({ key, challenge, status, statusQuiet, sub, line, action, onOpen }) => (
    <div
      key={key}
      className={`rounded-3xl ${t.surface} p-3.5 ${isNight ? '' : 'shadow-[0_10px_30px_-22px_rgba(16,27,45,0.45)]'}`}
    >
      <button type="button" onClick={onOpen} className="flex w-full gap-3.5 text-left">
        {renderChallengeImage(challenge, 'h-24 w-24 shrink-0 rounded-2xl')}
        <span className="flex min-w-0 flex-1 flex-col pt-0.5">
          <span className={`self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusQuiet ? pillQuiet : pill}`}>
            {status}
          </span>
          {sub && <span className={`mt-1.5 truncate text-[12px] ${t.faint}`}>{sub}</span>}
          <span className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">{challenge?.title}</span>
        </span>
      </button>
      {line && <p className={`mt-3 px-1 text-[12.5px] font-medium ${t.muted}`}>{line}</p>}
      {action && (
        action.done ? (
          <div className={`mt-2 w-full rounded-2xl border py-3 text-center text-[14px] font-semibold ${t.hair}`}>
            {action.label}
          </div>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className={`mt-2 w-full rounded-2xl py-3 text-[14px] font-bold ${action.quiet ? `border ${t.hair}` : t.btn}`}
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )

  const daysLeftText = (n) => `${n} ${n === 1 ? 'day' : 'days'} left`

  let list
  if (tab === 'progress') {
    list = active.map((p) => {
      const c = p.challenges
      const s = challengeStats(p)
      const open = () => openChallenge(p.challenge_id, 'challenges')
      if (s.notStarted) {
        return card({
          key: p.id, challenge: c, status: 'Starting soon', sub: c?.sponsor_name, onOpen: open,
          line: `Starts ${formatChallengeDate(c.starts_on)}`,
          action: { label: 'View challenge', onClick: open, quiet: true },
        })
      }
      return card({
        key: p.id, challenge: c, status: 'In progress', sub: c?.sponsor_name || `${s.total}-day challenge`, onOpen: open,
        line: `Day ${s.day} of ${s.total} · ${s.done} of ${s.target} done${s.hasWindow ? ` · ${daysLeftText(s.daysLeft)}` : ''}`,
        action: s.doneToday
          ? { label: 'Done for today!', done: true }
          : { label: 'Go to complete', onClick: () => setScreen('today') },
      })
    })
  } else if (tab === 'available') {
    list = available.map((c) => {
      const w = challengeWindow(c)
      const open = () => openChallenge(c.id, 'challenges')
      return card({
        key: c.id, challenge: c, status: w.notStarted ? `Starts ${formatChallengeDate(c.starts_on)}` : 'Open to join',
        sub: c.sponsor_name || `${c.duration_days}-day challenge`, onOpen: open,
        line: w.hasWindow && !w.notStarted
          ? `${formatChallengeDate(c.starts_on)} – ${formatChallengeDate(c.ends_on)} · ${daysLeftText(w.daysLeft)}`
          : c.tagline,
        action: { label: 'View challenge', onClick: open },
      })
    })
  } else {
    list = [
      ...finished.map((p) => {
        const c = p.challenges
        const completedAll = p.status === 'completed'
        const open = () => openChallenge(p.challenge_id, 'challenges')
        return card({
          key: p.id, challenge: c, status: completedAll ? 'Completed' : 'Ended', statusQuiet: !completedAll,
          sub: c?.sponsor_name, onOpen: open,
          line: completedAll
            ? `Completed ${new Date(p.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : `Ended ${formatChallengeDate(c.ends_on, true)} · ${p.days_completed}/${c.duration_days} days`,
          action: { label: 'See results', onClick: open, quiet: true },
        })
      }),
      ...pastUnjoined.map((c) => {
        const open = () => openChallenge(c.id, 'challenges')
        return card({
          key: c.id, challenge: c, status: 'Ended', statusQuiet: true, sub: c.sponsor_name, onOpen: open,
          line: `Ended ${formatChallengeDate(c.ends_on, true)}`,
          action: { label: 'See results', onClick: open, quiet: true },
        })
      }),
    ]
  }

  const EMPTY = {
    progress: "You're not in a challenge right now. Join one from Available.",
    available: "No new challenges right now. New ones are on the way.",
    past: 'Challenges you finish will be kept here.',
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">
        <button onClick={() => setScreen('today')} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Today
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">My challenges</h1>
          <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>Small habits, built one day at a time.</p>
        </div>

        {/* Tabs */}
        <div role="tablist" className={`mt-6 grid grid-cols-3 border-b ${t.hair}`}>
          {TABS.map(([key, label, count]) => {
            const on = tab === key
            return (
              <button
                key={key}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => setTab(key)}
                className={`relative pb-3 pt-1 text-[14px] transition ${on ? 'font-semibold' : t.faint}`}
              >
                {label}
                {count > 0 && <span className={`ml-1 tabular-nums ${on ? t.mark : ''}`}>{count}</span>}
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full transition ${on ? (isNight ? 'bg-white' : 'bg-[#101B2D]') : 'bg-transparent'}`}
                />
              </button>
            )
          })}
        </div>

        {challengesLoading && challenges.length === 0 ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : list.length === 0 ? (
          <div className={`mt-6 rounded-3xl ${t.surface} p-6 text-center`}>
            <p className={`text-[14px] leading-relaxed ${t.muted}`}>{EMPTY[tab]}</p>
            {tab === 'progress' && available.length > 0 && (
              <button type="button" onClick={() => setTab('available')} className={`mt-4 rounded-xl px-5 py-3 text-[13px] font-semibold ${t.btn}`}>
                See available challenges
              </button>
            )}
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3.5">{list}</div>
        )}
      </div>
    </main>
  )
}
