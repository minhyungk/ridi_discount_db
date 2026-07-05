import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "@/db/schema";

function createDb() {
  // On Cloudflare Workers, a direct TLS connection to Supabase hangs
  // (postgres.js CONNECT_TIMEOUT), so the connection must go through
  // the Hyperdrive binding, which terminates TLS on Cloudflare's side.
  let hyperdrive: { connectionString: string } | undefined;
  try {
    const { env } = getCloudflareContext();
    hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (!hyperdrive) {
      console.error("hyperdrive_binding_missing", Object.keys(env ?? {}));
    }
  } catch (e) {
    // Not running on Workers (e.g. `next dev` or `next build`).
    console.error("cf_context_unavailable", (e as Error).message);
  }

  if (hyperdrive) {
    const client = postgres(hyperdrive.connectionString, {
      prepare: false,
      max: 1,
    });
    return drizzle(client, { schema });
  }

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
