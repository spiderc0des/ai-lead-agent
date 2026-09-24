"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    // shouldCreateUser:false is what actually closes signup — an address that
    // was never invited simply never receives a link.
    await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    // Always the same response, whether or not the address exists: the form
    // must not double as a way to discover who has access.
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4">
      <div className="mb-6 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: "var(--accent)" }}>K</span>
        <h1 className="text-lg font-semibold tracking-tight">Koya Talent</h1>
      </div>
      <p className="hint">AI lead research and outreach drafting. Access is invite-only.</p>

      {linkError && (
        <p className="panel panel-warning mt-5">
          That sign-in link did not work ({linkError}). Links are single-use and expire — request a new one.
        </p>
      )}

      {sent ? (
        <div className="card mt-6">
          <p className="text-sm">
            If <span className="font-medium">{email}</span> is registered, a sign-in link is on its way.
            It expires shortly.
          </p>
          <button onClick={() => setSent(false)} className="btn btn-ghost btn-sm mt-3 px-0">
            Use a different address
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card mt-6">
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" type="email" required autoComplete="email" value={email}
                 onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="field" />
          <button type="submit" disabled={busy} className="btn btn-primary mt-3 w-full justify-center">
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
