import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "./rateLimit";

describe("[unit][security] login rate limiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first ten failures and blocks the eleventh within the window", () => {
    const key = "threshold-test";
    clearAttempts(key);

    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(recordFailedAttempt(key)).toBe(false);
    }
    expect(isRateLimited(key)).toBe(false);

    expect(recordFailedAttempt(key)).toBe(true);
    expect(isRateLimited(key)).toBe(true);
    clearAttempts(key);
  });

  it("expires a lock after its 15-minute window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00.000Z"));
    const key = "window-expiry-test";
    clearAttempts(key);

    for (let attempt = 1; attempt <= 11; attempt++) recordFailedAttempt(key);
    expect(isRateLimited(key)).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(isRateLimited(key)).toBe(false);
    expect(recordFailedAttempt(key)).toBe(false);
    clearAttempts(key);
  });

  it("clears previous failures after a successful login", () => {
    const key = "success-reset-test";
    clearAttempts(key);
    recordFailedAttempt(key);
    recordFailedAttempt(key);

    clearAttempts(key);
    expect(isRateLimited(key)).toBe(false);
  });
});
