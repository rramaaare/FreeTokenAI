"use client";

import { useEffect, useState } from "react";
import { Check, Coins, Copy, ReceiptText, ShoppingBag } from "lucide-react";
import { PageHeader, cardCls, inputCls } from "@/components/admin/ui";
import PrintReceipt, { type PrintableReceipt } from "@/components/kasir/PrintReceipt";
import { idr, useKasir } from "@/components/kasir/KasirShell";

type Mode = "product" | "retail";
type Pricing = { name: string; retail_rupiah_per_token: number; bonus_rupiah_per_token: number };

const MODES: { value: Mode; label: string; hint: string; icon: typeof ShoppingBag }[] = [
  { value: "product", label: "Beli Produk", hint: "Bonus token dari nominal belanja", icon: ShoppingBag },
  { value: "retail", label: "Beli Token Ketengan", hint: "Pelanggan beli token eceran", icon: Coins },
];

const newRef = () => `WEB-${Date.now()}`;
const n = (v: number) => v.toLocaleString("id-ID");

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-primary hover:text-primary dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Tersalin" : label}
    </button>
  );
}

export default function KasirStrukPage() {
  const { user, pkgs, authFetch, setError } = useKasir();
  const [mode, setMode] = useState<Mode>("product");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [belanja, setBelanja] = useState("");
  const [tokensIn, setTokensIn] = useState("");
  const [pkgId, setPkgId] = useState("");
  const [ref, setRef] = useState("");
  const [receipt, setReceipt] = useState<PrintableReceipt | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRef(newRef());
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await authFetch("/api/v1/kasir/pricing");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Gagal memuat tarif cafe (HTTP ${res.status}).`);
        return;
      }
      setPricing(data.cafe as Pricing);
    })();
  }, [authFetch, setError]);

  const belanjaRp = Number(belanja);
  const belanjaOk = Number.isInteger(belanjaRp) && belanjaRp > 0;
  const bonusTokens = pricing && belanjaOk ? Math.floor(belanjaRp / pricing.bonus_rupiah_per_token) : 0;

  const retailTokens = Number(tokensIn);
  const retailOk = Number.isInteger(retailTokens) && retailTokens >= 1 && retailTokens <= 10_000_000;
  const selectedPkg = pkgs?.find((p) => p.id === pkgId);
  const retailPrice = selectedPkg ? selectedPkg.rupiah_amount : pricing && retailOk ? retailTokens * pricing.retail_rupiah_per_token : 0;
  const retailTokenTotal = selectedPkg ? selectedPkg.tokens_granted : retailOk ? retailTokens : 0;

  const canSubmit = !!pricing && (mode === "product" ? bonusTokens >= 1 : !!selectedPkg || retailOk);

  async function generate() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const pos_reference_id = ref || newRef();
      const body =
        mode === "product"
          ? { mode, rupiah_amount: belanjaRp, pos_reference_id }
          : selectedPkg
            ? { token_package_id: selectedPkg.id, pos_reference_id }
            : { mode, tokens: retailTokens, pos_reference_id };
      const res = await authFetch("/api/v1/admin/receipts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Gagal membuat struk (HTTP ${res.status}).`);
        return;
      }
      setReceipt(data as PrintableReceipt);
      setRef(newRef());
      setBelanja("");
      setTokensIn("");
      setPkgId("");
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Buat Struk"
        description="Pilih jenis transaksi, lalu cetak struk berisi QR klaim token untuk pelanggan."
        icon={<ReceiptText size={22} className="text-primary" />}
      />

      <div className={`${cardCls} print:hidden`}>
        <div className="grid grid-cols-1 gap-2 border-b border-neutral-100 p-3 dark:border-neutral-700 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-left transition ${
                mode === m.value
                  ? "bg-primary text-white shadow-sm"
                  : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              <m.icon size={18} className="shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className={`block text-[11px] ${mode === m.value ? "text-white/80" : "text-neutral-400"}`}>{m.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {!pricing ? (
            <p className="py-6 text-center text-sm text-neutral-500">Memuat tarif cafe…</p>
          ) : mode === "product" ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Total belanja produk (Rp)</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={belanja}
                  onChange={(e) => setBelanja(e.target.value)}
                  placeholder="cth. 50000"
                  className={`${inputCls} mt-2`}
                />
                <span className="mt-1 block text-[11px] text-neutral-400">
                  Tarif bonus: tiap {idr(pricing.bonus_rupiah_per_token)} belanja = 1 token.
                </span>
              </label>
              <div className="rounded-xl bg-primary/5 p-4 dark:bg-primary/10">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Pelanggan mendapat</p>
                <p className="text-2xl font-bold text-primary">{n(bonusTokens)} token</p>
                {belanjaOk && bonusTokens < 1 && (
                  <p className="mt-1 text-[11px] text-red-500">Minimal belanja {idr(pricing.bonus_rupiah_per_token)} untuk dapat 1 token.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Jumlah token</span>
                <input
                  type="number"
                  min={1}
                  max={10_000_000}
                  inputMode="numeric"
                  value={tokensIn}
                  onChange={(e) => {
                    setTokensIn(e.target.value);
                    setPkgId("");
                  }}
                  placeholder="cth. 500"
                  className={`${inputCls} mt-2`}
                />
                <span className="mt-1 block text-[11px] text-neutral-400">Harga ketengan: {idr(pricing.retail_rupiah_per_token)} per token.</span>
              </label>

              {pkgs && pkgs.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">Atau pilih paket hemat</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {pkgs.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPkgId(pkgId === p.id ? "" : p.id);
                          setTokensIn("");
                        }}
                        className={`rounded-xl border-2 p-3 text-left transition ${
                          pkgId === p.id
                            ? "border-primary bg-primary/5 dark:bg-primary/10"
                            : "border-neutral-200 hover:border-primary/50 dark:border-neutral-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-neutral-900 dark:text-white">{p.name}</span>
                          {pkgId === p.id && <Check size={16} className="shrink-0 text-primary" />}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {n(p.tokens_granted)} token · {idr(p.rupiah_amount)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end justify-between gap-3 rounded-xl bg-primary/5 p-4 dark:bg-primary/10">
                <div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">Total bayar</p>
                  <p className="text-2xl font-bold text-primary">{idr(retailPrice)}</p>
                </div>
                <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">{n(retailTokenTotal)} token</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={generate}
            disabled={busy || !canSubmit}
            className="mt-5 w-full rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Memproses…" : "Buat Struk"}
          </button>
          <p className="mt-2 text-center text-[11px] text-neutral-400">Ref: {ref || "…"} · token dipotong dari saldo prepaid cafe</p>
        </div>
      </div>

      {receipt && (
        <div className={`${cardCls} space-y-4 p-5 print:border-0 print:p-0 print:shadow-none`}>
          <div className="flex items-center gap-2 print:hidden">
            <Check size={18} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Struk berhasil dibuat</span>
          </div>
          <PrintReceipt receipt={receipt} cashier={user.name} />
          <div className="flex flex-wrap justify-center gap-2 print:hidden">
            <CopyButton value={receipt.code} label="Salin kode" />
            <CopyButton value={receipt.claim_url} label="Salin link klaim" />
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-hover"
            >
              Buat struk baru
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
