/**
 * How a person is named in the UI and in email: their name when we have one,
 * otherwise their email. Accounts created before names existed (or by a
 * script) have no name, and must still read as someone rather than a blank.
 */
export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined): string {
  return p?.full_name?.trim() || p?.email || "Someone";
}

/** Two letters for an avatar: initials of the name, or the start of the email. */
export function initials(p: { full_name?: string | null; email?: string | null }): string {
  const name = p.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
  }
  return (p.email ?? "?").slice(0, 2);
}
