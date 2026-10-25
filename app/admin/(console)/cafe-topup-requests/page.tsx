'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, RefreshCw, Filter } from 'lucide-react';
import { PageHeader, Alert, EmptyState, Loading, cardCls, inputCls } from '@/components/admin/ui';

const btnCls = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50";

type TopUpRequest = {
  id: string;
  cafe_id: string;
  cafe_name: string;
  requested_by: string;
  amount: number;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  approved_by_name: string | null;
};

const n = (v: number) => v.toLocaleString('id-ID');
const dt = (v: string | null) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATUS_CONFIG: Record<TopUpRequest['status'], { label: string; cls: string }> = {
  pending: { label: 'Menunggu', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
  approved: { label: 'Disetujui', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  rejected: { label: 'Ditolak', cls: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border-red-200 dark:border-red-800' },
};

export default function AdminCafeTopupRequestsPage() {
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TopUpRequest['status']>('all');
  const [cafeFilter, setCafeFilter] = useState<string>('all');
  const [cafes, setCafes] = useState<{ id: string; name: string }[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TopUpRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (cafeFilter !== 'all') params.set('cafe_id', cafeFilter);
      params.set('limit', '200');
      const res = await fetch(`/api/v1/admin/cafe-topup-requests?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memuat');
      setRequests(data.requests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, cafeFilter]);

  const loadCafes = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/admin/cafes', { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setCafes(data.cafes ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
    loadCafes();
  }, [load, loadCafes]);

  function showNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  }

  async function handleAction(id: string, action: 'approve' | 'reject') {
    if (action === 'reject') {
      setRejectTarget(requests.find((r) => r.id === id) ?? null);
      setRejectReason('');
      return;
    }
    setProcessing(id);
    setError('');
    try {
      const res = await fetch('/api/v1/admin/cafe-topup-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memproses');
      showNotice(`Permintaan ${action === 'approve' ? 'disetujui' : 'ditolak'}.`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses');
    } finally {
      setProcessing(null);
    }
  }

  async function handleRejectConfirm() {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      setError('Alasan penolakan min. 3 karakter.');
      return;
    }
    setError('');
    setProcessing(rejectTarget.id);
    try {
      const res = await fetch('/api/v1/admin/cafe-topup-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: rejectTarget.id, action: 'reject', rejection_reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal menolak');
      showNotice('Permintaan ditolak.');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menolak');
    } finally {
      setProcessing(null);
    }
  }

  const filtered = requests.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.cafe_name.toLowerCase().includes(q) &&
          !(r.requested_by_name?.toLowerCase().includes(q)) &&
          !(r.requested_by_email?.toLowerCase().includes(q)) &&
          !n(r.amount).includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Permintaan Top-up Cafe"
        description="Kelola permintaan top-up saldo prepaid dari kasir. Setujui untuk menambah saldo cafe."
        icon={<Filter size={22} className="text-primary" />}
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className={cardCls}>
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  placeholder="Cari cafe, kasir, email, jumlah..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={inputCls}
                />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={`${inputCls} w-full sm:w-auto`}>
                <option value="all">Semua Status</option>
                <option value="pending">Menunggu</option>
                <option value="approved">Disetujui</option>
                <option value="rejected">Ditolak</option>
              </select>
              <select value={cafeFilter} onChange={(e) => setCafeFilter(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
                <option value="all">Semua Cafe</option>
                {cafes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button onClick={load} disabled={loading} className={`${btnCls} whitespace-nowrap shrink-0`}>
              <RefreshCw size={16} className={loading ? 'animate-spin mr-1' : 'mr-1'} />
              Muat Ulang
            </button>
          </div>
        </div>
        {loading ? (
          <Loading label="Memuat permintaan..." />
        ) : filtered.length === 0 ? (
          <EmptyState title="Tidak ada permintaan" description="Permintaan top-up dari kasir akan muncul di sini." icon={<Filter size={32} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-neutral-500 dark:text-neutral-400 text-xs uppercase border-b border-neutral-200 dark:border-neutral-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cafe</th>
                  <th className="px-4 py-3 font-semibold">Kasir</th>
                  <th className="px-4 py-3 font-semibold text-right">Jumlah</th>
                  <th className="px-4 py-3 font-semibold">Catatan</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Dibuat</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {filtered.map((r) => {
                  const s = STATUS_CONFIG[r.status];
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-700/30 transition">
                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-medium text-neutral-900 dark:text-white">{r.cafe_name}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <div>{r.requested_by_name || '—'}</div>
                        <div className="text-neutral-400">{r.requested_by_email || '—'}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs tabular-nums text-right font-medium">
                        +{n(r.amount)} token
                      </td>
                      <td className="px-4 py-3.5 text-xs text-neutral-500 dark:text-neutral-400 max-w-xs truncate">
                        {r.note || '—'}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                        {dt(r.created_at)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {r.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleAction(r.id, 'approve')}
                              disabled={processing === r.id}
                              title="Setujui"
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button
                              onClick={() => handleAction(r.id, 'reject')}
                              disabled={processing === r.id}
                              title="Tolak"
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                            >
                              <XCircle size={16} />
                            </button>
                            {processing === r.id && <Loader2 size={16} className="animate-spin text-neutral-400" />}
                          </div>
                        )}
                        {r.status !== 'pending' && (
                          <div className="text-xs text-neutral-400 text-right">
                            <div>Oleh: {r.approved_by_name || '—'}</div>
                            <div>{dt(r.approved_at)}</div>
                          </div>
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

      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-neutral-800 rounded-2xl max-w-md w-full border border-neutral-200 dark:border-neutral-700 shadow-xl p-5 space-y-4">
            <h3 className="font-bold text-neutral-900 dark:text-white">Tolak Permintaan Top-up</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              Cafe: <strong>{rejectTarget.cafe_name}</strong> — Jumlah: <strong>+{n(rejectTarget.amount)} token</strong>
            </p>
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Alasan penolakan <span className="text-red-500">*</span> <span className="font-normal text-neutral-400">(min. 3 karakter)</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                minLength={3}
                maxLength={200}
                placeholder="Contoh: Budget tidak cukup, tunggu persetujuan manajer..."
                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-white outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition text-sm"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={processing === rejectTarget.id || rejectReason.trim().length < 3}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {processing === rejectTarget.id && <Loader2 size={14} className="animate-spin" />}
                Tolak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}