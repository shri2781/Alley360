import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { rate } from "../db/schema";
import type { RateSchedule, SpecialRate } from "../domain/rates";

/**
 * Loads the tenant's rate schedule: the one base row plus every active special,
 * ordered so `resolveRate()` can just take the first match. `days` is never
 * filtered in SQL (see the schema.sql banner on `rate`) -- Postgres hands back
 * whatever it stored, split here into base vs. specials.
 *
 * Throws if there is no base row. `rate_one_base_idx` guarantees at most one; "at
 * least one" is this loader's job to enforce -- a missing base is a broken seed,
 * and pricing nothing at 0 silently would be worse than failing loudly.
 */
export async function getRateSchedule(tenantId: string): Promise<RateSchedule> {
  const rows = await db
    .select()
    .from(rate)
    .where(and(eq(rate.tenantId, tenantId), eq(rate.isActive, true)))
    .orderBy(asc(rate.priority), asc(rate.name), asc(rate.id));

  const baseRow = rows.find((r) => r.isBase);
  if (!baseRow) throw new Error(`tenant ${tenantId} has no base rate -- run \`npm run db:reset\``);

  const specials: SpecialRate[] = rows
    .filter((r) => !r.isBase)
    .map((r) => ({
      id: r.id,
      name: r.name,
      pricePerPerson: r.pricePerPerson,
      days: r.days ?? [],
      startsAtMin: r.startsAtMin,
      endsAtMin: r.endsAtMin,
      priority: r.priority,
    }));

  return {
    base: { id: baseRow.id, name: baseRow.name, pricePerPerson: baseRow.pricePerPerson },
    specials,
  };
}
