import { NextResponse } from "next/server";
import { extendedExpiry } from "@/lib/billing";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/permissions";

const MAX_TOPUP = 100_000;

// Top-up saldo Token langsung ke workspace customer oleh super_admin.
// Dipakai supaya user bisa lanjut memakai AI tanpa logout / ganti akun.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }

  const { id } = await params;

  let body: { amount?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Body bukan JSON." } },
      { status: 400 },
    );
  }

  const amount =
    typeof body.amount === "number" && Number.isInteger(body.amount) ? body.amount : NaN;
  if (!(amount >= 1 && amount <= MAX_TOPUP)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_AMOUNT",
          message: `Jumlah top-up harus angka 1-${MAX_TOPUP}.`,
        },
      },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";

  try {
    const result = await sql.begin(async (tx: any) => {
      // Lock user supaya dua top-up paralel tidak membuat dua workspace.
      const user = (await tx`
        SELECT id FROM users WHERE id = ${id} FOR UPDATE`) as unknown as Array<{ id: string }>;
      if (!user[0]) throw new Error("USER_NOT_FOUND");

      let ws = (await tx`
        SELECT id, token_balance, cafe_id FROM workspaces
        WHERE user_id = ${id}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`) as unknown as Array<{
        id: string;
        token_balance: number;
        cafe_id: string | null;
      }>;

      if (!ws[0]) {
        ws = (await tx`
          INSERT INTO workspaces (user_id, token_balance, expires_at)
          VALUES (${id}, ${amount}, now() + interval '7 days')
          RETURNING id, token_balance, cafe_id`) as unknown as Array<{
          id: string;
          token_balance: number;
          cafe_id: string | null;
        }>;
      } else {
        ws = (await tx`
          UPDATE workspaces
          SET token_balance = token_balance + ${amount},
              expires_at = ${extendedExpiry()}
          WHERE id = ${ws[0].id}
          RETURNING id, token_balance, cafe_id`) as unknown as Array<{
          id: string;
          token_balance: number;
          cafe_id: string | null;
        }>;
      }

      const wsId = ws[0].id;
      const balanceAfter = ws[0].token_balance;
      const inserted = (await tx`
        INSERT INTO token_transactions
          (workspace_id, type, amount, balance_after, reference_type, reference_id, cafe_id)
        VALUES (${wsId}, 'grant', ${amount}, ${balanceAfter}, NULL, NULL, ${ws[0].cafe_id})
        RETURNING id, type, amount, balance_after, created_at`) as unknown as Array<{
        id: string;
        type: string;
        amount: number;
        balance_after: number;
        created_at: string;
      }>;

      return {
        workspace_id: wsId,
        token_balance: balanceAfter,
        transaction: inserted[0],
      };
    });

    await logAudit(auth.user.id, "user.balance_topup", "users", id, {
      amount,
      note,
      balance_after: result.token_balance,
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menyimpan saldo";
    if (msg === "USER_NOT_FOUND")
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Pengguna tidak ditemukan." } },
        { status: 404 },
      );
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: msg } },
      { status: 500 },
    );
  }
}
