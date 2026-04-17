import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrisma() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// 로컬: 싱글톤 (HMR 누수 방지)
// edge 프로덕션: 매 호출마다 새 인스턴스 (Neon WebSocket이 isolate 간 재사용 시 "Connection closed" 발생)
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return createPrisma();
  }
  return (globalForPrisma.prisma ??= createPrisma());
}
