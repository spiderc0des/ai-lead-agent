# Supabase Auth email templates

Paste each into **Supabase dashboard → Authentication → Emails → Templates**.
They match the styling of the notification emails the app sends itself
(`src/lib/email.ts`).

| Dashboard template | File | Subject |
| --- | --- | --- |
| Invite user | `invite-user.html` | You're invited to Koya Lead Agent |
| Magic Link | `magic-link.html` | Your Koya Lead Agent sign-in link |
| Confirm signup | `confirm-signup.html` | Confirm your email for Koya Lead Agent |

## Which one is sent when

- **Invite user**: an admin invites someone from `/admin`. The app calls
  `inviteUserByEmail` with the person's name, and Supabase sends this template.
  `{{ .Data.full_name }}` is that name.
- **Magic Link**: every sign-in from `/login` after the first.
- **Confirm signup**: Supabase uses this instead of Magic Link when an account
  exists but its email was never confirmed, for example someone who was invited
  but signs in from `/login` instead of clicking the invitation. It's included
  so that case works too.

## Before they work

**Authentication → URL Configuration**

- **Site URL**: the deployed origin, e.g. `https://koya-lead-agent.up.railway.app`.
  Every link is built from `{{ .SiteURL }}`, so a wrong value sends people to
  the wrong place.
- **Redirect URLs**: add `https://<your-domain>/**` (and
  `http://localhost:3000/**` for local testing).

For Supabase to send more than a handful of emails an hour, set up **custom
SMTP** under Authentication → Emails → SMTP Settings. The same Gmail app
password the app uses for notifications (`MAIL_USER` / `MAIL_APP_PASSWORD`)
works: host `smtp.gmail.com`, port `465`.

## Why the links use `{{ .TokenHash }}`, not `{{ .ConfirmationURL }}`

Every link points to the app's own `/auth/confirm` with a `token_hash`, which
the server verifies with `verifyOtp`:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
```

- `inviteUserByEmail` does not support PKCE. With the default
  `{{ .ConfirmationURL }}`, the person lands with their session in a URL
  fragment (`#access_token=…`), which a server route can't read, and they end up
  back at `/login`.
- Corporate mail scanners open links in incoming mail. A default confirmation
  link can be used up by the scanner before the person clicks it. A
  `token_hash` link is only redeemed when `/auth/confirm` runs.

The `type` must match the template: `invite` for Invite user, and `email` for
Magic Link and Confirm signup. The wrong type fails only after someone clicks,
and looks exactly like an expired link.
