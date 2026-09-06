/**
 * Optimistic, cookie-only gate on /staff/*. Named `proxy.ts`, not `middleware.ts`
 * -- Next.js 16 deprecated and renamed the file convention (all behavior is the
 * same; only the file/export name changed). Runs on the Node.js runtime by
 * default in 16, which is what makes node:crypto usable here.
 *
 * This is explicitly NOT the real security boundary -- the Next.js docs are
 * direct about this: a proxy matcher that excludes a path also skips Server
 * Function calls made from that path, so this alone would leave every mutating
 * Server Action unguarded. The actual boundary is the guard at the top of each
 * Server Action (see src/app/staff/(console)/**\/actions.ts) plus the DB-backed
 * check in the (console) layout (src/server/auth/dal.ts). This layer exists
 * only to bounce an obviously-logged-out visitor before a page even renders,
 * and to perform the sliding-session refresh (see below), which needs to run on
 * every request regardless of which page was hit.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, SESSION_TTL_MS, encodeSessionToken, readSessionToken } from "./server/auth/session";

const LOGIN_PATH = "/staff/login";

// Refresh the cookie once it's more than an hour old rather than on every single
// request -- re-signing and re-setting a cookie on every request works but is
// wasted effort when nothing about the session changed.
const REFRESH_THRESHOLD_MS = 60 * 60 * 1000;

function safeNextPath(path: string): string {
  return path.startsWith("/staff") && !path.startsWith("//") ? path : "/staff";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = readSessionToken(request.cookies.get(COOKIE_NAME)?.value);

  if (pathname === LOGIN_PATH) {
    if (session) {
      const next = safeNextPath(request.nextUrl.searchParams.get("next") ?? "/staff");
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();

  // Sliding expiry: how much of the TTL is already spent tells us how old the
  // cookie is, since the payload only stores an absolute expiry.
  const remainingMs = session.exp - Date.now();
  const ageMs = SESSION_TTL_MS - remainingMs;
  if (ageMs > REFRESH_THRESHOLD_MS) {
    const refreshed = encodeSessionToken({ uid: session.uid, exp: Date.now() + SESSION_TTL_MS });
    response.cookies.set(COOKIE_NAME, refreshed, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }

  return response;
}

export const config = {
  matcher: ["/staff", "/staff/:path*"],
};
