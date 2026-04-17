import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrisma() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// 로컬 개발: 싱글톤 (HMR에서 연결 누수 방지)
// 프로덕션 edge: 매번 새 인스턴스 (stale 연결 방지)
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  process.env.NODE_ENV === "production"
    ? createPrisma()
    : (globalForPrisma.prisma ??= createPrisma());
