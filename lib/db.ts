import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// ponytail: singleton via globalThis agar dev-reload Next.js tidak bikin pool baru.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/freetokenai_dev", {
    // Vercel/serverless: 1 koneksi per instance, dan Neon pooler (PgBouncer
    // transaction mode) tidak mendukung prepared statement bernama.
    // Di host long-running (VPS) pakai max: 10 agar support concurrent requests.
    max: 10,
    prepare: false,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql);
export { sql };
