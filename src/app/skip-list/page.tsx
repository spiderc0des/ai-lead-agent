import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { SkipList, type SkipRow } from "@/components/SkipList";

export const dynamic = "force-dynamic";

export default async function SkipListPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  // Read under the user's own session: the list is team-wide, so RLS lets
  // every signed-in person read it.
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("suppressed_domains")
    .select("domain, reason, note, added_by, added_by_name, created_at")
    .order("created_at", { ascending: false });

  const missing = Boolean(error && /suppressed_domains/.test(error.message));

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-lg font-semibold">Skip list</h1>
        <p className="hint mt-1">
          Domains every run skips: existing customers, companies already contacted, and ones asked to
          be excluded. Discovery drops them before they cost a candidate slot or a scrape, the same
          way it drops directories. Companies qualified in any earlier run are skipped automatically
          and don&apos;t need to be listed here. Only domains are stored — never a person&apos;s details.
        </p>
        {missing ? (
          <p className="panel panel-warning mt-5">
            Apply <code>supabase/migrations/0011_suppression.sql</code> to use the skip list.
          </p>
        ) : (
          <SkipList rows={(data ?? []) as SkipRow[]} meId={profile.id} isAdmin={profile.role === "admin"} />
        )}
      </main>
    </>
  );
}
