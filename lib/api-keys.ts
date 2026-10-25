// ponytail: API key Developer milik pelanggan (PRD 5.3/7.4) — tersimpan di server
// (tabel api_keys, terikat workspace pelanggan). Key asli hanya dikembalikan SEKALI
// saat dibuat; DB menyimpan SHA-256-nya, jadi daftar hanya berisi prefix.
// Pemakaian key memotong saldo workspace pemiliknya (validateApiKey + withTokens).

export type DevApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
};

export const API_KEY_CHANGED = "ftai:apikey-changed";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(API_KEY_CHANGED));
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return data?.error?.message ?? `${fallback} (HTTP ${res.status})`;
}

export async function listApiKeys(): Promise<DevApiKey[]> {
  const res = await fetch("/api/v1/api-keys", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res, "Gagal memuat API key"));
  const data = (await res.json()) as { api_keys?: DevApiKey[] };
  return data.api_keys ?? [];
}

/** Buat key baru; `key` (lengkap) hanya ada di hasil ini — tidak bisa diambil lagi. */
export async function generateApiKey(name: string): Promise<{ key: string; api_key: DevApiKey }> {
  const res = await fetch("/api/v1/api-keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim().slice(0, 100) || "Default Key" }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Gagal membuat API key"));
  const data = (await res.json()) as { key: string; api_key: DevApiKey };
  notify();
  return data;
}

/** Cabut permanen: key langsung ditolak gateway. Tidak bisa diaktifkan lagi — buat key baru. */
export async function revokeApiKey(id: string): Promise<void> {
  const res = await fetch(`/api/v1/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Gagal mencabut API key"));
  notify();
}
