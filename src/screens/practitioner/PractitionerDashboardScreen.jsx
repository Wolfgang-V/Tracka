// Practitioner feature (parked) — the practitioner's dashboard.
// Loaded only when opened, so it isn't in everyone's download.

export default function PractitionerDashboardScreen({
  SITE_URL,
  applyDisplayName,
  busyAction,
  cancelInvitation,
  displayName,
  openClientDetail,
  pendingInvitations,
  pendingInvitationsLoading,
  practitionerClients,
  practitionerClientsLoading,
  practitionerRecommendations,
  runBusy,
  setAddClientEmail,
  setAddClientResult,
  setScreen,
  shareClientInviteLink,
  t,
}) {
  const pendingClients = practitionerClients.filter((c) => c.status === 'invited')

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('settings')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Settings
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Practitioner
          </p>
          <h1 className="mt-1.5 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Hello, {applyDisplayName || displayName}
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Help your clients stay consistent with their skincare routines.
          </p>

          <button
            onClick={() => setScreen('applyPractitioner')}
            className={`mt-2 text-[13px] font-semibold ${t.mark}`}
          >
            Edit your profile
          </button>

          <button
            type="button"
            onClick={() => setScreen('today')}
            className={`mt-4 w-full rounded-2xl border px-4 py-3 text-left text-[14px] font-semibold ${t.hair} ${t.muted}`}
          >
            My Today screen
          </button>
        </div>

        <button
          onClick={() => {
            setAddClientEmail('')
            setAddClientResult(null)
            setScreen('addClient')
          }}
          className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
        >
          + Add Client
        </button>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className={`rounded-3xl ${t.surface} p-4`}>
            <p className="text-[28px] font-semibold">{practitionerClients.length}</p>
            <p className={`text-[13px] ${t.muted}`}>Total clients</p>
          </div>
          <div className={`rounded-3xl ${t.surface} p-4`}>
            <p className="text-[28px] font-semibold">{pendingClients.length}</p>
            <p className={`text-[13px] ${t.muted}`}>Pending acceptance</p>
          </div>
        </div>

        <button
          onClick={() => setScreen('practitionerRoutines')}
          className={`mt-4 flex w-full items-center justify-between rounded-2xl border ${t.hair} px-4 py-3 text-left text-[14px] font-semibold ${t.muted}`}
        >
          All routines sent
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {!pendingInvitationsLoading && pendingInvitations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Pending invites</h2>
            <p className={`mt-1 text-[13px] ${t.muted}`}>
              Links you've sent that haven't been opened yet.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {pendingInvitations.map((inv) => (
                <div key={inv.token} className={`flex items-center justify-between rounded-2xl ${t.surface} p-4`}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">
                      {inv.label || inv.invited_email || 'Shared link'}
                    </p>
                    <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                      Sent {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => shareClientInviteLink(`${SITE_URL}/?invite=${inv.token}`)}
                      className={`text-[13px] font-semibold ${t.mark}`}
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => runBusy(`cancelInvite-${inv.token}`, () => cancelInvitation(inv.token))}
                      className={`text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
                    >
                      {busyAction === `cancelInvite-${inv.token}` ? '…' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-[15px] font-semibold">Clients</h2>

          {practitionerClientsLoading ? (
            <p className={`mt-4 text-[13px] ${t.muted}`}>Loading…</p>
          ) : practitionerClients.length === 0 ? (
            <p className={`mt-4 text-[13px] leading-relaxed ${t.muted}`}>
              No clients yet. Tap "Add Client" above to invite your first one.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {practitionerClients.map((c) => {
                // Flags a connection accepted in the last 24h — surfaces who
                // just claimed a link, since that's otherwise invisible
                // until the practitioner happens to check back. Relies on
                // practitioner_list_clients() already sorting most-recently-
                // accepted first, so these naturally land at the top.
                const isRecent =
                  c.status === 'active' &&
                  c.accepted_at &&
                  Date.now() - new Date(c.accepted_at).getTime() < 24 * 60 * 60 * 1000

                return (
                <button
                  key={c.relationship_id}
                  onClick={() => c.status === 'active' && openClientDetail(c.client_id)}
                  className={`flex items-center justify-between rounded-2xl ${t.surface} p-4 text-left`}
                >
                  <div>
                    <p className="text-[15px] font-semibold">
                      {c.username || 'Client'}
                      {isRecent && (
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                          New
                        </span>
                      )}
                    </p>
                    <p className={`mt-0.5 text-[13px] ${t.muted}`}>
                      {c.status === 'invited' ? 'Waiting for acceptance' : 'Active'}
                    </p>
                  </div>
                  {c.status === 'invited' ? (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                      Pending
                    </span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
                )
              })}
            </div>
          )}
        </div>

        {practitionerRecommendations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <div className="mt-4 flex flex-col gap-2.5">
              {practitionerRecommendations.slice(0, 5).map((rec) => {
                const label =
                  rec.status === 'proposed' ? 'Routine sent to'
                  : rec.status === 'accepted' ? 'Accepted by'
                  : rec.status === 'declined' ? 'Declined by'
                  : 'Withdrawn for'
                const at = rec.status === 'proposed' ? rec.created_at : rec.responded_at || rec.created_at

                return (
                  <p key={rec.id} className={`text-[13px] ${t.muted}`}>
                    <span className="font-medium">{label} {rec.profiles?.username || 'a client'}</span>
                    {' — '}
                    {new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
