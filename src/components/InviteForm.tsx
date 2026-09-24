"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Invite someone by name and email. Supabase sends the invitation using the
 * "Invite user" template; the person becomes active the first time they use
 * the link. The role is chosen now and applied when the account is created.
 */
export function InviteForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, role }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setResult({ ok: res.ok, text: res.ok ? data.note : (data.error ?? `Failed (${res.status})`) });
    if (res.ok) {
      setFullName("");
      setEmail("");
      setRole("member");
      router.refresh();
    }
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold">Invite a user</h2>
      <p className="hint">
        Signup is closed, so this is the only way in. Supabase emails them an invitation, and
        their account switches on the first time they use it.
      </p>

      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="text-xs">
          <span className="label">Full name</span>
          <input
            required
            maxLength={120}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ada Lovelace"
            className="field mt-1"
            disabled={busy}
          />
        </label>
        <label className="text-xs">
          <span className="label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="field mt-1"
            disabled={busy}
          />
        </label>
        <label className="text-xs">
          <span className="label">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
            className="field mt-1"
            disabled={busy}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !fullName.trim() || !email.includes("@")}
          className="btn btn-primary btn-sm"
        >
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>

      {role === "admin" && (
        <p className="hint mt-2">
          Admins see every user&apos;s runs, and can change budgets, workers and roles.
        </p>
      )}
      {result && (
        <p className={`panel mt-3 ${result.ok ? "panel-success" : "panel-danger"}`}>{result.text}</p>
      )}
    </section>
  );
}
