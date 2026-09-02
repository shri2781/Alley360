import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

/** `max: 5` is generous for a 4-lane venue; the concurrency test (M7) needs more than one. */
export const sql = postgres(url, { max: 5 });
export const db = drizzle(sql, { schema });

export { schema };
