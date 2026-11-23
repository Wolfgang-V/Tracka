// Welcome email. Runs every 5 minutes (cron job 'send-welcome-emails').
//
// Sends the welcome email once to every account due_welcome_emails()
// returns: people who confirmed in the last 14 days and haven't had it.
// No backfill to older accounts: those get a win-back campaign from the
// campaign tool instead (see migration 20261123010000).
// Each result is written to welcome_email_log, so nobody gets it twice.
//
// Sent through Resend (the same account Supabase Auth uses for SMTP).
// Secrets: RESEND_API_KEY, RESEND_FROM_EMAIL (e.g. "Tracka+ <hello@trackaplus.app>"
// on a domain verified in Resend).
//
// Manual calls (service-role key only):
//   { "dry_run": true }              → list who is due, send nothing
//   { "test_to": "you@example.com",  → send one sample to that address,
//     "first_name": "Ada" }             nothing logged
import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? ''
const APP_URL = 'https://www.trackaplus.app'

const BATCH = 25 // per run; ~5/min keeps well under Resend's rate limit
const GAP_MS = 600

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const NAVY = '#0B1E33'
const BLUE = '#2554EB'
const MUTED = '#51637E'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function greetingName(firstName?: string | null, username?: string | null) {
  return (firstName || username || '').trim() || 'there'
}

const p = (html: string, mb = 16) =>
  `<p style="margin:0 0 ${mb}px 0; font-size:15px; line-height:1.6; color:${NAVY};">${html}</p>`

const list = (items: string[], ordered = false) => {
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag} style="margin:0 0 16px 0; padding-left:22px; font-size:15px; line-height:1.7; color:${NAVY};">${
    items.map((i) => `<li>${i}</li>`).join('')
  }</${tag}>`
}

function welcomeEmail(name: string) {
  const subject = 'Welcome to Tracka+ 💙'
  const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F5F8FC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FC; padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#FFFFFF; border-radius:24px; overflow:hidden;">
          <tr><td style="padding:36px 32px 8px 32px; text-align:center;">
            <img src="${APP_URL}/logo-wordmark.jpg" alt="Tracka+" width="140" style="display:block; margin:0 auto 20px auto; border:0;" />
          </td></tr>
          <tr><td style="padding:0 32px 32px 32px;">
            ${p(`Hi ${escapeHtml(name)},`)}
            ${p(`Welcome to Tracka+! We're excited to have you here.`)}
            ${p(`We're here to help you build better skincare habits, stay consistent, learn more about your skin, and make your skincare journey more rewarding.`)}
            ${p(`<strong>Here's how to get started:</strong>`, 8)}
            ${list([
              'Explore Tracka+.',
              'Start building your skincare routine.',
              'Participate in challenges and activities.',
              'Stay consistent and enjoy the journey!',
            ])}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px 0;">
              <tr><td style="border-radius:14px; background:${BLUE};">
                <a href="${APP_URL}" style="display:inline-block; padding:15px 30px; font-size:15px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:14px;">Open Tracka+</a>
              </td></tr>
            </table>

            <div style="background:#F5F8FC; border-radius:18px; padding:20px 20px 4px 20px; margin:0 0 24px 0;">
              ${p(`<strong>📱 Add Tracka+ to Your Home Screen</strong>`, 6)}
              ${p(`Get quick access to Tracka+ anytime!`, 12)}
              ${p(`<strong>iPhone:</strong>`, 4)}
              ${list(['Open Tracka+ in your browser.', 'Tap the Share icon.', 'Select <strong>Add to Home Screen</strong>.', 'Tap <strong>Add</strong>.'], true)}
              ${p(`<strong>Android:</strong>`, 4)}
              ${list(['Open Tracka+ in Chrome.', 'Tap the three dots in the top corner.', 'Select <strong>Add to Home screen</strong> or <strong>Install app</strong>.'], true)}
              ${p(`And you're all set! Tracka+ is now just one tap away.`)}
            </div>

            ${p(`Remember, healthy skin starts with consistent habits. We're happy to be part of your journey!`)}
            ${p(`Welcome to the community!`)}
            ${p(`The Tracka+ Team`, 0)}
          </td></tr>
          <tr><td style="padding:18px 32px 26px 32px; font-size:12px; line-height:1.6; color:${MUTED}; border-top:1px solid #EEF2F8;">
            You're receiving this because you created a Tracka+ account.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  const text = `Hi ${name},

Welcome to Tracka+! We're excited to have you here.

We're here to help you build better skincare habits, stay consistent, learn more about your skin, and make your skincare journey more rewarding.

Here's how to get started:
- Explore Tracka+.
- Start building your skincare routine.
- Participate in challenges and activities.
- Stay consistent and enjoy the journey!

Open Tracka+: ${APP_URL}

Add Tracka+ to Your Home Screen
Get quick access to Tracka+ anytime!

iPhone:
1. Open Tracka+ in your browser.
2. Tap the Share icon.
3. Select Add to Home Screen.
4. Tap Add.

Android:
1. Open Tracka+ in Chrome.
2. Tap the three dots in the top corner.
3. Select Add to Home screen or Install app.

And you're all set! Tracka+ is now just one tap away.

Remember, healthy skin starts with consistent habits. We're happy to be part of your journey!

Welcome to the community!

The Tracka+ Team`

  return { subject, html, text }
}

async function sendOne(to: string, name: string) {
  const { subject, html, text } = welcomeEmail(name)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
  })
  if (res.ok) return { ok: true as const }
  return { ok: false as const, status: res.status, error: (await res.text()).slice(0, 500) }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  // verify_jwt lets the public anon key through too; only the service role
  // (the cron job, or you by hand) may trigger sends.
  // The gateway has already verified the JWT's signature; read its role.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  let role = ''
  try {
    const part = bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    role = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).role ?? ''
  } catch { /* not a JWT */ }
  if (role !== 'service_role') return json({ error: 'forbidden' }, 403)

  if (!RESEND_API_KEY || !RESEND_FROM) {
    return json({ error: 'RESEND_API_KEY and RESEND_FROM_EMAIL must be set' }, 500)
  }

  const body = await req.json().catch(() => ({})) as {
    dry_run?: boolean
    test_to?: string
    first_name?: string
  }

  if (body.test_to) {
    const r = await sendOne(body.test_to, greetingName(body.first_name))
    return json({ test: true, ...r }, r.ok ? 200 : 502)
  }

  const { data: due, error } = await supabase.rpc('due_welcome_emails', { p_limit: BATCH })
  if (error) {
    console.error('DUE WELCOME EMAILS ERROR:', error)
    return json({ error: error.message }, 500)
  }

  if (body.dry_run) {
    return json({ dry_run: true, due: (due ?? []).map((d: any) => ({ email: d.email, name: greetingName(d.first_name, d.username) })) })
  }

  let sent = 0, failed = 0
  for (const [i, d] of (due ?? []).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS))
    const r = await sendOne(d.email, greetingName(d.first_name, d.username))
    if (r.ok) {
      sent++
      await supabase.rpc('log_welcome_email', { p_user_id: d.user_id, p_status: 'sent' })
    } else if (r.status === 429) {
      // Rate-limited: not this person's fault, so don't use up one of their
      // tries. Stop; the next run picks up where we left off.
      break
    } else {
      failed++
      console.error('WELCOME EMAIL ERROR:', d.user_id, r.status, r.error)
      await supabase.rpc('log_welcome_email', { p_user_id: d.user_id, p_status: 'failed', p_error: `${r.status} ${r.error}` })
    }
  }

  return json({ sent, failed, due: due?.length ?? 0 })
})
