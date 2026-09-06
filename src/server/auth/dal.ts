/**
 * Data Access Layer for staff auth -- the real enforcement point. proxy.ts is
 * optimistic and cookie-only (see its own header comment for why that alone is
 * not a security boundary); this is what every protected page and every
 * mutating Server Action actually calls.
 *
 * Wrapped in React `cache()` so a request that calls requireStaff() from a
 * layout AND from an action on the same render only reads the session cookie
 * and hits the database once.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { staffUser } from "../../db/schema";
import { readSession } from "./session";

export type StaffUser = {
  id: string;
  username: string;
};

/** Verifies the session cookie AND re-checks is_active against the database.
 *  That DB check is what makes deactivating the shared account take effect
 *  immediately, even though the cookie itself is a stateless token that would
 *  otherwise keep verifying until it expires. Returns null rather than
 *  redirecting -- callers that can render a non-staff view (or, for
 *  moveAllocationAction, return a typed failure instead of throwing a
 *  mid-drag redirect) should use this; requireStaff() below is for anything
 *  that has no fallback but to bounce to the login page. */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  const session = await readSession();
  if (!session) return null;

  const [row] = await db
    .select({ id: staffUser.id, username: staffUser.username, isActive: staffUser.isActive })
    .from(staffUser)
    .where(eq(staffUser.id, session.uid));

  if (!row || !row.isActive) return null;
  return { id: row.id, username: row.username };
});

/** For layouts and Server Actions that have no reasonable fallback but to send
 *  an unauthenticated caller to the login page. */
export async function requireStaff(): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) {
    redirect("/staff/login");
  }
  return user;
}
