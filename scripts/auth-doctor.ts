/**
 * Work out why a sign-in link did not arrive, and hand you one that works.
 *
 * Supabase's built-in email sender is a shared testing service with a tight
 * hourly cap — it is explicitly not for production, and it fails quietly. This
 * reads the actual auth state with the service-role key and then mints a
 * sign-in link directly, so email delivery stops being on the critical path.
 *
 *   npm run auth:doctor -- you@company.com
 */
import "./env";
import { assertSupabaseUrl, requireEnv } from "./env";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: npm run auth:doctor -- you@company.com");
  }

  requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const url = assertSupabaseUrl();
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`project : ${url}`);
  console.log(`app url : ${appUrl}`);
  console.log(`checking: ${email}\n`);

  /* ---------------------------------------------------------- auth user -- */
  const { data: list, error: listErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw new Error(`Could not list users: ${listErr.message}`);

  const user = list.users.find((u) => u.email?.toLowerCase() === email);

  if (!user) {
    console.log("auth user        : NOT FOUND");
    console.log("\nThat is the whole problem. /login uses shouldCreateUser:false, so an");
    console.log("address with no account never receives a link — silently, by design.");
    console.log(`Run:  npm run seed:admin -- ${email}`);
    process.exit(1);
  }

  console.log(`auth user        : ${user.id}`);
  console.log(`  created        : ${user.created_at}`);
  console.log(`  invited        : ${user.invited_at ?? "(not via invite)"}`);
  console.log(`  email confirmed: ${user.email_confirmed_at ?? "NO — never followed a link yet"}`);
  console.log(`  last sign-in   : ${user.last_sign_in_at ?? "never"}`);

  /* ------------------------------------------------------------ profile -- */
  const { data: profile } = await db
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    console.log(`\nprofile          : MISSING`);
    console.log("  The on_auth_user_created trigger did not fire — check that");
    console.log("  supabase/migrations/0002_auth_rls.sql ran in full.");
  } else {
    console.log(`\nprofile          : role=${profile.role}`);
    if (profile.role !== "admin") {
      console.log(`  Not an admin. Run: npm run seed:admin -- ${email}`);
    }
  }

  const { data: allowed } = await db
    .from("allowed_emails")
    .select("email, invited_at, accepted_at")
    .eq("email", email)
    .maybeSingle();
  console.log(`allowlist        : ${allowed ? `invited ${allowed.invited_at}` : "no row (not required to sign in)"}`);

  /* -------------------------------------------------------- a real link -- */
  const redirectTo = `${appUrl}/auth/confirm?next=%2F`;
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });

  if (linkErr || !link?.properties) {
    console.error(`\nCould not generate a link: ${linkErr?.message ?? "no properties returned"}`);
    process.exit(1);
  }

  const hashed = link.properties.hashed_token;
  const direct = `${appUrl}/auth/confirm?token_hash=${hashed}&type=magiclink&next=%2F`;

  console.log(`\n${"=".repeat(72)}`);
  console.log("SIGN IN WITHOUT EMAIL — paste either link into your browser");
  console.log("=".repeat(72));
  console.log(`\nStraight at this app (skips Supabase's redirect entirely):\n\n  ${direct}`);
  console.log(`\nVia Supabase's verify endpoint (also proves your redirect allowlist):\n\n  ${link.properties.action_link}`);
  console.log(`\nBoth are single-use and expire. Generating this did NOT send an email.`);

  console.log(`\n${"-".repeat(72)}`);
  console.log("If email itself is what you need working:");
  console.log("  1. Auth > Emails > SMTP Settings — the built-in sender is a shared");
  console.log("     testing service with a low hourly cap and no delivery guarantee.");
  console.log("     Point it at Resend, SendGrid or Gmail SMTP for anything real.");
  console.log("  2. Auth > Rate Limits — check you have not already burnt the hour's quota.");
  console.log(`  3. Auth > URL Configuration — ${appUrl}/auth/confirm must be on the`);
  console.log("     redirect allowlist, or the link is rejected after it is clicked.");
  console.log("  4. Auth > Providers > Email — confirm the provider is enabled.");
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
