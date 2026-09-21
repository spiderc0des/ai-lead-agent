"use client";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "lead-agent-theme";
const EVENT = "lead-agent-theme-change";

/**
 * The stored preference is genuinely external state: an inline script in
 * layout.tsx has already read it and stamped the root element before React
 * runs, so reading it again in an effect would be a second source of truth
 * fighting the first.
 *
 * useSyncExternalStore is the right shape for that — it also gives a server
 * snapshot, so SSR renders the neutral "system" icon rather than guessing.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  // Another tab changing the theme should move this one too.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme | null) ?? "system";
  } catch {
    // Private windows and blocked site data both throw. The system preference
    // still applies; only the override is unavailable.
    return "system";
  }
}

const getServerSnapshot = (): Theme => "system";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* see getSnapshot */
    }
    window.dispatchEvent(new Event(EVENT));
  }

  const label =
    theme === "system" ? "Following your system theme" : theme === "light" ? "Light theme" : "Dark theme";

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${label} — click to change`}
      aria-label={`${label}. Change theme.`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md"
      style={{ color: "var(--ink-soft)" }}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5z" />
        </svg>
      ) : theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M16 4l-1.4 1.4M5.4 14.6L4 16" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="7" />
          <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
        </svg>
      )}
    </button>
  );
}
