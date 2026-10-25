import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';

// Pemantauan API key Developer milik pelanggan (dibuat sendiri di /dashboard/developer).
// Pemakaian key memotong saldo workspace pemiliknya; admin bisa mencabut key
// yang disalahgunakan lewat POST /api/v1/admin/api-keys/:id/revoke.
// Filter: ?status=active|revoked, ?q=<prefix / nama key / pemilik / cafe>.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') {
    const status = auth === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Hanya super_admin.' } }, { status });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status')?.trim() ?? '';
  const q = searchParams.get('q')?.trim() ?? '';
  const like = `%${q}%`;

  try {
    const rows = (await sql`
      SELECT
        k.id, k.key_prefix, k.name, k.is_active, k.revoked_at, k.revoked_reason, k.created_at,
        COALESCE(u.name, u.email, u.phone_number) AS owner,
        COALESCE(u.email, u.phone_number) AS owner_contact,
        c.name AS cafe_name,
        w.token_balance,
        w.expires_at AS workspace_expires_at,
        usage.requests_30d, usage.tokens_30d, usage.last_used_at
      FROM api_keys k
      LEFT JOIN workspaces w ON w.id = k.workspace_id
      LEFT JOIN users u ON u.id = w.user_id
      LEFT JOIN cafes c ON c.id = COALESCE(w.cafe_id, k.cafe_id)
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS requests_30d,
               COALESCE(SUM(ul.tokens_burned), 0)::int AS tokens_30d,
               MAX(ul.created_at) AS last_used_at
        FROM usage_logs ul
        WHERE ul.api_key_id = k.id AND ul.status = 'success' AND ul.created_at >= now() - interval '30 days'
      ) usage ON TRUE
      WHERE k.workspace_id IS NOT NULL
        AND (${q} = '' OR k.key_prefix ILIKE ${like} OR k.name ILIKE ${like}
             OR u.name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone_number ILIKE ${like} OR c.name ILIKE ${like})
        AND (${statusFilter} = ''
             OR (${statusFilter} = 'active' AND k.is_active AND k.revoked_at IS NULL)
             OR (${statusFilter} = 'revoked' AND (NOT k.is_active OR k.revoked_at IS NOT NULL)))
      ORDER BY k.created_at DESC
      LIMIT 200`) as unknown as Array<{
      id: string;
      key_prefix: string;
      name: string | null;
      is_active: boolean;
      revoked_at: string | null;
      revoked_reason: string | null;
      created_at: string;
      owner: string | null;
      owner_contact: string | null;
      cafe_name: string | null;
      token_balance: number | null;
      workspace_expires_at: string | null;
      requests_30d: number;
      tokens_30d: number;
      last_used_at: string | null;
    }>;

    const keys = rows.map((r) => ({ ...r, status: r.is_active && !r.revoked_at ? 'active' : 'revoked' }));
    return NextResponse.json({ keys, total: keys.length });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: e instanceof Error ? e.message : 'Gagal memuat' } },
      { status: 500 },
    );
  }
}
