import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { redis } from "@/lib/redis";

// ponytail: liveness/readiness internal tanpa auth (NFR#5). Selalu 200 agar LB
// bisa baca body; status 'ok' hanya bila db+redis keduanya up, else 'degraded'.
export async function GET() {
  let db: "up" | "down" = "down";
  let redisState: "up" | "down" | "off" = "down";
  const t0 = Date.now();
  try {
    await sql`SELECT 1`;
    db = "up";
  } catch {
    // down — dilaporkan di body, bukan throw.
  }
  const dbMs = Date.now() - t0;
  // REDIS_URL kosong = Redis sengaja tak dipakai (rate-limit in-memory), bukan gangguan.
  if (!process.env.REDIS_URL) {
    redisState = "off";
  } else {
    try {
      await redis.ping();
      redisState = "up";
    } catch {
      // down — dilaporkan di body.
    }
  }
  const status = db === "up" && redisState !== "down" ? "ok" : "degraded";
  return NextResponse.json({ status, db, db_ms: dbMs, redis: redisState });
}
