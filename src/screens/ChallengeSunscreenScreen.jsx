// "One step before you join": shown when someone tries to join a sunscreen
// challenge without a sunscreen in their morning routine (NO_SUNSCREEN_STEP).
// Instead of a dead end, three ways in, each ending in "joined":
//   - a sunscreen they already own: one tap
//   - the sponsor's sunscreen (when the challenge has a live product ad):
//     the add-product form, pre-filled, then straight back and joined
//   - any other sunscreen: the add-product form, then joined
// App does the work (add_sunscreen_to_morning, then join_challenge); this
// screen only lays out the choices.

export default function ChallengeSunscreenScreen({
  t,
  isNight,
  challenge,
  products,
  sponsorAd,
  busy,
  onUse,
  onAddSponsor,
  onAddOwn,
  onBack,
}) {
  const owned = (products || []).filter((p) => (p.products?.category || '').toLowerCase() === 'sunscreen')
  const sponsorName = sponsorAd?.product?.name
    ? `${sponsorAd.brand} ${sponsorAd.product.name}`
    : sponsorAd?.brand

  const row = 'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left disabled:opacity-60'

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Back
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>{challenge?.title}</p>
          <h1 className="mt-2 font-display text-[34px] font-light leading-[1.05] tracking-tight">
            One step before you join
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            This challenge counts the sunscreen you tick off each morning. Pick one and we&apos;ll add it to your
            morning routine and sign you up.
          </p>
        </div>

        {owned.length > 0 && (
          <section className="mt-7">
            <p className={`mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Your sunscreens</p>
            <div className="flex flex-col gap-2.5">
              {owned.map((p) => (
                <button key={p.id} type="button" disabled={busy} onClick={() => onUse(p)} className={`${row} ${t.hair} ${t.surface}`}>
                  <span className="text-[24px]">🧴</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {[p.products?.brand, p.products?.name].filter(Boolean).join(' ')}
                    </span>
                    <span className={`block text-[12.5px] ${t.muted}`}>Add to my morning routine and join</span>
                  </span>
                  <span className={`shrink-0 text-[13px] font-bold ${t.mark}`}>Use</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {sponsorAd && (
          <section className="mt-7">
            <p className={`mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
              From the challenge sponsor
            </p>
            <button type="button" disabled={busy} onClick={onAddSponsor}
              className={`w-full overflow-hidden rounded-3xl border text-left disabled:opacity-60 ${t.hair} ${t.surface}`}>
              {sponsorAd.image_url && (
                <img src={sponsorAd.image_url} alt="" className="h-44 w-full object-cover" />
              )}
              <span className="block p-4">
                <span className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${t.faint}`}>
                  Sponsored · {sponsorAd.brand}
                </span>
                <span className="mt-1 block text-[16px] font-semibold leading-snug">{sponsorName}</span>
                <span className={`mt-1 block text-[13px] leading-relaxed ${t.muted}`}>
                  Add it to your products and your morning routine, and you&apos;re in.
                </span>
                <span className={`mt-3 block w-full rounded-2xl py-3 text-center text-[14px] font-bold ${t.btn}`}>
                  Add {sponsorAd.brand} and join
                </span>
              </span>
            </button>
          </section>
        )}

        <button type="button" disabled={busy} onClick={onAddOwn}
          className={`mt-5 w-full rounded-2xl border py-3.5 text-[14px] font-semibold disabled:opacity-60 ${t.hair}`}>
          {owned.length || sponsorAd ? 'Add a different sunscreen' : 'Add my sunscreen'}
        </button>

        {busy && <p className={`mt-4 text-center text-[13px] ${t.muted}`}>Setting you up…</p>}

        <p className={`mt-6 px-1 text-[12px] leading-relaxed ${isNight ? 'text-white/45' : 'text-[#7488A3]'}`}>
          The sunscreen goes at the end of your morning routine. You can move or change it anytime in your routine.
        </p>
      </div>
    </main>
  )
}
