import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { displayName } from "@/lib/display-name";
import { parseDomainList, SUPPRESSION_REASONS } from "@/lib/suppression";

export const runtime = "nodejs";

const AddBody = z.object({
  domains: z.string().min(1, "Enter at least one domain").max(20_000),
  reason: z.enum(SUPPRESSION_REASONS).default("excluded"),
  note: z.string().trim().max(500).optional().default(""),
});
const RemoveBody = z.object({ domain: z.string().min(3) });

function missingTable(message: string) {
  return /suppressed_domains/.test(message);
}
const MIGRATION = "Apply supabase/migrations/0011_suppression.sql to use the skip list.";

/**
 * Add domains to the team's skip list. Anyone signed in may add: missing a
 * customer is the costly mistake, so adding should be easy. Existing entries
 * keep their original reason and author.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = AddBody.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const { domains, invalid } = parseDomainList(parsed.data.domains);
    if (domains.length === 0) {
      return NextResponse.json({ error: `None of those look like domains: ${invalid.slice(0, 5).join(", ")}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from("suppressed_domains")
      .upsert(
        domains.map((domain) => ({
          domain,
          reason: parsed.data.reason,
          note: parsed.data.note || null,
          added_by: user.id,
          added_by_name: displayName(user),
        })),
        { onConflict: "domain", ignoreDuplicates: true },
      )
      .select("domain");
    if (error) {
      return NextResponse.json({ error: missingTable(error.message) ? MIGRATION : error.message }, { status: missingTable(error.message) ? 409 : 500 });
    }

    const added = data?.length ?? 0;
    const already = domains.length - added;
    return NextResponse.json({
      ok: true,
      note:
        `Added ${added} domain${added === 1 ? "" : "s"}.` +
        (already ? ` ${already} ${already === 1 ? "was" : "were"} already on the list.` : "") +
        (invalid.length ? ` Ignored ${invalid.length} that didn't look like domains: ${invalid.slice(0, 5).join(", ")}.` : ""),
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}

/**
 * Remove a domain. Only whoever added it, or an admin: taking a customer off
 * the list means discovery may start finding and pitching them again.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const parsed = RemoveBody.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Which domain?" }, { status: 400 });

    const db = supabaseAdmin();
    const { data: row, error: readError } = await db
      .from("suppressed_domains")
      .select("domain, added_by")
      .eq("domain", parsed.data.domain)
      .maybeSingle();
    if (readError) {
      return NextResponse.json({ error: missingTable(readError.message) ? MIGRATION : readError.message }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: "Not on the list" }, { status: 404 });
    if (row.added_by !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Only whoever added it, or an admin, can remove it." }, { status: 403 });
    }

    await db.from("suppressed_domains").delete().eq("domain", row.domain);
    return NextResponse.json({ ok: true, note: `Removed ${row.domain}. Future runs may discover it again.` });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
