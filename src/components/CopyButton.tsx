"use client";
import { useState } from "react";

/**
 * Copy one piece of output to the clipboard.
 *
 * Every draft here exists to be pasted somewhere else, so selecting it by hand
 * out of a scrollable panel is the wrong amount of work. Confirms in place
 * rather than with a toast: the feedback belongs next to the thing copied.
 */
export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      // Denied permission, or an insecure origin. Say so rather than showing
      // a success the clipboard did not actually receive.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`btn btn-ghost btn-sm ${className}`}
      aria-label={state === "done" ? "Copied" : `${label} to clipboard`}
      title={state === "failed" ? "Your browser blocked clipboard access" : `${label} to clipboard`}
    >
      {state === "done" ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.5 3.5L13 5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4.5V9A1.5 1.5 0 0 0 4 10.5h1" />
        </svg>
      )}
      {state === "done" ? "Copied" : state === "failed" ? "Blocked" : label}
    </button>
  );
}
