import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PERMISSIONS, isToggleable, logAudit, roleMatrix } from '@/lib/permissions';

function forbidden(auth: string) {
  return NextResponse.json(
    { error: { code: 'FORBIDDEN', message: 'Hanya super_admin.' } },
    { status: auth === 'unauthorized' ? 401 : 403 },
  );
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') return forbidden(auth);
  return NextResponse.json({ catalog: PERMISSIONS, roles: await roleMatrix() });
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin(req, { roles: ['super_admin'] });
  if (typeof auth === 'string') return forbidden(auth);

  let body: { changes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Body bukan JSON.' } }, { status: 400 });
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0)
    return NextResponse.json({ error: { code: 'NO_CHANGES', message: 'Tidak ada perubahan yang dikirim.' } }, { status: 400 });

  const changes: { role: string; permission_key: string; allowed: boolean }[] = [];
  for (const item of body.changes as { role?: unknown; permission_key?: unknown; allowed?: unknown }[]) {
    if (!isToggleable(item.role, item.permission_key) || typeof item.allowed !== 'boolean')
      return NextResponse.json(
        { error: { code: 'INVALID_CHANGE', message: 'Izin tidak dikenal atau tidak bisa diubah untuk peran ini.' } },
        { status: 400 },
      );
    changes.push({ role: item.role, permission_key: item.permission_key as string, allowed: item.allowed });
  }

  await sql.begin(async (tx: any) => {
    for (const c of changes) {
      await tx`
        INSERT INTO role_permissions (role, permission_key, allowed, updated_at)
        VALUES (${c.role}, ${c.permission_key}, ${c.allowed}, now())
        ON CONFLICT (role, permission_key)
        DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()`;
    }
  });
  await logAudit(auth.user.id, 'rbac.update', 'role_permissions', null, { changes });

  return NextResponse.json({ ok: true, roles: await roleMatrix() });
}
