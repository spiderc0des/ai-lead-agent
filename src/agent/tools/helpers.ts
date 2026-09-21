import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logToolCall, truncateForLog, type ToolCallStatus } from "@/agent/tool-logger";
import type { RunContext } from "@/agent/budget";

/**
 * Shared plumbing for every tool handler.
 *
 * Each handler runs inside `withLogging`, which guarantees three things the
 * PRD depends on:
 *   * a tool_calls row exists for the call whatever its outcome
 *   * a thrown error reaches the model as a composed message via isError,
 *     not a raw stack trace
 *   * limit rejections are logged distinctly as `limit_blocked`, so the
 *     evidence shows the tool enforcing the cap rather than the model
 *     politely declining to exceed it
 */

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Thrown by a handler when a run limit or the shared budget refuses the call. */
export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

export type HandlerOutcome = {
  result: CallToolResult;
  /** Recorded in tool_calls.result_summary for the evidence trail. */
  summary?: unknown;
};

export async function withLogging(
  ctx: RunContext,
  toolName: string,
  purpose: string | null | undefined,
  input: unknown,
  handler: () => Promise<HandlerOutcome>,
): Promise<CallToolResult> {
  const startedAt = Date.now();
  let status: ToolCallStatus = "success";
  let errorMessage: string | null = null;
  let summary: unknown = null;
  let result: CallToolResult;

  try {
    const outcome = await handler();
    result = outcome.result;
    summary = outcome.summary ?? null;
    if (result.isError) {
      status = "error";
      errorMessage = firstText(result);
    }
  } catch (err) {
    if (err instanceof LimitError) {
      status = "limit_blocked";
      errorMessage = err.message;
      result = errorResult(err.message);
    } else {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      // Compose the message the model reads rather than surfacing a stack.
      result = errorResult(`${toolName} failed: ${errorMessage}`);
    }
  }

  await logToolCall(ctx.runId, ctx.userId, {
    toolName,
    purpose: purpose ?? null,
    inputSummary: truncateForLog(input),
    resultSummary: truncateForLog(summary),
    status,
    errorMessage,
    durationMs: Date.now() - startedAt,
  });

  return result;
}

function firstText(result: CallToolResult): string | null {
  const block = result.content?.find((c) => c.type === "text");
  return block && "text" in block ? String(block.text) : null;
}
