const TONE: Record<string, string> = {
  queued: "badge",
  running: "badge badge-accent",
  completed: "badge badge-success",
  needs_review: "badge badge-warning",
  failed: "badge badge-danger",
  cancelled: "badge",
  qualified: "badge badge-success",
  not_qualified: "badge",
  success: "badge badge-success",
  error: "badge badge-danger",
  denied: "badge badge-danger",
  limit_blocked: "badge badge-warning",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={TONE[status] ?? "badge"}>{status.replace(/_/g, " ")}</span>;
}
