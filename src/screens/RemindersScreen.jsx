// Reminders (Settings → Reminders): morning and night routine times, plus
// the sunscreen and diary nudges. Notifications come first: without them
// on this device, none of the reminders below can arrive.
// Moved out of App.jsx; the reminder state lives in App (the setup guide
// opens this screen too), so it comes in as props, as does saving.

const SUN = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
const MOON = <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
const SHIELD = <><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>
const BOOK = <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19" /><path d="M9 7.5h6" /></>
const BELL = <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>

const Glyph = ({ children, size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
    {children}
  </svg>
)

// "07:00" → "7:00 am"
const formatTime = (value) => {
  const [h, m] = (value || '').split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return value
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const MORNING_PRESETS = ['06:30', '07:00', '08:00']
const NIGHT_PRESETS = ['21:00', '22:00', '23:00']

function Switch({ on, onChange, label, t }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? t.btn : t.rail}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

export default function RemindersScreen({
  busyAction,
  diaryNudgeEnabled,
  getInstallEnv,
  isNight,
  morningReminderEnabled,
  morningReminderTime,
  nightReminderEnabled,
  nightReminderTime,
  onBack,
  onSave,
  openSetupGuide,
  pushStatus,
  renderBottomTabs,
  runBusy,
  setDiaryNudgeEnabled,
  setMorningReminderEnabled,
  setMorningReminderTime,
  setNightReminderEnabled,
  setNightReminderTime,
  setPushStatus,
  setSpfReapplyEnabled,
  spfReapplyEnabled,
  subscribeToPushNotifications,
  t,
}) {
  const env = getInstallEnv()
  const allowed = env.notifications === 'granted'
  const blocked = env.notifications === 'denied'

  const turnOn = () =>
    runBusy('pushSubscribe', async () => {
      const result = await subscribeToPushNotifications()
      setPushStatus(
        result.ok
          ? "You're all set!"
          : result.reason === 'needs_install'
            ? 'Add Tracka+ to your home screen first, then open it from there.'
            : result.reason === 'denied'
              ? 'Notifications are blocked. Turn them on in your browser settings for this site.'
              : result.reason === 'unsupported'
                ? "This browser can't do notifications. Try Chrome or Safari."
                : "That didn't work. Try again in a moment."
      )
    })

  const tint = {
    morning: isNight ? 'bg-amber-400/15 text-amber-300' : 'bg-amber-400/15 text-amber-600',
    night: isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-[#1463F4]/10 text-[#1463F4]',
    spf: isNight ? 'bg-orange-400/15 text-orange-300' : 'bg-orange-400/15 text-orange-600',
    diary: isNight ? 'bg-violet-400/15 text-violet-300' : 'bg-violet-500/10 text-violet-600',
  }

  // A routine reminder: icon, title, switch; when on, the time and a few
  // one-tap presets.
  const routineCard = ({ key, title, body, icon, on, setOn, time, setTime, presets }) => (
    <div key={key} className={`rounded-3xl ${t.surface} p-5`}>
      <div className="flex items-center gap-3.5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tint[key]}`}>
          <Glyph>{icon}</Glyph>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <p className={`text-[13px] ${t.muted}`}>{on ? `Every day at ${formatTime(time)}` : body}</p>
        </div>
        <Switch on={on} onChange={setOn} label={title} t={t} />
      </div>

      {on && (
        <div className={`mt-4 border-t pt-4 ${t.hair}`}>
          <label className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`} htmlFor={`${key}-time`}>
            Remind me at
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={`${key}-time`}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`min-w-0 flex-1 rounded-2xl border ${t.hair} bg-transparent px-4 py-3 text-[18px] font-semibold tabular-nums outline-none`}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTime(p)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
                  time === p ? `${t.chip} border border-transparent` : `border ${t.hair} ${t.muted}`
                }`}
              >
                {formatTime(p)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  const extraRow = ({ key, title, body, icon, on, setOn }) => (
    <div key={key} className="flex items-center gap-3.5 px-5 py-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint[key]}`}>
        <Glyph size={19}>{icon}</Glyph>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className={`text-[12.5px] leading-snug ${t.muted}`}>{body}</p>
      </div>
      <Switch on={on} onChange={setOn} label={title} t={t} />
    </div>
  )

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">
        <button onClick={onBack} className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Settings
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>Reminders</p>
          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">Stay on track</h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Choose when Tracka+ should remind you about your skincare routine.
          </p>
        </div>

        {/* Notifications on this device: first, because nothing below can
            arrive without them. Compact once they're on. */}
        {allowed ? (
          <div className={`mt-7 flex items-center gap-3 rounded-2xl px-4 py-3 ${
            isNight ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-500/10 text-emerald-700'
          }`}>
            <Glyph size={18}>{BELL}</Glyph>
            <p className="min-w-0 flex-1 text-[13.5px] font-semibold">Notifications are on for this device</p>
            <button
              type="button"
              disabled={busyAction === 'pushSubscribe'}
              onClick={turnOn}
              className="shrink-0 text-[12.5px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            >
              {busyAction === 'pushSubscribe' ? 'Checking…' : 'Reconnect'}
            </button>
          </div>
        ) : (
          <div className={`mt-7 rounded-3xl border p-5 ${
            isNight ? 'border-amber-300/20 bg-amber-400/10' : 'border-amber-500/20 bg-amber-50'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isNight ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-400/25 text-amber-700'
              }`}>
                <Glyph size={19}>{BELL}</Glyph>
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">
                  {blocked ? 'Notifications are blocked' : 'Turn on notifications'}
                </p>
                <p className={`text-[13px] leading-snug ${t.muted}`}>
                  {blocked
                    ? 'Allow them for Tracka+ in your browser or phone settings, then come back.'
                    : 'Your reminders can only reach you once notifications are on.'}
                </p>
              </div>
            </div>
            {!blocked && (
              <button
                disabled={busyAction === 'pushSubscribe'}
                onClick={turnOn}
                className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
              >
                {busyAction === 'pushSubscribe' ? 'Turning on…' : 'Turn on notifications'}
              </button>
            )}
            {!env.standalone && (
              <button type="button" onClick={openSetupGuide} className={`mt-3 text-[13px] font-semibold ${t.mark}`}>
                How to add Tracka+ to your home screen →
              </button>
            )}
          </div>
        )}
        {pushStatus && <p className={`mt-3 px-1 text-[13px] ${t.muted}`}>{pushStatus}</p>}

        <p className={`mb-2 mt-8 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Your routine</p>
        <div className="flex flex-col gap-3">
          {routineCard({
            key: 'morning',
            title: 'Morning routine',
            body: 'A reminder when it’s time for your morning routine.',
            icon: SUN,
            on: morningReminderEnabled,
            setOn: setMorningReminderEnabled,
            time: morningReminderTime,
            setTime: setMorningReminderTime,
            presets: MORNING_PRESETS,
          })}
          {routineCard({
            key: 'night',
            title: 'Night routine',
            body: 'A reminder when it’s time for your night routine.',
            icon: MOON,
            on: nightReminderEnabled,
            setOn: setNightReminderEnabled,
            time: nightReminderTime,
            setTime: setNightReminderTime,
            presets: NIGHT_PRESETS,
          })}
        </div>

        <p className={`mb-2 mt-8 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Extra nudges</p>
        <div className={`flex flex-col divide-y overflow-hidden rounded-3xl ${t.surface} ${t.hair}`}>
          {extraRow({
            key: 'spf',
            title: 'Reapply sunscreen',
            body: 'Reminders to top up your sunscreen during the day.',
            icon: SHIELD,
            on: spfReapplyEnabled,
            setOn: setSpfReapplyEnabled,
          })}
          {extraRow({
            key: 'diary',
            title: 'Skin diary',
            body: 'A midday nudge if you haven’t logged a note yet.',
            icon: BOOK,
            on: diaryNudgeEnabled,
            setOn: setDiaryNudgeEnabled,
          })}
        </div>

        <button
          disabled={busyAction === 'saveReminders'}
          onClick={() => runBusy('saveReminders', onSave)}
          className={`mt-8 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
        >
          {busyAction === 'saveReminders' ? 'Saving…' : 'Save reminders'}
        </button>
      </div>
      {renderBottomTabs('reminders', t)}
    </main>
  )
}
