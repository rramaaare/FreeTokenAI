// Hak akses per peran + audit log.
// Katalog di bawah = matriks /admin/rbac. Sel `fixed` selalu boleh (dikunci,
// anti-lockout), sel `toggle` bisa dicentang admin dan disimpan di
// role_permissions (baris tidak ada = boleh), selain itu tidak berlaku.
// Guard kasar tetap per peran di tiap endpoint (requireAdmin / requireAuth);
// roleAllows mempersempitnya per fitur.
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export type Role = 'super_admin' | 'kasir' | 'customer';
export const ROLES: Role[] = ['super_admin', 'kasir', 'customer'];

export type PermissionDef = {
  key: string;
  group: 'Admin' | 'Kasir' | 'Pelanggan';
  label: string;
  description: string;
  fixed: Role[];
  toggle: Role[];
};

const ADMIN: Pick<PermissionDef, 'group' | 'fixed' | 'toggle'> = { group: 'Admin', fixed: ['super_admin'], toggle: [] };
const KASIR: Pick<PermissionDef, 'group' | 'fixed' | 'toggle'> = { group: 'Kasir', fixed: ['super_admin'], toggle: ['kasir'] };
const CUSTOMER: Pick<PermissionDef, 'group' | 'fixed' | 'toggle'> = { group: 'Pelanggan', fixed: [], toggle: ['customer'] };

export const PERMISSIONS = [
  { key: 'cafe.manage', label: 'Kelola kafe, tarif & saldo prepaid', description: 'Tambah kafe, atur tarif billing, isi / koreksi saldo kafe.', ...ADMIN },
  { key: 'kasir.crud', label: 'Kelola akun kasir & admin', description: 'Buat, ubah, nonaktifkan akun; tambah saldo pelanggan manual.', ...ADMIN },
  { key: 'package.manage', label: 'Master paket token', description: 'Paket global / per kafe untuk kasir.', ...ADMIN },
  { key: 'tx.view', label: 'Dashboard & riwayat transaksi semua kafe', description: 'Ledger saldo kafe seluruh sistem.', ...ADMIN },
  { key: 'apikey.manage', label: 'Pantau & cabut API key pelanggan', description: 'Daftar key Developer pelanggan dan pencabutannya.', ...ADMIN },
  { key: 'model.manage', label: 'Provider AI & model', description: 'API key provider (terenkripsi), katalog model & biaya Token.', ...ADMIN },

  { key: 'receipt.product', label: 'Buat struk Beli Produk', description: 'Bonus token dari total belanja.', ...KASIR },
  { key: 'receipt.retail', label: 'Buat struk Beli Token Ketengan', description: 'Jual token satuan sesuai tarif kafe.', ...KASIR },
  { key: 'receipt.package', label: 'Buat struk dari Paket', description: 'Jual paket token dari Master Paket.', ...KASIR },
  { key: 'receipt.view', label: 'Cek status & daftar struk', description: 'Lihat status klaim dan cetak ulang struk kafe sendiri.', ...KASIR },
  { key: 'kasir.dashboard', label: 'Dashboard penjualan kafe', description: 'Ringkasan penjualan struk & saldo kafe sendiri.', ...KASIR },

  { key: 'ai.chat', label: 'Chat AI', description: 'Memakai chat di dashboard.', ...CUSTOMER },
  { key: 'ai.image', label: 'Generate gambar', description: 'Membuat gambar dari teks.', ...CUSTOMER },
  { key: 'ai.video', label: 'Generate video', description: 'Membuat video dari teks / gambar.', ...CUSTOMER },
  { key: 'ai.developer', label: 'Developer API', description: 'Membuat API key sendiri dan memanggil gateway AI.', ...CUSTOMER },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const BY_KEY = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.key, p]));

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

export function isToggleable(role: unknown, key: unknown): role is Role {
  return isRole(role) && typeof key === 'string' && (BY_KEY.get(key)?.toggle.includes(role) ?? false);
}

/** Matriks efektif: role -> key -> boleh. */
export async function roleMatrix(): Promise<Record<Role, Record<string, boolean>>> {
  const out = {} as Record<Role, Record<string, boolean>>;
  for (const role of ROLES) {
    out[role] = {};
    for (const p of PERMISSIONS) out[role][p.key] = (p.fixed as readonly Role[]).includes(role) || (p.toggle as readonly Role[]).includes(role);
  }
  const rows = (await sql`SELECT role, permission_key, allowed FROM role_permissions`) as unknown as {
    role: string;
    permission_key: string;
    allowed: boolean;
  }[];
  for (const r of rows) if (isToggleable(r.role, r.permission_key)) out[r.role][r.permission_key] = r.allowed;
  return out;
}

export async function roleAllows(role: string, key: PermissionKey): Promise<boolean> {
  const def = BY_KEY.get(key);
  if (!def || !isRole(role)) return false;
  if (def.fixed.includes(role)) return true;
  if (!def.toggle.includes(role)) return false;
  const rows = (await sql`
    SELECT allowed FROM role_permissions WHERE role = ${role} AND permission_key = ${key} LIMIT 1`) as unknown as {
    allowed: boolean;
  }[];
  return rows[0]?.allowed ?? true;
}

/** 403 bila fitur dimatikan untuk peran ini; null bila boleh. */
export async function permissionDenied(
  role: string,
  key: PermissionKey,
  headers?: HeadersInit,
): Promise<NextResponse | null> {
  if (await roleAllows(role, key)) return null;
  return NextResponse.json(
    { error: { code: 'PERMISSION_DENIED', message: `Akses "${BY_KEY.get(key)?.label}" dinonaktifkan admin.` } },
    { status: 403, headers },
  );
}

export async function logAudit(
  actorUserId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail: Record<string, unknown> = {},
) {
  try {
    await sql`
      INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, detail)
      VALUES (${actorUserId}, ${action}, ${targetType}, ${targetId}, ${JSON.stringify(detail)}::jsonb)`;
  } catch {
    // audit tidak boleh menggagalkan aksi utama
  }
}
