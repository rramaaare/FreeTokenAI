"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptText, Sparkles } from "lucide-react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import TokenExhaustedModal from "./TokenExhaustedModal";
import { bindCurrentUser } from "@/lib/current-user";
import { notifySettingsChanged, notifyWorkspaceChanged } from "@/lib/settings";
import { TOKENS_EXHAUSTED_EVENT } from "@/lib/token-events";
import { useT } from "@/lib/i18n";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tokensExhausted, setTokensExhausted] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
        bindCurrentUser(data?.user?.id ?? null);
        setIsAuthenticated(true);
      } else {
        bindCurrentUser(null);
        setIsAuthenticated(false);
      }
    } catch {
      bindCurrentUser(null);
      setIsAuthenticated(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    checkAuth();

    const handleLogout = () => {
      bindCurrentUser(null);
      setIsAuthenticated(false);
      setTokensExhausted(false);
    };

    window.addEventListener("auth_logout", handleLogout);
    return () => {
      window.removeEventListener("auth_logout", handleLogout);
    };
  }, [checkAuth]);

  useEffect(() => {
    const handleExhausted = () => {
      if (isAuthenticated) setTokensExhausted(true);
    };
    window.addEventListener(TOKENS_EXHAUSTED_EVENT, handleExhausted);
    return () => window.removeEventListener(TOKENS_EXHAUSTED_EVENT, handleExhausted);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-white dark:bg-neutral-950">
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}
      <Sidebar open={open} onClose={close} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setOpen(true)} />
        {/* Konten (riwayat gambar/video/chat) baru dirender setelah akun terverifikasi
            & riwayat lokal terikat ke akun itu — tak ada sisa milik akun lain yang sempat tampil. */}
        <main className="flex min-h-0 flex-1 overflow-hidden">{ready && isAuthenticated ? children : null}</main>
      </div>

      {/* ponytail: shell dirender duluan; modal tunggu cek auth supaya tak nge-flash */}
      {ready && !isAuthenticated && (
        <ApiKeyPromptModal
          onSuccess={() => {
            setIsAuthenticated(true);
            notifySettingsChanged();
            notifyWorkspaceChanged();
          }}
        />
      )}

      {ready && isAuthenticated && tokensExhausted && (
        <TokenExhaustedModal onClose={() => setTokensExhausted(false)} />
      )}
    </div>
  );
}

function ApiKeyPromptModal({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 md:p-8 shadow-2xl dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 modal-enter">
        <div className="mb-6 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-inner">
            <Sparkles size={32} />
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">
            {t("auth.welcome")}
          </h2>
          <p className="mt-2 text-xs md:text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
            {t("auth.desc")}
          </p>
        </div>

        <div className="space-y-3 text-center">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {t("auth.needKey")}
          </p>
          <Link
            href="/claim"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary-hover"
          >
            <ReceiptText size={16} />
            {t("claim.submit")}
          </Link>
        </div>
      </div>
    </div>
  );
}
