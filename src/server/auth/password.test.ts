import { describe, expect, it } from "vitest";
import { getDummyHash, hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("stores the scrypt cost parameters in the hash string", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("never throws on a malformed stored hash -- fails closed instead", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt:oops:8:1:aa:bb")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });
});

describe("getDummyHash", () => {
  it("returns a valid-shaped hash that no real password verifies against", async () => {
    const dummy = await getDummyHash();
    expect(dummy).toMatch(/^scrypt:\d+:\d+:\d+:[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword("password", dummy)).toBe(false);
  });

  it("is stable across calls in the same process", async () => {
    expect(await getDummyHash()).toBe(await getDummyHash());
  });
});
