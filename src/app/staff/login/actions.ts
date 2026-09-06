"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "../../../db/client";
import { staffUser } from "../../../db/schema";
import { getVenue } from "../../../server/venue";
import { getDummyHash, verifyPassword } from "../../../server/auth/password";
import { createSession } from "../../../server/auth/session";
import { isRateLimited, recordFailedAttempt, clearAttempts } from "../../../server/auth/rateLimit";

export type LoginState = { error: string } | undefined;

/** Only paths starting with "/staff" are honoured for `next` -- otherwise the
 *  query param could be used as an open redirect to an attacker-controlled URL. */
function safeNextPath(raw: FormDataEntryValue | null): string {
  if (typeof raw === "string" && raw.startsWith("/staff") && !raw.startsWith("//")) {
    return raw;
  }
  return "/staff";
}

export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!username || !password) {
    return { error: "Enter a username and password." };
  }

  if (isRateLimited(username)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const venue = await getVenue();
  const [row] = await db
    .select()
    .from(staffUser)
    .where(and(eq(staffUser.tenantId, venue.id), eq(staffUser.username, username)));

  // Always run a verify, even when no row matched or the account is inactive --
  // against a fixed dummy hash if there's no real one to check. This keeps the
  // response time the same in every failure case, so a caller can't use timing
  // (or a differently-worded message) to learn whether a username exists.
  const hashToCheck = row && row.isActive ? row.passwordHash : await getDummyHash();
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!row || !row.isActive || !passwordOk) {
    recordFailedAttempt(username);
    return { error: "Incorrect username or password." };
  }

  clearAttempts(username);
  await createSession(row.id);
  redirect(next);
}
