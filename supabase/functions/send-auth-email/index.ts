// Supabase Auth "Send Email" hook. When this hook is enabled in the
// dashboard, Supabase stops sending auth emails itself (built-in service
// or Custom SMTP) and instead POSTs the email event here — we build the
// message and send it through Resend ourselves, so it can carry Tracka+'s
// own design instead of Supabase's template editor.
//
// Payload + signature verification follow Supabase's documented Send
// Email Hook contract: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
import { Webhook } from 'npm:standardwebhooks@1.0.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Tracka+ <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

// Supabase shows this as "v1,whsec_..." when you enable the hook — the
// library wants just the whsec_ value.
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace(/^v1,/, '')

const NAVY = '#0B1E33'
const BLUE = '#2554EB'
const MUTED = '#51637E'

function renderEmail({ heading, bodyHtml, ctaLabel, ctaUrl }: {
  heading: string
  bodyHtml: string
  ctaLabel: string
  ctaUrl: string
}) {
  return `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F5F8FC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FC; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#FFFFFF; border-radius:24px; overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <span style="font-size:17px; font-weight:700; color:${NAVY};">Tracka<span style="color:${BLUE};">+</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <h1 style="margin:0; font-size:24px; font-weight:600; color:${NAVY}; line-height:1.3;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px; font-size:15px; line-height:1.6; color:${MUTED};">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px 32px;">
                <a href="${ctaUrl}" style="display:inline-block; background:${BLUE}; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:15px; padding:14px 28px; border-radius:14px;">
                  ${ctaLabel}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px 32px; font-size:12px; line-height:1.6; color:${MUTED};">
                Or paste this link into your browser:<br />
                <span style="word-break:break-all;">${ctaUrl}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px; font-size:12px; color:${MUTED}; border-top:1px solid #EEF2F8; margin-top:8px;">
                If you didn't request this, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buildActionUrl(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string) {
  const url = new URL(`${supabaseUrl}/auth/v1/verify`)
  url.searchParams.set('token', tokenHash)
  url.searchParams.set('type', type)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

function buildEmail(emailActionType: string, actionUrl: string, otp: string) {
  switch (emailActionType) {
    case 'signup':
      return {
        subject: 'Confirm your Tracka+ account',
        html: renderEmail({
          heading: 'Confirm your email',
          bodyHtml: "You're one step away from tracking your skincare routine. Confirm your email to finish setting up your account.",
          ctaLabel: 'Confirm email',
          ctaUrl: actionUrl,
        }),
      }
    case 'recovery':
      return {
        subject: 'Reset your Tracka+ password',
        html: renderEmail({
          heading: 'Reset your password',
          bodyHtml: 'We got a request to reset the password on your Tracka+ account. Tap below to choose a new one.',
          ctaLabel: 'Reset password',
          ctaUrl: actionUrl,
        }),
      }
    case 'email_change':
      return {
        subject: 'Confirm your new email for Tracka+',
        html: renderEmail({
          heading: 'Confirm your new email',
          bodyHtml: 'Confirm this address to finish updating the email on your Tracka+ account.',
          ctaLabel: 'Confirm new email',
          ctaUrl: actionUrl,
        }),
      }
    case 'magiclink':
      return {
        subject: 'Your Tracka+ sign-in link',
        html: renderEmail({
          heading: 'Sign in to Tracka+',
          bodyHtml: 'Tap below to sign in. This link only works once.',
          ctaLabel: 'Sign in',
          ctaUrl: actionUrl,
        }),
      }
    case 'invite':
      return {
        subject: "You've been invited to Tracka+",
        html: renderEmail({
          heading: "You're invited",
          bodyHtml: 'Someone invited you to Tracka+. Accept the invite to set up your account.',
          ctaLabel: 'Accept invite',
          ctaUrl: actionUrl,
        }),
      }
    default:
      // reauthentication and anything else: Supabase expects a one-time
      // code shown to the user rather than a link for these.
      return {
        subject: 'Your Tracka+ verification code',
        html: renderEmail({
          heading: 'Verify it’s you',
          bodyHtml: `Enter this code to continue: <strong style="color:${NAVY}; font-size:20px; letter-spacing:2px;">${otp}</strong>`,
          ctaLabel: 'Open Tracka+',
          ctaUrl: actionUrl,
        }),
      }
  }
}

Deno.serve(async (req) => {
  const payload = await req.text()

  try {
    const wh = new Webhook(HOOK_SECRET)
    const headers = Object.fromEntries(req.headers)
    const verified = wh.verify(payload, headers) as {
      user: { email: string }
      email_data: {
        token: string
        token_hash: string
        redirect_to: string
        email_action_type: string
        site_url: string
      }
    }

    const { user, email_data } = verified
    const actionUrl = buildActionUrl(SUPABASE_URL, email_data.token_hash, email_data.email_action_type, email_data.redirect_to)
    const { subject, html } = buildEmail(email_data.email_action_type, actionUrl, email_data.token)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [user.email],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error('RESEND ERROR:', res.status, body)
      return new Response(
        JSON.stringify({ error: { http_code: 500, message: 'Failed to send email' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('SEND AUTH EMAIL ERROR:', err)
    return new Response(
      JSON.stringify({ error: { http_code: 401, message: 'Invalid webhook signature' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
