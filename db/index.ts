import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";
import { requireRuntimeDatabase } from "./runtime-database.ts";

export async function getDb() {
  const database = await requireRuntimeDatabase();
  return drizzle(database as never, { schema });
}
