const STYLES: Record<string, string> = {
  queued: "bg-neutral-100 text-neutral-700 border-neutral-200",
  running: "bg-blue-50 text-blue-800 border-blue-200",
  completed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  needs_review: "bg-amber-50 text-amber-900 border-amber-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  cancelled: "bg-neutral-100 text-neutral-600 border-neutral-200",
  qualified: "bg-emerald-50 text-emerald-800 border-emerald-200",
  not_qualified: "bg-neutral-100 text-neutral-600 border-neutral-200",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  error: "bg-red-50 text-red-800 border-red-200",
  denied: "bg-red-50 text-red-800 border-red-200",
  limit_blocked: "bg-amber-50 text-amber-900 border-amber-200",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? "bg-neutral-100 text-neutral-700 border-neutral-200";
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
