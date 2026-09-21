/**
 * Next.js runs this once per server process, before handling any request.
 *
 * Used to recover runs orphaned by the previous process and start anything
 * that was left queued — otherwise a restart mid-run leaves a row stuck in
 * `running` forever, holding that user's one active-run slot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported lazily so the edge runtime never pulls in the server-only modules.
  const { bootstrapQueue } = await import("@/agent/queue");
  await bootstrapQueue();
}
