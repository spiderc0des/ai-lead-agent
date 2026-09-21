"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A button that asks before it acts.
 *
 * Reveal-in-place rather than window.confirm(): the native dialog cannot name
 * the thing being acted on, cannot be themed, and reads as a browser warning
 * rather than part of the app.
 *
 * Used for the two actions here that cannot be walked back — cancelling a run
 * mid-flight, and deleting one along with all its evidence.
 *
 * The resting button stays quiet even for a destructive action; the danger
 * styling belongs on the confirmation, where the consequence is spelled out.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  question,
  detail,
  tone = "default",
  disabled,
  busy,
  busyLabel,
  onConfirm,
}: {
  label: string;
  /** Says what will happen, not "OK". */
  confirmLabel: string;
  question: string;
  detail?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // If the action stops being available while the question is open, the
  // question is about something that no longer exists. Derived during render
  // rather than synced in an effect — there is no state to keep, only a
  // condition to read.
  const showing = confirming && !disabled;

  // A floating panel with no way out is a trap: the trigger is behind it.
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [showing]);

  if (!showing) {
    return (
      <button
        type="button"
        className={`btn btn-sm ${tone === "danger" ? "btn-ghost" : ""}`}
        style={tone === "danger" ? { color: "var(--danger)" } : undefined}
        disabled={disabled || busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? (busyLabel ?? "Working…") : label}
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="panel panel-warning flex flex-wrap items-center gap-3"
      role="alertdialog"
      aria-label={question}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{question}</p>
        {detail && <p className="mt-0.5 text-xs opacity-80">{detail}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
          disabled={busy}
          onClick={async () => {
            setConfirming(false);
            await onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
