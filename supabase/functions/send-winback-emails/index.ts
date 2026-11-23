// One-time win-back for dormant sign-ups who never finished setting up.
// (Reviewer's function; migration 20261123020000_winback_dormant_signups.)
//
// Deliberately NOT on a cron: call it by hand, a batch at a time, and check
// Resend's bounce/complaint rates between batches.
//
//   ?dry=1          render everything, send nothing, return the emails
//   ?limit=20       batch size (default 20, max 50)
//
//   curl -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
//        "https://<project>.supabase.co/functions/v1/send-winback-emails?dry=1"
//
// Every email carries an unsubscribe link and a List-Unsubscribe header.
// due_winback_emails() already filters out anyone suppressed.
//
// Changes from the reviewer's draft:
// - Service-role only. verify_jwt also accepts the public anon key (it's in
//   the app bundle), so without this check anyone could trigger sends or
//   pull ?dry=1 previews containing users' email addresses.
// - Unsubscribe link is /?unsubscribe=TOKEN, not /unsubscribe?t=TOKEN.
//   The site has no SPA rewrites, so /unsubscribe returns 404 on Vercel
//   (checked 2026-11-23). The app handles ?unsubscribe= on load.
// - APP_URL defaults to www (the bare domain 308-redirects there anyway).
// - A 429 from Resend stops the batch without using up one of that person's
//   3 tries.

import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL')!
const APP_URL = Deno.env.get('APP_URL') ?? 'https://www.trackaplus.app'

const NAVY = '#0B1E33'
const BLUE = '#2554EB'
const MUTED = '#51637E'

type Row = {
  user_id: string
  email: string
  first_name: string | null
  username: string | null
  unsubscribe_token: string
  variant: 'has_products' | 'needs_products'
  product_count: number
  product_names: string[] | null
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const unsubscribeUrl = (token: string) => `${APP_URL}/?unsubscribe=${encodeURIComponent(token)}`

// The gateway has already verified the JWT's signature; read its role.
function isServiceRole(req: Request) {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  try {
    const part = bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function render(heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string, unsubUrl: string) {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F5F8FC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FC; padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#FFFFFF; border-radius:24px; overflow:hidden;">
          <tr><td style="padding:28px 32px 0 32px;">
            <span style="font-size:17px; font-weight:700; color:${NAVY};">Tracka<span style="color:${BLUE};">+</span></span>
          </td></tr>
          <tr><td style="padding:24px 32px 8px 32px;">
            <h1 style="margin:0; font-size:24px; font-weight:600; color:${NAVY}; line-height:1.3;">${heading}</h1>
          </td></tr>
          <tr><td style="padding:0 32px 8px 32px; font-size:15px; line-height:1.6; color:${MUTED};">${bodyHtml}</td></tr>
          <tr><td style="padding:16px 32px 8px 32px;">
            <a href="${ctaUrl}" style="display:inline-block; background:${BLUE}; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:15px; padding:14px 28px; border-radius:14px;">${ctaLabel}</a>
          </td></tr>
          <tr><td style="padding:20px 32px 28px 32px; font-size:12px; line-height:1.6; color:${MUTED}; border-top:1px solid #EEF2F8;">
            You're getting this because you started setting up a Tracka+ account.<br />
            <a href="${unsubUrl}" style="color:${MUTED};">Don't email me again</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function build(row: Row) {
  const name = row.first_name?.trim() || row.username?.trim() || ''
  const hi = name ? `Hi ${esc(name)}, ` : ''
  const unsubUrl = unsubscribeUrl(row.unsubscribe_token)

  if (row.variant === 'has_products') {
    const names = (row.product_names ?? []).filter(Boolean)
    const shown = names.slice(0, 3).map(esc)
    const rest = row.product_count - shown.length
    // "your X, Y and Z" / "...and 18 others"
    const list = shown.length
      ? shown.join(', ') + (rest > 0 ? ` and ${rest} other${rest === 1 ? '' : 's'}` : '')
      : `your ${row.product_count} product${row.product_count === 1 ? '' : 's'}`

    return {
      subject: row.product_count > 1
        ? `Your ${row.product_count} products are waiting`
        : 'Your product is waiting',
      html: render(
        "You're one step from your routine",
        `${hi}you saved <strong style="color:${NAVY};">${list}</strong> to Tracka+, but never built a routine with them.` +
        `<br /><br />It takes about a minute — pick which ones you use in the morning and at night, and Tracka+ handles the rest: ` +
        `reminders, what to skip after a retinol night, and when something's about to expire.`,
        'Build my routine',
        APP_URL,
        unsubUrl,
      ),
    }
  }

  return {
    subject: 'Finish setting up your Tracka+ routine',
    html: render(
      'Add one product to get started',
      `${hi}you told Tracka+ about your skin, but didn't add any products yet.` +
      `<br /><br />Add just one — a cleanser, a serum, whatever's nearest — and you can build a routine around it. ` +
      `Tracka+ then reminds you morning and night, and tells you which nights to rest.`,
      'Add my first product',
      APP_URL,
      unsubUrl,
    ),
  }
}

Deno.serve(async (req) => {
  if (!isServiceRole(req)) return Response.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 50)

  if (!dry && (!RESEND_API_KEY || !RESEND_FROM)) {
    return Response.json({ error: 'RESEND_API_KEY and RESEND_FROM_EMAIL must both be set' }, { status: 500 })
  }

  const { data, error } = await supabase.rpc('due_winback_emails', { p_limit: limit })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Row[]
  const result = { queued: rows.length, sent: 0, failed: 0, dryRun: dry, rateLimited: false, errors: [] as unknown[], preview: [] as unknown[] }

  for (const row of rows) {
    const { subject, html } = build(row)

    if (dry) {
      result.preview.push({ to: row.email, variant: row.variant, products: row.product_count, subject, html })
      continue
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: row.email,
          subject,
          html,
          // Lets Gmail/Apple show a native unsubscribe button, which people
          // use INSTEAD of the spam button. Worth more than the footer link.
          headers: { 'List-Unsubscribe': `<${unsubscribeUrl(row.unsubscribe_token)}>` },
        }),
      })

      if (res.status === 429) {
        // Not this person's fault: don't log a try. Stop; rerun later.
        result.rateLimited = true
        break
      }
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)

      await supabase.rpc('log_winback_email', {
        p_user_id: row.user_id, p_variant: row.variant, p_status: 'sent', p_error: null,
      })
      result.sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await supabase.rpc('log_winback_email', {
        p_user_id: row.user_id, p_variant: row.variant, p_status: 'failed', p_error: message,
      })
      result.failed++
      result.errors.push({ user: row.user_id, message })
    }

    // Gentle on Resend's rate limit, and spreads the send out a little.
    await new Promise((r) => setTimeout(r, 600))
  }

  return Response.json(result)
})
