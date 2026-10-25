import { NextResponse } from "next/server";
import { createSession, requireAuth, sessionCookieHeader } from "@/lib/auth";
import { extendedExpiry } from "@/lib/billing";
import { sql } from "@/lib/db";
import { rateLimited, retryAfterSec } from "@/lib/rate-limit";
import { RECEIPT_VALID_DAYS } from "@/lib/receipts";

// ponytail: PRD §4.2/§7.2 — klaim QR struk publik (tanpa auth). Alur:
//   1) kunci receipt (FOR UPDATE) -> tolak kalau sudah diklaim (409)
//   2) find-or-create user dari identifier (WA/email), kunci barisnya
//   3) find-or-create workspace, grant token + expires_at = now()+7d
//      (Workspace Cycle §2: klaim saat aktif tetap extend 7 hari DARI KLAIM)
//   4) ledger token_transactions type 'grant' (reference receipt)
//   5) tandai receipt claimed (audit trail workspace_id)
// Semua 1..5 dalam SATU transaksi. Sesi dibuat SETELAH commit (createSession
// punya sql.begin sendiri + lock users — memanggilnya di dalam tx = deadlock).
// Catatan: PRD §7.2 sebut access/refresh_token; repo ini pakai cookie sesi
// httpOnly (pola lib/auth.ts TASK-014) — access_token = id sesi, refresh =
// cookie 30 hari. Setara secara fungsi, bukan format JWT.

class ClaimError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseIdentifier(raw: string): { email: string | null; phone: string | null } | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes("@")) {
    const email = s.toLowerCase();
    if (email.length > 255 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    return { email, phone: null };
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 20) return null;
  return { email: null, phone: digits };
}

export async function POST(req: Request) {
  // ponytail: rate-limit IP 10/menit (sebelum parse body, hemat resource).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  if (await rateLimited(`claim:ip:${ip}`, 10, 60)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Terlalu banyak request dari IP ini." } },
      { status: 429, headers: { "Retry-After": String(retryAfterSec(60)) } },
    );
  }

  let body: { code?: unknown; identifier?: unknown; device_fingerprint?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Body bukan JSON." } },
      { status: 400 },
    );
  }
  const code = typeof body.code === "string" ? body.code.trim().slice(0, 20) : "";
  if (!code)
    return NextResponse.json(
      { error: { code: "CODE_REQUIRED", message: "Kode struk wajib." } },
      { status: 400 },
    );

  // ponytail: kalau sudah login, token struk masuk ke workspace user yang sedang
  // login. Identifier diabaikan supaya tidak membuat user/sesi baru (ganti akun).
  const auth = await requireAuth(req);
  const idn = auth
    ? null
    : typeof body.identifier === "string"
      ? parseIdentifier(body.identifier)
      : null;
  if (!auth && !idn)
    return NextResponse.json(
      { error: { code: "INVALID_IDENTIFIER", message: "Masukkan No. WhatsApp atau email yang valid." } },
      { status: 400 },
    );

  // ponytail: rate-limit identifier 5/jam (setelah validasi identifier).
  const identKey = auth ? `user:${auth.user.id}` : idn!.email ?? `phone:${idn!.phone}`;
  if (await rateLimited(`claim:id:${identKey}`, 5, 3600)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Terlalu banyak klaim untuk identifier ini." } },
      { status: 429, headers: { "Retry-After": String(retryAfterSec(3600)) } },
    );
  }

  const fingerprint = (
    typeof body.device_fingerprint === "string" && body.device_fingerprint.trim()
      ? body.device_fingerprint
      : req.headers.get("user-agent") ?? "unknown"
  ).slice(0, 255);

  let workspace: { id: string; token_balance: number; expires_at: string };
  let userId: string;
  try {
    const out = (await sql.begin(async (tx: any) => {
      const rc = (await tx`
        SELECT id, tokens_granted, is_claimed, cafe_id,
               (refunded_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= now())) AS expired
        FROM receipts
        WHERE code = ${code} LIMIT 1 FOR UPDATE`) as unknown as {
        id: string;
        tokens_granted: number;
        is_claimed: boolean;
        cafe_id: string | null;
        expired: boolean;
      }[];
      if (!rc[0]) throw new ClaimError("RECEIPT_NOT_FOUND", 404, "Kode struk tidak ditemukan.");
      if (rc[0].is_claimed)
        throw new ClaimError("RECEIPT_ALREADY_CLAIMED", 409, "Kode struk sudah pernah diklaim.");
      // struk hangus: tokennya kembali ke saldo cafe (lib/receipts.ts), bukan ke pelanggan.
      if (rc[0].expired)
        throw new ClaimError(
          "RECEIPT_EXPIRED",
          410,
          `Kode struk sudah kedaluwarsa (tidak diklaim dalam ${RECEIPT_VALID_DAYS} hari). Minta struk baru di kasir.`,
        );

      let uid: string;
      if (auth) {
        // Sudah login: kredit workspace milik user ini, tanpa bikin akun/sesi baru.
        uid = auth.user.id;
        await tx`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`;
      } else {
        // find-or-create user (unique: email / phone_number)
        const identity = idn!;
        const where = identity.email
          ? tx`SELECT id FROM users WHERE email = ${identity.email} LIMIT 1`
          : tx`SELECT id FROM users WHERE phone_number = ${identity.phone} LIMIT 1`;
        let user = (await where) as unknown as { id: string }[];
        if (!user[0]) {
          const ins = (await tx`
            INSERT INTO users (email, phone_number)
            VALUES (${identity.email}, ${identity.phone})
            ON CONFLICT DO NOTHING
            RETURNING id`) as unknown as { id: string }[];
          if (ins[0]) user = ins;
          else
            user = (await (identity.email
              ? tx`SELECT id FROM users WHERE email = ${identity.email} LIMIT 1`
              : tx`SELECT id FROM users WHERE phone_number = ${identity.phone} LIMIT 1`)) as unknown as {
              id: string;
            }[];
        }
        uid = user[0].id;
        await tx`SELECT id FROM users WHERE id = ${uid} FOR UPDATE`;
      }

      // find-or-create workspace (serial per-user lewat lock users di atas)
      let ws = (await tx`
        SELECT id FROM workspaces WHERE user_id = ${uid}
        ORDER BY created_at LIMIT 1 FOR UPDATE`) as unknown as { id: string }[];
      if (!ws[0]) {
        ws = (await tx`
          INSERT INTO workspaces (user_id, token_balance, expires_at, cafe_id)
          VALUES (${uid}, 0, now(), ${rc[0].cafe_id})
          RETURNING id`) as unknown as { id: string }[];
      }
      const wsId = ws[0].id;

      // grant + masa aktif: sisa + 7 hari (lewat -> 7 hari dari sekarang), maks 30 hari
      // ke depan — aturan di lib/billing.ts (extendedExpiry).
      const upd = (await tx`
        UPDATE workspaces
        SET token_balance = token_balance + ${rc[0].tokens_granted},
            expires_at = ${extendedExpiry()}
        WHERE id = ${wsId}
        RETURNING id, token_balance, expires_at`) as unknown as {
        id: string;
        token_balance: number;
        expires_at: string;
      }[];
      await tx`
        INSERT INTO token_transactions (workspace_id, type, amount, balance_after, reference_type, reference_id)
        VALUES (${wsId}, 'grant', ${rc[0].tokens_granted}, ${upd[0].token_balance}, 'receipt', ${rc[0].id})`;
      await tx`
        UPDATE receipts
        SET is_claimed = TRUE, claimed_by_user_id = ${uid}, claimed_at = now(), workspace_id = ${wsId}
        WHERE id = ${rc[0].id}`;
      return { userId: uid, workspace: upd[0] };
    })) as unknown as { userId: string; workspace: { id: string; token_balance: number; expires_at: string } };
    userId = out.userId;
    workspace = out.workspace;
  } catch (e) {
    if (e instanceof ClaimError)
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    throw e;
  }

  // Klaim oleh user yang sudah login: jangan ganti sesi/cookie.
  if (auth) {
    return NextResponse.json({
      logged_in: true,
      workspace: { token_balance: workspace.token_balance, expires_at: workspace.expires_at },
    });
  }

  // sesi dibuat setelah commit; device ke-3 auto-revoke oldest (lib/auth.ts)
  const session = await createSession(userId, fingerprint);
  const res = NextResponse.json({
    access_token: session.id,
    workspace: { token_balance: workspace.token_balance, expires_at: workspace.expires_at },
  });
  res.headers.set("Set-Cookie", sessionCookieHeader(session.id));
  return res;
}
