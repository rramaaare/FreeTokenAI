'use client';

import { useEffect, useState } from 'react';
import { Check, Lock, Minus, ShieldCheck } from 'lucide-react';
import { Alert, Loading, PageHeader, cardCls } from '@/components/admin/ui';

type Role = 'super_admin' | 'kasir' | 'customer';
type PermissionDef = { key: string; group: string; label: string; description: string; fixed: Role[]; toggle: Role[] };
type Matrix = Record<Role, Record<string, boolean>>;

const ROLES: { id: Role; label: string; where: string }[] = [
  { id: 'super_admin', label: 'Super Admin', where: '/admin' },
  { id: 'kasir', label: 'Kasir', where: '/kasir' },
  { id: 'customer', label: 'Pelanggan', where: '/dashboard' },
];

export default function AdminRbacPage() {
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [roles, setRoles] = useState<Matrix | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/v1/admin/rbac', { credentials: 'include', cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memuat');
        setCatalog(data.catalog);
        setRoles(data.roles);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Gagal memuat');
      }
    })();
  }, []);

  async function toggle(role: Role, key: string, allowed: boolean) {
    setSaving(`${role}:${key}`);
    setError('');
    try {
      const res = await fetch('/api/v1/admin/rbac', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ changes: [{ role, permission_key: key, allowed }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal menyimpan');
      setRoles(data.roles);
      setNotice('Hak akses diperbarui.');
      setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSaving(null);
    }
  }

  const groups = [...new Set(catalog.map((p) => p.group))];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Peran & Hak Akses"
        description="Centang / hapus centang untuk membuka atau menutup fitur per peran. Berlaku langsung dan ditegakkan di server."
        icon={<ShieldCheck size={22} className="text-primary" />}
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className={`${cardCls} overflow-x-auto`}>
        {!roles ? (
          <Loading label="Memuat hak akses..." />
        ) : (
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Fitur</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="w-28 px-4 py-3 text-center font-semibold">
                    {r.label}
                    <div className="font-mono text-[10px] font-normal normal-case text-neutral-400">{r.where}</div>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g} className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                <tr className="bg-neutral-50/60 dark:bg-neutral-900/30">
                  <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {g}
                  </td>
                </tr>
                {catalog
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <tr key={p.key}>
                      <td className="px-4 py-3">
                        <div className="text-neutral-800 dark:text-neutral-100">{p.label}</div>
                        <div className="text-[11px] text-neutral-400">{p.description}</div>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r.id} className="px-4 py-3 text-center">
                          {p.fixed.includes(r.id) ? (
                            <span className="inline-flex items-center gap-1 text-primary" title="Selalu aktif (tidak bisa dicabut)">
                              <Check size={16} strokeWidth={3} />
                              <Lock size={11} />
                            </span>
                          ) : p.toggle.includes(r.id) ? (
                            <input
                              type="checkbox"
                              checked={roles[r.id]?.[p.key] ?? false}
                              disabled={saving === `${r.id}:${p.key}`}
                              onChange={(e) => toggle(r.id, p.key, e.target.checked)}
                              className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label={`${p.label} untuk ${r.label}`}
                            />
                          ) : (
                            <Minus size={16} className="mx-auto text-neutral-300 dark:text-neutral-600" aria-label="tidak berlaku" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        )}
      </div>

      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        <Check size={11} className="inline" /> <Lock size={10} className="inline" /> = selalu aktif agar admin tidak terkunci.
        &nbsp;— = tidak berlaku untuk peran itu. Kasir tetap hanya bisa mengakses data kafenya sendiri.
      </p>
    </div>
  );
}
