"use client";
import { useState } from "react";
import Link from "next/link";

export type NavLink = { href: string; label: string };

/**
 * The nav links, collapsed behind a hamburger below `sm`. The same array is
 * handed to the inline desktop row in AppHeader, so the two cannot drift.
 */
export function MobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md"
        style={{ color: "var(--ink-soft)" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-20 flex flex-col border-b px-4 py-2"
          style={{ borderColor: "var(--rule)", background: "var(--paper)", boxShadow: "var(--shadow)" }}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-2.5 text-sm no-underline"
              style={{ color: "var(--ink-soft)" }}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
