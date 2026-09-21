import Link from "next/link";
import type { Profile } from "@/lib/auth";

export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Lead Agent
        </Link>
        <div className="flex items-center gap-4 text-sm text-neutral-600">
          {profile.role === "admin" && (
            <Link href="/admin" className="underline underline-offset-4">
              Admin
            </Link>
          )}
          <span className="hidden sm:inline">{profile.email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
