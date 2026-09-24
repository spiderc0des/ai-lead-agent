import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicUrl } from "@/lib/public-origin";

/**
 * Refreshes the Supabase session cookie on every request and gates the app
 * behind sign-in. (Next 16 renamed this convention from `middleware` to
 * `proxy`; the behaviour is unchanged.)
 *
 * The honeypot route is deliberately public: Firecrawl fetches it from the
 * outside during the prompt-injection test, and it would get a login page
 * instead of the test fixture if it were protected.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/test/injection-honeypot",
  "/_next",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession(): only getUser() revalidates the token
  // with Supabase rather than trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    // API callers get a status they can branch on. Redirecting them to the
    // login page means a client fetch() follows it and tries to JSON.parse
    // HTML, turning an expired session into a confusing parse error.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    // Built on the public origin: nextUrl carries the container's internal
    // address behind a reverse proxy (see lib/public-origin.ts).
    const url = publicUrl("/login", request);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(publicUrl("/", request));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
