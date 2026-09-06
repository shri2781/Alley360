/**
 * Stateless signed-cookie sessions -- no session table, so there's nothing to
 * garbage-collect and nothing extra to query on every request. The cost of that
 * is that a session can't be revoked before it expires by deleting a row; the
 * DAL (dal.ts) covers the one case that matters here by re-checking
 * staff_user.is_active against the DB on every read, so deactivating the
 * account still takes effect immediately even though the cookie itself lives on.
 *
 * Token shape: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 * The HMAC is what makes the cookie tamper-evident -- a client can read the
 * payload (it's not encryption) but cannot forge or extend one without
 * SESSION_SECRET.
 *
 * No `import "server-only"` guard: that package isn't among this project's
 * dependencies, and this module already can't be bundled into a Client
 * Component -- it imports node:crypto and next/headers, both server-only APIs
 * that fail to bundle for the browser on their own.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "staff_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, sliding -- see proxy.ts for the refresh.

const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error("SESSION_SECRET is not set");
}
// Re-bind to a definitely-string local so every use below is typed without `!`.
const SESSION_SECRET: string = secret;

type SessionPayload = { uid: string; exp: number };

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

/** Exported (not just used internally) so proxy.ts can mint a refreshed cookie
 *  for the sliding-expiry rewrite using NextResponse's cookie API directly,
 *  rather than going through next/headers' cookies(), whose write support in
 *  proxy is not the well-established path (NextResponse.cookies.set() is). */
export function encodeSessionToken(payload: SessionPayload): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${json}.${sign(json)}`;
}

/** Verifies the HMAC and expiry of a raw cookie value. Pure string work -- no DB,
 *  no next/headers dependency beyond the type -- so proxy.ts can call this
 *  directly without touching the database on every request. */
export function readSessionToken(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;

  const json = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  const expectedSig = sign(json);

  // Different-length buffers would make timingSafeEqual throw rather than return
  // false, so length-check first -- an attacker-controlled cookie must not crash.
  const provided = Buffer.from(providedSig, "base64url");
  const expected = Buffer.from(expectedSig, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Sets the session cookie. Callable only from a Server Action, Route Handler, or
 *  proxy -- cookies() rejects writes during page render. */
export async function createSession(userId: string): Promise<void> {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeSessionToken(payload), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Reads and verifies the session cookie for the current request. */
export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME, SESSION_TTL_MS };
export type { SessionPayload };
