/**
 * Drops and rebuilds the database from src/db/schema.sql, then seeds it.
 * The schema file is the source of truth, so a reset is always a clean slate.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "../src/db/client.js";
import { seed } from "../src/db/seed.js";

const schemaPath = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));

async function main() {
  const ddl = await readFile(schemaPath, "utf8");

  // .simple() uses the simple query protocol, which is what allows a multi-statement script.
  await sql.unsafe(ddl).simple();
  console.log("schema applied");

  await seed();
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
