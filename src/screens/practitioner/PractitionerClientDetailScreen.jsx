// Practitioner feature (parked) — one client's details.
// Loaded only when opened, so it isn't in everyone's download.

export default function PractitionerClientDetailScreen({
  busyAction,
  clientDetail,
  clientDetailLoading,
  clientProducts,
  clientRoutineSteps,
  openComposer,
  practitionerClients,
  removeClient,
  runBusy,
  selectedClientId,
  setScreen,
  t,
}) {
  const client = practitionerClients.find((c) => c.client_id === selectedClientId)

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('practitionerDashboard')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Clients
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[32px] font-light leading-[1.05] tracking-tight">
            {client?.username || 'Client'}
          </h1>
        </div>

        {clientDetailLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : (
          <>
            <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Skin profile</h2>
              {clientDetail ? (
                <div className="mt-3 flex flex-col gap-2 text-[14px]">
                  {clientDetail.skin_type && (
                    <p><span className={t.muted}>Skin type — </span>{clientDetail.skin_type}</p>
                  )}
                  {clientDetail.concerns && (
                    <p><span className={t.muted}>Concerns — </span>{clientDetail.concerns}</p>
                  )}
                  {clientDetail.goals && (
                    <p><span className={t.muted}>Goals — </span>{clientDetail.goals}</p>
                  )}
                  {!clientDetail.skin_type && !clientDetail.concerns && !clientDetail.goals && (
                    <p className={t.muted}>Not filled in yet.</p>
                  )}
                </div>
              ) : (
                <p className={`mt-3 text-[13px] ${t.muted}`}>Not shared, or not filled in yet.</p>
              )}
            </div>

            <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Products</h2>
              {clientProducts.length === 0 ? (
                <p className={`mt-3 text-[13px] ${t.muted}`}>None added yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {clientProducts.map((p) => (
                    <p key={p.id} className="text-[14px]">
                      <span className="font-medium">{p.products?.brand}</span>
                      {' '}{p.products?.name}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Routine</h2>

              <p className={`mt-3 text-[13px] font-semibold ${t.mark}`}>Morning</p>
              {clientRoutineSteps.am.length === 0 ? (
                <p className={`mt-1 text-[13px] ${t.muted}`}>No AM routine.</p>
              ) : (
                clientRoutineSteps.am.map((s, i) => (
                  <p key={i} className="mt-1 text-[14px]">{s.step_name}</p>
                ))
              )}

              <p className={`mt-4 text-[13px] font-semibold ${t.mark}`}>Night</p>
              {clientRoutineSteps.pm.length === 0 ? (
                <p className={`mt-1 text-[13px] ${t.muted}`}>No PM routine.</p>
              ) : (
                clientRoutineSteps.pm.map((s, i) => (
                  <p key={i} className="mt-1 text-[14px]">{s.step_name}</p>
                ))
              )}
            </div>

            <button
              onClick={openComposer}
              className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
            >
              Propose a routine
            </button>

            <button
              disabled={!!busyAction}
              onClick={() => runBusy(`removeClient-${client?.relationship_id}`, () => removeClient(client?.relationship_id, client?.username))}
              className={`mt-3 w-full text-center text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
            >
              {busyAction === `removeClient-${client?.relationship_id}` ? 'Removing…' : 'Remove client'}
            </button>
          </>
        )}

      </div>
    </main>
  )
}
