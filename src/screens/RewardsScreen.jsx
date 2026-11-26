// My rewards: every award earned across all challenges (medals and cups)
// and a digital certificate for each finished challenge.
//
// Nothing new is stored. Awards come from challengeAwards() over the
// recorded challenge days (same as the challenge page), so the two can
// never disagree. Certificates are drawn on demand from the participation.
//
// Certificate rules:
// - unlocked once the challenge is over: its shared window has ended, or
//   (challenges without a window) the person completed it
// - at least one day checked in, and not left part-way
// - "of Achievement" if they reached the goal, "of Participation" otherwise
// - printed with their first + last name (Settings → Your details),
//   falling back to the username

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { challengeAwards } from '../lib/core/awards'

const longDate = (d) =>
  (d instanceof Date ? d : new Date(`${d}T00:00:00`))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export default function RewardsScreen({
  t,
  isNight,
  user,
  myChallenges,
  challengesLoading,
  challengeTarget,
  challengeWindow,
  challengeInProgress,
  formatChallengeDate,
  renderAwardIcon,
  saveAward,
  awardSaving,
  openChallenge,
  notify,
  onBack,
  onEditDetails,
  onFindChallenges,
}) {
  const [profile, setProfile] = useState(null)
  const [savingCert, setSavingCert] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('username, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data || {}) })
    return () => { cancelled = true }
  }, [user?.id])

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
  const certName = fullName || profile?.username || user?.email?.split('@')[0] || 'Tracka+ member'

  const entries = myChallenges.map((p) => {
    const challenge = p.challenges || {}
    const win = challengeWindow(challenge)
    const target = challengeTarget(challenge)
    const duration = challenge.duration_days || 30
    const done = p.days_completed || 0
    const awards = challengeAwards(
      (p.challenge_days || []).map((d) => d.local_date),
      target,
      { overTheLine: challengeInProgress(challenge), challengeEnded: win.ended }
    )
    const over = win.hasWindow ? win.ended : p.status === 'completed' || p.status === 'ended'
    const certificate = over && done >= 1 && p.status !== 'left'
    return { p, challenge, win, target, duration, done, awards, earned: awards.filter((a) => a.earned), over, certificate }
  })

  const earnedCount = entries.reduce((n, e) => n + e.earned.length, 0)
  const cupCount = entries.reduce((n, e) => n + e.earned.filter((a) => a.kind === 'cup').length, 0)
  const certCount = entries.filter((e) => e.certificate).length

  const saveCertificate = async (entry) => {
    if (savingCert) return
    setSavingCert(entry.p.id)
    try {
      const { challenge, p, done, duration, target } = entry
      const range = challenge.starts_on && challenge.ends_on
        ? ` · ${formatChallengeDate(challenge.starts_on)} – ${formatChallengeDate(challenge.ends_on, true)}`
        : ''
      const issued = challenge.ends_on
        ? longDate(challenge.ends_on)
        : longDate(p.completed_at ? new Date(p.completed_at) : new Date())
      const { generateCertificateImage } = await import('../lib/shareImage')
      const blob = await generateCertificateImage({
        name: certName,
        challengeTitle: challenge.title || 'Tracka+ Challenge',
        achieved: done >= target,
        detail: `${Math.min(done, duration)} of ${duration} days checked in${range}`,
        sponsor: challenge.sponsor_name || null,
        issuedLabel: issued,
        certificateId: String(p.id).replace(/-/g, '').slice(0, 8).toUpperCase(),
      })
      const slug = (challenge.slug || 'challenge').replace(/[^a-z0-9-]/gi, '')
      const fileName = `tracka-certificate-${slug}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      const caption = `🎓 My certificate for ${challenge.title || 'a challenge'} on Tracka+`

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Tracka+', text: caption })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
        notify?.('Saved. Find it in your downloads.', 'success')
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('SAVE CERTIFICATE ERROR:', err)
        notify?.("Couldn't make your certificate. Please try again.")
      }
    } finally {
      setSavingCert(null)
    }
  }

  const stat = (value, label) => (
    <div className={`rounded-3xl ${t.surface} p-4`}>
      <p className="text-[28px] font-semibold tabular-nums leading-none">{value}</p>
      <p className={`mt-1.5 text-[12.5px] ${t.muted}`}>{label}</p>
    </div>
  )

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Back
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">My rewards</h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Every medal, cup and certificate you&apos;ve earned in challenges, kept in one place.
          </p>
        </div>

        {challengesLoading && !myChallenges.length ? (
          <p className={`mt-8 text-[14px] ${t.muted}`}>Loading your rewards…</p>
        ) : !entries.length ? (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[16px] font-semibold">No rewards yet</p>
            <p className={`mt-1 text-[14px] leading-relaxed ${t.muted}`}>
              Join a challenge to earn medals along the way, a cup at the finish, and a certificate when it ends.
            </p>
            <button type="button" onClick={onFindChallenges}
              className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}>
              See challenges
            </button>
          </div>
        ) : (
          <>
            <div className="mt-7 grid grid-cols-3 gap-2.5">
              {stat(earnedCount, earnedCount === 1 ? 'award' : 'awards')}
              {stat(cupCount, cupCount === 1 ? 'cup' : 'cups')}
              {stat(certCount, certCount === 1 ? 'certificate' : 'certificates')}
            </div>

            {profile && !fullName && certCount > 0 && (
              <button type="button" onClick={onEditDetails}
                className={`mt-4 rounded-3xl border p-4 text-left text-[13.5px] leading-relaxed ${
                  isNight ? 'border-white/10 bg-[#13203A]' : 'border-[#1463F4]/10 bg-[#EAF1FF] text-[#14306B]'
                }`}>
                <span className="font-semibold">Add your name for your certificates.</span>{' '}
                Right now they&apos;ll show your username. Tap to add it in Your details.
              </button>
            )}

            <div className="mt-6 flex flex-col gap-4">
              {entries.map((e) => (
                <section key={e.p.id} className={`rounded-3xl ${t.surface} p-4`}>
                  <button type="button" onClick={() => openChallenge(e.p.challenge_id, 'rewards')} className="block w-full text-left">
                    <p className="text-[16px] font-semibold leading-snug">{e.challenge.title}</p>
                    <p className={`mt-0.5 text-[12.5px] ${t.faint}`}>
                      {e.p.status === 'left'
                        ? `Left · ${e.done} ${e.done === 1 ? 'day' : 'days'} checked in`
                        : e.over
                          ? `Finished · ${e.done} of ${e.duration} days`
                          : `In progress · ${e.done} of ${e.duration} days`}
                    </p>
                  </button>

                  {e.earned.length ? (
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {e.earned.map((award) => (
                        <button
                          key={award.key}
                          type="button"
                          disabled={!!awardSaving}
                          onClick={() => saveAward(award, e.p)}
                          className={`flex flex-col items-center gap-1.5 rounded-2xl border ${t.hair} px-1 py-3 text-center`}
                        >
                          {renderAwardIcon(award, 44)}
                          <span className="text-[11px] font-semibold leading-tight">
                            {awardSaving === award.key ? 'Saving…' : award.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className={`mt-3 text-[13px] ${t.muted}`}>No awards yet. Your first one comes with day one.</p>
                  )}
                  {e.earned.length > 0 && (
                    <p className={`mt-2 px-1 text-[11.5px] ${t.faint}`}>Tap an award to save or share it.</p>
                  )}

                  {e.certificate ? (
                    <button
                      type="button"
                      disabled={!!savingCert}
                      onClick={() => saveCertificate(e)}
                      className={`mt-3 w-full rounded-2xl py-3.5 text-[14px] font-bold ${t.btn} disabled:opacity-60`}
                    >
                      {savingCert === e.p.id ? 'Making your certificate…' : '🎓 Get my certificate'}
                    </button>
                  ) : !e.over && e.p.status !== 'left' && (
                    <p className={`mt-3 rounded-2xl border ${t.hair} px-3 py-2.5 text-[12.5px] leading-relaxed ${t.muted}`}>
                      {e.win.hasWindow
                        ? `Your certificate unlocks when the challenge ends on ${formatChallengeDate(e.challenge.ends_on, true)}.`
                        : 'Your certificate unlocks when you finish this challenge.'}
                    </p>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
