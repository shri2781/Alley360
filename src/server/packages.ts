import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { pkg } from "../db/schema";

export async function getActivePackages(tenantId: string) {
  return db
    .select()
    .from(pkg)
    .where(and(eq(pkg.tenantId, tenantId), eq(pkg.isActive, true)))
    .orderBy(asc(pkg.sortOrder));
}
