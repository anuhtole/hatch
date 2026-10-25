import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter } as any);
}

// Bumped when the generated client surface changes (e.g. after a
// `prisma db push` + `prisma generate` adds a new model). Forces the
// dev-mode global cache to drop the stale client so the new model
// (e.g. PendingAction) becomes reachable without restarting the server.
const PRISMA_CLIENT_VERSION = 4;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion: number | undefined;
};

function getClient(): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.prismaVersion === PRISMA_CLIENT_VERSION) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
    globalForPrisma.prismaVersion = PRISMA_CLIENT_VERSION;
  }
  return client;
}

export const prisma = getClient();
