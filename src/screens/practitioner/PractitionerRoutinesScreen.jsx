// Practitioner feature (parked) — recommendations sent.
// Loaded only when opened, so it isn't in everyone's download.

export default function PractitionerRoutinesScreen({
  practitionerRecommendations,
  practitionerRecommendationsLoading,
  recommendationsFilter,
  setRecommendationsFilter,
  setScreen,
  t,
}) {
  const FILTERS = [
    ['all', 'All'],
    ['proposed', 'Sent'],
    ['accepted', 'Accepted'],
    ['declined', 'Declined'],
    ['superseded', 'Withdrawn'],
  ]

  const filtered = recommendationsFilter === 'all'
    ? practitionerRecommendations
    : practitionerRecommendations.filter((r) => r.status === recommendationsFilter)

  const STATUS_LABEL = {
    proposed: 'Sent — awaiting response',
    accepted: 'Accepted',
    declined: 'Declined',
    superseded: 'Withdrawn',
  }

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
          Dashboard
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Routines
          </h1>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRecommendationsFilter(value)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                recommendationsFilter === value ? `${t.chip} border-transparent` : `border ${t.hair} ${t.muted}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {practitionerRecommendationsLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nothing here yet.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {filtered.map((rec) => (
              <div key={rec.id} className={`rounded-2xl ${t.surface} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-semibold">{rec.profiles?.username || 'Client'}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                    {STATUS_LABEL[rec.status] || rec.status}
                  </span>
                </div>
                <p className={`mt-1 text-[12px] ${t.muted}`}>
                  {new Date(rec.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                {rec.note && (
                  <p className={`mt-2 text-[13px] italic ${t.faint}`}>"{rec.note}"</p>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
