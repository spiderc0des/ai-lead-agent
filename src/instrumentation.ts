/**
 * Next.js runs this once per server process, before handling any request.
 *
 * Used to recover runs orphaned by the previous process and start anything
 * that was left queued — otherwise a restart mid-run leaves a row stuck in
 * `running` forever, holding that user's one active-run slot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // A web-only instance: serves pages and the API but never claims runs. For
  // running the app locally against the production database, where a second
  // worker would race the deployed one for queued runs and execute them with
  // the wrong settings (it happened: a local server with no mail credentials).
  if (process.env.QUEUE_WORKER === "off") {
    console.log("[queue] QUEUE_WORKER=off — this instance will not claim or sweep runs");
    return;
  }

  // Imported lazily so the edge runtime never pulls in the server-only modules.
  const { bootstrapQueue } = await import("@/agent/queue");
  await bootstrapQueue();
}
