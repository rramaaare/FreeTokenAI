import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { permissionDenied } from "@/lib/permissions";
import { receiptStatus, sweepExpiredReceipts } from "@/lib/receipts";

// ponytail: daftar struk terbaru untuk halaman Cek Status kasir. Kasir hanya
// struk cafe-nya sendiri; super_admin semua cafe (opsional ?cafe_id=).
// Filter: ?status=claimed|unclaimed|expired, ?q=<potongan kode>. Maks 100 baris.

export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Akses tidak sah." } }, { status });
  }
  const denied = await permissionDenied(auth.user.role, "receipt.view");
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  let cafeId: string | null;
  if (auth.user.role === "kasir") {
    if (!auth.user.cafe_id)
      return NextResponse.json({ error: { code: "FORBIDDEN_CAFE", message: "Akun kasir belum terikat cafe." } }, { status: 403 });
    cafeId = auth.user.cafe_id;
  } else {
    cafeId = params.get("cafe_id")?.trim() || null;
  }

  const raw = params.get("status");
  const status = raw === "claimed" || raw === "unclaimed" || raw === "expired" ? raw : null;
  const q = (params.get("q") ?? "").trim().toUpperCase().slice(0, 20);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 50));

  await sweepExpiredReceipts(cafeId);
  // status: claimed | expired (hangus, token kembali ke cafe) | unclaimed (masih berlaku)
  const rows = (await sql`
    SELECT r.code, r.tokens_granted, r.is_claimed, r.claimed_at, r.created_at, r.expires_at, r.refunded_at
    FROM receipts r
    WHERE (${cafeId}::uuid IS NULL OR r.cafe_id = ${cafeId}::uuid)
      AND (
        ${status}::text IS NULL
        OR (${status} = 'claimed' AND r.is_claimed IS TRUE)
        OR (${status} = 'expired' AND r.is_claimed IS NOT TRUE AND (r.refunded_at IS NOT NULL OR r.expires_at <= now()))
        OR (${status} = 'unclaimed' AND r.is_claimed IS NOT TRUE AND r.refunded_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > now()))
      )
      AND (${q} = '' OR r.code ILIKE ${"%" + q + "%"})
    ORDER BY r.created_at DESC
    LIMIT ${limit}`) as unknown as Array<{
    code: string;
    tokens_granted: number;
    is_claimed: boolean | null;
    claimed_at: string | null;
    created_at: string;
    expires_at: string | null;
    refunded_at: string | null;
  }>;

  return NextResponse.json({
    receipts: rows.map((r) => ({
      code: r.code,
      tokens: r.tokens_granted,
      claimed: Boolean(r.is_claimed),
      status: receiptStatus(r),
      claimed_at: r.claimed_at,
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
  });
}
