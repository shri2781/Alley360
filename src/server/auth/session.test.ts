import { describe, expect, it } from "vitest";

process.env.SESSION_SECRET = "test-only-session-secret";

const session = await import("./session");

describe("[unit][security] signed staff sessions", () => {
  it("round-trips a valid, unexpired session", () => {
    const token = session.encodeSessionToken({ uid: "staff-1", exp: Date.now() + 60_000 });
    expect(session.readSessionToken(token)).toMatchObject({ uid: "staff-1" });
  });

  it("fails closed when either the payload or signature is changed", () => {
    const token = session.encodeSessionToken({ uid: "staff-1", exp: Date.now() + 60_000 });
    const [payload, signature] = token.split(".");

    expect(session.readSessionToken(payload + "x." + signature)).toBeNull();
    expect(session.readSessionToken(payload + "." + signature + "x")).toBeNull();
  });

  it("rejects expired, malformed, and incomplete tokens without throwing", () => {
    const expired = session.encodeSessionToken({ uid: "staff-1", exp: Date.now() - 1 });

    expect(session.readSessionToken(expired)).toBeNull();
    expect(session.readSessionToken("not-a-token")).toBeNull();
    expect(session.readSessionToken("..")).toBeNull();
    expect(session.readSessionToken(undefined)).toBeNull();
  });
});
