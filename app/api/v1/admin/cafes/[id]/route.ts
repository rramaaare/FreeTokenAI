import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sweepExpiredReceipts } from '@/lib/receipts';
import { requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/permissions';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') {
    const status = auth === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Hanya super_admin.' } }, { status });
  }

  const { id } = await params;

  try {
    // token struk kedaluwarsa kembali ke saldo cafe sebelum saldo ditampilkan.
    await sweepExpiredReceipts(id);
    const cafe = (await sql`
      SELECT
        c.id,
        c.name,
        c.is_active,
        c.prepaid_token_balance::int AS token_balance,
        c.retail_rupiah_per_token,
        c.bonus_rupiah_per_token,
        COALESCE((SELECT SUM(amount) FROM cafe_token_transactions WHERE cafe_id = c.id AND amount > 0), 0)::int AS total_topup,
        COALESCE((SELECT SUM(-amount) FROM cafe_token_transactions WHERE cafe_id = c.id AND amount < 0), 0)::int AS total_used,
        (SELECT MAX(created_at) FROM cafe_token_transactions WHERE cafe_id = c.id) AS last_activity_at,
        (SELECT MAX(expires_at) FROM workspaces WHERE cafe_id = c.id) AS expires_at
      FROM cafes c WHERE c.id = ${id} LIMIT 1`) as unknown as {
      id: string; name: string; is_active: boolean; token_balance: number;
      retail_rupiah_per_token: number; bonus_rupiah_per_token: number; total_topup: number;
      total_used: number; last_activity_at: string | null; expires_at: string | null;
    }[];

    if (!cafe[0]) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Cafe tidak ditemukan' } }, { status: 404 });

    const workspaces = (await sql`
      SELECT w.id, COALESCE(u.name, 'Workspace ' || left(w.id::text, 8)) AS name, w.token_balance, w.expires_at
      FROM workspaces w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.cafe_id = ${id} ORDER BY w.created_at`) as unknown as {
      id: string; name: string; token_balance: number; expires_at: string | null;
    }[];

    const wsIds = workspaces.map(w => w.id);

    let usageByEndpoint: { endpoint_type: string; tokens_burned: number; count: number }[] = [];
    let usageByDay: { day: string; tokens_burned: number; count: number }[] = [];

    if (wsIds.length > 0) {
      usageByEndpoint = (await sql`
        SELECT endpoint_type, SUM(tokens_burned) as tokens_burned, COUNT(*) as count
        FROM usage_logs
        WHERE workspace_id = ANY(${wsIds}) AND status = 'success'
        GROUP BY endpoint_type
        ORDER BY tokens_burned DESC`) as unknown as { endpoint_type: string; tokens_burned: number; count: number }[];

      usageByDay = (await sql`
        SELECT DATE(created_at) as day, SUM(tokens_burned) as tokens_burned, COUNT(*) as count
        FROM usage_logs
        WHERE workspace_id = ANY(${wsIds}) AND status = 'success'
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 30`) as unknown as { day: string; tokens_burned: number; count: number }[];
    }

    const transactions = (await sql`
      SELECT t.id, t.type, t.amount, t.balance_after, t.reference_type, t.note, t.created_at,
             COALESCE(u.name, u.email) AS created_by
      FROM cafe_token_transactions t
      LEFT JOIN users u ON u.id = t.created_by_user_id
      WHERE t.cafe_id = ${id}
      ORDER BY t.created_at DESC
      LIMIT 20`) as unknown as {
      id: string; type: string; amount: number; balance_after: number; reference_type: string | null;
      note: string | null; created_at: string; created_by: string | null;
    }[];

    return NextResponse.json({
      cafe: cafe[0],
      workspaces,
      transactions,
      usage: { byEndpoint: usageByEndpoint, byDay: usageByDay },
    });
  } catch (e) {
    return NextResponse.json({ error: { code: 'SERVER_ERROR', message: 'Gagal memuat detail cafe' } }, { status: 500 });
  }
}

// ponytail: ubah tarif billing kasir per cafe (super_admin saja).
//   retail_rupiah_per_token = harga 1 token ketengan
//   bonus_rupiah_per_token  = tiap kelipatan Rp belanja produk = 1 token bonus
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') {
    const status = auth === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Hanya super_admin.' } }, { status });
  }
  const { id } = await params;

  let body: { retail_rupiah_per_token?: unknown; bonus_rupiah_per_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Body bukan JSON.' } }, { status: 400 });
  }
  const rate = (v: unknown) => {
    const x = Number(v);
    return Number.isInteger(x) && x >= 1 && x <= 10_000_000 ? x : null;
  };
  const retail = rate(body.retail_rupiah_per_token);
  const bonus = rate(body.bonus_rupiah_per_token);
  if (retail === null || bonus === null)
    return NextResponse.json(
      { error: { code: 'INVALID_RATE', message: 'Tarif wajib angka bulat Rp1–Rp10.000.000.' } },
      { status: 400 },
    );

  const rows = (await sql`
    UPDATE cafes SET retail_rupiah_per_token = ${retail}, bonus_rupiah_per_token = ${bonus}, updated_at = now()
    WHERE id = ${id}
    RETURNING retail_rupiah_per_token, bonus_rupiah_per_token`) as unknown as {
    retail_rupiah_per_token: number; bonus_rupiah_per_token: number;
  }[];
  if (!rows[0]) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Cafe tidak ditemukan' } }, { status: 404 });
  await logAudit(auth.user.id, 'cafe.pricing_update', 'cafes', id, rows[0]);
  return NextResponse.json(rows[0]);
}
