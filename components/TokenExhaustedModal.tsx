"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Coins, Loader2, ReceiptText, Wallet, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { notifyWorkspaceChanged } from "@/lib/settings";

type BalanceResponse = { remaining?: number; isExpired?: boolean };

export default function TokenExhaustedModal({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n);

  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  // masa aktif lewat (saldo bisa masih ada) -> judul & ajakan klaim berbeda
  const [expired, setExpired] = useState(false);

  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimSuccess, setClaimSuccess] = useState(false);

  const [checking, setChecking] = useState(false);
  const [adminSuccess, setAdminSuccess] = useState(false);

  const baselineRef = useRef<number | null>(null);
  const claimSuccessRef = useRef(false);
  const adminSuccessRef = useRef(false);

  const loadBalance = useCallback(async (): Promise<number | null> => {
    try {
      const res = await fetch("/api/v1/user/balance", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as BalanceResponse;
      const remaining = Number(data.remaining ?? 0);
      setBalance(remaining);
      setExpired(Boolean(data.isExpired));
      return remaining;
    } catch {
      return null;
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  // Cek saldo otomatis saat popup terbuka — admin bisa top-up kapan saja.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const remaining = await loadBalance();
      if (!alive || remaining === null) return;
      if (baselineRef.current === null) baselineRef.current = remaining;
      else if (
        remaining > baselineRef.current &&
        !claimSuccessRef.current &&
        !adminSuccessRef.current
      ) {
        adminSuccessRef.current = true;
        setAdminSuccess(true);
        notifyWorkspaceChanged();
      }
    };
    void tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loadBalance]);

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (claiming || !code.trim()) return;
    setClaiming(true);
    setClaimError("");
    try {
      const res = await fetch("/api/v1/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message || t("tokens.claimFailed"));
      }
      const next = Number(data?.workspace?.token_balance ?? 0);
      setBalance(next);
      baselineRef.current = next;
      claimSuccessRef.current = true;
      setClaimSuccess(true);
      notifyWorkspaceChanged();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : t("tokens.claimFailed"));
    } finally {
      setClaiming(false);
    }
  }

  async function handleCheckBalance() {
    if (checking) return;
    setChecking(true);
    const remaining = await loadBalance();
    if (remaining !== null) {
      if (baselineRef.current === null) baselineRef.current = remaining;
      if (remaining > baselineRef.current) {
        adminSuccessRef.current = true;
        setAdminSuccess(true);
        notifyWorkspaceChanged();
      }
    }
    setChecking(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
              <Coins size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
                {expired ? t("tokens.expiredTitle") : t("tokens.title")}
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {expired ? t("tokens.expiredDesc") : t("tokens.desc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3 dark:bg-neutral-800">
          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("tokens.balance")}
          </span>
          <span className="flex items-center gap-1.5 font-sf text-lg font-bold text-neutral-900 dark:text-white">
            {loadingBalance ? (
              <Loader2 size={16} className="animate-spin text-neutral-400" />
            ) : (
              fmt(balance ?? 0)
            )}
            <span className="text-xs font-medium text-neutral-500">Token</span>
          </span>
        </div>

        {/* Opsi A — klaim struk */}
        <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="mb-2 flex items-center gap-2">
            <ReceiptText size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t("tokens.claimTitle")}
            </h3>
          </div>

          {claimSuccess ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>{t("tokens.claimSuccess")}</span>
            </div>
          ) : (
            <form onSubmit={handleClaim} className="space-y-2">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {t("tokens.claimDesc")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="RST-123456"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2 font-mono text-sm uppercase tracking-wider text-neutral-900 outline-none transition focus:border-primary dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={claiming || !code.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {claiming && <Loader2 size={15} className="animate-spin" />}
                  {claiming ? t("tokens.claiming") : t("tokens.claimBtn")}
                </button>
              </div>
              {claimError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {claimError}
                </p>
              )}
            </form>
          )}
        </section>

        {/* Opsi B — minta admin top-up */}
        <section className="mt-3 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
          <div className="mb-2 flex items-center gap-2">
            <Wallet size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t("tokens.adminTitle")}
            </h3>
          </div>

          {adminSuccess ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <span>{t("tokens.adminSuccess")}</span>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                {t("tokens.adminDesc")}
              </p>
              <button
                type="button"
                onClick={handleCheckBalance}
                disabled={checking}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {checking && <Loader2 size={15} className="animate-spin" />}
                {checking ? t("tokens.checking") : t("tokens.check")}
              </button>
            </>
          )}
        </section>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {claimSuccess || adminSuccess ? t("tokens.continue") : t("common.close")}
        </button>
      </div>
    </div>
  );
}
