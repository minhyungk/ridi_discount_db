import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    ssl: "require",
  });

  return drizzle(client, { schema });
}

type DB = ReturnType<typeof createDb>;
const globalForDb = global as unknown as { db?: DB };

export function getDb(): DB {
  if (process.env.NODE_ENV === "production") {
    return createDb();
  }
  return (globalForDb.db ??= createDb());
}
