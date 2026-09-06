/**
 * In-memory login attempt limiter. Deliberately simple: a single shared venue
 * password is exactly the case where brute force matters (one password to guess,
 * unlimited time), so even a basic throttle is worth it.
 *
 * Per-process, in-memory, resets on restart or redeploy -- adequate for the one
 * instance this app runs as. It is NOT a distributed rate limiter; if this app
 * is ever run as multiple instances behind a load balancer, an attacker spread
 * across instances would get MAX_ATTEMPTS per instance. Revisit with a shared
 * store (the database itself, or Redis) if that ever becomes the deployment shape.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type Bucket = { count: number; windowStart: number };

const attempts = new Map<string, Bucket>();

/** Call after a FAILED login attempt. Returns true if this key has now exceeded
 *  the limit and should be rejected regardless of whether the password is right. */
export function recordFailedAttempt(key: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

/** Call before even checking the password, so a locked-out key never reaches
 *  verifyPassword. */
export function isRateLimited(key: string): boolean {
  const bucket = attempts.get(key);
  if (!bucket) return false;
  if (Date.now() - bucket.windowStart > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return bucket.count > MAX_ATTEMPTS;
}

/** Call after a SUCCESSFUL login to clear the count for that key. */
export function clearAttempts(key: string): void {
  attempts.delete(key);
}
