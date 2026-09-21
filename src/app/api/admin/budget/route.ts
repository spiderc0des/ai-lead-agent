import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pumpQueue } from "@/agent/queue";

export const runtime = "nodejs";

const Body = z.object({
  apify_cap_usd: z.number().min(0).max(1000).optional(),
  agent_cap_usd: z.number().min(0).max(1000).optional(),
  runs_paused: z.boolean().optional(),
});

/** Adjust the shared caps, or pause new runs entirely. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from("app_budget")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", "global");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Unpausing should let anything waiting start immediately.
    if (parsed.data.runs_paused === false) void pumpQueue();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
