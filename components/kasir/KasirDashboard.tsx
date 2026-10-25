"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import { idr } from "@/components/kasir/KasirShell";
import { cardCls, inputCls } from "@/components/admin/ui";

const btnCls =
  "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-hover disabled:opacity-50";

type Sales = {
  receipts: number;
  tokens: number;
  claimed: number;
  product: { receipts: number; rupiah: number; tokens: number };
  retail: { receipts: number; rupiah: number; tokens: number };
};

type Dashboard = {
  cafe: { id: string; name: string; token_balance: number; is_active: boolean };
  sales: { today: Sales; week: Sales };
  by_day: { day: string; product: number; retail: number; retail_rupiah: number }[];
  balance_forecast: { avg_daily_tokens: number; days_left: number | null };
  unclaimed: { receipts: number; tokens: number; oldest: string | null; next_expiry: string | null };
  expired_week: { receipts: number; tokens: number };
  receipt_valid_days: number;
  recent_receipts: {
    code: string; tokens: number; purchase_type: string | null; rupiah_amount: number | null;
    claimed: boolean; expired: boolean; created_at: string;
  }[];
  usage: { today_tokens: number; week_tokens: number; today_customers: number; week_customers: number };
  by_endpoint: { endpoint_type: string; requests: number; tokens: number }[];
  transactions: { type: string; amount: number; balance_after: number; note: string | null; created_at: string }[];
  generated_at: string;
};

const n = (v: number) => v.toLocaleString("id-ID");
const when = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short" });
const dayLong = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" });

const TX_LABEL: Record<string, string> = { topup: "Top-up", reserve: "Terbit struk", refund: "Struk hangus (dikembalikan)", adjustment: "Koreksi" };
const ENDPOINT_LABEL: Record<string, string> = { chat: "Chat", image: "Gambar", video: "Video" };
const TOPUP_STATUS_LABEL: Record<"pending" | "approved" | "rejected", { label: string; cls: string }> = {
  pending: { label: "Menunggu", cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  approved: { label: "Disetujui", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  rejected: { label: "Ditolak", cls: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border-red-200 dark:border-red-800" },
};

// Palet 2 seri divalidasi (dataviz validate_palette): oranye = produk, biru = ketengan.
// Terang #F97316/#2563EB, gelap #EA6A0C/#3B82F6. Oranye < 3:1 di terang -> legend + tooltip + tabel sr-only.
const SERIES = {
  product: { label: "Bonus produk", cls: "bg-[#F97316] dark:bg-[#EA6A0C]" },
  retail: { label: "Ketengan", cls: "bg-[#2563EB] dark:bg-[#3B82F6]" },
} as const;

const card = "rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

export default function KasirDashboard({ authFetch }: { authFetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topupRequests, setTopupRequests] = useState<Array<{
    id: string;
    amount: number;
    note: string | null;
    status: "pending" | "approved" | "rejected";
    approved_at: string | null;
    rejection_reason: string | null;
    created_at: string;
  }>>([]);
  const [topupLoading, setTopupLoading] = useState(false);
  const fetchRef = useRef(authFetch);
  fetchRef.current = authFetch;

  const loadTopupRequests = useCallback(async () => {
    setTopupLoading(true);
    try {
      const res = await fetchRef.current("/api/v1/kasir/topup-requests");
      if (res.ok) {
        const json = await res.json();
        setTopupRequests(json.requests ?? []);
      }
    } catch {
      // ignore
    } finally {
      setTopupLoading(false);
    }
  }, [fetchRef]);

  useEffect(() => {
    void loadTopupRequests();
  }, [loadTopupRequests]);

  const handleTopUpSubmit = useCallback(async (amount: number, note: string) => {
    const res = await fetchRef.current("/api/v1/kasir/topup-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? "Gagal submit permintaan");
    }
    await loadTopupRequests();
  }, [fetchRef, loadTopupRequests]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetchRef.current("/api/v1/kasir/dashboard");
        if (!res.ok) {
          if (alive) setError(res.status === 401 ? "Sesi habis." : `Gagal memuat dashboard (HTTP ${res.status}).`);
          return;
        }
        const json = (await res.json()) as Dashboard;
        if (!alive) return;
        setData(json);
        setError(null);
      } catch {
        if (alive) setError("Tidak dapat memuat dashboard.");
      }
    };
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data) {
    return <div className={`${card} p-5 text-sm text-neutral-500 dark:text-neutral-400`}>{error ?? "Memuat dashboard cafe..."}</div>;
  }

  const { today, week } = data.sales;
  const { days_left } = data.balance_forecast;
  const lowBalance = data.cafe.token_balance < 10_000 || (days_left !== null && days_left < 3);
  const claimRate = week.receipts > 0 ? Math.round((week.claimed / week.receipts) * 100) : null;

  return (
    <>
      <section className="space-y-4 print:hidden">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">Dashboard {data.cafe.name}</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Diperbarui otomatis tiap 15 detik · terakhir {when(data.generated_at)}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            data.cafe.is_active
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
          }`}
        >
          {data.cafe.is_active ? "Cafe aktif" : "Cafe nonaktif"}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {error} Menampilkan data terakhir.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Penjualan token hari ini"
          value={idr(today.retail.rupiah)}
          sub={`${n(today.retail.receipts)} struk ketengan · 7 hari ${idr(week.retail.rupiah)}`}
        />
        <Stat
          label="Token terbit hari ini"
          value={n(today.tokens)}
          sub={`Produk ${n(today.product.tokens)} · Ketengan ${n(today.retail.tokens)}`}
        />
        <Link href="/kasir/status" className={`${card} block p-5 transition hover:border-primary`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Struk belum diklaim</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{n(data.unclaimed.receipts)}</p>
          <p className="mt-1 text-[11px] text-neutral-400">
            {data.unclaimed.receipts > 0
              ? `${n(data.unclaimed.tokens)} token tertahan · hangus terdekat ${when(data.unclaimed.next_expiry ?? data.unclaimed.oldest!)}`
              : "Tidak ada struk yang menunggu klaim"}
            <br />
            Tidak diklaim {data.receipt_valid_days} hari = token kembali ke saldo cafe.
          </p>
        </Link>
        <div
          className={`rounded-2xl border p-5 shadow-sm ${
            lowBalance
              ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
              : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${lowBalance ? "text-amber-700 dark:text-amber-400" : "text-primary"}`}>
              {lowBalance ? "⚠ Saldo prepaid menipis" : "Saldo prepaid cafe"}
            </p>
            <button
              type="button"
              onClick={() => setShowTopUpModal(true)}
              className={`${btnCls} text-xs py-1.5`}
            >
              <Plus size={12} className="mr-1" /> Minta Top-up
            </button>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{n(data.cafe.token_balance)}</p>
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {days_left === null
              ? "Belum ada struk 7 hari terakhir"
              : `Cukup ±${n(days_left)} hari (rata-rata ${n(data.balance_forecast.avg_daily_tokens)} token/hari)`}
            {lowBalance && " — minta top-up ke admin."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DailyChart days={data.by_day} />

        <div className={`${card} p-4`}>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Ringkasan 7 hari</p>
          <dl className="mt-3 space-y-3 text-xs">
            <Breakdown
              swatch={SERIES.product.cls}
              title="Bonus belanja produk"
              rows={[
                ["Struk", n(week.product.receipts)],
                ["Total belanja", idr(week.product.rupiah)],
                ["Token bonus", n(week.product.tokens)],
              ]}
            />
            <Breakdown
              swatch={SERIES.retail.cls}
              title="Token ketengan & paket"
              rows={[
                ["Struk", n(week.retail.receipts)],
                ["Pendapatan", idr(week.retail.rupiah)],
                ["Token terjual", n(week.retail.tokens)],
              ]}
            />
            <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/60">
              <div className="flex items-center justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Tingkat klaim</dt>
                <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">
                  {claimRate === null ? "—" : `${claimRate}%`}
                </dd>
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                {n(week.claimed)} dari {n(week.receipts)} struk 7 hari sudah dipakai pelanggan
              </p>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/60">
              <div className="flex items-center justify-between">
                <dt className="text-neutral-500 dark:text-neutral-400">Struk hangus</dt>
                <dd className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{n(data.expired_week.receipts)}</dd>
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                {n(data.expired_week.tokens)} token kembali ke saldo cafe (7 hari terakhir)
              </p>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className={`${card} overflow-hidden lg:col-span-2`}>
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Struk terbaru</p>
            <Link href="/kasir/status" className="text-[11px] font-medium text-primary hover:underline">
              Lihat semua
            </Link>
          </div>
          {data.recent_receipts.length === 0 ? (
            <p className="px-4 py-6 text-xs text-neutral-400">
              Belum ada struk.{" "}
              <Link href="/kasir/struk" className="font-medium text-primary hover:underline">
                Buat struk pertama
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              {data.recent_receipts.map((r) => {
                const series = r.purchase_type === "product" ? SERIES.product : SERIES.retail;
                return (
                  <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${series.cls}`} aria-hidden />
                    <span className="font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-50">{r.code}</span>
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{series.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        r.claimed
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : r.expired
                            ? "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      }`}
                    >
                      {r.claimed ? "✓ Diklaim" : r.expired ? "Hangus" : "Belum diklaim"}
                    </span>
                    <span className="ml-auto text-right text-xs tabular-nums text-neutral-700 dark:text-neutral-200">
                      {n(r.tokens)} token
                      {r.rupiah_amount != null && <span className="text-neutral-400"> · {idr(r.rupiah_amount)}</span>}
                    </span>
                    <span className="w-full text-[10px] text-neutral-400 sm:w-auto">{when(r.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <div className={`${card} p-4`}>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Pemakaian AI pelanggan</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-800/60">
                <p className="text-neutral-400">Hari ini</p>
                <p className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{n(data.usage.today_tokens)} token</p>
                <p className="text-[10px] text-neutral-400">{n(data.usage.today_customers)} pelanggan</p>
              </div>
              <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-800/60">
                <p className="text-neutral-400">7 hari</p>
                <p className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{n(data.usage.week_tokens)} token</p>
                <p className="text-[10px] text-neutral-400">{n(data.usage.week_customers)} pelanggan</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.by_endpoint.length === 0 && <span className="text-[11px] text-neutral-400">Belum ada pemakaian.</span>}
              {data.by_endpoint.map((e) => (
                <span key={e.endpoint_type} className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {ENDPOINT_LABEL[e.endpoint_type] ?? e.endpoint_type ?? "Lain"}: {n(e.requests)}x
                </span>
              ))}
            </div>
          </div>

          <div className={`${card} p-4`}>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Riwayat saldo cafe</p>
            {data.transactions.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-400">Belum ada transaksi saldo.</p>
            ) : (
              <ul className="mt-2 divide-y divide-neutral-100 text-xs dark:divide-neutral-800">
                {data.transactions.map((t, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-neutral-800 dark:text-neutral-100">{TX_LABEL[t.type] ?? t.type}</p>
                      <p className="truncate text-[10px] text-neutral-400">{when(t.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold tabular-nums ${t.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-700 dark:text-neutral-200"}`}>
                        {t.amount >= 0 ? "+" : "−"}
                        {n(Math.abs(t.amount))}
                      </p>
                      <p className="text-[10px] text-neutral-400">saldo {n(t.balance_after)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Permintaan Top-up</p>
              <button
                type="button"
                onClick={() => setShowTopUpModal(true)}
                className={`${btnCls} text-xs py-1.5`}
              >
                <Plus size={12} className="mr-1" /> Minta Top-up
              </button>
            </div>
            {topupLoading ? (
              <p className="mt-3 text-xs text-neutral-400 text-center">Memuat...</p>
            ) : topupRequests.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-400">Belum ada permintaan top-up.</p>
            ) : (
              <ul className="mt-2 divide-y divide-neutral-100 text-xs dark:divide-neutral-800">
                {topupRequests.slice(0, 5).map((r) => {
                  const status = TOPUP_STATUS_LABEL[r.status];
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-neutral-800 dark:text-neutral-100">Minta top-up {n(r.amount)} token</p>
                        <p className="truncate text-[10px] text-neutral-400">{when(r.created_at)}</p>
                        {r.note && <p className="truncate text-[10px] text-neutral-500">{r.note}</p>}
                        {r.status === "rejected" && r.rejection_reason && (
                          <p className="truncate text-[10px] text-red-500">Alasan: {r.rejection_reason}</p>
                        )}
                      </div>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold border ${status.cls}`}>
                        {status.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
    {showTopUpModal && (
      <TopUpRequestModal
        isOpen={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        onSubmit={handleTopUpSubmit}
        balance={data.cafe.token_balance}
        lowBalance={lowBalance}
      />
    )}
    </>
  );
}

function TopUpRequestModal({
  isOpen,
  onClose,
  onSubmit,
  balance,
  lowBalance,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => void;
  balance: number;
  lowBalance: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt < 1 || amt > 100_000_000) {
      setError("Jumlah 1–100.000.000 token.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onSubmit(amt, note.trim());
      onClose();
      setAmount("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Minta Top-up Saldo Cafe</h3>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"><X size={20} /></button>
        </div>

        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          Saldo saat ini: <strong>{n(balance)} token</strong>
          {lowBalance && <span className="text-amber-600 dark:text-amber-400 ml-2">(Menipis)</span>}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Jumlah token <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="1"
              max="100000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="cth. 50000"
              className={`${inputCls} mt-1`}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">Catatan (opsional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="cth. Restok mingguan, promo akhir bulan..."
              rows={3}
              maxLength={200}
              className={`${inputCls} mt-1`}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">
              Batal
            </button>
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
              {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : <>Kirim Permintaan</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DailyChart({ days }: { days: Dashboard["by_day"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.product + d.retail));
  const total = days.reduce((s, d) => s + d.product + d.retail, 0);
  const h = hover !== null ? days[hover] : null;
  const PLOT = 112;

  return (
    <div className={`${card} p-4 lg:col-span-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Token terbit per hari</p>
          <p className="text-[11px] text-neutral-400">7 hari terakhir · total {n(total)} token</p>
        </div>
        <div className="flex gap-3 text-[11px] text-neutral-600 dark:text-neutral-300">
          {Object.values(SERIES).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.cls}`} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
        {h && (
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            <p className="font-semibold text-neutral-900 dark:text-neutral-50">{dayLong(h.day)}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
              <span className={`h-2 w-2 rounded-sm ${SERIES.product.cls}`} /> Bonus produk: {n(h.product)} token
            </p>
            <p className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300">
              <span className={`h-2 w-2 rounded-sm ${SERIES.retail.cls}`} /> Ketengan: {n(h.retail)} token · {idr(h.retail_rupiah)}
            </p>
          </div>
        )}
        <div className="flex items-end gap-2 border-b border-neutral-200 dark:border-neutral-700" style={{ height: PLOT }}>
          {days.map((d, i) => {
            const ph = Math.round((d.product / max) * (PLOT - 16));
            const rh = Math.round((d.retail / max) * (PLOT - 16));
            const empty = d.product + d.retail === 0;
            return (
              <button
                key={d.day}
                type="button"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${dayLong(d.day)}: produk ${d.product}, ketengan ${d.retail} token`}
                className={`flex h-full flex-1 flex-col items-center justify-end rounded-t-md transition ${hover === i ? "bg-neutral-100 dark:bg-neutral-800/70" : ""}`}
              >
                {empty ? (
                  <span className="h-0.5 w-3/5 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                ) : (
                  <span className="flex w-3/5 max-w-10 flex-col gap-0.5">
                    {rh > 0 && <span className={`w-full rounded-t ${SERIES.retail.cls}`} style={{ height: Math.max(3, rh) }} />}
                    {ph > 0 && <span className={`w-full ${rh > 0 ? "" : "rounded-t"} ${SERIES.product.cls}`} style={{ height: Math.max(3, ph) }} />}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex gap-2">
          {days.map((d) => (
            <span key={d.day} className="flex-1 text-center text-[10px] text-neutral-400">
              {dayLabel(d.day)}
            </span>
          ))}
        </div>
      </div>

      {/* tabel di dalam div sr-only: <table> mengabaikan width 1px sehingga sempat bikin scroll horizontal di 320px */}
      <div className="sr-only">
      <table>
        <caption>Token terbit per hari, 7 hari terakhir</caption>
        <thead>
          <tr>
            <th>Hari</th>
            <th>Bonus produk</th>
            <th>Ketengan</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{dayLong(d.day)}</td>
              <td>{d.product}</td>
              <td>{d.retail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Breakdown({ swatch, title, rows }: { swatch: string; title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-neutral-100 p-3 dark:border-neutral-800">
      <p className="flex items-center gap-2 font-semibold text-neutral-800 dark:text-neutral-100">
        <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} aria-hidden />
        {title}
      </p>
      <div className="mt-1.5 space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-neutral-500 dark:text-neutral-400">{k}</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-50">{v}</dd>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={`${card} p-5`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{label}</p>
      <p className="mt-2 break-words text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{value}</p>
      <p className="mt-1 text-[11px] text-neutral-400">{sub}</p>
    </div>
  );
}
