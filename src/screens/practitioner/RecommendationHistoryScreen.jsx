// Practitioner feature (parked) — past routine recommendations.
// Loaded only when opened, so it isn't in everyone's download.

export default function RecommendationHistoryScreen({
  recommendationHistory,
  recommendationHistoryLoading,
  setScreen,
  t,
}) {
  const STATUS_LABEL = {
    accepted: 'Accepted',
    declined: 'Declined',
    superseded: 'Withdrawn by practitioner',
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('notifications')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Notifications
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Past recommendations
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Everything a professional has proposed for you, resolved or not.
          </p>
        </div>

        {recommendationHistoryLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : recommendationHistory.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nothing here yet.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            {recommendationHistory.map((rec) => (
              <div key={rec.id} className={`rounded-2xl ${t.surface} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold">
                      {rec.practitioners?.display_name || 'A professional'}
                    </p>
                    {rec.practitioners?.title && (
                      <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rec.practitioners.title}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                    {STATUS_LABEL[rec.status] || rec.status}
                  </span>
                </div>
                <p className={`mt-2 text-[12px] ${t.muted}`}>
                  {new Date(rec.responded_at || rec.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
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
