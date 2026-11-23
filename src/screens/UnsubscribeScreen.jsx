// Email unsubscribe: trackaplus.app/?unsubscribe=<token>, the link in the
// footer and List-Unsubscribe header of app emails (win-back, and any we add).
//
// Rendered by main.jsx INSTEAD of the app, so it works signed out and never
// waits for auth. The token alone identifies the person (unsubscribe_email()
// is anon-callable and reveals nothing about who it belongs to).
//
// Asks for one tap rather than unsubscribing on page load: mail security
// scanners open links in emails automatically, and would otherwise
// unsubscribe people who never clicked.

import { useState } from 'react'
import { supabase } from '../lib/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function UnsubscribeScreen({ token }) {
  const valid = UUID.test(token || '')
  const [state, setState] = useState(valid ? 'ask' : 'invalid') // ask | working | done | invalid | error

  const unsubscribe = async () => {
    setState('working')
    const { data, error } = await supabase.rpc('unsubscribe_email', { p_token: token })
    if (error) {
      console.error('UNSUBSCRIBE ERROR:', error)
      setState('error')
      return
    }
    setState(data ? 'done' : 'invalid')
  }

  const copy = {
    ask: ['Stop Tracka+ emails?', "We'll stop sending you emails about your routine, challenges and offers. You can still use the app as normal."],
    working: ['Stop Tracka+ emails?', "We'll stop sending you emails about your routine, challenges and offers. You can still use the app as normal."],
    done: ["You're unsubscribed", "We won't email you again. Emails you ask for, like password resets, will still arrive. Changed your mind? Turn promotional emails back on in Settings → Your details."],
    invalid: ['This link has expired', "We couldn't find that unsubscribe link. Open the latest email from us and use the link at the bottom, or turn emails off in Settings → Your details."],
    error: ['Something went wrong', 'Check your connection and try again.'],
  }[state]

  return (
    <main className="min-h-screen bg-[#F5F8FC] text-[#101B2D]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-10">
        <p className="text-[17px] font-bold">Tracka<span className="text-[#2554EB]">+</span></p>

        <div className="mt-10">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">{copy[0]}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-[#51637E]">{copy[1]}</p>
        </div>

        {(state === 'ask' || state === 'working' || state === 'error') && (
          <button
            type="button"
            disabled={state === 'working'}
            onClick={unsubscribe}
            className="mt-8 w-full rounded-2xl bg-[#101B2D] py-4 text-base font-bold text-white disabled:opacity-60"
          >
            {state === 'working' ? 'Unsubscribing…' : state === 'error' ? 'Try again' : 'Unsubscribe'}
          </button>
        )}

        <a href="/" className="mt-4 block w-full rounded-2xl border border-[#101B2D]/10 py-4 text-center text-[15px] font-semibold">
          Open Tracka+
        </a>
      </div>
    </main>
  )
}
