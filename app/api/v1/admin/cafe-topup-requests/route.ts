import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/permissions";

// Super_admin lihat semua permintaan top-up (bisa filter by cafe, status)
export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }

  const { searchParams } = new URL(req.url);
  const cafeId = searchParams.get("cafe_id");
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);
  const offset = Number(searchParams.get("offset") ?? 0);

  const whereCafe = cafeId ? sql`AND r.cafe_id = ${cafeId}` : sql``;
  const whereStatus = status && ["pending", "approved", "rejected"].includes(status)
    ? sql`AND r.status = ${status}`
    : sql``;

  const rows = (await sql`
    SELECT
      r.id,
      r.cafe_id,
      c.name AS cafe_name,
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
    JOIN cafes c ON c.id = r.cafe_id
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN users a ON a.id = r.approved_by
    WHERE TRUE
    ${whereCafe}
    ${whereStatus}
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Array<{
    id: string;
    cafe_id: string;
    cafe_name: string;
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

  const total = (await sql`
    SELECT count(*)::int AS n FROM cafe_topup_requests r
    JOIN cafes c ON c.id = r.cafe_id
    WHERE TRUE
    ${whereCafe}
    ${whereStatus}
  `) as unknown as { n: number }[];

  return NextResponse.json({ requests: rows, total: total[0]?.n ?? 0 });
}

// Super_admin approve/reject permintaan top-up
export async function PATCH(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }

  let body: { id?: unknown; action?: unknown; rejection_reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "Body bukan JSON." } }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : null;
  if (!id || !action) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "id dan action (approve/reject) wajib." } },
      { status: 400 },
    );
  }

  if (action === "reject") {
    const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
    if (reason.length < 3) {
      return NextResponse.json(
        { error: { code: "INVALID_REASON", message: "Alasan penolakan min. 3 karakter." } },
        { status: 400 },
      );
    }
  }

  try {
    const result = await sql.begin(async (tx: any) => {
      const reqRow = (await tx`
        SELECT id, cafe_id, amount, status FROM cafe_topup_requests WHERE id = ${id} FOR UPDATE
      `) as unknown as Array<{
        id: string;
        cafe_id: string;
        amount: number;
        status: "pending" | "approved" | "rejected";
      }>;

      if (!reqRow[0]) throw new Error("NOT_FOUND");
      if (reqRow[0].status !== "pending") throw new Error("ALREADY_PROCESSED");

      if (action === "approve") {
        // Update request status
        await tx`
          UPDATE cafe_topup_requests
          SET status = 'approved', approved_by = ${auth.user.id}, approved_at = now()
          WHERE id = ${id}
        `;

        // Top-up saldo cafe
        const cafeRow = (await tx`
          SELECT prepaid_token_balance FROM cafes WHERE id = ${reqRow[0].cafe_id} FOR UPDATE
        `) as unknown as { prepaid_token_balance: number }[];
        if (!cafeRow[0]) throw new Error("CAFE_NOT_FOUND");

        const balanceAfter = cafeRow[0].prepaid_token_balance + reqRow[0].amount;
        await tx`UPDATE cafes SET prepaid_token_balance = ${balanceAfter} WHERE id = ${reqRow[0].cafe_id}`;

        // Ledger
        await tx`
          INSERT INTO cafe_token_transactions
            (cafe_id, type, amount, balance_after, reference_type, reference_id, created_by_user_id, note)
          VALUES (${reqRow[0].cafe_id}, 'topup', ${reqRow[0].amount}, ${balanceAfter}, 'topup', ${id}, ${auth.user.id}, 'Top-up via request')
        `;

        // Audit log: fire-and-forget di luar transaksi supaya tidak nge-block response
        void logAudit(auth.user.id, "cafe.topup_approve", "cafe_topup_requests", id, {
          cafe_id: reqRow[0].cafe_id,
          amount: reqRow[0].amount,
          balance_after: balanceAfter,
        });

        return { ok: true, balance_after: balanceAfter };
      } else {
        // Reject
        const reason = (body.rejection_reason as string).trim();
        await tx`
          UPDATE cafe_topup_requests
          SET status = 'rejected', approved_by = ${auth.user.id}, approved_at = now(), rejection_reason = ${reason}
          WHERE id = ${id}
        `;

        // Audit log: fire-and-forget
        void logAudit(auth.user.id, "cafe.topup_reject", "cafe_topup_requests", id, {
          cafe_id: reqRow[0].cafe_id,
          amount: reqRow[0].amount,
          rejection_reason: reason,
        });

        return { ok: true };
      }
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memproses";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Permintaan tidak ditemukan." } }, { status: 404 });
    if (msg === "ALREADY_PROCESSED") return NextResponse.json({ error: { code: "ALREADY_PROCESSED", message: "Permintaan sudah diproses." } }, { status: 409 });
    if (msg === "CAFE_NOT_FOUND") return NextResponse.json({ error: { code: "CAFE_NOT_FOUND", message: "Cafe tidak ditemukan." } }, { status: 404 });
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: msg } }, { status: 500 });
  }
}