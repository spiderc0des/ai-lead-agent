import "server-only";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadRunContext, settleBudget, releaseBudget } from "@/agent/budget";
import { buildLeadToolServer, LEAD_TOOL_NAMES, LEAD_SERVER_NAME } from "@/agent/tools";
import { buildSystemPrompt, buildPrompt } from "@/agent/system-prompt";
import { logToolCall } from "@/agent/tool-logger";
import { emptyTally, estimateCostUsd, type TokenTally } from "@/agent/pricing";
import { sendRunFinished } from "@/lib/email";
import { recordRunEvent, type RunEventKind } from "@/lib/run-events";

/** The five skills built from the guidance docs in assets/. */
export const REQUIRED_SKILLS = [
  "icp-refinement",
  "lead-qualification",
  "outbound-copywriting",
  "lead-list-quality",
  "outreach-safety",
] as const;

export const DEFAULT_MODEL = "claude-sonnet-5";

/** Where .claude/skills/ lives. Must be set correctly in a container image. */
export function agentCwd(): string {
  return process.env.AGENT_CWD ?? process.cwd();
}

/** Live runs, so the API can cancel one and the wall clock can abort it. */
const inFlight = new Map<string, AbortController>();

/** Runs a person cancelled, as opposed to ones stopped by the wall clock. */
const cancelledByPerson = new Set<string>();

export function cancelRun(runId: string): boolean {
  const controller = inFlight.get(runId);
  if (!controller) return false;
  cancelledByPerson.add(runId);
  controller.abort();
  return true;
}

export function isRunning(runId: string): boolean {
  return inFlight.has(runId);
}

export function activeRunCount(): number {
  return inFlight.size;
}

type TerminalStatus =
  | "completed"
  | "needs_review"
  | "needs_clarification"
  | "awaiting_confirmation"
  | "failed"
  | "cancelled";

/**
 * Execute one run to completion.
 *
 * Resolves rather than throws: the caller is a background task, and every
 * failure path must still release the budget reservation and free a queue slot.
 */
export async function runAgent(runId: string): Promise<TerminalStatus> {
  const ctx = await loadRunContext(runId);
  const model = process.env.AGENT_MODEL || DEFAULT_MODEL;

  // A run can be several agent sessions: one before a pause for clarification
  // or ICP approval, another after. Everything the second session needs lives
  // on the run, not in the first session.
  const { data: seeded, error: seedError } = await supabaseAdmin()
    .from("runs")
    .select("icp, icp_approved_at, total_cost_usd, num_turns, duration_ms, reserved_usd, started_at")
    .eq("id", runId)
    .single();
  if (seedError || !seeded) {
    throw new Error(
      `Could not load run ${runId}: ${seedError?.message ?? "no row"}. ` +
        `If a column is missing, apply supabase/migrations/0006_run_log.sql.`,
    );
  }

  const { data: answeredEvents } = await supabaseAdmin()
    .from("run_events")
    .select("detail")
    .eq("run_id", runId)
    .eq("kind", "answered")
    .order("created_at");
  const answers = (answeredEvents ?? []).flatMap(
    (e) => ((e.detail as { answers?: { question: string; answer: string }[] })?.answers ?? []),
  );

  const icpAlreadyApproved = Boolean(seeded.icp && seeded.icp_approved_at);
  const isResume = (seeded.num_turns ?? 0) > 0 || answers.length > 0 || icpAlreadyApproved;

  // Cumulative across sessions. This session's own spend is measured from
  // these baselines, and is what gets settled against its reservation.
  const baselineCost = Number(seeded.total_cost_usd ?? 0);
  const baselineTurns = Number(seeded.num_turns ?? 0);
  const baselineDuration = Number(seeded.duration_ms ?? 0);
  // What this session holds against the shared pool. For a fresh run that is
  // the whole budget; for a resumed one, only what earlier sessions left.
  const sessionBudget =
    Number(seeded.reserved_usd ?? 0) > 0
      ? Number(seeded.reserved_usd)
      : Math.max(0.05, ctx.limits.max_budget_usd - baselineCost);

  const controller = new AbortController();
  inFlight.set(runId, controller);
  const wallClock = setTimeout(() => controller.abort(), ctx.limits.wall_clock_ms);

  let sessionCostUsd = 0;
  let terminal: TerminalStatus = "failed";
  let statusReason: string | null = null;

  // Live meters. The per-turn cost is a FLOOR: per-step output_tokens is a
  // placeholder the SDK fills in only at the end. The result message
  // overwrites it with the authoritative figure.
  const seenTurnIds = new Set<string>();
  const tally: TokenTally = emptyTally();

  const heartbeat = async (extra: Record<string, unknown> = {}) => {
    await supabaseAdmin()
      .from("runs")
      .update({ heartbeat_at: new Date().toISOString(), ...extra })
      .eq("id", runId);
  };

  try {
    await supabaseAdmin()
      .from("runs")
      .update({
        status: "running",
        model,
        // A resumed run keeps the time it first started.
        started_at: seeded.started_at ?? new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        status_reason: null,
        session_baseline_usd: baselineCost,
        reserved_usd: sessionBudget,
      })
      .eq("id", runId);

    await recordRunEvent(runId, ctx.userId, isResume ? "resumed" : "started", null, {
      session_budget_usd: sessionBudget,
      spent_so_far_usd: baselineCost,
    });

    const server = buildLeadToolServer(ctx);

    /**
     * Deny-by-default permission gate. `tools: ["Skill"]` already removes every
     * other built-in, so this should never fire; if it does, the attempt is
     * denied AND recorded.
     */
    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<PermissionResult> => {
      if (toolName === "Skill" || LEAD_TOOL_NAMES.includes(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
      await logToolCall(runId, ctx.userId, {
        toolName,
        purpose: "blocked by permission gate",
        inputSummary: { attempted: toolName },
        status: "denied",
        errorMessage: `Tool '${toolName}' is not part of this agent's surface`,
      });
      return {
        behavior: "deny",
        message: `'${toolName}' is not available to this agent. Only the mcp__${LEAD_SERVER_NAME}__* tools and Skill are.`,
      };
    };

    let sawInit = false;
    let sawResult = false;

    const stream = query({
      prompt: buildPrompt(ctx.objective, { icpAlreadyApproved, answers }),
      options: {
        model,
        cwd: agentCwd(),
        // Required for the project's .claude/skills/ to be discovered at all.
        settingSources: ["project"],
        skills: [...REQUIRED_SKILLS],
        // Removes Bash, WebFetch, WebSearch, Read, Write, Edit and friends. The
        // structural half of the injection defence: no tool could send, shell
        // out, or read a file.
        tools: ["Skill"],
        mcpServers: { [LEAD_SERVER_NAME]: server },
        allowedTools: ["Skill", ...LEAD_TOOL_NAMES],
        disallowedTools: ["Bash", "WebFetch", "WebSearch", "Read", "Write", "Edit", "Task"],
        canUseTool,
        maxTurns: Math.max(1, ctx.limits.max_turns - baselineTurns),
        maxBudgetUsd: sessionBudget,
        abortController: controller,
        systemPrompt: buildSystemPrompt(ctx.limits),
        persistSession: false,
        env: { ...process.env } as Record<string, string>,
      },
    });

    for await (const message of stream) {
      if (message.type === "system" && message.subtype === "init") {
        sawInit = true;
        // Fail loudly rather than run a skill-less agent.
        const loaded = new Set(message.skills ?? []);
        const missing = REQUIRED_SKILLS.filter((sk) => !loaded.has(sk));
        if (missing.length > 0) {
          statusReason =
            `Skills failed to load: ${missing.join(", ")}. cwd=${message.cwd}; ` +
            `found=[${[...loaded].join(", ")}]. Check that .claude/skills/<name>/SKILL.md exists under AGENT_CWD.`;
          controller.abort();
          break;
        }
        await supabaseAdmin()
          .from("runs")
          .update({ session_id: message.session_id, model: message.model })
          .eq("id", runId);
      }

      if (message.type === "assistant" && !message.parent_tool_use_id) {
        // Parallel tool calls in one turn share a message id, so dedupe by it.
        const mid = message.message?.id;
        if (mid && !seenTurnIds.has(mid)) {
          seenTurnIds.add(mid);
          const u = message.message?.usage;
          if (u) {
            tally.inputTokens += u.input_tokens ?? 0;
            tally.outputTokens += u.output_tokens ?? 0;
            tally.cacheReadTokens += u.cache_read_input_tokens ?? 0;
            tally.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
          }
          sessionCostUsd = estimateCostUsd(tally, model);
          await heartbeat({
            num_turns: baselineTurns + seenTurnIds.size,
            total_cost_usd: baselineCost + sessionCostUsd,
          });
        } else {
          await heartbeat();
        }
      } else if (message.type === "user") {
        await heartbeat();
      }

      if (message.type === "result") {
        sawResult = true;
        sessionCostUsd = message.total_cost_usd ?? sessionCostUsd;
        await supabaseAdmin()
          .from("runs")
          .update({
            total_cost_usd: baselineCost + sessionCostUsd,
            usage: message.usage ?? null,
            model_usage: message.modelUsage ?? null,
            num_turns: baselineTurns + (message.num_turns ?? seenTurnIds.size),
            duration_ms: baselineDuration + (message.duration_ms ?? 0),
          })
          .eq("id", runId);
        if (message.subtype !== "success") statusReason = `Agent stopped early: ${message.subtype}.`;
      }
    }

    if (!sawInit) statusReason = statusReason ?? "Agent process never started (no init message).";
    else if (!sawResult && !statusReason) statusReason = "Agent stream ended without a result message.";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusReason = controller.signal.aborted ? (statusReason ?? `Run aborted: ${msg}`) : `Run failed: ${msg}`;
  } finally {
    clearTimeout(wallClock);
    inFlight.delete(runId);
    // Settle THIS session: its reservation against its own spend. Earlier
    // sessions were settled when they ended.
    await settleBudget("agent", sessionBudget, sessionCostUsd, runId, ctx.userId, "agent session settled");
    await supabaseAdmin().from("runs").update({ reserved_usd: 0 }).eq("id", runId);
  }

  // A tool may already have set a terminal or waiting status; respect it.
  const { data: finalRow } = await supabaseAdmin()
    .from("runs")
    .select("status, clarification_questions")
    .eq("id", runId)
    .single();

  const settledByTool = ["completed", "needs_review", "needs_clarification", "awaiting_confirmation"];
  const personCancelled = cancelledByPerson.delete(runId);

  if (finalRow?.status && settledByTool.includes(finalRow.status)) {
    terminal = finalRow.status as TerminalStatus;
    if (statusReason) {
      await supabaseAdmin().from("runs").update({ status_reason: statusReason }).eq("id", runId);
    }
  } else {
    terminal = controller.signal.aborted && !statusReason?.startsWith("Run failed") ? "cancelled" : "failed";
    if (terminal === "cancelled" && !personCancelled) {
      statusReason = `Stopped at the ${Math.round(ctx.limits.wall_clock_ms / 60000)}-minute time limit. Partial results are still stored.`;
    }
    await supabaseAdmin()
      .from("runs")
      .update({
        status: terminal,
        status_reason:
          statusReason ?? "The agent stopped without calling finalize_run. Partial results are still stored.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  // The cancel route already logged a person's cancel, with who did it.
  if (!(terminal === "cancelled" && personCancelled)) {
    await recordRunEvent(runId, ctx.userId, terminal as RunEventKind, null, {
      reason: statusReason,
      session_cost_usd: sessionCostUsd,
      ...(terminal === "needs_clarification" ? { questions: finalRow?.clarification_questions ?? [] } : {}),
    });
  }

  await notifyOwner(runId, terminal);
  return terminal;
}

/**
 * Tell the owner their run is done. A run takes twenty minutes or more, so
 * nobody should have to watch the page to find out.
 *
 * Never allowed to affect the run's outcome: the run has already finished and
 * been recorded by the time this is called, and every failure is swallowed.
 */
async function notifyOwner(runId: string, terminal: TerminalStatus): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data: run } = await db
      .from("runs")
      .select("id, user_id, objective, status, status_reason, limits, total_cost_usd, duration_ms")
      .eq("id", runId)
      .single();
    if (!run) return;

    const { data: profile } = await db
      .from("profiles")
      .select("email")
      .eq("id", run.user_id)
      .maybeSingle();
    if (!profile?.email) return;

    const countOf = async (table: string, extra?: [string, string]) => {
      let q = db.from(table).select("id", { count: "exact", head: true }).eq("run_id", runId);
      if (extra) q = q.eq(extra[0], extra[1]);
      return (await q).count ?? 0;
    };

    const { data: flagged } = await db
      .from("page_sources")
      .select("injection_flags")
      .eq("run_id", runId);

    const outcome = await sendRunFinished(profile.email, {
      runId,
      objective: run.objective,
      status: run.status ?? terminal,
      statusReason: run.status_reason ?? null,
      qualified: await countOf("leads", ["qualification_status", "qualified"]),
      targetLeads: (run.limits as { max_leads?: number })?.max_leads ?? 0,
      evaluated: await countOf("leads"),
      costUsd: Number(run.total_cost_usd ?? 0),
      durationMs: run.duration_ms ?? null,
      injectionAttempts: (flagged ?? []).filter((p) => p.injection_flags?.length).length,
    });

    if (!outcome.sent) console.log(`[email] run ${runId} notification not sent: ${outcome.reason}`);
  } catch (err) {
    console.error("[email] notification failed:", err);
  }
}

/** Only used by scripts/verify-skills.ts; kept here so the path logic is shared. */
export function skillsDir(): string {
  return path.join(agentCwd(), ".claude", "skills");
}

export { releaseBudget };
