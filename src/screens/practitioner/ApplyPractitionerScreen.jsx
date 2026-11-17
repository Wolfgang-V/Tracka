// Practitioner feature (parked) — apply to be a practitioner.
// Loaded only when opened, so it isn't in everyone's download.

export default function ApplyPractitionerScreen({
  applyBio,
  applyDisplayName,
  applyInstagram,
  applySaving,
  applySpecialisms,
  applyTitle,
  applyWhatsapp,
  practitionerStatus,
  setApplyBio,
  setApplyDisplayName,
  setApplyInstagram,
  setApplySpecialisms,
  setApplyTitle,
  setApplyWhatsapp,
  setScreen,
  submitPractitionerApplication,
  t,
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
            {practitionerStatus === 'verified' ? 'Your practitioner profile' : 'Become a professional'}
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            {practitionerStatus === 'verified'
              ? 'Clients see this when you invite them. You can update it any time.'
              : practitionerStatus === 'pending'
              ? 'Your access was revoked and needs to be reviewed again before you can continue.'
              : "Tell us a bit about your practice. You'll get instant access to invite clients."}
          </p>
        </div>

        <div className={`mt-8 flex flex-col gap-5 rounded-3xl ${t.surface} p-5`}>
          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Display name
            </label>
            <input
              type="text"
              placeholder="e.g. Deeyah Skin Studio"
              value={applyDisplayName}
              onChange={(e) => setApplyDisplayName(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Your title
            </label>
            <input
              type="text"
              placeholder="e.g. Esthetician, Dermatologist, Skincare Brand, Clinic"
              value={applyTitle}
              onChange={(e) => setApplyTitle(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              Shown to clients wherever your name appears.
            </p>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Bio
            </label>
            <textarea
              placeholder="A short intro clients will see"
              value={applyBio}
              onChange={(e) => setApplyBio(e.target.value)}
              rows={3}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Specialisms
            </label>
            <input
              type="text"
              placeholder="e.g. Acne, hyperpigmentation, sensitive skin"
              value={applySpecialisms}
              onChange={(e) => setApplySpecialisms(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
            <p className={`mt-1.5 text-[12px] ${t.faint}`}>Separate with commas</p>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Instagram
            </label>
            <input
              type="text"
              placeholder="e.g. @deeyahskin"
              value={applyInstagram}
              onChange={(e) => setApplyInstagram(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              WhatsApp number
            </label>
            <input
              type="text"
              placeholder="e.g. +2348012345678"
              value={applyWhatsapp}
              onChange={(e) => setApplyWhatsapp(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <button
            onClick={submitPractitionerApplication}
            disabled={applySaving}
            className={`mt-2 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
          >
            {applySaving
              ? 'Saving…'
              : practitionerStatus === 'verified'
              ? 'Save changes'
              : practitionerStatus === 'pending'
              ? 'Update application'
              : 'Submit application'}
          </button>
        </div>

      </div>
    </main>
  )
}
