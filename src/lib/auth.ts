import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Profile = {
  id: string;
  email: string;
  role: "member" | "admin";
  /** Null for accounts created before 0008_names_roles.sql, or without a name. */
  full_name: string | null;
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** The signed-in user's profile, or null. */
export async function currentProfile(): Promise<Profile | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read through the service role: a brand-new user may race the
  // on_auth_user_created trigger, and we want a clear error either way.
  const { data } = await supabaseAdmin()
    .from("profiles")
    // "*" rather than a column list: full_name only exists once
    // 0008_names_roles.sql is applied, and naming a missing column would fail
    // the whole read — locking every admin out of /admin.
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) {
    return { id: user.id, email: user.email ?? "", role: "member", full_name: null };
  }
  return { full_name: null, ...data } as Profile;
}

/** Throws 401 unless someone is signed in. */
export async function requireUser(): Promise<Profile> {
  const profile = await currentProfile();
  if (!profile) throw new AuthError("Not signed in", 401);
  return profile;
}

/** Throws 401/403 unless the caller is an admin. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();
  if (profile.role !== "admin") throw new AuthError("Admins only", 403);
  return profile;
}

/** Map an AuthError (or anything else) onto a Response. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
