import { db } from "../db/client";
import { tenant } from "../db/schema";

/** The one seeded venue. Real multi-tenancy (picking a venue by domain/subdomain) is
 *  out of scope -- see the note on the `tenant` table in schema.sql. */
export async function getVenue() {
  const [row] = await db.select().from(tenant).limit(1);
  if (!row) throw new Error("no venue configured -- run `npm run db:reset` first");
  return row;
}
