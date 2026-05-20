import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

function createDb() {
  // Supabase pooler(Supavisor)는 self-signed cert를 쓰므로 rejectUnauthorized=false.
  // connectionString의 sslmode 파라미터는 explicit ssl 옵션과 충돌해서 제거.
  const url = (process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  return drizzle(pool, { schema });
}

type DB = ReturnType<typeof createDb>;
const globalForDb = global as unknown as { db?: DB };

export function getDb(): DB {
  if (process.env.NODE_ENV === "production") {
    return createDb();
  }
  return (globalForDb.db ??= createDb());
}
