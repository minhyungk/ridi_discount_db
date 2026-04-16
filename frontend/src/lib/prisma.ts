import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Cloudflare Pages / Workers edge runtime 호환
// DATABASE_URL은 Neon 풀링 엔드포인트 (ends with -pooler.neon.tech) 권장
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
