// Practitioner feature (parked) — client directory of professionals.
// Loaded only when opened, so it isn't in everyone's download.

export default function FindProfessionalScreen({
  findProfessionalQuery,
  setFindProfessionalQuery,
  setScreen,
  t,
  verifiedPractitioners,
  verifiedPractitionersLoading,
  whatsappLink,
}) {
  const q = findProfessionalQuery.trim().toLowerCase()
  const filtered = !q
    ? verifiedPractitioners
    : verifiedPractitioners.filter((p) => {
        const haystack = [p.display_name, p.title, p.bio, ...(p.specialisms || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })

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
            Find a professional
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Browse verified aestheticians and reach out directly.
          </p>
        </div>

        <input
          type="text"
          placeholder="Search by name, specialism…"
          value={findProfessionalQuery}
          onChange={(e) => setFindProfessionalQuery(e.target.value)}
          className={`mt-6 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3.5 text-[15px] outline-none`}
        />

        {verifiedPractitionersLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            {verifiedPractitioners.length === 0
              ? 'No verified professionals yet — check back soon.'
              : 'No matches. Try a different search.'}
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {filtered.map((p) => (
              <div key={p.user_id} className={`rounded-3xl ${t.surface} p-5`}>
                <p className="text-[16px] font-semibold">{p.display_name}</p>
                {p.title && (
                  <p className={`mt-0.5 text-[13px] font-medium ${t.mark}`}>{p.title}</p>
                )}
                {p.bio && (
                  <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>{p.bio}</p>
                )}
                {p.specialisms?.length > 0 && (
                  <p className={`mt-2 text-[12px] ${t.faint}`}>{p.specialisms.join(' · ')}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  {p.whatsapp && (
                    <a
                      href={whatsappLink(p.whatsapp, `Hi ${p.display_name}, I found your profile on Tracka+ — `)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-xl px-3.5 py-2 text-[13px] font-semibold ${t.btn}`}
                    >
                      Message on WhatsApp
                    </a>
                  )}
                  {p.instagram && (
                    <span className={`flex items-center rounded-xl border px-3.5 py-2 text-[13px] font-semibold ${t.hair} ${t.muted}`}>
                      IG: {p.instagram}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
