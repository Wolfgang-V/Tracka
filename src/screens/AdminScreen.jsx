// Admin dashboard — signups, practitioner review, challenge stats, product
// insights, referrals and ads. Loaded on demand (only the admin account ever
// opens it), and owns all of its own state, so none of it ships to or
// re-renders for everyone else. Server-side, every admin RPC checks the
// caller itself; this screen is only the UI.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDateString } from '../lib/core/planNight'

export default function AdminScreen({
  t, isNight, notify, confirmAction, busyAction, runBusy, setScreen,
  setUser, setPractitionerStatus, practitionersLaunched, setPractitionersLaunched,
  renderProductArt, adminTab, setAdminTab,
}) {
  const [adminUsers, setAdminUsers] = useState([])
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminError, setAdminError] = useState(null)
  const [pendingPractitioners, setPendingPractitioners] = useState([])
  const [pendingPractitionersLoading, setPendingPractitionersLoading] = useState(true)
  const [verifiedPractitionersAdmin, setVerifiedPractitionersAdmin] = useState([])
  const [verifiedPractitionersAdminLoading, setVerifiedPractitionersAdminLoading] = useState(true)
  const [adminSignupsQuery, setAdminSignupsQuery] = useState('')
  const [adminChallengeStats, setAdminChallengeStats] = useState([])
  const [adminChallengeStatsLoading, setAdminChallengeStatsLoading] = useState(true)
  const [adminChallengeParticipants, setAdminChallengeParticipants] = useState({})
  const [adminOpenChallengeId, setAdminOpenChallengeId] = useState(null)
  // Admin → Products: what people actually use.
  const [productInsights, setProductInsights] = useState(null)
  const [insightsView, setInsightsView] = useState('products')
  const [insightsQuery, setInsightsQuery] = useState('')
  // Admin → Referrals: flyer QR codes per store/clinic and what they produced.
  const [referralReport, setReferralReport] = useState(null)
  const [newReferral, setNewReferral] = useState({ code: '', partner: '', kind: 'store', label: '', city: '', phone: '' })
  const [newReferralOpen, setNewReferralOpen] = useState(false)

  const loadReferralReport = async () => {
    const { data, error } = await supabase.rpc('admin_referral_report')
    if (error) {
      console.error('REFERRAL REPORT ERROR:', error)
      return
    }
    setReferralReport(data)
  }

  const saveReferralCode = async () => {
    const code = newReferral.code.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) {
      notify('Code must be 2–24 letters, numbers or dashes, e.g. BEAUTYHUT-LEKKI.')
      return
    }
    if (!newReferral.partner.trim()) {
      notify('Add the partner name.')
      return
    }
    const { error } = await supabase.rpc('admin_upsert_referral_code', {
      p_code: code,
      p_partner_name: newReferral.partner.trim(),
      p_kind: newReferral.kind,
      p_label: newReferral.label.trim() || null,
      p_city: newReferral.city.trim() || null,
      p_contact_phone: newReferral.phone.trim() || null,
    })
    if (error) {
      console.error('SAVE REFERRAL CODE ERROR:', error)
      notify(error.message)
      return
    }
    notify(`${code} is live — print its QR with qr/generate.py.`, 'success')
    setNewReferral({ code: '', partner: '', kind: 'store', label: '', city: '', phone: '' })
    setNewReferralOpen(false)
    await loadReferralReport()
  }

  const loadProductInsights = async () => {
    const { data, error } = await supabase.rpc('admin_product_insights')
    if (error) {
      console.error('PRODUCT INSIGHTS ERROR:', error)
      return
    }
    setProductInsights(data)
  }

  const loadAdminChallengeStats = async () => {
    setAdminChallengeStatsLoading(true)
    const { data, error } = await supabase.rpc('admin_challenge_stats')
    if (error) {
      console.error('ADMIN CHALLENGE STATS ERROR:', error)
      setAdminChallengeStatsLoading(false)
      return
    }
    setAdminChallengeStats(data || [])
    setAdminChallengeStatsLoading(false)
  }

  const toggleAdminChallengeParticipants = async (challengeId) => {
    if (adminOpenChallengeId === challengeId) {
      setAdminOpenChallengeId(null)
      return
    }
    setAdminOpenChallengeId(challengeId)

    const { data, error } = await supabase.rpc('admin_challenge_participants', { p_challenge_id: challengeId })
    if (error) {
      console.error('ADMIN CHALLENGE PARTICIPANTS ERROR:', error)
      notify('Could not load participants.')
      return
    }
    setAdminChallengeParticipants((current) => ({ ...current, [challengeId]: data || [] }))
  }

  const loadAdminUsers = async () => {
    setAdminLoading(true)
    setAdminError(null)

    const { data, error } = await supabase.rpc('admin_list_users')

    if (error) {
      console.error('ADMIN LIST USERS ERROR:', error)
      // "Not authorized" only ever means someone other than the admin
      // account reached this screen — show nothing rather than a raw
      // Postgres error hinting an authorization check exists at all.
      setAdminError(error.message === 'Not authorized' ? null : error.message)
      setAdminLoading(false)
      return
    }

    setAdminUsers(data || [])
    setAdminLoading(false)
  }

  const loadPendingPractitioners = async () => {
    setPendingPractitionersLoading(true)

    const { data, error } = await supabase.rpc('admin_list_pending_practitioners')

    if (error) {
      console.error('ADMIN LIST PENDING PRACTITIONERS ERROR:', error)
      setPendingPractitionersLoading(false)
      return
    }

    setPendingPractitioners(data || [])
    setPendingPractitionersLoading(false)
  }

  const reviewPractitioner = async (targetId, approve) => {
    if (!approve) {
      const confirmed = await confirmAction(
        "Reject this application? They'll need to apply again if they want to reconsider."
      )
      if (!confirmed) return
    }

    const { error } = await supabase.rpc('admin_review_practitioner', {
      target_id: targetId,
      approve,
    })

    if (error) {
      console.error('ADMIN REVIEW PRACTITIONER ERROR:', error)
      notify(error.message)
      return
    }

    notify(approve ? 'Approved.' : 'Rejected.', 'success')
    setPendingPractitioners((current) => current.filter((p) => p.user_id !== targetId))
  }

  const loadVerifiedPractitionersAdmin = async () => {
    setVerifiedPractitionersAdminLoading(true)

    const { data, error } = await supabase.rpc('admin_list_verified_practitioners')

    if (error) {
      console.error('ADMIN LIST VERIFIED PRACTITIONERS ERROR:', error)
      setVerifiedPractitionersAdminLoading(false)
      return
    }

    setVerifiedPractitionersAdmin(data || [])
    setVerifiedPractitionersAdminLoading(false)
  }

  const revokePractitioner = async (targetId, name) => {
    const confirmed = await confirmAction(
      `Revoke ${name || 'this practitioner'}'s verification? They'll immediately lose access to every client's data, though the history stays on record. They'd need to apply again to be reconsidered.`
    )
    if (!confirmed) return

    const { error } = await supabase.rpc('admin_revoke_practitioner', { target_id: targetId })

    if (error) {
      console.error('ADMIN REVOKE PRACTITIONER ERROR:', error)
      notify(error.message)
      return
    }

    notify('Verification revoked.', 'success')
    setVerifiedPractitionersAdmin((current) => current.filter((p) => p.user_id !== targetId))
  }

  const togglePractitionersLaunch = async () => {
    const launching = !practitionersLaunched
    const confirmed = await confirmAction(
      launching
        ? 'Open practitioner applications to everyone? Any of the 109 live users will be able to apply and instantly see client data they have access to.'
        : 'Park the practitioner feature again? New applications will be blocked; practitioners who are already set up keep working as normal.'
    )
    if (!confirmed) return

    const { error } = await supabase.rpc('admin_set_feature_flag', {
      flag_key: 'practitioners_launch',
      enabled: launching,
    })

    if (error) {
      console.error('ADMIN SET FEATURE FLAG ERROR:', error)
      notify(error.message)
      return
    }

    setPractitionersLaunched(launching)
    notify(launching ? 'Practitioners launched.' : 'Practitioner feature parked.', 'success')
  }

  // "Verified" (can invite clients, self-service) and "listed" (shows up in
  // the public Find a Professional directory) are deliberately separate —
  // auto-verify means anyone who filled in the form can operate, but only an
  // admin-reviewed practitioner should be presented to a client browsing as
  // if they're a known professional.
  const togglePractitionerListed = async (targetId, listed) => {
    const { error } = await supabase.rpc('admin_set_practitioner_listed', { target_id: targetId, listed })

    if (error) {
      console.error('ADMIN SET PRACTITIONER LISTED ERROR:', error)
      notify(error.message)
      return
    }

    notify(listed ? 'Listed in the directory.' : 'Removed from the directory.', 'success')
    setVerifiedPractitionersAdmin((current) =>
      current.map((p) => (p.user_id === targetId ? { ...p, listed_at: listed ? new Date().toISOString() : null } : p))
    )
  }

  const exportAdminUsersCsv = (users) => {
    const headers = ['Email', 'Username', 'Onboarded', 'Signed up', 'Last active', 'Email confirmed', 'Suspended']

    const escapeCsv = (value) => {
      const str = String(value ?? '')
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }

    const rows = users.map((u) => [
      u.email,
      u.username || '',
      u.onboarding_completed ? 'Yes' : 'No',
      u.created_at,
      u.last_active_at || u.last_sign_in_at || 'Never',
      u.email_confirmed_at ? 'Yes' : 'No',
      isSuspended(u) ? 'Yes' : 'No',
    ])

    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `tracka-signups-${localDateString()}.csv`
    link.click()

    URL.revokeObjectURL(url)
  }

  const isSuspended = (targetUser) =>
    Boolean(targetUser.banned_until) && new Date(targetUser.banned_until) > new Date()

  const toggleSuspendUser = async (targetUser) => {
    const suspended = isSuspended(targetUser)

    const confirmed = await confirmAction(
      suspended
        ? `Unsuspend ${targetUser.email}? They'll be able to log in again.`
        : `Suspend ${targetUser.email}? They won't be able to log in until unsuspended.`
    )
    if (!confirmed) return

    const { error } = await supabase.rpc('admin_suspend_user', {
      target_id: targetUser.id,
      suspend: !suspended,
    })

    if (error) {
      notify('Could not update this account: ' + error.message)
      return
    }

    notify(suspended ? 'Account unsuspended.' : 'Account suspended.', 'success')
    loadAdminUsers()
  }

  const deleteUserAccount = async (targetUser) => {
    const confirmed = await confirmAction(
      `Permanently delete ${targetUser.email}? This deletes their account and all their data. This cannot be undone.`
    )
    if (!confirmed) return

    const { error } = await supabase.rpc('admin_delete_user', { target_id: targetUser.id })

    if (error) {
      notify('Could not delete this account: ' + error.message)
      return
    }

    notify('Account deleted.', 'success')
    loadAdminUsers()
  }

  // The loaders flip their own loading flags first, which this rule flags;
  // it is a one-off load on open, not a render loop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadAdminUsers()
    loadPendingPractitioners()
    loadVerifiedPractitionersAdmin()
    loadAdminChallengeStats()
    loadProductInsights()
    loadReferralReport()
    // Load once when the screen opens.
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

    const adminQuery = adminSignupsQuery.trim().toLowerCase()
    const filteredAdminUsers = !adminQuery
      ? adminUsers
      : adminUsers.filter((u) =>
          [u.email, u.username].filter(Boolean).some((v) => v.toLowerCase().includes(adminQuery))
        )

    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
                Admin
              </p>
              <h1 className="mt-1 font-display text-[32px] font-light leading-[1.05] tracking-tight">
                {adminTab === 'signups'
                  ? 'Signups'
                  : adminTab === 'practitioners'
                  ? 'Revoked — awaiting restoration'
                  : adminTab === 'challenges'
                  ? 'Challenges'
                  : adminTab === 'products'
                  ? 'Products'
                  : adminTab === 'referrals'
                  ? 'Referrals'
                  : adminTab === 'ads'
                  ? 'Ads'
                  : 'Verified practitioners'}
              </h1>
            </div>

            <button
              type="button"
              onClick={async () => {
                const confirmed = await confirmAction('Log out of the admin dashboard?')
                if (!confirmed) return
                await supabase.auth.signOut()
                setUser(null)
                setPractitionerStatus(null)
                setScreen('welcome')
              }}
              className={`rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted}`}
            >
              Log out
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className={`rounded-2xl ${t.surface} p-3`}>
              <p className="text-[20px] font-semibold">{adminUsers.length}</p>
              <p className={`text-[11px] ${t.muted}`}>Total users</p>
            </div>
            <div className={`rounded-2xl ${t.surface} p-3`}>
              <p className="text-[20px] font-semibold">{verifiedPractitionersAdmin.length}</p>
              <p className={`text-[11px] ${t.muted}`}>Verified pros</p>
            </div>
            <div className={`rounded-2xl ${t.surface} p-3`}>
              <p className="text-[20px] font-semibold">{pendingPractitioners.length}</p>
              <p className={`text-[11px] ${t.muted}`}>Pending apps</p>
            </div>
          </div>

          <div className={`mt-3 flex items-center justify-between rounded-2xl ${t.surface} p-4`}>
            <div>
              <p className="text-[14px] font-semibold">
                Practitioners {practitionersLaunched ? 'launched' : 'parked'}
              </p>
              <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                {practitionersLaunched
                  ? 'Anyone can apply and go live instantly.'
                  : 'New applications are blocked. Existing practitioners still work.'}
              </p>
            </div>
            <button
              type="button"
              disabled={busyAction === 'togglePractitionersLaunch'}
              onClick={() => runBusy('togglePractitionersLaunch', togglePractitionersLaunch)}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50 ${t.hair} ${t.muted}`}
            >
              {busyAction === 'togglePractitionersLaunch' ? '…' : practitionersLaunched ? 'Park it' : 'Launch'}
            </button>
          </div>

          <div className="mt-4">
            <label htmlFor="admin-section" className="sr-only">Admin section</label>
            <select
              id="admin-section"
              value={adminTab}
              onChange={(e) => setAdminTab(e.target.value)}
              className={`w-full appearance-none rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 text-[14px] font-semibold outline-none`}
            >
              <option value="signups">Signups</option>
              <option value="practitioners">
                {`Revoked${pendingPractitioners.length > 0 ? ` (${pendingPractitioners.length})` : ''}`}
              </option>
              <option value="challenges">Challenges</option>
              <option value="products">Products</option>
              <option value="referrals">Referrals</option>
              <option value="ads">Ads</option>
            </select>
          </div>

          {adminTab === 'signups' && !adminLoading && !adminError && (
            <>
              <input
                type="text"
                placeholder="Search by email or username…"
                value={adminSignupsQuery}
                onChange={(e) => setAdminSignupsQuery(e.target.value)}
                className={`mt-3 w-full rounded-2xl border ${t.hair} px-4 py-3 text-[14px] outline-none`}
              />

              <div className="mt-3 flex items-center justify-between">
                <p className={`text-[13px] ${t.faint}`}>
                  {filteredAdminUsers.length} {filteredAdminUsers.length === 1 ? 'user' : 'users'}
                  {adminQuery && ` of ${adminUsers.length}`}
                </p>

                <button
                  type="button"
                  disabled={adminUsers.length === 0}
                  onClick={() => exportAdminUsersCsv(adminUsers)}
                  className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${t.hair} ${t.muted} disabled:opacity-40`}
                >
                  Export CSV
                </button>
              </div>
            </>
          )}

          {adminTab === 'signups' && adminLoading && (
            <p className={`mt-8 text-[15px] ${t.muted}`}>Loading…</p>
          )}

          {adminTab === 'signups' && adminError && (
            <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
              <p className={`text-[13px] leading-relaxed ${t.danger}`}>{adminError}</p>
            </div>
          )}

          {adminTab === 'signups' && !adminLoading && !adminError && (
            <div className="mt-5 flex flex-col gap-3">
              {filteredAdminUsers.length === 0 && (
                <p className={`text-[13px] leading-relaxed ${t.muted}`}>No matches.</p>
              )}
              {filteredAdminUsers.map((u) => (
                <div key={u.id} className={`rounded-2xl border ${t.hair} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">
                        {u.username || 'No username yet'}
                      </p>
                      <p className={`truncate text-[13px] ${t.muted}`}>{u.email}</p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          u.onboarding_completed ? t.chip : `border ${t.hair} ${t.faint}`
                        }`}
                      >
                        {u.onboarding_completed ? 'Onboarded' : 'Incomplete'}
                      </span>

                      {isSuspended(u) && (
                        <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold">
                          <span className={t.danger}>Suspended</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.faint}`}>
                    <span>
                      Signed up {new Date(u.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </span>
                    <span>
                      {(u.last_active_at || u.last_sign_in_at)
                        ? `Last active ${new Date(u.last_active_at || u.last_sign_in_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}`
                        : 'Never active'}
                    </span>
                    {!u.email_confirmed_at && (
                      <span className={t.danger}>Email not confirmed</span>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSuspendUser(u)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.muted}`}
                    >
                      {isSuspended(u) ? 'Unsuspend' : 'Suspend'}
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteUserAccount(u)}
                      className={`flex-1 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] font-semibold ${t.danger}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {adminTab === 'practitioners' && (
            <div className="mt-5">
              {pendingPractitionersLoading ? (
                <p className={`text-[15px] ${t.muted}`}>Loading…</p>
              ) : pendingPractitioners.length === 0 ? (
                <p className={`text-[13px] leading-relaxed ${t.muted}`}>
                  No one's currently waiting on restoration.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {pendingPractitioners.map((p) => (
                    <div key={p.user_id} className={`rounded-2xl border ${t.hair} p-4`}>
                      <p className="text-[15px] font-semibold">{p.display_name}</p>
                      {p.title && (
                        <p className={`text-[12px] font-medium ${t.mark}`}>{p.title}</p>
                      )}
                      <p className={`truncate text-[13px] ${t.muted}`}>{p.email}</p>

                      {p.bio && (
                        <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>{p.bio}</p>
                      )}

                      {p.specialisms?.length > 0 && (
                        <p className={`mt-2 text-[12px] ${t.faint}`}>
                          {p.specialisms.join(' · ')}
                        </p>
                      )}

                      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.faint}`}>
                        {p.instagram && <span>IG: {p.instagram}</span>}
                        {p.whatsapp && <span>WhatsApp: {p.whatsapp}</span>}
                        <span>
                          Applied {new Date(p.created_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                      </div>

                      {p.revoked_at && (
                        <p className={`mt-2 text-[12px] font-semibold ${t.danger}`}>
                          Previously revoked {new Date(p.revoked_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })} — this is a reapplication, not a first-time applicant.
                        </p>
                      )}

                      {p.title && (
                        <p className={`mt-2 text-[11px] leading-relaxed ${t.faint}`}>
                          Shown to clients next to their name — check it against their Instagram/WhatsApp before approving.
                        </p>
                      )}

                      {/* Reject is deliberately not offered here — every entry in
                          this list is now a previously-revoked reapplicant (first-
                          time applicants auto-verify and never land in this tab
                          at all), and admin_review_practitioner's reject branch
                          explicitly refuses anyone with revoked_at set, to
                          protect their real client history from deletion. The
                          only way to keep someone out permanently is to leave
                          them unapproved. */}
                      <button
                        type="button"
                        disabled={!!busyAction}
                        onClick={() => runBusy(`reviewPractitioner-${p.user_id}`, () => reviewPractitioner(p.user_id, true))}
                        className={`mt-3 w-full rounded-xl px-3 py-2 text-[12px] font-bold ${t.btn} disabled:opacity-50`}
                      >
                        {busyAction === `reviewPractitioner-${p.user_id}` ? 'Restoring…' : 'Restore access'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {adminTab === 'verified' && (
            <div className="mt-5">
              {verifiedPractitionersAdminLoading ? (
                <p className={`text-[15px] ${t.muted}`}>Loading…</p>
              ) : verifiedPractitionersAdmin.length === 0 ? (
                <p className={`text-[13px] leading-relaxed ${t.muted}`}>
                  No verified practitioners yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {verifiedPractitionersAdmin.map((p) => (
                    <div key={p.user_id} className={`rounded-2xl border ${t.hair} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold">{p.display_name}</p>
                          {p.title && (
                            <p className={`text-[12px] font-medium ${t.mark}`}>{p.title}</p>
                          )}
                          <p className={`truncate text-[13px] ${t.muted}`}>{p.email}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                            {p.client_count} {p.client_count === 1 ? 'client' : 'clients'}
                          </span>
                          {p.listed_at ? (
                            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                              Listed
                            </span>
                          ) : (
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${t.hair} ${t.faint}`}>
                              Not listed
                            </span>
                          )}
                        </div>
                      </div>

                      {p.bio && (
                        <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>{p.bio}</p>
                      )}

                      {p.specialisms?.length > 0 && (
                        <p className={`mt-2 text-[12px] ${t.faint}`}>
                          {p.specialisms.join(' · ')}
                        </p>
                      )}

                      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.faint}`}>
                        {p.instagram && <span>IG: {p.instagram}</span>}
                        {p.whatsapp && <span>WhatsApp: {p.whatsapp}</span>}
                        <span>
                          Verified {new Date(p.verified_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </span>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={!!busyAction}
                          onClick={() =>
                            runBusy(`toggleListed-${p.user_id}`, () => togglePractitionerListed(p.user_id, !p.listed_at))
                          }
                          className={`flex-1 rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
                        >
                          {busyAction === `toggleListed-${p.user_id}`
                            ? '…'
                            : p.listed_at ? 'Remove from directory' : 'List in directory'}
                        </button>
                        <button
                          type="button"
                          disabled={!!busyAction}
                          onClick={() => runBusy(`revokePractitioner-${p.user_id}`, () => revokePractitioner(p.user_id, p.display_name))}
                          className={`flex-1 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] font-semibold ${t.danger} disabled:opacity-50`}
                        >
                          {busyAction === `revokePractitioner-${p.user_id}` ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {adminTab === 'ads' && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setScreen('adsConsole')}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left ${t.btn}`}
              >
                <span>
                  <span className="block text-[14px] font-bold">Open ads console</span>
                  <span className="block text-[12px] opacity-80">Impressions, reach, clicks, CTR and sign-ups per campaign</span>
                </span>
                <span className="text-[18px]">›</span>
              </button>
              <p className={`mt-3 px-1 text-[12.5px] leading-relaxed ${t.muted}`}>
                Brands, campaigns and their ads. Tracka+'s own promotions run here as house campaigns, so the tracking is proven before the first brand signs.
              </p>
            </div>
          )}

          {adminTab === 'referrals' && (() => {
            if (!referralReport) {
              return <p className={`mt-5 text-[15px] ${t.muted}`}>Loading…</p>
            }
            const T = referralReport.totals
            const rows = referralReport.partners
            const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')
            const STAGES = [
              ['scans', 'Scans'],
              ['signups', 'Sign-ups'],
              ['onboarded', 'Onboarded'],
              ['logged_routine', 'Logged a routine'],
              ['perfect_day', 'Perfect day'],
            ]
            const field = (key, placeholder, extra = '') => (
              <input
                value={newReferral[key]}
                onChange={(e) => setNewReferral((r) => ({ ...r, [key]: e.target.value }))}
                placeholder={placeholder}
                className={`w-full min-w-0 rounded-xl border ${t.hair} bg-transparent px-3 py-2.5 text-[13px] outline-none ${extra}`}
              />
            )

            return (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setScreen('referralConsole')}
                  className={`mb-4 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left ${t.btn}`}
                >
                  <span>
                    <span className="block text-[14px] font-bold">Open referral console</span>
                    <span className="block text-[12px] opacity-80">Partners, new codes, QR flyers and share links</span>
                  </span>
                  <span className="text-[18px]">›</span>
                </button>

                {/* Funnel: each stage with conversion from the previous one. */}
                <div className={`overflow-hidden rounded-2xl ${t.surface}`}>
                  {STAGES.map(([key, label], i) => {
                    const prev = i > 0 ? T[STAGES[i - 1][0]] : null
                    const width = T.scans > 0 ? Math.max(4, (T[key] / T.scans) * 100) : 0
                    return (
                      <div key={key} className={`px-4 py-2.5 ${i > 0 ? `border-t ${t.hair}` : ''}`}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-[13px] font-medium">{label}</span>
                          <span className="text-[15px] font-semibold tabular-nums">
                            {T[key]}
                            {prev !== null && (
                              <span className={`ml-2 text-[11px] font-normal ${t.faint}`}>{pct(T[key], prev)}</span>
                            )}
                          </span>
                        </div>
                        <span className={`mt-1.5 block h-1 overflow-hidden rounded-full ${isNight ? 'bg-white/10' : 'bg-[#101B2D]/8'}`}>
                          <span className={`block h-full rounded-full ${t.nodeDone}`} style={{ width: `${width}%` }} />
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className={`mt-2 text-[11px] leading-relaxed ${t.faint}`}>
                  {T.partners} partners · {T.codes} active codes · {T.visitors} unique visitors. Percentages are from the stage above.
                </p>

                {/* Add a partner / store code */}
                {newReferralOpen ? (
                  <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
                    <p className="text-[14px] font-semibold">New referral code</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {field('partner', 'Partner (e.g. Beauty Hut)', 'col-span-2')}
                      {field('code', 'Code (e.g. BEAUTYHUT-LEKKI)', 'col-span-2 uppercase')}
                      {field('label', 'Label (e.g. Lekki branch)')}
                      {field('city', 'City')}
                      <select
                        value={newReferral.kind}
                        onChange={(e) => setNewReferral((r) => ({ ...r, kind: e.target.value }))}
                        className={`w-full rounded-xl border ${t.hair} ${t.surface} px-3 py-2.5 text-[13px] outline-none`}
                      >
                        {['store', 'clinic', 'spa', 'aesthetician', 'brand', 'online', 'event'].map((k) => (
                          <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>
                        ))}
                      </select>
                      {field('phone', 'Contact phone')}
                    </div>
                    <p className={`mt-2 text-[11px] leading-relaxed ${t.faint}`}>
                      Same partner name adds another code to that partner (one per branch).
                      {newReferral.code.trim() && <> Flyer link: <b>trackaplus.app/?ref={newReferral.code.trim().toUpperCase()}</b></>}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNewReferralOpen(false)}
                        className={`flex-1 rounded-xl border py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted}`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!!busyAction}
                        onClick={() => runBusy('saveReferralCode', saveReferralCode)}
                        className={`flex-1 rounded-xl py-2.5 text-[13px] font-bold ${t.btn} disabled:opacity-60`}
                      >
                        {busyAction === 'saveReferralCode' ? 'Saving…' : 'Create code'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNewReferralOpen(true)}
                    className={`mt-4 w-full rounded-2xl border border-dashed py-3 text-[13px] font-semibold ${t.hair} ${t.muted}`}
                  >
                    + Add a store or clinic code
                  </button>
                )}

                <div className="mt-3 flex flex-col gap-2.5">
                  {rows.length === 0 && <p className={`text-[13px] ${t.muted}`}>No partners yet.</p>}
                  {rows.map((r, i) => (
                    <div key={`${r.partner}-${i}`} className={`rounded-2xl ${t.surface} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold">
                            {r.partner}
                          </p>
                          <p className={`truncate text-[12px] capitalize ${t.faint}`}>
                            {[r.kind, r.city, `${r.codes} ${r.codes === 1 ? 'code' : 'codes'}`].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-1 text-center">
                        {STAGES.map(([key, label]) => (
                          <div key={key}>
                            <p className="text-[16px] font-semibold tabular-nums">{r[key]}</p>
                            <p className={`text-[9.5px] leading-tight ${t.faint}`}>{label}</p>
                          </div>
                        ))}
                      </div>
                      <p className={`mt-2.5 text-[11px] ${t.faint}`}>
                        {r.last_scan_at
                          ? `Last scan ${new Date(r.last_scan_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                          : 'No scans yet'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {adminTab === 'products' && (() => {
            if (!productInsights) {
              return <p className={`mt-5 text-[15px] ${t.muted}`}>Loading…</p>
            }
            const q = insightsQuery.trim().toLowerCase()
            const rows =
              insightsView === 'products'
                ? productInsights.products.filter((p) => !q || `${p.brand} ${p.name}`.toLowerCase().includes(q))
                : insightsView === 'brands'
                ? productInsights.brands.filter((b) => !q || (b.brand || '').toLowerCase().includes(q))
                : productInsights.categories
            const max = Math.max(1, ...rows.map((r) => r.users))
            const totals = productInsights.totals

            const exportCsv = () => {
              const esc = (v) => {
                const s = String(v ?? '')
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
              }
              const lines =
                insightsView === 'products'
                  ? [['Brand', 'Product', 'Category', 'Users', 'Have it now', 'In a routine', 'Finished'],
                     ...rows.map((p) => [p.brand, p.name, p.category, p.users, p.active_users, p.in_routine_users, p.finished_users])]
                  : insightsView === 'brands'
                  ? [['Brand', 'Users', 'Products', 'In a routine'],
                     ...rows.map((b) => [b.brand, b.users, b.products, b.in_routine_users])]
                  : [['Category', 'Users', 'Saved'], ...rows.map((c) => [c.category, c.users, c.saved])]
              const blob = new Blob([lines.map((l) => l.map(esc).join(',')).join('\n')], { type: 'text/csv' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `tracka-${insightsView}.csv`
              a.click()
              URL.revokeObjectURL(a.href)
            }

            return (
              <div className="mt-5">
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    [totals.users_with_products, 'People'],
                    [totals.saved, 'Products saved'],
                    [totals.distinct_brands, 'Brands'],
                  ].map(([v, l]) => (
                    <div key={l} className={`rounded-2xl ${t.surface} p-3`}>
                      <p className="text-[20px] font-semibold">{v}</p>
                      <p className={`text-[11px] ${t.muted}`}>{l}</p>
                    </div>
                  ))}
                </div>

                <div className={`mt-4 grid grid-cols-3 rounded-xl p-0.5 ${isNight ? 'bg-white/5' : 'bg-[#101B2D]/5'}`}>
                  {[['products', 'Products'], ['brands', 'Brands'], ['categories', 'Categories']].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setInsightsView(key)}
                      className={`rounded-[10px] py-2 text-[12px] font-semibold ${insightsView === key ? `${t.surface} shadow-sm` : t.faint}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  {insightsView !== 'categories' && (
                    <input
                      type="text"
                      value={insightsQuery}
                      onChange={(e) => setInsightsQuery(e.target.value)}
                      placeholder={insightsView === 'products' ? 'Search products…' : 'Search brands…'}
                      className={`min-w-0 flex-1 rounded-xl border ${t.hair} bg-transparent px-3 py-2 text-[13px] outline-none`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={exportCsv}
                    className={`ml-auto shrink-0 rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.muted}`}
                  >
                    Export CSV
                  </button>
                </div>

                <div className={`mt-3 overflow-hidden rounded-2xl ${t.surface}`}>
                  {rows.length === 0 && <p className={`p-4 text-[13px] ${t.muted}`}>No matches.</p>}
                  {rows.map((r, i) => {
                    const title =
                      insightsView === 'products' ? r.name : insightsView === 'brands' ? r.brand : r.category.replace(/_/g, ' ')
                    const sub =
                      insightsView === 'products'
                        ? [r.brand, r.category].filter(Boolean).join(' · ')
                        : insightsView === 'brands'
                        ? `${r.products} ${r.products === 1 ? 'product' : 'products'}`
                        : `${r.saved} saved`
                    return (
                      <div key={`${insightsView}-${i}`} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? `border-t ${t.hair}` : ''}`}>
                        <span className={`w-6 shrink-0 text-center text-[12px] font-semibold tabular-nums ${t.faint}`}>{i + 1}</span>
                        {insightsView === 'products' && (
                          r.image_url ? (
                            <img src={r.image_url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
                          ) : (
                            renderProductArt(r.category, 'h-9 w-9 rounded-lg', 'h-[86%] w-[86%]')
                          )
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium capitalize">{title}</span>
                          <span className={`block truncate text-[11px] ${t.faint}`}>{sub}</span>
                          <span className={`mt-1.5 block h-1 overflow-hidden rounded-full ${isNight ? 'bg-white/10' : 'bg-[#101B2D]/8'}`}>
                            <span className={`block h-full rounded-full ${t.nodeDone}`} style={{ width: `${(r.users / max) * 100}%` }} />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[15px] font-semibold tabular-nums">{r.users}</span>
                          <span className={`block text-[10px] ${t.faint}`}>
                            {insightsView === 'categories'
                              ? 'people'
                              : `${r.in_routine_users} in routine${insightsView === 'products' && r.finished_users ? ` · ${r.finished_users} finished` : ''}`}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {adminTab === 'challenges' && (
            <div className="mt-5">
              {adminChallengeStatsLoading ? (
                <p className={`text-[15px] ${t.muted}`}>Loading…</p>
              ) : adminChallengeStats.length === 0 ? (
                <p className={`text-[13px] leading-relaxed ${t.muted}`}>No challenges yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {adminChallengeStats.map((c) => {
                    const attempts = Number(c.active_count) + Number(c.completed_count) + Number(c.left_count)
                    const completionRate = attempts > 0 ? Math.round((Number(c.completed_count) / attempts) * 100) : 0
                    const participants = adminChallengeParticipants[c.challenge_id]
                    const isOpen = adminOpenChallengeId === c.challenge_id
                    const STATUS_STYLE = {
                      active: t.chip,
                      completed: 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-500',
                      left: `border border-rose-400/30 bg-rose-400/10 ${t.danger}`,
                      ended: `border ${t.hair} ${t.muted}`,
                    }
                    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

                    return (
                      <div key={c.challenge_id} className={`rounded-2xl border ${t.hair} p-4`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold">{c.title}</p>
                            <p className={`text-[12px] ${t.faint}`}>{c.duration_days} days{c.target_days && c.target_days !== c.duration_days ? ` · complete at ${c.target_days}` : ""}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            c.is_published ? t.chip : `border ${t.hair} ${t.faint}`
                          }`}>
                            {c.is_published ? 'Live' : 'Hidden'}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-5 gap-1.5">
                          {[
                            [c.participants, 'People'],
                            [c.active_count, 'Active'],
                            [c.completed_count, 'Completed'],
                            [c.ended_count ?? 0, 'Ended'],
                            [c.left_count, 'Left'],
                          ].map(([value, label]) => (
                            <div key={label} className={`rounded-xl ${t.surface} p-2.5`}>
                              <p className="text-[18px] font-semibold">{value}</p>
                              <p className={`text-[10px] ${t.muted}`}>{label}</p>
                            </div>
                          ))}
                        </div>

                        <div className={`mt-3 flex flex-col gap-1 text-[12px] ${t.muted}`}>
                          <span>{completionRate}% of attempts completed</span>
                          <span>
                            {c.left_before_half} left before the halfway point
                            {Number(c.left_count) > 0 && c.avg_days_when_left !== null &&
                              ` · leavers averaged ${c.avg_days_when_left} days`}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleAdminChallengeParticipants(c.challenge_id)}
                          className={`mt-3 w-full rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.muted}`}
                        >
                          {isOpen ? 'Hide leaderboard' : 'Leaderboard & participants'}
                        </button>

                        {isOpen && (
                          <div className="mt-3 flex flex-col gap-2">
                            {!participants ? (
                              <p className={`text-[13px] ${t.muted}`}>Loading…</p>
                            ) : participants.length === 0 ? (
                              <p className={`text-[13px] ${t.muted}`}>No one has joined yet.</p>
                            ) : (
                              participants.map((p) => (
                                <div key={p.participant_id} className={`rounded-xl ${t.surface} p-3`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="flex items-center gap-2 truncate text-[14px] font-semibold">
                                        {p.rank && (
                                          <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-600">
                                            #{p.rank}
                                          </span>
                                        )}
                                        <span className="truncate">{p.username || 'No username'}</span>
                                        {p.hidden && (
                                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${t.hair} ${t.faint}`}>
                                            Hidden
                                          </span>
                                        )}
                                      </p>
                                      <p className={`truncate text-[12px] ${t.muted}`}>{p.email}</p>
                                    </div>
                                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_STYLE[p.status] || t.chip}`}>
                                      {p.status}
                                    </span>
                                  </div>
                                  <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${t.faint}`}>
                                    <span>{p.days_completed}/{c.duration_days} days</span>
                                    <span>Joined {fmt(p.joined_at)}</span>
                                    {p.last_day && <span>Last tick {fmt(p.last_day)}</span>}
                                    {p.completed_at && <span>Finished {fmt(p.completed_at)}</span>}
                                    {p.left_at && <span>Left {fmt(p.left_at)}</span>}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    )
}
