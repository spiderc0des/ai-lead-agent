"use client";
import { useState, type ReactNode } from "react";

/**
 * A section that can be folded away.
 *
 * A finished run carries sixty tool calls, thirty scraped pages and a dozen
 * leads. Rendered flat that is several screens of scrolling before the part
 * you came for, so each section states its own size in the header and opens
 * only when it is the thing being looked at.
 *
 * `defaultOpen` is the judgement about what someone wants first: the leads and
 * the ICP, not the audit trail.
 */
export function Collapsible({
  title,
  count,
  subtitle,
  defaultOpen = false,
  tone,
  actions,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Draws attention to a section that holds something notable. */
  tone?: "default" | "warning";
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `sec-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <section
      className="overflow-hidden rounded-[var(--radius)] border"
      style={{
        borderColor: tone === "warning" ? "var(--warning)" : "var(--rule)",
        background: "var(--card)",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
          <span className="text-sm font-semibold">{title}</span>
          {count !== undefined && (
            <span className="text-sm font-normal" style={{ color: "var(--ink-faint)" }}>
              ({count})
            </span>
          )}
          {subtitle && (
            <span className="ml-1 truncate text-xs" style={{ color: "var(--ink-faint)" }}>
              {subtitle}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && (
        <div id={id} className="border-t px-4 py-4" style={{ borderColor: "var(--rule)" }}>
          {children}
        </div>
      )}
    </section>
  );
}
