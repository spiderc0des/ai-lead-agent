"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const linkError = params.get("error");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);

    const next = params.get("next") ?? "/";
    const supabase = supabaseBrowser();

    // shouldCreateUser: false is what actually closes signup. An address that
    // was never invited simply never receives a link.
    await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    // Always the same response, whether or not the address exists — the form
    // must not double as a way to discover who has access.
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Lead Agent</h1>
      <p className="mt-2 text-sm text-neutral-500">
        AI lead research and outreach drafting. Access is invite-only.
      </p>

      {linkError && (
        <p className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          That sign-in link did not work ({linkError}). Links are single-use and expire — request a
          new one.
        </p>
      )}

      {sent ? (
        <div className="mt-8 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm">
            If <span className="font-medium">{email}</span> is registered, a sign-in link is on its
            way. It expires shortly.
          </p>
          <button
            onClick={() => setSent(false)}
            className="mt-3 text-sm text-neutral-600 underline underline-offset-4"
          >
            Use a different address
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
