"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";

export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "member" | "admin";
  created_at: string;
  /** Null until they first use their invitation or a sign-in link. */
  last_sign_in_at: string | null;
};

/**
 * Everyone with an account. An admin can promote or demote anyone but
 * themselves (the server refuses a self-demotion, since the last admin doing
 * it would lock everyone out) and fix a name.
 */
export function UsersTable({ users, meId }: { users: UserRow[]; meId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function patch(id: string, body: Record<string, string>) {
    setBusyId(id);
    setNote(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    setNote({ ok: res.ok, text: res.ok ? data.note : (data.error ?? `Failed (${res.status})`) });
    if (res.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === meId;
              const busy = busyId === u.id;
              return (
                <tr key={u.id}>
                  <td className="text-sm">
                    {editing?.id === u.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (editing.value.trim()) void patch(u.id, { full_name: editing.value });
                        }}
                      >
                        <input
                          autoFocus
                          maxLength={120}
                          value={editing.value}
                          onChange={(e) => setEditing({ id: u.id, value: e.target.value })}
                          className="field w-40 py-1 text-sm"
                          disabled={busy}
                        />
                        <button type="submit" className="btn btn-sm" disabled={busy || !editing.value.trim()}>
                          Save
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="text-left hover:underline"
                        title="Edit name"
                        onClick={() => setEditing({ id: u.id, value: u.full_name ?? "" })}
                      >
                        {u.full_name || <span style={{ color: "var(--ink-faint)" }}>add a name</span>}
                        {isMe && <span className="hint ml-1">(you)</span>}
                      </button>
                    )}
                  </td>
                  <td className="text-xs">{u.email}</td>
                  <td>
                    <span className={u.role === "admin" ? "badge badge-accent" : "badge"}>{u.role}</span>
                  </td>
                  <td className="whitespace-nowrap text-xs" style={{ color: "var(--ink-faint)" }}>
                    {u.last_sign_in_at
                      ? `Last signed in ${new Date(u.last_sign_in_at).toLocaleDateString()}`
                      : "Invited · not signed in yet"}
                  </td>
                  <td className="text-right">
                    {isMe ? (
                      <span className="hint" title="Another admin has to change your role">
                        your account
                      </span>
                    ) : u.role === "admin" ? (
                      <ConfirmButton
                        label="Remove admin"
                        confirmLabel="Remove"
                        question={`Make ${u.full_name || u.email} a member?`}
                        detail="They keep their own runs but lose access to /admin and to other people's runs."
                        busy={busy}
                        onConfirm={() => patch(u.id, { role: "member" })}
                      />
                    ) : (
                      <ConfirmButton
                        label="Make admin"
                        confirmLabel="Make admin"
                        question={`Make ${u.full_name || u.email} an admin?`}
                        detail="Admins see every user's runs and can change budgets, workers and roles."
                        busy={busy}
                        onConfirm={() => patch(u.id, { role: "admin" })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <p className={`panel mt-3 ${note.ok ? "panel-success" : "panel-danger"}`}>{note.text}</p>}
    </div>
  );
}
