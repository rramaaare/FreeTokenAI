// BYOK registry — sumber kebenaran model & API key provider (super_admin via /admin).
// Server-only. Key plain hanya hidup di memori saat decrypt untuk fetch provider;
// tidak pernah dikirim ke client (UI admin hanya menerima masked/has_key).
import { sql } from "./db";
import { decryptSecret } from "./secret-box";

export type ModelKind = "chat" | "image" | "video";

export type RegistryModel = {
  id: string;
  kind: ModelKind;
  kinds: ModelKind[];
  model_id: string;
  label: string;
  cost: number;
  is_default: boolean;
  provider_slug: string | null;
};

export type ProviderInfo = {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  is_active: boolean;
  has_key: boolean;
  key_masked: string | null;
  verified_at: string | null;
  capabilities: ModelKind[];
};

// ---- seed fallback: daftar hardcoded LAMA (komppatibel instalasi segar) -------
// Biar fresh install tanpa data tetap jalan, registry menanam ini sekali saat
// tabel kosong, dengan harga persis sama dengan chatCost/imageCost/videoCost lama.
const SEED_MODELS: { kind: ModelKind; model_id: string; label: string; cost: number; provider: string }[] = [
  { kind: "chat", model_id: "openai/gpt-oss-20b", label: "GPT-OSS 20B Cepat", cost: 1, provider: "groq" },
  { kind: "chat", model_id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", cost: 1, provider: "gemini" },
  { kind: "chat", model_id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", cost: 10, provider: "groq" },
  { kind: "image", model_id: "nano-banana-2", label: "Nano Banana 2", cost: 3, provider: "vio" },
  { kind: "image", model_id: "nano-banana-pro", label: "Nano Banana Pro", cost: 50, provider: "vio" },
  { kind: "image", model_id: "qwen-image", label: "Qwen Image", cost: 3, provider: "vio" },
  { kind: "video", model_id: "veo-3.1-lite", label: "Veo 3.1 Lite", cost: 5, provider: "vio" },
  { kind: "video", model_id: "veo-3.1-fast", label: "Veo 3.1 Fast", cost: 40, provider: "vio" },
  { kind: "video", model_id: "veo-3.1-quality", label: "Veo 3.1 Quality", cost: 200, provider: "vio" },
];

const SEED_PROVIDERS: { slug: string; name: string; base_url: string; capabilities: ModelKind[] }[] = [
  { slug: "groq", name: "Groq", base_url: "https://api.groq.com", capabilities: ["chat"] },
  { slug: "gemini", name: "Google Gemini", base_url: "https://generativelanguage.googleapis.com", capabilities: ["chat"] },
  { slug: "vio", name: "Vio Studio", base_url: "https://api.viostudio.id/v1", capabilities: ["image", "video"] },
];

// ---- cache in-memory (TTL 60 dtk) — hemat query + batching saat streaming -----
type CacheShape = { at: number; models: RegistryModel[]; providers: ProviderInfo[] };
const globalForReg = globalThis as unknown as { __ftaiRegistry?: CacheShape; __ftaiKeys?: Map<string, { at: number; key: string | null }> };
// Cache dimatikan (TTL 0) supaya perubahan ceklis/model dari admin langsung
// terlihat di picker user. Query DB ringan; decrypt AES hanya saat memanggil provider.
const TTL = 0;

function cache(): CacheShape {
  globalForReg.__ftaiRegistry ??= { at: 0, models: [], providers: [] };
  return globalForReg.__ftaiRegistry;
}
function keyCache(): Map<string, { at: number; key: string | null }> {
  globalForReg.__ftaiKeys ??= new Map();
  return globalForReg.__ftaiKeys;
}

export function invalidateRegistry() {
  cache().at = 0;
  keyCache().clear();
}

let seeded = false;
async function ensureSeeded() {
  if (seeded) return;
  const rows = (await sql`SELECT count(*)::int AS n FROM ai_models`) as unknown as { n: number }[];
  if (rows[0]?.n) {
    seeded = true;
    return;
  }
  for (const p of SEED_PROVIDERS) {
    await sql`
      INSERT INTO providers (slug, name, base_url, capabilities)
      VALUES (${p.slug}, ${p.name}, ${p.base_url}, ${p.capabilities}::varchar[])
      ON CONFLICT (slug) DO NOTHING`;
  }
  for (const m of SEED_MODELS) {
    await sql`
      INSERT INTO ai_models (provider_id, kind, kinds, model_id, label, cost, is_default, sort_order)
      SELECT p.id, ${m.kind}, ARRAY[${m.kind}]::varchar[], ${m.model_id}, ${m.label}, ${m.cost},
             ${m.model_id === SEED_MODELS.find((x) => x.kind === m.kind)!.model_id}, 0
      FROM providers p WHERE p.slug = ${m.provider}
      ON CONFLICT (kind, model_id) DO NOTHING`;
  }
  seeded = true;
  invalidateRegistry();
}

/** Daftar model aktif per kind (untuk picker user + validasi allowlist). */
export async function listModels(kind?: ModelKind): Promise<RegistryModel[]> {
  const c = cache();
  if (Date.now() - c.at < TTL && c.models.length)
    return kind ? c.models.filter((m) => m.kinds.includes(kind)) : c.models;
  await ensureSeeded();
  try {
    const rows = (await sql`
      SELECT m.id, m.kind, m.kinds, m.model_id, m.label, m.cost, m.is_default, p.slug AS provider_slug
      FROM ai_models m LEFT JOIN providers p ON p.id = m.provider_id
      WHERE m.is_active = TRUE
        AND (p.id IS NULL OR p.is_active = TRUE)
      ORDER BY m.kind, m.sort_order, m.label`) as unknown as RegistryModel[];
    c.models = rows.map((r) => ({
      ...r,
      kinds: r.kinds?.length ? r.kinds : [r.kind],
    }));
    c.at = Date.now();
  } catch {
    // DB sedang mati -> pakai cache lama bila ada (biar UI picker tetap hidup)
    if (!c.models.length) return [];
  }
  return kind ? c.models.filter((m) => m.kinds.includes(kind)) : c.models;
}

/** Allowlist server: model valid kalau terdaftar & aktif di registry. */
export async function isModelAllowed(kind: ModelKind, modelId: string): Promise<boolean> {
  const list = await listModels(kind);
  if (!list.length) return false; // registry kosong & DB error -> tutup (fail-closed)
  return list.some((m) => m.model_id === modelId);
}

/** Default model per kind (untuk fallback picker/route). */
export async function defaultModel(kind: ModelKind): Promise<string | null> {
  const list = await listModels(kind);
  if (!list.length) return null;
  return (list.find((m) => m.is_default) ?? list[0]).model_id;
}

/** Harga token/kredit per model dari registry (null bila tidak dikenal). */
export async function modelCost(kind: ModelKind, modelId: string): Promise<number | null> {
  const list = await listModels(kind);
  return list.find((m) => m.model_id === modelId)?.cost ?? null;
}

// ---- provider info (UI admin; key TIDAK pernah utuh) -------------------------
export async function listProviders(): Promise<ProviderInfo[]> {
  const c = cache();
  if (Date.now() - c.at < TTL && c.providers.length) return c.providers;
  await ensureSeeded();
  try {
    const rows = (await sql`
      SELECT id, slug, name, base_url, is_active, key_hint, verified_at, capabilities,
             (api_key_encrypted IS NOT NULL) AS has_key
      FROM providers ORDER BY name`) as unknown as {
      id: string; slug: string; name: string; base_url: string;
      is_active: boolean; has_key: boolean; key_hint: string | null;
      verified_at: string | null; capabilities: ModelKind[] | null;
    }[];
    c.providers = rows.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, base_url: r.base_url,
      is_active: r.is_active, has_key: !!r.has_key,
      key_masked: r.key_hint ?? null, verified_at: r.verified_at,
      capabilities: r.capabilities?.length ? r.capabilities : ["chat"],
    }));
    c.at = Date.now();
  } catch {
    if (!c.providers.length) return [];
  }
  return c.providers;
}

/**
 * Ambil API key provider: DB (decrypt) -> fallback env lama (GROQ_API_KEY dll).
 * Plain key hanya hidup di server-side selama request.
 */
export async function providerKey(slug: string): Promise<string | null> {
  const kc = keyCache();
  const hit = kc.get(slug);
  if (hit && Date.now() - hit.at < TTL) return hit.key;

  let key: string | null = null;
  try {
    const rows = (await sql`
      SELECT api_key_encrypted FROM providers
      WHERE slug = ${slug} AND is_active = TRUE AND api_key_encrypted IS NOT NULL
      LIMIT 1`) as unknown as { api_key_encrypted: string }[];
    if (rows[0]) {
      try {
        key = cleanApiKey(decryptSecret(rows[0].api_key_encrypted));
      } catch {
        console.error(
          `[model-registry] API key ${slug} di DB tidak bisa didekripsi — APP_ENCRYPTION_KEY berbeda dari saat key disimpan. Simpan ulang key di /admin/models.`,
        );
      }
    }
  } catch {
    // DB error -> lanjut ke fallback env
  }

  // fallback .env.local lama (instalasi yang belum memindahkan key ke DB)
  if (!key) {
    const envMap: Record<string, string | undefined> = {
      groq: process.env.GROQ_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      vio: process.env.VIO_API_KEY,
    };
    key = cleanApiKey(envMap[slug] ?? "") || null;
  }
  kc.set(slug, { at: Date.now(), key });
  return key;
}

/**
 * Rapikan API key hasil tempel: spasi/baris baru/karakter tak terlihat, tanda
 * kutip, dan awalan "Bearer " (sering ikut tersalin dari dashboard provider
 * atau env Vercel) membuat provider membalas 401 walau key-nya benar.
 */
export function cleanApiKey(raw: string): string {
  return String(raw ?? "")
    .replace(/[\s\u200B-\u200D\uFEFF]/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Bearer/i, "");
}

export const PROVIDER_USER_AGENT = "FreeTokenAI/1.0 (+server)";

// Root Gemini tanpa suffix versi (/v1beta, /v1, /v1beta/openai) supaya admin
// boleh menempelkan URL apa pun dari dokumentasi tanpa dobel path.
function geminiRoot(baseUrl: string): string {
  return (baseUrl || "https://generativelanguage.googleapis.com")
    .replace(/\/+$/, "")
    .replace(/\/(v1beta|v1)(\/openai)?$/i, "");
}

// ---- validasi key ke provider (handshake /connect ala OpenCode) --------------
// Tidak menyimpan apa pun — hanya GET ringan ke endpoint listing/health.
// 401/403 = key ditolak; selain itu dianggap terjangkau (beberapa provider tidak
// punya endpoint /models publik, jadi kegagalan jaringan dibedakan dari auth fail).
function maskKey(k: string) {
  return k.length <= 10 ? "****" : `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export async function testProviderKey(
  slug: string,
  baseUrl: string,
  key: string,
): Promise<{ ok: boolean; message: string }> {
  const base = (baseUrl || "").replace(/\/+$/, "");
  key = cleanApiKey(key);
  const probes: { url: string; headers: Record<string, string> }[] = [];

  if (slug === "groq" || base.includes("groq")) {
    probes.push({ url: `${base || "https://api.groq.com"}/openai/v1/models`, headers: { Authorization: `Bearer ${key}` } });
  } else if (slug === "gemini" || base.includes("generativelanguage")) {
    probes.push({ url: `${geminiRoot(base)}/v1beta/models?pageSize=1`, headers: { "x-goog-api-key": key } });
  } else if (slug === "vio" || base.includes("viostudio")) {
    probes.push({ url: `${base || "https://api.viostudio.id/v1"}/models`, headers: { Authorization: `Bearer ${key}` } });
  } else if (base) {
    probes.push({ url: `${base}/models`, headers: { Authorization: `Bearer ${key}` } });
  } else {
    return { ok: false, message: "Isi base_url provider untuk bisa menguji koneksi." };
  }

  for (const p of probes) {
    try {
      const res = await fetch(p.url, {
        headers: { ...p.headers, "User-Agent": PROVIDER_USER_AGENT, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) {
        const detail = await res.text().catch(() => "");
        // 403 berupa halaman HTML / header cf-mitigated = firewall Cloudflare provider
        // memblokir IP server (mis. Vercel), bukan key yang salah.
        if (res.headers.get("cf-mitigated") || /^\s*</.test(detail))
          return {
            ok: false,
            message: `Request diblokir firewall provider (HTTP ${res.status}) — IP server ini ditolak, bukan key yang salah. Minta provider meng-whitelist server / region deploy.`,
          };
        const reason = (() => {
          try {
            return (JSON.parse(detail) as { error?: { message?: string }; message?: string }).error?.message ?? detail;
          } catch {
            return detail;
          }
        })().slice(0, 160);
        return {
          ok: false,
          message: `Key ditolak provider (HTTP ${res.status}: ${reason || "unauthorized"}). Pastikan key disalin utuh (${maskKey(key)}, ${key.length} karakter) dan masih aktif di dashboard provider.`,
        };
      }
      if (!res.ok) {
        // server provider hidup tapi endpoint probe tidak ada / error lain -> key tetap diterima
        return { ok: true, message: `Server provider terjangkau (HTTP ${res.status}); key disimpan tanpa verifikasi penuh.` };
      }
      return { ok: true, message: "Key valid — handshake provider berhasil." };
    } catch (e) {
      return { ok: false, message: `Gagal terhubung ke provider: ${e instanceof Error ? e.message : "jaringan error"}` };
    }
  }
  return { ok: false, message: "Tidak ada probe koneksi yang bisa dijalankan." };
}

// ---- tarik daftar model OTOMATIS dari provider (ala OpenRouter) -------------
export const MODEL_KINDS: ModelKind[] = ["chat", "image", "video"];

/** Normalisasi input capabilities dari client -> daftar kind valid (unik). */
export function parseCapabilities(raw: unknown): ModelKind[] {
  const arr = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const caps = arr.map((x) => String(x).trim()).filter((x): x is ModelKind => (MODEL_KINDS as string[]).includes(x));
  return caps.length ? [...new Set(caps)] : ["chat"];
}

/** Tebak kegunaan model dari id-nya saat model baru ditarik dari provider. */
export function kindForModel(modelId: string, fallback: ModelKind = "chat"): ModelKind {
  const id = modelId.toLowerCase();
  if (/(veo|sora|video|kling|runway)/.test(id)) return "video";
  if (/(imagen|dall-e|gpt-image|image|flux|stable-diffusion|midjourney)/.test(id)) return "image";
  return fallback;
}

// Format OpenAI-compatible (/v1/models -> { data: [{id}] }) dipakai Groq,
// OpenRouter, OpenRouter-klon, dsb; Gemini pakai { models: [{name, displayName}] }.
// Dipanggil server-side SETELAH key lolos validasi; hasilnya disimpan admin.
export type DiscoveredModel = { model_id: string; label: string; kind: ModelKind };

export async function discoverModels(
  slug: string,
  baseUrl: string,
  key: string,
): Promise<{ models: DiscoveredModel[]; source: string }> {
  const base = (baseUrl || "").replace(/\/+$/, "");
  // Tebak jenis dari id model (bisa dikoreksi lewat ceklis per model di admin).
  const primary: ModelKind = "chat";

  // Gemini: daftar model dari v1beta/models (ikut SEMUA halaman / nextPageToken).
  if (slug === "gemini" || base.includes("generativelanguage")) {
    type GeminiModel = { name?: string; displayName?: string; supportedGenerationMethods?: string[] };
    const raw: GeminiModel[] = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ pageSize: "1000" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`${geminiRoot(base)}/v1beta/models?${params}`, {
        headers: { "x-goog-api-key": key },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} saat mengambil daftar model`);
      const data = (await res.json().catch(() => ({}))) as {
        models?: GeminiModel[];
        nextPageToken?: string;
      };
      raw.push(...(data.models ?? []));
      pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    const usable = ["generateContent", "predict", "predictLongRunning"];
    const models = raw
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.some((x) => usable.includes(x)))
      .map((m) => {
        const model_id = String(m.name ?? "").replace(/^models\//, "");
        return {
          model_id,
          label: String(m.displayName ?? m.name ?? ""),
          kind: kindForModel(model_id, primary),
        };
      })
      .filter((m) => m.model_id);
    return { models, source: "gemini-v1beta" };
  }

  // OpenAI-compatible: /models (Groq: /openai/v1/models; OpenRouter: /api/v1/models)
  const candidates = base
    ? [`${base}/models`, `${base}/v1/models`]
    : slug === "groq"
      ? ["https://api.groq.com/openai/v1/models"]
      : [];
  let lastErr = "";
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 || res.status === 403) throw new Error(`key ditolak (HTTP ${res.status})`);
      if (!res.ok) {
        lastErr = `HTTP ${res.status} di ${url}`;
        continue;
      }
      const data = (await res.json().catch(() => ({}))) as {
        data?: { id?: string; name?: string; description?: string }[];
        models?: { id?: string; name?: string }[];
      };
      const items = data.data ?? data.models ?? [];
      const models = items
        .map((m) => {
          const id = String(m.id ?? m.name ?? "");
          return { model_id: id, label: id, kind: kindForModel(id, primary) };
        })
        .filter((m) => m.model_id && !/(whisper|tts-|embedding|moderation|davinci|babbage)/i.test(m.model_id));
      if (models.length) return { models, source: url };
      lastErr = "daftar model kosong";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "jaringan error";
    }
  }
  throw new Error(lastErr || "endpoint /models provider tidak ditemukan");
}
