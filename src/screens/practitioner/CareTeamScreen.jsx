// Practitioner feature (parked) — a client's care team.
// Loaded only when opened, so it isn't in everyone's download.

export default function CareTeamScreen({
  CARE_SCOPES,
  busyAction,
  careAccessLog,
  careRelationships,
  careTeamLoading,
  endedRelationships,
  respondToCareInvite,
  revokeCareAccess,
  runBusy,
  setScreen,
  t,
  toggleCareScope,
  whatsappLink,
}) {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

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
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Care team
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Professionals you've connected with, and exactly what they can see.
          </p>
        </div>

        {careTeamLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : careRelationships.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nobody yet. If a professional invites you, they'll show up here.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {careRelationships.map((rel) => (
              <div key={rel.id} className={`rounded-3xl ${t.surface} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[16px] font-semibold">
                      {rel.practitioners?.display_name || 'Professional'}
                    </p>
                    {rel.practitioners?.title && (
                      <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rel.practitioners.title}</p>
                    )}
                    {rel.practitioners?.bio && (
                      <p className={`mt-0.5 text-[13px] ${t.muted}`}>{rel.practitioners.bio}</p>
                    )}
                  </div>
                  {rel.status === 'invited' && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                      Pending
                    </span>
                  )}
                  {rel.status === 'active' && !rel.practitioners?.verified_at && (
                    <span className="shrink-0 rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold">
                      <span className={t.danger}>No longer verified</span>
                    </span>
                  )}
                </div>

                {rel.status === 'invited' ? (
                  <div className="mt-4 flex gap-2.5">
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, false))}
                      className={`flex-1 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
                    >
                      {busyAction === `careInvite-${rel.id}` ? 'Declining…' : 'Decline'}
                    </button>
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, true))}
                      className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-50`}
                    >
                      {busyAction === `careInvite-${rel.id}` ? 'Accepting…' : 'Accept'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={`mt-4 flex flex-col gap-2.5 border-t pt-4 ${t.hair}`}>
                      {CARE_SCOPES.map(([scope, label]) => {
                        const isNested = scope === 'pregnancy_status'
                        const locked = isNested && !rel.scopes.includes('skin_profile')

                        return (
                          <div
                            key={scope}
                            className={`flex items-center justify-between ${isNested ? 'ml-4' : ''}`}
                          >
                            <div>
                              <span className={`text-[14px] ${locked ? t.faint : ''}`}>{label}</span>
                              {locked && (
                                <p className={`text-[11px] ${t.faint}`}>Requires skin profile access</p>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => toggleCareScope(rel, scope)}
                              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                                rel.scopes.includes(scope) ? t.btn : t.rail
                              } ${locked ? 'opacity-40' : ''}`}
                            >
                              <span
                                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                                  rel.scopes.includes(scope) ? 'left-6' : 'left-1'
                                }`}
                              />
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      {rel.practitioners?.whatsapp ? (
                        <a
                          href={whatsappLink(rel.practitioners.whatsapp, `Hi ${rel.practitioners.display_name || ''}, `)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-[13px] font-semibold ${t.mark}`}
                        >
                          Message on WhatsApp
                        </a>
                      ) : <span />}

                      <button
                        disabled={!!busyAction}
                        onClick={() => runBusy(`revokeCare-${rel.id}`, () => revokeCareAccess(rel.id, rel.practitioners?.display_name))}
                        className={`text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
                      >
                        {busyAction === `revokeCare-${rel.id}` ? 'Revoking…' : 'Revoke access'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {endedRelationships.length > 0 && (
          <div className="mt-8">
            <div className="flex flex-col gap-2.5">
              {endedRelationships.map((rel) => (
                <p key={rel.id} className={`text-[13px] ${t.faint}`}>
                  {rel.practitioners?.display_name || 'A professional'} ended your care relationship
                  {' — '}
                  {new Date(rel.revoked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              ))}
            </div>
          </div>
        )}

        {careAccessLog.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <div className="mt-3 flex flex-col gap-2.5">
              {careAccessLog.map((entry, i) => (
                <p key={i} className={`text-[13px] ${t.muted}`}>
                  <span className="font-medium">{entry.practitioners?.display_name || 'A professional'}</span>
                  {' '}viewed your {entry.what === 'view_skin_profile' ? 'skin profile' : entry.what}
                  {' — '}
                  {new Date(entry.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
