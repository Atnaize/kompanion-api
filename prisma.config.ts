/// <reference types="node" />
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// PgBouncer's transaction-mode pooling drops sessions between statements,
// which breaks the advisory lock Prisma uses to coordinate migrations (P1002).
// `prisma migrate deploy` needs a session-scoped connection. Prefer an
// explicit DIRECT_URL (set locally for Docker postgres), otherwise fall back
// to the unpooled URL that Neon's Vercel integration auto-provisions.
const directUrlValue =
  process.env.DIRECT_URL ??
  process.env.DB_DATABASE_URL_UNPOOLED ??
  process.env.DB_POSTGRES_URL_NON_POOLING;

if (!directUrlValue) {
  throw new Error(
    "Set DIRECT_URL (or rely on Neon's DB_DATABASE_URL_UNPOOLED / DB_POSTGRES_URL_NON_POOLING) so prisma migrate can use a session-scoped connection."
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
  datasource: {
    // Pooled connection for app runtime (Neon's PgBouncer).
    url: env("DATABASE_URL"),
    // Non-pooled connection for migrations only.
    directUrl: directUrlValue,
  },
});
