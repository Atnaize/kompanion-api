/// <reference types="node" />
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Populate DIRECT_URL before the schema validator reads it. The schema
// declares `directUrl = env("DIRECT_URL")`, which `prisma migrate deploy`
// uses to dodge PgBouncer (advisory locks need a session-scoped connection
// — without this, migrations fail with P1002). Locally DIRECT_URL is set in
// .env; on Vercel we fall back to the unpooled URL Neon's integration
// auto-provisions, so no manual env var is needed.
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL =
    process.env.DB_DATABASE_URL_UNPOOLED ??
    process.env.DB_POSTGRES_URL_NON_POOLING;
}

if (!process.env.DIRECT_URL) {
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
  // `engine: "classic"` requires a datasource block in defineConfig's type.
  // The schema.prisma datasource is what `prisma generate` actually reads;
  // this is here to satisfy the TS types only.
  datasource: {
    url: env("DATABASE_URL"),
    directUrl: env("DIRECT_URL"),
  },
});
