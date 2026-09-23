import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelRun } from "@/agent/run-agent";
import { releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";

export const runtime = "nodejs";

/**
 * Delete a run and everything recorded under it.
 *
 * Every child table cascades from runs, so this removes the candidates, the
 * scraped pages, the qualification decisions, the drafts and the audit trail
 * along with it. That is the point — a run is the unit of work — but it is
 * also why the UI asks first.
 *
 * A run still in flight is aborted before deletion, otherwise the agent would
 * keep writing rows against an id that no longer exists.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const { data: run } = await supabaseAdmin()
      .from("runs")
      .select("id, user_id, status, limits, reserved_usd")
      .eq("id", id)
      .maybeSingle();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Checked here because this route writes with the service role, which
    // bypasses RLS.
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }

    if (run.status === "running" || run.status === "queued") {
      cancelRun(id);
      const reserved = Number(run.reserved_usd ?? 0);
      if (reserved > 0) {
        await releaseBudget("agent", reserved, undefined, run.user_id, "run deleted while active");
      }
    }

    const { error } = await supabaseAdmin().from("runs").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    void pumpQueue();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
