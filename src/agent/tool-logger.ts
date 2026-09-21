import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The agent's audit trail.
 *
 * Every tool handler writes a row here, and so does the canUseTool gate, so a
 * denied call is as visible as a successful one. This table is the evidence
 * the PRD asks for: which tools ran, why, with what limits, and what happened.
 */

export type ToolCallStatus = "success" | "error" | "denied" | "limit_blocked";

export type ToolCallRecord = {
  toolName: string;
  purpose?: string | null;
  inputSummary?: unknown;
  resultSummary?: unknown;
  status: ToolCallStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
};

export async function logToolCall(
  runId: string,
  userId: string,
  record: ToolCallRecord,
): Promise<void> {
  const { error } = await supabaseAdmin().from("tool_calls").insert({
    run_id: runId,
    user_id: userId,
    tool_name: record.toolName,
    purpose: record.purpose ?? null,
    input_summary: record.inputSummary ?? null,
    result_summary: record.resultSummary ?? null,
    status: record.status,
    error_message: record.errorMessage ?? null,
    duration_ms: record.durationMs ?? null,
  });

  // Logging must never take the run down; a lost audit row is bad, a crashed
  // run mid-way through spending money is worse.
  if (error) console.error("[tool-logger] failed to record tool call:", error.message);
}

/** Keep logged payloads small — these rows are read in a browser table. */
export function truncateForLog(value: unknown, maxChars = 600): unknown {
  if (typeof value === "string") {
    return value.length > maxChars ? `${value.slice(0, maxChars)}… [+${value.length - maxChars} chars]` : value;
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, 10).map((v) => truncateForLog(v, 200));
    return value.length > 10 ? [...head, `… +${value.length - 10} more`] : head;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateForLog(v, 200);
    }
    return out;
  }
  return value;
}
