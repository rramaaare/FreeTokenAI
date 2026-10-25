'use client';

import { useState, useEffect } from 'react';
import { Package, Loader2, Plus, X, Pencil, Trash2 } from 'lucide-react';
import { Alert, EmptyState, Loading, PageHeader, Badge } from '@/components/admin/ui';

type PackageRow = {
  id: string;
  cafe_id: string | null;
  name: string;
  rupiah_amount: number;
  tokens_granted: number;
  is_active: boolean;
  sort_order: number;
  default_expires_days: number;
  max_expires_days: number;
};

type Cafe = { id: string; name: string };

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    rupiah_amount: 10000,
    tokens_granted: 1500,
    cafe_id: '',
    is_active: true,
    sort_order: 0,
    default_expires_days: 30,
    max_expires_days: 90,
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [resPkg, resCafe] = await Promise.all([
        fetch('/api/v1/admin/token-packages', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/v1/admin/cafes', { credentials: 'include', cache: 'no-store' }),
      ]);
      const dataPkg = await resPkg.json();
      if (!resPkg.ok) throw new Error(dataPkg?.error?.message ?? 'Gagal memuat');
      setPackages(dataPkg.packages || []);
      if (resCafe.ok) {
        const dataCafe = await resCafe.json();
        setCafes(dataCafe.cafes || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }

  function showNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', rupiah_amount: 10000, tokens_granted: 1500, cafe_id: '', is_active: true, sort_order: 0, default_expires_days: 30, max_expires_days: 90 });
    setModalOpen(true);
  }

  function openEdit(p: PackageRow) {
    setEditing(p);
    setForm({
      name: p.name,
      rupiah_amount: p.rupiah_amount,
      tokens_granted: p.tokens_granted,
      cafe_id: p.cafe_id || '',
      is_active: p.is_active,
      sort_order: p.sort_order,
      default_expires_days: p.default_expires_days,
      max_expires_days: p.max_expires_days,
    });
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        rupiah_amount: form.rupiah_amount,
        tokens_granted: form.tokens_granted,
        cafe_id: form.cafe_id || null,
        is_active: form.is_active,
        sort_order: form.sort_order,
        default_expires_days: form.default_expires_days,
        max_expires_days: form.max_expires_days,
      };
      const url = editing ? `/api/v1/admin/token-packages/${editing.id}` : '/api/v1/admin/token-packages';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal menyimpan');
      showNotice(editing ? 'Paket diperbarui.' : 'Paket dibuat.');
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(p: PackageRow) {
    if (!confirm(`Nonaktifkan paket "${p.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/admin/token-packages/${p.id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal');
      showNotice('Paket dinonaktifkan.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Master Paket Kuota"
        description="Paket token yang dijual kasir sebagai “paket hemat”. Global = berlaku di semua kafe; pilih kafe = hanya kafe itu."
        icon={<Package size={22} className="text-primary" />}
        action={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover"
          >
            <Plus size={16} />
            Tambah Paket
          </button>
        }
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
        {loading ? (
          <Loading label="Memuat paket..." />
        ) : packages.length === 0 ? (
          <EmptyState title="Belum ada paket" description="Tambahkan paket pertama untuk mulai menjual kuota token." icon={<Package size={32} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400 text-xs uppercase border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama</th>
                  <th className="px-4 py-3 font-semibold">Harga (Rp)</th>
                  <th className="px-4 py-3 font-semibold">Token</th>
                  <th className="px-4 py-3 font-semibold">Cafe</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {packages.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-700/30 transition">
                    <td className="px-4 py-3.5 font-medium text-neutral-900 dark:text-white">{p.name}</td>
                    <td className="px-4 py-3.5 text-xs">{p.rupiah_amount.toLocaleString('id-ID')}</td>
                    <td className="px-4 py-3.5 text-xs">{p.tokens_granted.toLocaleString('id-ID')}</td>
                    <td className="px-4 py-3.5 text-xs">{p.cafe_id ? (cafes.find((c) => c.id === p.cafe_id)?.name || '-') : 'Global'}</td>
                    <td className="px-4 py-3.5">
                      <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => openEdit(p)} title="Edit" className="p-1.5 rounded-lg text-neutral-500 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-700 transition">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(p)} title="Nonaktifkan" className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
              <h2 className="font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Package size={18} className="text-primary" />
                {editing ? 'Edit Paket' : 'Tambah Paket'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Nama Paket</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Harga (Rp)</label>
                  <input type="number" min={1} value={form.rupiah_amount} onChange={(e) => setForm({ ...form, rupiah_amount: Number(e.target.value) })} required className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Token</label>
                  <input type="number" min={1} value={form.tokens_granted} onChange={(e) => setForm({ ...form, tokens_granted: Number(e.target.value) })} required className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary" />
                </div>
              </div>
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-900/50">
                {form.rupiah_amount > 0 && form.tokens_granted > 0
                  ? `Rp ${form.rupiah_amount.toLocaleString('id-ID')} → ${form.tokens_granted.toLocaleString('id-ID')} token (Rp ${(form.rupiah_amount / form.tokens_granted).toFixed(2)}/token)`
                  : 'Isi harga dan token untuk melihat rasio.'}
              </p>
              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Cafe (kosong = global)</label>
                <select value={form.cafe_id} onChange={(e) => setForm({ ...form, cafe_id: e.target.value })} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary">
                  <option value="">Global (semua cafe)</option>
                  {cafes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">Sort Order</label>
                  <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-neutral-900 dark:text-white outline-none focus:border-primary" />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 rounded border-neutral-300 text-primary focus:ring-primary" />
                    Aktif
                  </label>
                </div>
              </div>
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-neutral-700">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition">Batal</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 transition flex items-center gap-2">
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}