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
  | "cancelled"
  | "emailed"
  | "email_failed"
  | "lead_reviewed"
  | "run_reviewed"
  | "lead_processed";

export type Actor = { id: string; email: string; full_name?: string | null } | null;

export async function recordRunEvent(
  runId: string,
  ownerId: string,
  kind: RunEventKind,
  actor: Actor,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const row = {
    run_id: runId,
    user_id: ownerId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    // The name as it was at the time: a later rename must not rewrite history.
    actor_name: actor?.full_name ?? null,
    kind,
    detail,
  };
  let { error } = await supabaseAdmin().from("run_events").insert(row);
  // Before 0008_names_roles.sql there is no actor_name column. Keep logging.
  if (error && /actor_name/.test(error.message)) {
    const { actor_name: _unused, ...withoutName } = row;
    void _unused;
    ({ error } = await supabaseAdmin().from("run_events").insert(withoutName));
  }
  if (error) console.error(`[run-events] could not record ${kind} for ${runId}:`, error.message);
}
