import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A run's history: who started it, when it paused and why, who answered and
 * with what, who approved its criteria, who cancelled it.
 *
 * Written only by the server. A lost log row must never take a run down, so
 * failures are logged and swallowed.
 */
export type RunEventKind =
  | "created"
  | "started"
  | "resumed"
  | "answered"
  | "approved"
  | "needs_clarification"
  | "awaiting_confirmation"
  | "completed"
  | "needs_review"
  | "failed"
  | "cancelled";

export type Actor = { id: string; email: string } | null;

export async function recordRunEvent(
  runId: string,
  ownerId: string,
  kind: RunEventKind,
  actor: Actor,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabaseAdmin().from("run_events").insert({
    run_id: runId,
    user_id: ownerId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    kind,
    detail,
  });
  if (error) console.error(`[run-events] could not record ${kind} for ${runId}:`, error.message);
}
