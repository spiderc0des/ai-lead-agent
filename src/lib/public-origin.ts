/**
 * The address people actually reach the app on, for building redirects.
 *
 * Never `request.url`: behind Railway's proxy (or any reverse proxy) that is
 * the container's own address — http://localhost:8080 — so a redirect built
 * from it sends the browser to a machine it cannot reach. That is exactly what
 * happened after sign-in on the first deploy.
 *
 * Order: the configured NEXT_PUBLIC_APP_URL (the same value the auth emails
 * are built from), then the proxy's forwarded host, then the request itself
 * for local development where there is no proxy.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && /^https?:\/\//.test(configured)) return configured;

  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ??
      (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/** A redirect target on the public origin. `path` must be app-relative. */
export function publicUrl(path: string, request: Request): URL {
  return new URL(path, publicOrigin(request));
}
