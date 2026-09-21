import "server-only";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadRunContext, settleBudget, releaseBudget } from "@/agent/budget";
import { buildLeadToolServer, LEAD_TOOL_NAMES, LEAD_SERVER_NAME } from "@/agent/tools";
import { buildSystemPrompt, buildPrompt } from "@/agent/system-prompt";
import { logToolCall } from "@/agent/tool-logger";

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

export function cancelRun(runId: string): boolean {
  const controller = inFlight.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isRunning(runId: string): boolean {
  return inFlight.has(runId);
}

export function activeRunCount(): number {
  return inFlight.size;
}

type TerminalStatus = "completed" | "needs_review" | "failed" | "cancelled";

/**
 * Execute one run to completion.
 *
 * Resolves rather than throws: the caller is a background task, and every
 * failure path must still release the budget reservation and free a queue slot.
 */
export async function runAgent(runId: string): Promise<TerminalStatus> {
  const ctx = await loadRunContext(runId);
  const model = process.env.AGENT_MODEL || DEFAULT_MODEL;

  const controller = new AbortController();
  inFlight.set(runId, controller);

  const wallClock = setTimeout(() => {
    controller.abort();
  }, ctx.limits.wall_clock_ms);

  // The run reserved max_budget_usd from the shared agent cap when it was
  // created; this tracks what actually gets settled against it.
  let actualCostUsd = 0;
  let settled = false;
  let terminal: TerminalStatus = "failed";
  let statusReason: string | null = null;

  const heartbeat = async () => {
    await supabaseAdmin()
      .from("runs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", runId);
  };

  try {
    await supabaseAdmin()
      .from("runs")
      .update({
        status: "running",
        model,
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        status_reason: null,
      })
      .eq("id", runId);

    const server = buildLeadToolServer(ctx);

    /**
     * Deny-by-default permission gate.
     *
     * `tools: ["Skill"]` already removes every other built-in from the model's
     * context, so this should never fire. It exists so that if it ever does,
     * the attempt is denied AND recorded — an unexpected tool call is exactly
     * the signal a reviewer wants to see.
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
        message:
          `'${toolName}' is not available to this agent. Only the mcp__${LEAD_SERVER_NAME}__* tools and Skill are.`,
      };
    };

    let sawInit = false;
    let sawResult = false;

    const stream = query({
      prompt: buildPrompt(ctx.objective),
      options: {
        model,
        cwd: agentCwd(),
        // Required for the project's .claude/skills/ to be discovered at all.
        settingSources: ["project"],
        skills: [...REQUIRED_SKILLS],
        // Removes Bash, WebFetch, WebSearch, Read, Write, Edit and friends from
        // the model's context entirely. "Skill" must stay, or skills cannot be
        // invoked. This is the structural half of the prompt-injection defence:
        // there is simply no tool that could send, shell out, or read a file.
        tools: ["Skill"],
        mcpServers: { [LEAD_SERVER_NAME]: server },
        allowedTools: ["Skill", ...LEAD_TOOL_NAMES],
        disallowedTools: ["Bash", "WebFetch", "WebSearch", "Read", "Write", "Edit", "Task"],
        canUseTool,
        maxTurns: ctx.limits.max_turns,
        maxBudgetUsd: ctx.limits.max_budget_usd,
        abortController: controller,
        systemPrompt: buildSystemPrompt(ctx.limits),
        persistSession: false,
        env: { ...process.env } as Record<string, string>,
      },
    });

    for await (const message of stream) {
      if (message.type === "system" && message.subtype === "init") {
        sawInit = true;

        // Fail loudly rather than run a skill-less agent. A wrong cwd, a
        // missing settingSources, or a .claude/ directory left out of the
        // container image all land here.
        const loaded = new Set(message.skills ?? []);
        const missing = REQUIRED_SKILLS.filter((s) => !loaded.has(s));
        if (missing.length > 0) {
          statusReason =
            `Skills failed to load: ${missing.join(", ")}. ` +
            `cwd=${message.cwd}; found=[${[...loaded].join(", ")}]. ` +
            `Check that .claude/skills/<name>/SKILL.md exists under AGENT_CWD.`;
          controller.abort();
          break;
        }

        await supabaseAdmin()
          .from("runs")
          .update({ session_id: message.session_id, model: message.model })
          .eq("id", runId);
      }

      if (message.type === "assistant" || message.type === "user") {
        await heartbeat();
      }

      if (message.type === "result") {
        sawResult = true;
        actualCostUsd = message.total_cost_usd ?? 0;

        await supabaseAdmin()
          .from("runs")
          .update({
            total_cost_usd: actualCostUsd,
            usage: message.usage ?? null,
            model_usage: message.modelUsage ?? null,
            num_turns: message.num_turns ?? null,
            duration_ms: message.duration_ms ?? null,
          })
          .eq("id", runId);

        if (message.subtype !== "success") {
          statusReason = `Agent stopped early: ${message.subtype}.`;
        }
      }
    }

    if (!sawInit) {
      statusReason = statusReason ?? "Agent process never started (no init message).";
    } else if (!sawResult && !statusReason) {
      statusReason = "Agent stream ended without a result message.";
    }
  } catch (err) {
    // A single-shot query() throws after yielding an error result, so cost has
    // usually already been recorded by the result branch above.
    const message = err instanceof Error ? err.message : String(err);
    statusReason = controller.signal.aborted
      ? (statusReason ?? `Run aborted: ${message}`)
      : `Run failed: ${message}`;
  } finally {
    clearTimeout(wallClock);
    inFlight.delete(runId);

    // Always give the shared agent budget back what was not spent.
    if (!settled) {
      settled = true;
      await settleBudget(
        "agent",
        ctx.limits.max_budget_usd,
        actualCostUsd,
        runId,
        ctx.userId,
        "agent run settled",
      );
    }
  }

  // finalize_run may already have set a terminal status; respect it.
  const { data: finalRow } = await supabaseAdmin()
    .from("runs")
    .select("status")
    .eq("id", runId)
    .single();

  if (finalRow?.status === "completed" || finalRow?.status === "needs_review") {
    terminal = finalRow.status;
    if (statusReason) {
      await supabaseAdmin()
        .from("runs")
        .update({ status_reason: statusReason })
        .eq("id", runId);
    }
  } else {
    terminal = controller.signal.aborted && !statusReason?.startsWith("Run failed") ? "cancelled" : "failed";
    await supabaseAdmin()
      .from("runs")
      .update({
        status: terminal,
        status_reason:
          statusReason ??
          "The agent stopped without calling finalize_run. Partial results are still stored.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  return terminal;
}

/** Only used by scripts/verify-skills.ts; kept here so the path logic is shared. */
export function skillsDir(): string {
  return path.join(agentCwd(), ".claude", "skills");
}

export { releaseBudget };
