'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CreditCard,
  KeyRound,
  Search,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Alert,
  Badge,
  EmptyState,
  Loading,
  PageHeader,
  StatCard,
  WelcomeBanner,
  cardCls,
  inputCls,
} from '@/components/admin/ui';
import BalanceModal from '@/components/admin/BalanceModal';

type Cafe = {
  id: string;
  name: string;
  is_active: boolean;
  token_balance: number;
  total_topup: number;
  total_used: number;
  last_activity_at: string | null;
  expires_at: string | null;
  active_workspaces: number;
  active_keys: number;
};

const n = (v: number) => v.toLocaleString('id-ID');
const dt = (v: string | null) => (v ? new Date(v).toLocaleString('id-ID') : '-');

export default function AdminPage() {
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const [balanceTarget, setBalanceTarget] = useState<Cafe | null>(null);
  const [mode, setMode] = useState<'topup' | 'adjust'>('topup');

  useEffect(() => {
    void loadCafes();
  }, []);

  async function loadCafes() {
    setError('');
    try {
      const res = await fetch('/api/v1/admin/cafes', { credentials: 'include', cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
      setCafes(data.cafes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat cafe');
    } finally {
      setLoading(false);
    }
  }

  function showNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 5000);
  }

  function openBalance(cafe: Cafe, nextMode: 'topup' | 'adjust') {
    setBalanceTarget(cafe);
    setMode(nextMode);
  }

  const totals = useMemo(
    () =>
      cafes.reduce(
        (acc, c) => ({
          balance: acc.balance + c.token_balance,
          topup: acc.topup + c.total_topup,
          used: acc.used + c.total_used,
          low: acc.low + (c.token_balance < 5000 ? 1 : 0),
        }),
        { balance: 0, topup: 0, used: 0, low: 0 },
      ),
    [cafes],
  );

  const filtered = cafes.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-6">
      <WelcomeBanner
        name="Super Admin"
        description="Pantau saldo prepaid, konsumsi token, dan aktivitas workspace seluruh cafe dari satu tempat."
      />

      <PageHeader
        title="Daftar Cafe"
        description="Pantau saldo prepaid, konsumsi token, dan workspace tiap cafe."
        icon={<Building2 size={22} className="text-primary" />}
        action={
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari cafe..."
              className={`${inputCls} w-full pl-9 sm:w-56`}
            />
          </div>
        }
      />

      {notice && <Alert tone="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Saldo" value={n(totals.balance)} hint="token tersedia" icon={<Wallet size={16} />} />
        <StatCard label="Total Diterbitkan" value={n(totals.topup)} hint="top-up admin ke kafe" icon={<TrendingUp size={16} />} tone="success" />
        <StatCard label="Dibagikan ke Struk" value={n(totals.used)} hint="token yang kafe terbitkan jadi struk" icon={<TrendingDown size={16} />} tone="warning" />
        <StatCard label="Saldo Rendah" value={n(totals.low)} hint="< 5.000 token" icon={<Activity size={16} />} tone={totals.low > 0 ? 'danger' : 'neutral'} />
      </div>

      {loading ? (
        <div className={cardCls}>
          <Loading label="Memuat cafe..." />
        </div>
      ) : cafes.length === 0 ? (
        <div className={cardCls}>
          <EmptyState
            title="Belum ada cafe"
            description="Tambahkan cafe lewat seed atau database, lalu saldo bisa diisi dari halaman ini."
            icon={<Building2 size={44} />}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cardCls}>
          <EmptyState title="Cafe tidak ditemukan" description={`Tidak ada cafe yang cocok dengan "${search}".`} icon={<Search size={40} />} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((cafe) => (
            <div key={cafe.id} className={`${cardCls} flex flex-col p-5`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 size={20} className="text-primary" />
                  </div>
                  <div>
                    <Link href={`/admin/cafes/${cafe.id}`} className="font-semibold text-neutral-900 hover:text-primary dark:text-white">
                      {cafe.name}
                    </Link>
                    <p className="font-mono text-[11px] text-neutral-400">{cafe.id.slice(0, 8)}</p>
                  </div>
                </div>
                <Badge tone={cafe.is_active ? 'success' : 'neutral'}>{cafe.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
              </div>

              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    <CreditCard size={14} className="text-primary" /> Saldo token
                  </span>
                  <span className={`text-lg font-bold ${cafe.token_balance < 5000 ? 'text-red-600 dark:text-red-400' : 'text-primary'}`}>
                    {n(cafe.token_balance)}
                  </span>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Total top-up</dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{n(cafe.total_topup)}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Terpakai</dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{n(cafe.total_used)}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Workspace</dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{cafe.active_workspaces}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="flex items-center gap-1 text-neutral-400">
                    <KeyRound size={11} /> Key aktif
                  </dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{cafe.active_keys}</dd>
                </div>
              </dl>

              <p className="mt-3 text-[11px] text-neutral-400">Aktivitas terakhir: {dt(cafe.last_activity_at)}</p>

              <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-700/60">
                <button
                  type="button"
                  onClick={() => openBalance(cafe, 'topup')}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-hover"
                >
                  <TrendingUp size={14} /> Tambah Saldo
                </button>
                <button
                  type="button"
                  onClick={() => openBalance(cafe, 'adjust')}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 transition hover:border-primary hover:text-primary dark:border-neutral-600 dark:text-neutral-300"
                >
                  Koreksi
                </button>
                <Link
                  href={`/admin/cafes/${cafe.id}`}
                  className="rounded-lg border border-neutral-200 p-2 text-neutral-500 transition hover:border-primary hover:text-primary dark:border-neutral-600"
                  aria-label={`Detail ${cafe.name}`}
                >
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {balanceTarget && (
        <BalanceModal
          cafe={balanceTarget}
          defaultMode={mode}
          onClose={() => setBalanceTarget(null)}
          onDone={(msg) => {
            setBalanceTarget(null);
            showNotice(msg);
            void loadCafes();
          }}
        />
      )}
    </div>
  );
}
