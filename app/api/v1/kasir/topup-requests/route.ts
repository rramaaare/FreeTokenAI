import { NextResponse } from "next/server";
import { corsHeaders, requireAdmin, requireAllowedOrigin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { logAudit } from "@/lib/permissions";

export async function OPTIONS(req: Request) {
  const origin = requireAllowedOrigin(req);
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// Kasir submit permintaan top-up saldo cafe
export async function POST(req: Request) {
  const origin = requireAllowedOrigin(req);
  if (origin === "denied")
    return NextResponse.json(
      { error: { code: "FORBIDDEN_ORIGIN", message: "Origin tidak diizinkan." } },
      { status: 403, headers: corsHeaders(null) },
    );

  const auth = await requireAdmin(req, { roles: ["kasir"] });
  if (typeof auth === "string")
    return NextResponse.json(
      { error: { code: auth.toUpperCase(), message: "Akses kasir tidak sah." } },
      { status: auth === "unauthorized" ? 401 : 403, headers: corsHeaders(origin) },
    );

  if (!auth.user.cafe_id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN_CAFE", message: "Akun kasir belum terikat cafe." } },
      { status: 403, headers: corsHeaders(origin) },
    );
  }

  let body: { amount?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Body bukan JSON." } },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const amount = typeof body.amount === "number" && Number.isInteger(body.amount) ? body.amount : NaN;
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) {
    return NextResponse.json(
      { error: { code: "INVALID_AMOUNT", message: "Jumlah top-up 1–100.000.000 token." } },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

  try {
    const inserted = (await sql`
      INSERT INTO cafe_topup_requests (cafe_id, requested_by, amount, note)
      VALUES (${auth.user.cafe_id}, ${auth.user.id}, ${amount}, ${note || null})
      RETURNING id, cafe_id, requested_by, amount, note, status, created_at
    `) as unknown as Array<{
      id: string;
      cafe_id: string;
      requested_by: string;
      amount: number;
      note: string | null;
      status: string;
      created_at: string;
    }>;

    await logAudit(auth.user.id, "cafe.topup_request", "cafe_topup_requests", inserted[0].id, {
      cafe_id: auth.user.cafe_id,
      amount,
      note,
    });

    return NextResponse.json(
      { request: inserted[0] },
      { status: 201, headers: corsHeaders(origin) },
    );
  } catch (e) {
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: e instanceof Error ? e.message : "Gagal submit permintaan" } },
      { status: 500, headers: corsHeaders(origin) },
    );
  }
}

// Kasir lihat daftar permintaan top-up milik cafe ini
export async function GET(req: Request) {
  const origin = requireAllowedOrigin(req);
  if (origin === "denied")
    return NextResponse.json(
      { error: { code: "FORBIDDEN_ORIGIN", message: "Origin tidak diizinkan." } },
      { status: 403, headers: corsHeaders(null) },
    );

  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string")
    return NextResponse.json(
      { error: { code: auth.toUpperCase(), message: "Akses tidak sah." } },
      { status: auth === "unauthorized" ? 401 : 403, headers: corsHeaders(origin) },
    );

  const cafeId = auth.user.role === "super_admin"
    ? new URL(req.url).searchParams.get("cafe_id") ?? auth.user.cafe_id
    : auth.user.cafe_id;

  if (!cafeId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN_CAFE", message: "Cafe tidak ditentukan." } },
      { status: 403, headers: corsHeaders(origin) },
    );
  }

  const statusFilter = new URL(req.url).searchParams.get("status");
  const whereStatus = statusFilter && ["pending", "approved", "rejected"].includes(statusFilter)
    ? sql`AND status = ${statusFilter}`
    : sql``;

  const rows = (await sql`
    SELECT
      r.id,
      r.cafe_id,
      r.requested_by,
      r.amount,
      r.note,
      r.status,
      r.approved_by,
      r.approved_at,
      r.rejection_reason,
      r.created_at,
      u.name AS requested_by_name,
      u.email AS requested_by_email,
      a.name AS approved_by_name
    FROM cafe_topup_requests r
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN users a ON a.id = r.approved_by
    WHERE r.cafe_id = ${cafeId}
    ${whereStatus}
    ORDER BY r.created_at DESC
    LIMIT 100
  `) as unknown as Array<{
    id: string;
    cafe_id: string;
    requested_by: string;
    amount: number;
    note: string | null;
    status: "pending" | "approved" | "rejected";
    approved_by: string | null;
    approved_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    requested_by_name: string | null;
    requested_by_email: string | null;
    approved_by_name: string | null;
  }>;

  return NextResponse.json({ requests: rows }, { headers: corsHeaders(origin) });
}