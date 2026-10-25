import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "./db";

// ponytail: auth cookie minimal di atas tabel sessions PRD §5.3. Cookie = id sesi,
// httpOnly; tanpa lib baru, tanpa JWT — validasi = row ada di DB.
// Admin console sengaja punya cookie SENDIRI supaya login admin tidak menimpa
// session customer di browser yang sama (mudah tes dua peran sekaligus).
export const SESSION_COOKIE = "ftai_session";
export const ADMIN_SESSION_COOKIE = "ftai_admin_session";
export const MAX_DEVICES = 2;

// ---- Admin auth (Bearer token cross-origin untuk kasir/ui standalone) ----
// PRD §4.1: admin.restoran.com beda origin dari web app, cookie SameSite=Lax tak cocok.
// Bearer token pendek umur (akses) + refresh httpOnly cookie; HS256 via node:crypto (stdlib).
// Refresh token di-hash SHA-256 di tabel admin_sessions (pola sessions).
// ponytail: secret dev hanya untuk development. Di production wajib diset —
// fallback diam-diam = semua deployment memakai kunci yang sama (bisa dipalsukan).
function envSecret(name: string, devFallback: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (process.env.NODE_ENV === "production") throw new Error(`[auth] ${name} wajib diset di production.`);
  return devFallback;
}

const ACCESS_TTL_SECONDS = Number(process.env.ADMIN_ACCESS_TTL ?? 900); // 15 menit
const REFRESH_TTL_SECONDS = Number(process.env.ADMIN_REFRESH_TTL ?? 604800); // 7 hari
const MAX_REFRESH_SESSIONS = 5;

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://admin.restoran.com",
];
export function allowedOrigins(): string[] {
  const extra = (process.env.ADMIN_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra];
}
export function corsHeaders(origin: string | null) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}
export function requireAllowedOrigin(req: Request): string | null | "denied" {
  const origin = (req.headers.get("origin") ?? "").trim() || null;
  if (!origin) return null;
  if (allowedOrigins().includes(origin)) return origin;
  // ponytail: akses LAN/tablet (IP host) = same-origin; bandingkan host langsung
  // ketimbang mewajibkan tiap IP didaftarkan di env.
  try {
    const reqHost = req.headers.get("host") ?? new URL(req.url).host;
    if (new URL(origin).host === reqHost) return origin;
  } catch {}
  return "denied";
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function partSig(header: string, payload: string) {
  return createHmac("sha256", envSecret("ADMIN_JWT_SECRET", "dev-only-admin-jwt-secret"))
    .update(`${header}.${payload}`)
    .digest();
}
export function createAccessToken(user: AdminUser): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ sub: user.id, role: user.role, cafe_id: user.cafe_id, iat: now, exp: now + ACCESS_TTL_SECONDS }),
    ),
  );
  return `${header}.${payload}.${b64url(partSig(header, payload))}`;
}
export type AdminUser = {
  id: string;
  role: "kasir" | "super_admin";
  cafe_id: string | null;
};
export type AccessClaims = {
  sub: string;
  role: "kasir" | "super_admin";
  cafe_id: string | null;
  exp: number;
};
export function verifyAccessToken(token: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = b64url(partSig(header, payload));
  const got = sig ?? "";
  if (expected.length !== got.length) return null;
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payload).toString("utf8")) as AccessClaims;
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!["kasir", "super_admin"].includes(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---- Password (scrypt + salt; verifikasi deterministik harga-tetap) ----
// Format disimpan: scrypt$1$<salt-hex>$<key-hex>
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;
const pepper = () => envSecret("ADMIN_PASSWORD_PEPPER", "dev-only-pepper-TASK023");
export function hashPassword(password: string): string {
  if (password.length < 8 || password.length > 128)
    throw new Error("Password harus 8–128 karakter.");
  const salt = randomBytes(16);
  const key = scryptSync(password + pepper(), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const [, , saltHex, keyHex] = parts;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) return false;
  const key = scryptSync(password + pepper(), Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}

// ---- Refresh token (raw hanya di respons; DB menyimpan hash) ----
export function issueRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  return { raw, hash, expiresAt };
}
// ponytail: login/refresh admin = 1 baris admin_sessions; kelebihan cap = evict
// paling lama (pola createSession lib/auth.ts). Bukan security boundary — abuse
// refresh sama dengan punya refresh, cap ini hanya pembatas bloat.
export async function saveRefreshSession(
  user: AdminUser,
  hash: string,
  expiresAt: Date,
  origin: string | null,
): Promise<void> {
  await sql.begin(async (tx: any) => {
    await tx`DELETE FROM admin_sessions WHERE user_id = ${user.id} AND expires_at <= now()`;
    const existing = (await tx`
      SELECT id FROM admin_sessions WHERE user_id = ${user.id}
      ORDER BY created_at DESC`) as unknown as { id: string }[];
    const overflow = existing.length - MAX_REFRESH_SESSIONS + 1;
    if (overflow > 0) {
      const victims = existing.slice(existing.length - overflow).map((s) => s.id);
      await tx`DELETE FROM admin_sessions WHERE id = ANY(${victims})`;
    }
    await tx`
      INSERT INTO admin_sessions (user_id, refresh_token_hash, origin, expires_at)
      VALUES (${user.id}, ${hash}, ${origin}, ${expiresAt.toISOString()})`;
  });
}
// Refresh rotation: token lama dihapus SAAT dipakai (satu pakai), lalu terbitkan
// admin_sessions baru. Return null bila refresh token invalid/expired/revoked.
export async function rotateRefreshToken(
  raw: string,
  origin: string | null,
): Promise<{ user: AdminUser; refreshToken: string; refreshHash: string; refreshExpiresAt: Date } | null> {
  const hash = createHash("sha256").update(raw).digest("hex");
  const out = (await sql.begin(async (tx: any) => {
    const s = (await tx`
      DELETE FROM admin_sessions WHERE refresh_token_hash = ${hash} AND expires_at > now()
      RETURNING user_id`) as unknown as { user_id: string }[];
    if (!s[0]) return null;
    const u = (await tx`
      SELECT id, role, cafe_id FROM users
      WHERE id = ${s[0].user_id} AND role IN ('kasir', 'super_admin')
        AND COALESCE(is_active, TRUE)
      LIMIT 1`) as unknown as AdminUser[];
    if (!u[0]) return null;
    return u[0];
  })) as unknown as AdminUser | null;
  if (!out) return null;
  const rt = issueRefreshToken();
  await saveRefreshSession(out, rt.hash, rt.expiresAt, origin);
  return { user: out, refreshToken: rt.raw, refreshHash: rt.hash, refreshExpiresAt: rt.expiresAt };
}

// PRD §7.1: login kasir/super_admin -> {access_token, refresh_token, user}.
// Password admin tersimpan di users.admin_password_hash (0003); non-admin di-reject.
export async function loginByPassword(
  emailOrPhone: string,
  password: string,
  origin: string | null,
): Promise<{
  user: AdminUser;
  accessToken: string;
  refreshToken: string;
} | null> {
  const id = emailOrPhone.trim().toLowerCase();
  const rows = (await sql`
    SELECT id, role, cafe_id, admin_password_hash FROM users
    WHERE (lower(email) = ${id} OR phone_number = ${emailOrPhone.trim()})
      AND role IN ('kasir', 'super_admin')
      AND COALESCE(is_active, TRUE)
    LIMIT 1`) as unknown as Array<AdminUser & { admin_password_hash: string | null }>;
  const row = rows[0];
  if (!row || !row.admin_password_hash || !verifyPassword(password, row.admin_password_hash))
    return null;
  const user: AdminUser = { id: row.id, role: row.role, cafe_id: row.cafe_id };
  const rt = issueRefreshToken();
  await saveRefreshSession(user, rt.hash, rt.expiresAt, origin);
  return { user, accessToken: createAccessToken(user), refreshToken: rt.raw };
}

// ---- Autentikasi request (Bearer JWT) ----
export function bearerToken(req: Request): string | null {
  const auth = (req.headers.get("authorization") ?? "").trim();
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/u.exec(auth);
  return m ? m[1] : null;
}
// guard origin + role + (opsional) cafe milik kasir. Return AdminAuth atau kode
// error string; route memetakan kode -> status (401/403).
export async function requireAdmin(
  req: Request,
  opts: { roles?: Array<AdminUser["role"]>; cafeId?: string } = {},
): Promise<{ user: AdminUser; sessionId: string } | "unauthorized" | "forbidden-origin" | "forbidden-role" | "forbidden-cafe"> {
  const origin = requireAllowedOrigin(req);
  if (origin === "denied") return "forbidden-origin";
  let user: AdminUser | null = null;
  const token = bearerToken(req);
  const claims = token ? verifyAccessToken(token) : null;
  if (claims) user = { id: claims.sub, role: claims.role, cafe_id: claims.cafe_id };
  // ponytail: fallback cookie sesi web console admin (cookie TERPISAH dari customer).
  // cafe_id null utk sesi cookie → cek forbidden-cafe fail-closed.
  if (!user) {
    const sid = adminSessionIdFrom(req);
    const ctx = sid ? await authBySessionId(sid) : null;
    if (ctx && (ctx.user.role === "kasir" || ctx.user.role === "super_admin"))
      user = { id: ctx.user.id, role: ctx.user.role as AdminUser["role"], cafe_id: null };
  }
  if (!user) return "unauthorized";
  if (opts.roles && !opts.roles.includes(user.role)) return "forbidden-role";
  if (opts.cafeId && user.role !== "super_admin" && user.cafe_id !== opts.cafeId)
    return "forbidden-cafe";
  return { user, sessionId: "" };
}

export type AuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  avatar_url: string | null;
  role?: string;
};

export type AuthContext = { user: AuthUser; sessionId: string };

function cookieValueFrom(req: Request, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`,
    "u",
  );
  const m = pattern.exec(req.headers.get("cookie") ?? "");
  const v = m?.[1]?.trim().replace(/^"|"$/g, "");
  return v && /^[0-9a-f-]{8,36}$/iu.test(v) ? v : null;
}

function sessionIdFrom(req: Request): string | null {
  return cookieValueFrom(req, SESSION_COOKIE);
}

function adminSessionIdFrom(req: Request): string | null {
  return cookieValueFrom(req, ADMIN_SESSION_COOKIE);
}

async function authBySessionId(sid: string): Promise<AuthContext | null> {
  if (!/^[0-9a-f-]{8,36}$/iu.test(sid)) return null;
  const rows = (await sql`
    SELECT u.id, u.name, u.email, u.phone_number, u.avatar_url, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sid} AND COALESCE(u.is_active, TRUE) LIMIT 1`) as unknown as AuthUser[];
  if (!rows[0]) return null;
  await sql`UPDATE sessions SET last_active = now() WHERE id = ${sid}`;
  return { user: rows[0], sessionId: sid };
}

export async function requireAuth(req: Request): Promise<AuthContext | null> {
  const sid = sessionIdFrom(req);
  return sid ? authBySessionId(sid) : null;
}

export async function requireSuperAdmin(req: Request): Promise<AuthContext | null> {
  const auth = await requireAuth(req);
  if (!auth || auth.user.role !== 'super_admin') return null;
  return auth;
}

export async function getServerSession(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
  return sid ? authBySessionId(sid) : null;
}

// Sesi web console admin (cookie terpisah dari customer).
export async function getAdminServerSession(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const sid = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sid) return null;
  const auth = await authBySessionId(sid);
  if (!auth || (auth.user.role !== 'super_admin' && auth.user.role !== 'kasir')) return null;
  return auth;
}

export function sessionCookieHeader(sessionId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function adminSessionCookieHeader(sessionId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clearedAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ponytail: device ke-3 = revoke oldest dalam 1 transaksi (PRD §2/§4.2/§5.3).
// Lock baris users dulu — SELECT sessions FOR UPDATE tak serialize insert paralel
// (phantom di READ COMMITTED); lock users serialize semua createSession per-user.
export async function createSession(userId: string, fingerprint: string): Promise<{ id: string }> {
  const hash = randomBytes(32).toString("hex");
  const fp = fingerprint.slice(0, 255) || "unknown";
  const rows = (await sql.begin(async (tx: any) => {
    await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const existing = (await tx`
      SELECT id FROM sessions WHERE user_id = ${userId}
      ORDER BY last_active ASC FOR UPDATE`) as unknown as { id: string }[];
    const overflow = existing.length - MAX_DEVICES + 1;
    if (overflow > 0) {
      const victims = existing.slice(0, overflow).map((s) => s.id);
      await tx`DELETE FROM sessions WHERE id = ANY(${victims})`;
    }
    return (await tx`
      INSERT INTO sessions (user_id, device_fingerprint, refresh_token_hash)
      VALUES (${userId}, ${fp}, ${hash})
      RETURNING id`) as unknown as { id: string }[];
  })) as unknown as { id: string }[];
  return { id: rows[0].id };
}

export async function devSeedUserId(): Promise<string | null> {
  const rows = (await sql`
    SELECT id FROM users WHERE email = 'dev@example.com' LIMIT 1`) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

