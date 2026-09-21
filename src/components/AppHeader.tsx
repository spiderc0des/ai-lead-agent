import Link from "next/link";
import type { Profile } from "@/lib/auth";
import { MobileNav, type NavLink } from "@/components/MobileNav";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppHeader({ profile }: { profile: Profile }) {
  // Built once and handed to both the desktop row and the mobile panel, so
  // the two cannot drift apart.
  const links: NavLink[] = [
    { href: "/", label: "Runs" },
    { href: "/profile", label: "Profile" },
    ...(profile.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="relative border-b" style={{ borderColor: "var(--rule)", background: "var(--card)" }}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight no-underline" style={{ color: "var(--ink)" }}>
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--accent)" }}
          >
            L
          </span>
          <span className="hidden text-sm sm:inline">Lead Agent</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 sm:flex">
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

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            href="/profile"
            title={profile.email}
            aria-label={`Signed in as ${profile.email}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold uppercase no-underline"
            style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--rule)" }}
          >
            {profile.email.slice(0, 2)}
          </Link>
          <MobileNav links={links} />
        </div>
      </div>
    </header>
  );
}
