import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { NewRunForm } from "@/components/NewRunForm";

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const profile = await currentProfile();
  if (!profile) redirect("/login");

  const supabase = await supabaseServer();
  const { data: active } = await supabase
    .from("runs")
    .select("id")
    .in("status", ["queued", "running"])
    .limit(1);

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <Link href="/" className="text-xs no-underline" style={{ color: "var(--ink-faint)" }}>
          ← all runs
        </Link>
        <h1 className="mt-3 text-lg font-semibold">New run</h1>
        <div className="mt-4">
          <NewRunForm hasActiveRun={(active?.length ?? 0) > 0} />
        </div>
      </main>
    </>
  );
}
