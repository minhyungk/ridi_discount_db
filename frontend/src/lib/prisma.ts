// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// 1. Set up the raw PostgreSQL connection pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 2. Wrap it in a Prisma Adapter
const adapter = new PrismaPg(pool);

// 3. Create the client using the adapter
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: adapter, // Pass the adapter here instead of 'datasources'
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;