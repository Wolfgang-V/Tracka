// Sign up — create an account (first screen after "Get started").
// Moved out of App.jsx; shared state comes in as props for now.

import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SignUpScreen({
  ADMIN_EMAIL,
  SITE_URL,
  busyAction,
  loginEmail,
  loginPassword,
  notify,
  runBusy,
  setDisplayName,
  setLoginEmail,
  setLoginPassword,
  setOnboardingCompleted,
  setProducts,
  setScreen,
  setShowPassword,
  setUser,
  setUsername,
  showPassword,
  t,
  username,
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [marketingOptIn, setMarketingOptIn] = useState(false)
  const inputClass = `w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => window.history.back()}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[40px] font-light leading-[1.05] tracking-tight">
            Create your account
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Start building a skincare routine you can actually stick to.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                First name
              </label>
              <input
                type="text"
                autoComplete="given-name"
                placeholder="Ada"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Last name
              </label>
              <input
                type="text"
                autoComplete="family-name"
                placeholder="Okafor"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Email address
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 pr-12 text-[15px] outline-none`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-4 top-1/2 -translate-y-1/2 ${t.faint}`}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 3l18 18"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 0 0 2.25 12c1.5 2.7 4.5 6.75 9.75 6.75a9.8 9.8 0 0 0 4.023-.84"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.228 6.228A10.45 10.45 0 0 1 12 5.25c5.25 0 8.25 4.05 9.75 6.75a11.05 11.05 0 0 1-2.25 3.15"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Username
            </label>

            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="e.g. deeyah"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
            <p className={`mt-1.5 px-1 text-[12px] ${t.faint}`}>
              Shown on challenge leaderboards. You can change it later in Settings.
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 px-1">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#2554EB]"
            />
            <span className={`text-[13.5px] leading-relaxed ${t.muted}`}>
              Email me skincare tips, challenges and offers from Tracka+. You can turn this off anytime in Settings.
            </span>
          </label>

          <button
            disabled={busyAction === 'signup'}
            onClick={() =>
              runBusy('signup', async () => {
                const email = loginEmail.trim()
                const password = loginPassword
                const first = firstName.trim()
                const last = lastName.trim()
                const handle = username.trim()

                if (!first || !last || !handle || !email || !password) {
                  notify('Please fill in your first name, last name, email, password and username.')
                  return
                }

                if (handle.length < 2 || handle.length > 30) {
                  notify('Your username needs to be 2 to 30 characters.')
                  return
                }

                // If the check itself fails (offline, older server), carry on:
                // the sign-up trigger still guards against duplicates.
                const { data: available, error: availableError } = await supabase.rpc('is_username_available', { p_username: handle })
                if (!availableError && available === false) {
                  notify('That username is already taken. Try another one.')
                  return
                }

                const { data, error } = await supabase.auth.signUp({
                  email,
                  password,
                  options: {
                    data: {
                      username: handle,
                      first_name: first.slice(0, 50),
                      last_name: last.slice(0, 50),
                      marketing_opt_in: marketingOptIn,
                    },
                    emailRedirectTo: `${SITE_URL}/?confirmed=true`,
                  },
                })

                if (error) {
                  notify(error.message)
                  return
                }

                if (!data.user) {
                  notify('Account could not be created.')
                  return
                }

                setProducts([])
                setUser(data.user)
                setDisplayName(handle)
                setOnboardingCompleted(false)

                if (data.user.email === ADMIN_EMAIL) {
                  setScreen('admin')
                  return
                }

                if (data.session) {
                  setScreen('skinProfile')
                  return
                }

                setScreen('checkEmail')
              })
            }
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'signup' ? 'Creating account…' : 'Create account'}
          </button>

        </div>

        <p className={`mt-6 text-center text-[15px] ${t.muted}`}>
          Already have an account?{' '}
          <button
            onClick={() => setScreen('login')}
            className={`font-semibold ${t.mark}`}
          >
            Log in
          </button>
        </p>

      </div>
    </main>
  )
}
