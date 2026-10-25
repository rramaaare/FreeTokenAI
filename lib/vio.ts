// ponytail: satu helper server-only untuk Vio. Key TIDAK PERNAH ke client.
// BYOK: key diambil dari registry (DB terenkripsi) dengan fallback env VIO_API_KEY.
import { fetchRetryOnce } from "./obs";
import { PROVIDER_USER_AGENT, providerKey } from "./model-registry";

export const VIO_BASE = "https://api.viostudio.id/v1";

export async function vioHeaders() {
  const key = await providerKey("vio");
  if (!key)
    throw new Error("API key Vio belum diisi (menu Provider & Model AI di /admin, atau VIO_API_KEY di .env.local)");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "User-Agent": PROVIDER_USER_AGENT,
  };
}

export async function vioFetch(path: string, init?: RequestInit) {
  // ponytail: NFR#6 — retry 1x hanya transient (5xx/throw); 4xx langsung pulang.
  const res = await fetchRetryOnce(`${VIO_BASE}${path}`, {
    ...init,
    headers: { ...(await vioHeaders()), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Unggah gambar referensi ke Vio (multipart field "file") -> asset_id numerik.
 * Dipakai mode image-to-video: Vio minta `start_frame_asset_id`, bukan base64.
 * Tanpa retry — duplikat unggahan boros dan bisa bikin dua aset.
 */
export async function vioUploadAsset(file: File | Blob, filename = "reference.png"): Promise<number> {
  const key = await providerKey("vio");
  if (!key) throw new Error("API key Vio belum diisi (menu Provider & Model AI di /admin).");
  const form = new FormData();
  form.append("file", file, filename);
  const res = await fetch(`${VIO_BASE}/assets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "User-Agent": PROVIDER_USER_AGENT }, // biarkan runtime set boundary multipart
    body: form,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { asset_id?: number; error?: { message?: string } };
  if (!res.ok || !data.asset_id) throw new Error(data?.error?.message ?? `Upload gambar gagal (HTTP ${res.status}).`);
  return data.asset_id;
}

// UI ratio -> Vio aspect_ratio
export function mapAspect(kind: "image" | "video", ratio: string): string {
  if (kind === "video") return ratio === "9:16" ? "portrait" : "landscape"; // Veo: landscape|portrait, 1:1 fallback landscape
  return ratio; // image: 16:9, 1:1, 9:16 langsung valid
}
