"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import ConsoleShell from "@/components/admin/ConsoleShell";
import { Alert } from "@/components/admin/ui";

const ACCESS_KEY = "ftai:admin:access_token";
const REFRESH_KEY = "ftai:admin:refresh_token";
const USER_KEY = "ftai:admin:user";

export type KasirUser = { id: string; name?: string; role: string; cafe_id: string | null; email?: string };
export type Pkg = {
  id: string;
  cafe_id: string | null;
  name: string;
  rupiah_amount: number;
  tokens_granted: number;
  sort_order: number;
};

type KasirCtx = {
  user: KasirUser;
  pkgs: Pkg[] | null;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  setError: (msg: string | null) => void;
};

const Ctx = createContext<KasirCtx | null>(null);

export function useKasir() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKasir dipakai di luar KasirShell");
  return ctx;
}

export function idr(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export default function KasirShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<KasirUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [pkgs, setPkgs] = useState<Pkg[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setPkgs(null);
    setError(null);
  }, []);

  const authFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const withAuth = (t: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${t}`);
      return fetch(path, { ...init, headers });
    };
    const res = await withAuth(localStorage.getItem(ACCESS_KEY) ?? "");
    if (res.status !== 401) return res;
    const rt = localStorage.getItem(REFRESH_KEY);
    if (!rt) return res;
    const rr = await fetch("/api/v1/admin/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!rr.ok) return res;
    const data = (await rr.json().catch(() => null)) as { access_token?: string; refresh_token?: string } | null;
    if (!data?.access_token) return res;
    localStorage.setItem(ACCESS_KEY, data.access_token);
    localStorage.setItem(REFRESH_KEY, data.refresh_token ?? rt);
    return withAuth(data.access_token);
  }, []);

  const loadPkgs = useCallback(async () => {
    const res = await authFetch("/api/v1/admin/token-packages");
    if (res.status === 401) {
      logout();
      setError("Sesi habis - login ulang.");
      return;
    }
    if (!res.ok) {
      setError(`Gagal memuat paket (HTTP ${res.status}).`);
      return;
    }
    const data = (await res.json()) as { packages: Pkg[] };
    setPkgs(data.packages ?? []);
  }, [authFetch, logout]);

  useEffect(() => {
    try {
      const t = localStorage.getItem(ACCESS_KEY);
      const raw = localStorage.getItem(USER_KEY);
      if (t && t !== "undefined" && raw) {
        setUser(JSON.parse(raw) as KasirUser);
        void loadPkgs();
      }
    } catch {
      logout();
    } finally {
      setBooting(false);
    }
  }, [loadPkgs, logout]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError("Format email tidak valid.");
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError("Password harus 8-128 karakter.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail, password }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setError("Email/password salah.");
        return;
      }
      if (res.status === 403) {
        setError(data?.error?.message ?? "Akses ditolak (origin atau hak akses).");
        return;
      }
      if (res.status === 429) {
        setError(data?.error?.message ?? "Terlalu banyak percobaan. Coba lagi nanti.");
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? `Login gagal (HTTP ${res.status}).`);
        return;
      }
      // ponytail: API pakai snake_case (access_token/refresh_token) - bukan `token`.
      if (!data?.access_token) {
        setError("Respons login tidak dikenali.");
        return;
      }
      localStorage.setItem(ACCESS_KEY, data.access_token as string);
      localStorage.setItem(REFRESH_KEY, (data.refresh_token as string) ?? "");
      localStorage.setItem(USER_KEY, JSON.stringify({ ...data.user, email: mail }));
      setUser({ ...data.user, email: mail });
      void loadPkgs();
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 text-sm text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
        Memuat sesi kasir…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 dark:bg-neutral-950 print:block">
        <div className="w-full max-w-md px-4 py-6 print:max-w-none">
          <form
            onSubmit={login}
            className="mt-4 space-y-3 rounded-xl border border-neutral-200 bg-white p-5 print:hidden dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">Login Kasir</h1>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Gunakan akun kasir yang terhubung ke cafe.
              </p>
            </div>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
              >
                {error}
              </div>
            )}
            <label className="block text-sm">
              Email kasir{" "}
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kasir.kopi@example.com"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <label className="block text-sm">
              Password{" "}
              <input
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? "Masuk…" : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (user.role !== "kasir" || !user.cafe_id) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50 dark:bg-neutral-950 print:block">
        <div className="w-full max-w-md space-y-3 px-4 py-6 print:max-w-none">
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 print:hidden dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            403 — Halaman ini hanya untuk akun kasir yang terikat cafe.
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-600 hover:border-primary hover:text-primary dark:border-neutral-700 dark:text-neutral-300"
          >
            Keluar
          </button>
        </div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ user, pkgs, authFetch, setError }}>
      <ConsoleShell role="kasir" name={user.name || "Kasir"} email={user.email} onLogout={logout}>
        <div className="space-y-6">
          {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
          {children}
        </div>
      </ConsoleShell>
    </Ctx.Provider>
  );
}
