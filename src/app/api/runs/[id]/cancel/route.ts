import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelRun } from "@/agent/run-agent";
import { releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";

export const runtime = "nodejs";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const { data: run } = await supabaseAdmin()
      .from("runs")
      .select("id, user_id, status, limits")
      .eq("id", id)
      .maybeSingle();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Ownership is checked here because this route writes with the service
    // role, which bypasses RLS.
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }
    if (!["queued", "running"].includes(run.status)) {
      return NextResponse.json({ error: `Run is already ${run.status}` }, { status: 409 });
    }

    const wasRunning = cancelRun(id);

    if (!wasRunning) {
      // Queued, or orphaned by a restart: nothing to abort, just close it out.
      await supabaseAdmin()
        .from("runs")
        .update({
          status: "cancelled",
          status_reason: "Cancelled before the agent started.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", id)
        .in("status", ["queued", "running"]);

      const reserved = (run.limits as { max_budget_usd?: number })?.max_budget_usd ?? 0;
      if (reserved > 0) {
        await releaseBudget("agent", reserved, id, run.user_id, "cancelled before start");
      }
      void pumpQueue();
    }

    return NextResponse.json({ ok: true, aborted: wasRunning });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
