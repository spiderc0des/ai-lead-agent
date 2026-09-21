import Link from "next/link";
import { redirect } from "next/navigation";
import { currentProfile } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { RunView } from "@/components/RunView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await currentProfile();
  if (!profile) redirect("/login");
  const { id } = await params;

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <Link href="/" className="text-xs no-underline" style={{ color: "var(--ink-faint)" }}>← all runs</Link>
        <div className="mt-4"><RunView runId={id} /></div>
      </main>
    </>
  );
}
