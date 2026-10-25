"use client";

import { useCallback, useEffect, useState } from "react";
import { Printer, ReceiptText, RefreshCw, Search } from "lucide-react";
import { Badge, EmptyState, Loading, PageHeader, cardCls, inputCls } from "@/components/admin/ui";
import PrintReceipt from "@/components/kasir/PrintReceipt";
import { useKasir } from "@/components/kasir/KasirShell";

type Status = "unclaimed" | "claimed" | "expired";
type ReceiptRow = {
  code: string;
  tokens: number;
  claimed: boolean;
  status: Status;
  claimed_at: string | null;
  created_at: string;
  expires_at: string | null;
};
type Filter = "all" | Status;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "unclaimed", label: "Belum diklaim" },
  { value: "claimed", label: "Sudah diklaim" },
  { value: "expired", label: "Kedaluwarsa" },
];

const STATUS_BADGE: Record<Status, { label: string; short: string; tone: "success" | "warning" | "neutral" }> = {
  claimed: { label: "Sudah diklaim", short: "✓ Diklaim", tone: "success" },
  unclaimed: { label: "Belum diklaim", short: "Belum", tone: "warning" },
  expired: { label: "Kedaluwarsa", short: "Kedaluwarsa", tone: "neutral" },
};

type Lookup = {
  receipt: {
    code: string;
    tokens: number;
    created_at: string;
    cafe_name: string | null;
    claimed: boolean;
    claimed_at: string | null;
    status: Status;
    expires_at: string | null;
    refunded_at: string | null;
    claim_url: string;
    purchase_type: string | null;
    rupiah_amount: number | null;
    pos_reference_id: string | null;
  };
  customer: {
    name: string | null;
    contact: string | null;
    token_balance: number;
    expires_at: string | null;
    expired: boolean;
  } | null;
};

const n = (v: number) => v.toLocaleString("id-ID");
const dt = (v: string | null) => (v ? new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function KasirStatusPage() {
  const { user, authFetch, setError } = useKasir();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (q.trim()) params.set("q", q.trim());
      const res = await authFetch(`/api/v1/admin/receipts?${params}`);
      if (!res.ok) {
        setError(`Gagal memuat daftar struk (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json()) as { receipts: ReceiptRow[] };
      setRows(data.receipts ?? []);
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setListLoading(false);
    }
  }, [authFetch, setError, filter, q]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), 250);
    return () => clearTimeout(t);
  }, [loadList]);

  async function check(code?: string) {
    const value = (code ?? input).trim().toUpperCase();
    if (!value) return;
    if (code) setInput(code);
    setBusy(true);
    setError(null);
    setResult(null);
    setShowPrint(false);
    try {
      const res = await authFetch(`/api/v1/admin/receipts/lookup?code=${encodeURIComponent(value)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Gagal mengecek struk (HTTP ${res.status}).`);
        return;
      }
      setResult(data as Lookup);
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  const c = result?.customer;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Cek Status Struk"
        description="Pilih struk dari daftar atau masukkan kodenya untuk melihat status klaim dan sisa saldo pelanggan."
        icon={<Search size={22} className="text-primary" />}
      />

      <div className={`${cardCls} p-5`}>
        <label className="block">
          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Kode struk</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") void check();
            }}
            placeholder="RST-123456"
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} mt-1 font-mono uppercase tracking-wider`}
          />
        </label>
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy || !input.trim()}
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Mengecek…" : "Cek Status"}
        </button>
      </div>

      {result && (
        <div className={`${cardCls} p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-neutral-900 dark:text-white">{result.receipt.code}</span>
            <Badge tone={STATUS_BADGE[result.receipt.status].tone}>{STATUS_BADGE[result.receipt.status].label}</Badge>
            {result.receipt.cafe_name && <span className="ml-auto text-[11px] text-neutral-400">{result.receipt.cafe_name}</span>}
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
              <dt className="text-neutral-400">Nilai struk</dt>
              <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{n(result.receipt.tokens)} token</dd>
            </div>
            <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
              <dt className="text-neutral-400">Dibuat</dt>
              <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{dt(result.receipt.created_at)}</dd>
            </div>
            {result.receipt.status !== "claimed" && (
              <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                <dt className="text-neutral-400">{result.receipt.status === "expired" ? "Kedaluwarsa sejak" : "Bisa diklaim sampai"}</dt>
                <dd className={`font-semibold ${result.receipt.status === "expired" ? "text-red-500" : "text-neutral-800 dark:text-neutral-100"}`}>
                  {dt(result.receipt.expires_at)}
                </dd>
              </div>
            )}
            {result.receipt.refunded_at && (
              <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                <dt className="text-neutral-400">Token dikembalikan ke saldo cafe</dt>
                <dd className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{n(result.receipt.tokens)} · {dt(result.receipt.refunded_at)}
                </dd>
              </div>
            )}
            {c && (
              <>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Diklaim oleh</dt>
                  <dd className="break-all font-semibold text-neutral-800 dark:text-neutral-100">{c.name || c.contact || "—"}</dd>
                  {c.name && c.contact && <dd className="break-all text-neutral-500">{c.contact}</dd>}
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Waktu klaim</dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{dt(result.receipt.claimed_at)}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Sisa saldo pelanggan</dt>
                  <dd className="font-semibold text-neutral-800 dark:text-neutral-100">{n(c.token_balance)} token</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
                  <dt className="text-neutral-400">Berlaku sampai</dt>
                  <dd className={`font-semibold ${c.expired ? "text-red-500" : "text-neutral-800 dark:text-neutral-100"}`}>
                    {dt(c.expires_at)}
                    {c.expired && " (kedaluwarsa)"}
                  </dd>
                </div>
              </>
            )}
          </dl>

          <p className="mt-3 text-[11px] text-neutral-400">
            {result.receipt.status === "claimed"
              ? "Untuk top-up, buat struk baru — pelanggan klaim dengan No. WA/email yang sama (atau sambil login), token masuk ke saldo yang sama."
              : result.receipt.status === "expired"
                ? "Struk ini tidak diklaim sampai batas waktu, jadi tidak bisa dipakai lagi. Tokennya sudah kembali ke saldo prepaid cafe — buatkan struk baru bila pelanggan masih butuh."
                : "Pelanggan bisa mengklaim struk ini di halaman /claim sebelum batas waktu di atas."}
          </p>

          {result.receipt.status === "unclaimed" && (
            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700">
              <button
                type="button"
                onClick={() => setShowPrint((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary hover:text-primary print:hidden dark:border-neutral-600 dark:text-neutral-200"
              >
                <Printer size={14} /> {showPrint ? "Tutup struk" : "Cetak ulang struk"}
              </button>
              {showPrint && (
                <div className="mt-4">
                  <PrintReceipt receipt={result.receipt} cashier={user.name} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`${cardCls} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-neutral-100 p-3 dark:border-neutral-700 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder="Cari kode…"
              maxLength={20}
              className={`${inputCls} font-mono text-xs uppercase`}
            />
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={listLoading}
              aria-label="Muat ulang"
              className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-500 transition hover:border-primary hover:text-primary disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
            >
              <RefreshCw size={15} className={listLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {listLoading && rows.length === 0 ? (
          <Loading label="Memuat struk..." />
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada struk" description="Struk yang dibuat di menu Buat Struk akan muncul di sini." icon={<ReceiptText size={32} />} />
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-700/50">
            {rows.map((r) => (
              <li key={r.code}>
                <button
                  type="button"
                  onClick={() => void check(r.code)}
                  className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-700/40 ${
                    result?.receipt.code === r.code ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="font-mono text-sm font-semibold text-neutral-900 dark:text-white">{r.code}</span>
                  <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].short}</Badge>
                  <span className="text-xs tabular-nums text-neutral-600 dark:text-neutral-300">{n(r.tokens)} token</span>
                  <span className="ml-auto text-[11px] text-neutral-400">{dt(r.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
