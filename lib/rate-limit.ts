import { redis } from "./redis";

// ponytail: fixed-window via Redis INCR+EXPIRE. windowSec default 60 (backward compat).
// Redis down -> fallback in-memory + warning sekali (tetap layani, jangan 500).
const mem = new Map<string, { count: number; window: number }>();
let warned = false;

function memLimited(key: string, limit: number, windowSec: number): boolean {
  const win = Math.floor(Date.now() / (windowSec * 1000));
  const h = mem.get(key);
  if (!h || h.window !== win) {
    mem.set(key, { count: 1, window: win });
    return false;
  }
  h.count += 1;
  return h.count > limit;
}

export async function rateLimited(key: string, limit = 60, windowSec = 60): Promise<boolean> {
  // REDIS_URL kosong (mis. shared hosting) -> langsung in-memory, jangan tunggu retry koneksi.
  if (!process.env.REDIS_URL) return memLimited(key, limit, windowSec);
  const win = Math.floor(Date.now() / (windowSec * 1000));
  try {
    const n = await redis.incr(`rl:${key}:${win}`);
    if (n === 1) await redis.expire(`rl:${key}:${win}`, windowSec + 5);
    return n > limit;
  } catch {
    if (!warned) {
      warned = true;
      console.warn("[rate-limit] Redis down, fallback in-memory.");
    }
    return memLimited(key, limit, windowSec);
  }
}

export function retryAfterSec(windowSec = 60): number {
  const now = Date.now();
  const winEnd = (Math.floor(now / (windowSec * 1000)) + 1) * windowSec * 1000;
  return Math.ceil((winEnd - now) / 1000);
}
