'use client';

import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Download, ScrollText, Search } from 'lucide-react';
import { Alert, EmptyState, Loading, PageHeader, StatCard, cardCls, inputCls } from '@/components/admin/ui';

type TxRow = {
  id: string;
  cafe_name: string | null;
  type: string;
  amount: number;
  balance_after: number;
  reference_type: string | null;
  note: string | null;
  receipt_code: string | null;
  receipt_tokens: number | null;
  created_at: string;
  kasir_name: string | null;
  kasir_email: string | null;
};

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  topup: { label: 'Top-Up', cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  reserve: { label: 'Reserve', cls: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
  refund: { label: 'Refund', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  adjustment: { label: 'Adjustment', cls: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' },
};

const n = (v: number) => v.toLocaleString('id-ID');

function csvCell(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminTransactionsPage() {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kasirFilter, setKasirFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [days, setDays] = useState(30);
  const [kasirs, setKasirs] = useState<Array<{ id: string; name: string | null; email: string | null }>>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/v1/admin/users?role=kasir', { credentials: 'include', cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setKasirs(d.users || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kasirFilter, typeFilter, days]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (kasirFilter) params.set('kasir_id', kasirFilter);
      if (typeFilter) params.set('type', typeFilter);
      params.set('days', String(days));
      const res = await fetch(`/api/v1/admin/transactions?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'Gagal memuat');
      setRows(data.transactions || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.cafe_name || '').toLowerCase().includes(q) ||
      (t.kasir_name || '').toLowerCase().includes(q) ||
      (t.note || '').toLowerCase().includes(q) ||
      (t.receipt_code || '').toLowerCase().includes(q)
    );
  });

  const masuk = filtered.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const keluar = filtered.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  function downloadCsv() {
    const header = ['Waktu', 'Cafe', 'Kasir', 'Email Kasir', 'Tipe', 'Jumlah', 'Saldo Setelah', 'Referensi', 'Catatan'];
    const lines = filtered.map((t) =>
      [
        new Date(t.created_at).toISOString(),
        t.cafe_name,
        t.kasir_name,
        t.kasir_email,
        t.type,
        t.amount,
        t.balance_after,
        t.receipt_code ? `Struk ${t.receipt_code}` : t.reference_type,
        t.note,
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaksi-${days}hari-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Riwayat Transaksi"
        description="Audit trail transaksi kuota kafe. Filter per kasir / tipe / rentang hari."
        icon={<ScrollText size={22} className="text-primary" />}
        action={
          <button
            type="button"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 transition hover:border-primary hover:text-primary disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
          >
            <Download size={15} /> Export CSV
          </button>
        }
      />

      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Transaksi" value={n(filtered.length)} hint={`${days} hari terakhir`} tone="neutral" />
        <StatCard label="Token Masuk" value={`+${n(masuk)}`} icon={<ArrowDownLeft size={16} />} tone="success" hint="Top-up & koreksi positif admin" />
        <StatCard label="Token Keluar" value={n(keluar)} icon={<ArrowUpRight size={16} />} tone="warning" hint="Reserve struk & API key" />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800 sm:flex-row sm:items-center">
        <select value={kasirFilter} onChange={(e) => setKasirFilter(e.target.value)} className={`${inputCls} w-auto text-xs`}>
          <option value="">Semua Kasir</option>
          {kasirs.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name || k.email}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputCls} w-auto text-xs`}>
          <option value="">Semua Tipe</option>
          <option value="topup">Top-Up</option>
          <option value="reserve">Reserve</option>
          <option value="refund">Refund</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputCls} w-auto text-xs`}>
          <option value={7}>7 hari</option>
          <option value={30}>30 hari</option>
          <option value={90}>90 hari</option>
        </select>
        <div className="relative sm:ml-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari cafe, kasir, struk..."
            className={`${inputCls} w-full pl-9 text-xs sm:w-56`}
          />
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        {loading ? (
          <Loading label="Memuat transaksi..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Tidak ada transaksi"
            description="Coba ubah filter kasir, tipe, atau rentang hari."
            icon={<ScrollText size={32} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Waktu</th>
                  <th className="px-4 py-3 font-semibold">Cafe</th>
                  <th className="px-4 py-3 font-semibold">Kasir</th>
                  <th className="px-4 py-3 font-semibold">Tipe</th>
                  <th className="px-4 py-3 font-semibold">Jumlah</th>
                  <th className="px-4 py-3 font-semibold">Saldo Setelah</th>
                  <th className="px-4 py-3 font-semibold">Referensi / Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {filtered.map((t) => {
                  const tl = TYPE_LABEL[t.type] ?? TYPE_LABEL.adjustment;
                  return (
                    <tr key={t.id} className="transition hover:bg-neutral-50/70 dark:hover:bg-neutral-700/30">
                      <td className="whitespace-nowrap px-4 py-3 text-xs">{new Date(t.created_at).toLocaleString('id-ID')}</td>
                      <td className="px-4 py-3 text-xs">{t.cafe_name || '-'}</td>
                      <td className="px-4 py-3 text-xs">
                        <div>{t.kasir_name || '-'}</div>
                        <div className="text-neutral-400">{t.kasir_email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tl.cls}`}>{tl.label}</span>
                      </td>
                      <td className={`px-4 py-3 text-xs font-semibold ${t.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {t.amount > 0 ? '+' : ''}
                        {n(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs">{n(t.balance_after)}</td>
                      <td className="px-4 py-3 text-xs">
                        <div>{t.receipt_code ? `Struk ${t.receipt_code} (${n(t.receipt_tokens ?? 0)} token)` : t.reference_type || '-'}</div>
                        {t.note && <div className="mt-0.5 text-neutral-400">{t.note}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
