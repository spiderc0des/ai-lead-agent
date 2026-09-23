import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pumpQueue } from "@/agent/queue";
import { WORKER_CEILING, PER_USER_CEILING } from "@/lib/settings";

export const runtime = "nodejs";

const Body = z.object({
  apify_cap_usd: z.number().min(0).max(1000).optional(),
  agent_cap_usd: z.number().min(0).max(1000).optional(),
  runs_paused: z.boolean().optional(),
  max_concurrent_runs: z.number().int().min(1).max(WORKER_CEILING).optional(),
  max_runs_per_user: z.number().int().min(1).max(PER_USER_CEILING).optional(),
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

    if (error) {
      // The worker columns arrive with 0007; say so rather than a column error.
      const missing = /max_concurrent_runs|max_runs_per_user/.test(error.message);
      return NextResponse.json(
        { error: missing ? "Apply supabase/migrations/0007_workers.sql to change worker settings." : error.message },
        { status: missing ? 409 : 500 },
      );
    }

    // Unpausing, or adding capacity, should let anything waiting start now.
    if (
      parsed.data.runs_paused === false ||
      parsed.data.max_concurrent_runs !== undefined ||
      parsed.data.max_runs_per_user !== undefined
    ) {
      void pumpQueue();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
