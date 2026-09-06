/**
 * Password hashing. Pure -- no DB, no next/headers -- so it can be imported from
 * seed.ts under tsx as well as from Server Actions under Next.
 *
 * node:crypto's scrypt, not bcrypt/argon2: this project has zero auth/crypto
 * dependencies and scrypt is purpose-built for password hashing and built into
 * Node, so it adds none. The scrypt cost parameters are stored inside the hash
 * string itself (see STORED FORMAT) so they can be tuned later without a
 * migration that invalidates every existing password.
 *
 * STORED FORMAT: "scrypt:N:r:p:<saltHex>:<keyHex>"
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** N=16384, r=8, p=1 is Node's own documented "interactive login" baseline --
 *  strong enough for a login form, cheap enough not to stall the request. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(plain, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${key.toString("hex")}`;
}

/** Re-derives the key with the stored parameters and compares in constant time.
 *  Never throws on a malformed/foreign hash -- returns false instead, so a
 *  corrupted row fails login rather than crashing the request. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  // noUncheckedIndexedAccess: parts.length === 6 was just checked, so these are safe.
  const N = Number(parts[1]!);
  const r = Number(parts[2]!);
  const p = Number(parts[3]!);
  const saltHex = parts[4]!;
  const keyHex = parts[5]!;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expectedKey = Buffer.from(keyHex, "hex");
    const actualKey = await scrypt(plain, salt, expectedKey.length, { N, r, p });
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

/** A hash of an unguessable password, for verifyPassword() to run against when no
 *  matching username exists -- so a login attempt against a nonexistent username
 *  takes the same time as one against a real username with the wrong password,
 *  and the response can never be used to enumerate valid usernames. Computed once
 *  per process, not per request. */
let dummyHashPromise: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(32).toString("hex"));
  }
  return dummyHashPromise;
}
