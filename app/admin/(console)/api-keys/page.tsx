'use client';

import { useState, useEffect } from 'react';
import { KeyRound, Loader2, Search, Ban, Wallet, AlertTriangle, Activity } from 'lucide-react';
import { Alert, EmptyState, Loading, PageHeader, StatCard } from '@/components/admin/ui';

type KeyRow = {
  id: string;
  key_prefix: string;
  name: string | null;
  is_active: boolean;
  status: 'active' | 'revoked';
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  owner: string | null;
  owner_contact: string | null;
  cafe_name: string | null;
  token_balance: number | null;
  requests_30d: number;
  tokens_30d: number;
  last_used_at: string | null;
};

const STATUS_LABEL: Record<KeyRow['status'], { label: string; cls: string }> = {
  active: { label: 'Aktif', cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  revoked: { label: 'Dicabut', cls: 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 border-neutral-300 dark:border-neutral-600' },
};

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('id-ID');

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null);

  useEffect(() => {
    load();
  }, [statusFilter]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('q', search);
      const res = await fetch(`/api/v1/admin/api-keys?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memuat');
      setKeys(data.keys || []);
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

  async function handleRevoke() {
    if (!revokeTarget) return;
    if (revokeReason.trim().length < 3) {
      setError('Alasan revoke wajib diisi minimal 3 karakter.');
      return;
    }
    setError('');
    setRevoking(revokeTarget.id);
    setError('');
    try {
      const res = await fetch(`/api/v1/admin/api-keys/${revokeTarget.id}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: revokeReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal revoke');
      setKeys((prev) => prev.map((k) => (k.id === revokeTarget.id ? { ...k, status: 'revoked', is_active: false, revoked_at: new Date().toISOString(), revoked_reason: revokeReason || null } : k)));
      showNotice(`API key ${revokeTarget.key_prefix} dicabut.`);
      setRevokeTarget(null);
      setRevokeReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal revoke');
    } finally {
      setRevoking(null);
    }
  }

  const filtered = keys;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="API Key Pelanggan"
        description="Key Developer API yang dibuat pelanggan sendiri. Pemakaiannya memotong saldo Token pemilik key. Cabut bila disalahgunakan."
        icon={<KeyRound size={22} className="text-primary" />}
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Key" value={keys.length.toLocaleString('id-ID')} icon={<KeyRound size={16} />} tone="primary" />
        <StatCard label="Aktif" value={keys.filter((k) => k.status === 'active').length.toLocaleString('id-ID')} icon={<Activity size={16} />} tone="success" />
        <StatCard label="Request 30 Hari" value={n(keys.reduce((s, k) => s + k.requests_30d, 0))} icon={<AlertTriangle size={16} />} tone="warning" />
        <StatCard label="Token Terpakai 30 Hari" value={n(keys.reduce((s, k) => s + k.tokens_30d, 0))} icon={<Wallet size={16} />} tone="neutral" />
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-neutral-800 p-3 rounded-xl border border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: '', label: 'Semua' },
            { id: 'active', label: 'Aktif' },
            { id: 'revoked', label: 'Dicabut' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                statusFilter === tab.id ? 'bg-primary text-white' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Cari prefix, nama key, pemilik, cafe..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-white placeholder:text-neutral-400 outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
        {loading ? (
          <Loading label="Memuat API key..." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Tidak ada API key" description="Key yang dibuat pelanggan di halaman Developer API akan tampil di sini." icon={<KeyRound size={32} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400 text-xs uppercase border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Key</th>
                  <th className="px-4 py-3 font-semibold">Pemilik</th>
                  <th className="px-4 py-3 font-semibold">Saldo Pemilik</th>
                  <th className="px-4 py-3 font-semibold">Pemakaian 30 Hari</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {filtered.map((k) => {
                  const s = STATUS_LABEL[k.status];
                  return (
                    <tr key={k.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-700/30 transition">
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-mono">{k.key_prefix}…</div>
                        <div className="text-neutral-400">{k.name || '-'}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <div>{k.owner || '-'}</div>
                        <div className="text-neutral-400">{k.cafe_name ? `via ${k.cafe_name}` : ''}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs tabular-nums">{n(k.token_balance)} token</td>
                      <td className="px-4 py-3.5 text-xs tabular-nums">
                        <div>{n(k.requests_30d)} request · {n(k.tokens_30d)} token</div>
                        <div className="text-neutral-400">
                          {k.last_used_at ? `terakhir ${new Date(k.last_used_at).toLocaleString('id-ID')}` : 'belum dipakai'}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {k.status === 'active' && (
                          <button
                            onClick={() => { setRevokeTarget(k); setRevokeReason(''); }}
                            title="Revoke API Key"
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                          >
                            <Ban size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {revokeTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl p-5 space-y-4">
            <h3 className="font-bold text-neutral-900 dark:text-white">Cabut API Key</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Key <strong>{revokeTarget.key_prefix}…</strong> akan dicabut dan tidak bisa dipakai lagi.
            </p>
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Alasan <span className="text-red-500">*</span> <span className="font-normal text-neutral-400">(min. 3 karakter, tercatat di audit log)</span>
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                rows={3}
                minLength={3}
                maxLength={200}
                placeholder="Contoh: key bocor ke publik"
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleRevoke}
                disabled={revoking === revokeTarget.id || revokeReason.trim().length < 3}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {revoking === revokeTarget.id && <Loader2 size={14} className="animate-spin" />}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}