import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { logAudit } from '@/lib/permissions';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') {
    const status = auth === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Hanya super_admin.' } }, { status });
  }

  let body: { reason?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // reason opsional
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  try {
    const existing = (await sql`
      SELECT id, revoked_at, key_prefix FROM api_keys WHERE id = ${id} LIMIT 1`) as unknown as Array<{
      id: string;
      revoked_at: string | null;
      key_prefix: string;
    }>;
    if (!existing[0]) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'API key tidak ditemukan.' } }, { status: 404 });
    }
    if (existing[0].revoked_at) {
      return NextResponse.json({ error: { code: 'ALREADY_REVOKED', message: 'API key sudah di-revoke.' } }, { status: 409 });
    }

    await sql`
      UPDATE api_keys
      SET is_active = FALSE,
          revoked_at = now(),
          revoked_by = ${auth.user.id},
          revoked_reason = ${reason || null}
      WHERE id = ${id}`;

    await logAudit(auth.user.id, 'apikey.revoke', 'api_keys', id, { reason, key_prefix: existing[0].key_prefix });

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: e instanceof Error ? e.message : 'Gagal revoke.' } },
      { status: 500 },
    );
  }
}