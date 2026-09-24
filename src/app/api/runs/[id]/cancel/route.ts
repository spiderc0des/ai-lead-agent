import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelRun, notifyOwner } from "@/agent/run-agent";
import { releaseBudget } from "@/agent/budget";
import { pumpQueue } from "@/agent/queue";
import { recordRunEvent } from "@/lib/run-events";
import { displayName } from "@/lib/display-name";

export const runtime = "nodejs";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    const { data: run } = await supabaseAdmin()
      .from("runs")
      .select("id, user_id, status, limits, reserved_usd")
      .eq("id", id)
      .maybeSingle();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Ownership is checked here because this route writes with the service
    // role, which bypasses RLS.
    if (run.user_id !== user.id && user.role !== "admin") {
      return NextResponse.json({ error: "Not your run" }, { status: 403 });
    }
    if (!["queued", "running", "needs_clarification", "awaiting_confirmation"].includes(run.status)) {
      return NextResponse.json({ error: `Run is already ${run.status}` }, { status: 409 });
    }

    // Logged before the abort, so the event carries who did it. The runner sees
    // a person-initiated cancel and does not log a second, actorless one.
    await recordRunEvent(id, run.user_id, "cancelled", user, {
      was: run.status,
    });

    const wasRunning = cancelRun(id, displayName(user));

    if (!wasRunning) {
      // Queued, or orphaned by a restart: nothing to abort, just close it out.
      await supabaseAdmin()
        .from("runs")
        .update({
          status: "cancelled",
          status_reason: `Cancelled by ${displayName(user)}.`,
          finished_at: new Date().toISOString(),
        })
        .eq("id", id)
        .in("status", ["queued", "running", "needs_clarification", "awaiting_confirmation"]);

      // Release what this run actually holds — for a resumed run that is
      // less than max_budget_usd.
      const reserved = Number(run.reserved_usd ?? 0);
      if (reserved > 0) {
        await releaseBudget("agent", reserved, id, run.user_id, "cancelled before start");
        await supabaseAdmin().from("runs").update({ reserved_usd: 0 }).eq("id", id);
      }
      void pumpQueue();
      // A running run emails its owner as it winds down. This one never
      // started (or was paused), so nothing else will tell them — and if an
      // admin stopped it, they would otherwise never find out why.
      void notifyOwner(id, "cancelled");
    }

    return NextResponse.json({ ok: true, aborted: wasRunning });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
