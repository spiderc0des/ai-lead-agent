import Link from "next/link";
import type { Profile } from "@/lib/auth";
import { MobileNav, type NavLink } from "@/components/MobileNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { displayName, initials } from "@/lib/display-name";

export function AppHeader({ profile }: { profile: Profile }) {
  // Built once and handed to both the desktop row and the mobile panel, so the
  // two cannot drift. Profile is deliberately absent: the avatar links there,
  // and a nav item for it would be a second route to the same page.
  const links: NavLink[] = [
    { href: "/new", label: "New run" },
    { href: "/", label: "Runs" },
    { href: "/skip-list", label: "Skip list" },
    ...(profile.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="relative border-b" style={{ borderColor: "var(--rule)", background: "var(--card)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight no-underline"
          style={{ color: "var(--ink)" }}
        >
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            K
          </span>
          <span className="text-sm">Koya Lead Agent</span>
        </Link>

        {/* Right-aligned: the wordmark anchors the left, everything actionable
            collects on the right next to the avatar. */}
        <div className="flex items-center gap-1.5">
          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-2.5 py-1.5 text-sm no-underline"
                style={{ color: "var(--ink-soft)" }}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <ThemeToggle />

          <Link
            href="/profile"
            title={`${displayName(profile)} — your profile`}
            aria-label={`Signed in as ${displayName(profile)}. Open your profile.`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold uppercase no-underline"
            style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--rule)" }}
          >
            {initials(profile)}
          </Link>

          <MobileNav links={links} />
        </div>
      </div>
    </header>
  );
}
