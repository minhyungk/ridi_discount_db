import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrisma() {
  // Supabase pooler(Supavisor)는 self-signed cert를 쓰므로 rejectUnauthorized=false.
  // connectionString의 sslmode 파라미터는 explicit ssl 옵션과 충돌할 수 있어 제거.
  const url = (process.env.DATABASE_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");
  const adapter = new PrismaPg({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return createPrisma();
  }
  return (globalForPrisma.prisma ??= createPrisma());
}
