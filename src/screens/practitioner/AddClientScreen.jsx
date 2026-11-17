// Practitioner feature (parked) — invite a client.
// Loaded only when opened, so it isn't in everyone's download.

export default function AddClientScreen({
  addClientEmail,
  addClientResult,
  addClientSaving,
  addLinkLabel,
  addLinkSaving,
  createInviteLink,
  inviteClientByEmail,
  setAddClientEmail,
  setAddClientResult,
  setAddLinkLabel,
  setScreen,
  shareClientInviteLink,
  t,
}) {
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
            Add Client
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Invite a client to receive their personalized skincare routine.
          </p>
        </div>

        {!addClientResult ? (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Client email
            </label>

            <input
              type="email"
              placeholder="e.g. sarah@email.com"
              value={addClientEmail}
              onChange={(e) => setAddClientEmail(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              This email is used to find or create their Tracka+ account.
            </p>

            <button
              onClick={inviteClientByEmail}
              disabled={addClientSaving}
              className={`mt-5 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
            >
              {addClientSaving ? 'Sending…' : 'Continue'}
            </button>
          </div>
        ) : null}

        {!addClientResult && (
          <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[15px] font-semibold">Don't know their email?</p>
            <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
              Generate a link instead — it works whether or not they already have an account, no email needed.
            </p>

            <input
              type="text"
              placeholder="A name to remind you who this is for (optional)"
              value={addLinkLabel}
              onChange={(e) => setAddLinkLabel(e.target.value)}
              className={`mt-3 w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            <button
              onClick={createInviteLink}
              disabled={addLinkSaving}
              className={`mt-3 w-full rounded-2xl border py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted} disabled:opacity-60`}
            >
              {addLinkSaving ? 'Creating…' : 'Generate invite link'}
            </button>
          </div>
        )}

        {addClientResult && (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[15px] font-semibold">Ready to share</p>
            <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>
              Share this link with them — opening it connects them with you, whether they already have a Tracka+ account or not.
            </p>

            <div className={`mt-4 rounded-2xl border ${t.hair} px-4 py-3`}>
              <p className="break-all text-[13px]">{addClientResult.link}</p>
            </div>

            <button
              onClick={() => shareClientInviteLink(addClientResult.link)}
              className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
            >
              Share link
            </button>

            <button
              onClick={() => {
                setAddClientEmail('')
                setAddClientResult(null)
                setScreen('practitionerDashboard')
              }}
              className={`mt-3 w-full text-[13px] font-semibold ${t.muted}`}
            >
              Done
            </button>
          </div>
        )}

      </div>
    </main>
  )
}
