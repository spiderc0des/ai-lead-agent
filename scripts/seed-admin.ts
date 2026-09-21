/**
 * Promote an account to admin, and optionally create it first.
 *
 * The first admin has to be made out of band — there is no bootstrap UI,
 * because a self-service one would be a way in.
 *
 *   npm run seed:admin -- you@company.com
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run seed:admin -- you@company.com");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Find or invite the user.
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (!user) {
    console.log(`No account for ${email} yet — sending an invite.`);
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/confirm`;
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) {
      console.error("Invite failed:", error.message);
      process.exit(1);
    }
    user = data.user;
  }

  await db.from("allowed_emails").upsert({ email }, { onConflict: "email" });

  // The trigger normally creates this; upsert covers a pre-existing account.
  const { error } = await db
    .from("profiles")
    .upsert({ id: user!.id, email, role: "admin" }, { onConflict: "id" });

  if (error) {
    console.error("Could not set the admin role:", error.message);
    process.exit(1);
  }

  console.log(`${email} is now an admin (user id ${user!.id}).`);
  console.log("Sign in from /login — the invite email also works as a sign-in link.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
