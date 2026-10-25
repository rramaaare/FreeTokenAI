// Adapter gambar/video platform (OpenAI-compatible & Gemini/Veo).
// Server-only: tidak pernah mengembalikan API key ke client.
import { sql } from "./db";
import type { AiRoute } from "./ai-router";
import { providerKey } from "./model-registry";

export type MediaPoll = {
  status: "processing" | "completed" | "failed";
  asset_url?: string;
  error_message?: string;
};

function openAiSize(aspect: string): string {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

function geminiAspect(aspect: string): string {
  if (aspect === "9:16") return "9:16";
  if (aspect === "1:1") return "1:1";
  return "16:9";
}

/**
 * Generate gambar. Mendukung:
 * - OpenAI-compatible: /images/generations (gpt-image-1, dall-e-3, dll)
 * - Gemini: Imagen `:predict` atau model `*-image` via generateContent
 * Return daftar URL (data URL base64 atau URL provider).
 */
export async function generateImages(
  route: AiRoute,
  opts: { prompt: string; aspect: string; count: number },
): Promise<{ ok: true; urls: string[] } | { ok: false; message: string }> {
  const count = Math.min(2, Math.max(1, opts.count));
  try {
    if (route.family === "gemini") {
      const id = route.model.toLowerCase();
      if (id.includes("image") && !id.includes("imagen")) {
        // Gemini image model via generateContent (responseModalities IMAGE)
        const res = await fetch(`${route.base_url}/v1beta/models/${route.model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": route.key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
          error?: { message?: string };
        };
        if (!res.ok) return { ok: false, message: data?.error?.message ?? `HTTP ${res.status}` };
        const urls = (data.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.inlineData)
          .filter((x): x is { data: string; mimeType?: string } => !!x?.data)
          .map((x) => `data:${x.mimeType ?? "image/png"};base64,${x.data}`);
        if (!urls.length) return { ok: false, message: "Provider tidak mengembalikan gambar." };
        return { ok: true, urls: urls.slice(0, count) };
      }

      // Imagen predict
      const res = await fetch(`${route.base_url}/v1beta/models/${route.model}:predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": route.key },
        body: JSON.stringify({
          instances: [{ prompt: opts.prompt }],
          parameters: { sampleCount: count, aspectRatio: geminiAspect(opts.aspect) },
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        predictions?: { bytesBase64Encoded?: string; mimeType?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) return { ok: false, message: data?.error?.message ?? `HTTP ${res.status}` };
      const urls = (data.predictions ?? [])
        .filter((p) => p.bytesBase64Encoded)
        .map((p) => `data:${p.mimeType ?? "image/png"};base64,${p.bytesBase64Encoded}`);
      if (!urls.length) return { ok: false, message: "Provider tidak mengembalikan gambar." };
      return { ok: true, urls };
    }

    // OpenAI-compatible: satu request per gambar (aman untuk dall-e-3 yang n=1)
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await fetch(`${route.base_url}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` },
        body: JSON.stringify({
          model: route.model,
          prompt: opts.prompt,
          n: 1,
          size: openAiSize(opts.aspect),
          response_format: "b64_json",
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { b64_json?: string; url?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) return { ok: false, message: data?.error?.message ?? `HTTP ${res.status}` };
      for (const item of data.data ?? []) {
        if (item.b64_json) urls.push(`data:image/png;base64,${item.b64_json}`);
        else if (item.url) urls.push(item.url);
      }
    }
    if (!urls.length) return { ok: false, message: "Provider tidak mengembalikan gambar." };
    return { ok: true, urls };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal menghubungi provider gambar." };
  }
}

/**
 * Mulai pembuatan video (Gemini Veo). Job disimpan di media_generations agar
 * bisa dipoll lewat /api/generations/[id] walau halaman ditinggal.
 */
export async function startGeminiVideo(
  route: AiRoute,
  opts: {
    prompt: string;
    aspect: string;
    userId: string | null;
    duration?: number;
    motion?: string;
    quality?: string;
    fps?: number;
    referenceImageUrl?: string | null;
    tokensUsed?: number;
  },
): Promise<{ ok: true; generationId: string } | { ok: false; message: string }> {
  try {
    const res = await fetch(`${route.base_url}/v1beta/models/${route.model}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": route.key },
      body: JSON.stringify({
        instances: [{ prompt: opts.prompt }],
        parameters: { aspectRatio: geminiAspect(opts.aspect) },
      }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, message: data?.error?.message ?? `HTTP ${res.status}` };
    if (!data.name) return { ok: false, message: "Provider tidak mengembalikan operation id." };

    const rows = (await sql`
      INSERT INTO media_generations (user_id, provider, model_id, operation, status, prompt, aspect_ratio, duration, motion, quality, fps, reference_image_url, tokens_used)
      VALUES (${opts.userId}, ${route.provider}, ${route.model}, ${data.name}, 'processing', ${opts.prompt}, ${opts.aspect}, ${opts.duration ?? null}, ${opts.motion ?? null}, ${opts.quality ?? null}, ${opts.fps ?? null}, ${opts.referenceImageUrl ?? null}, ${opts.tokensUsed ?? 0})
      RETURNING id`) as unknown as { id: string }[];
    return { ok: true, generationId: rows[0].id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal memulai video." };
  }
}

function extractVideoUri(payload: unknown): string | null {
  const p = payload as {
    response?: {
      generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
      predictions?: { videoUri?: string; video?: { uri?: string } }[];
      generatedVideos?: { video?: { uri?: string } }[];
    };
  };
  return (
    p?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
    p?.response?.predictions?.[0]?.videoUri ??
    p?.response?.predictions?.[0]?.video?.uri ??
    p?.response?.generatedVideos?.[0]?.video?.uri ??
    null
  );
}

/** Poll job media async (Gemini). Return null bila id bukan milik tabel/user. */
export async function pollMediaGeneration(id: string, userId: string | null): Promise<MediaPoll | null> {
  const rows = (await sql`
    SELECT id, user_id, provider, operation, status, asset_url, error_message
    FROM media_generations WHERE id = ${id} LIMIT 1`) as unknown as {
    id: string; user_id: string | null; provider: string;
    operation: string | null; status: string; asset_url: string | null; error_message: string | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  if (row.user_id && row.user_id !== userId) return null;
  if (row.status === "completed") return { status: "completed", asset_url: `/api/media/asset/${row.id}` };
  if (row.status === "failed") return { status: "failed", error_message: row.error_message ?? "Generate gagal." };
  if (!row.operation) return { status: "failed", error_message: "Operation tidak dikenal." };

  // key platform Gemini (dari /admin/models)
  const key = await providerKey("gemini");
  if (!key) {
    await sql`UPDATE media_generations SET status = 'failed', error_message = 'API key Gemini tidak tersedia.', updated_at = now() WHERE id = ${id}`;
    return { status: "failed", error_message: "API key Gemini tidak tersedia." };
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${row.operation}`, {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      done?: boolean;
      error?: { message?: string };
    };
    if (!res.ok) {
      const message = data?.error?.message ?? `HTTP ${res.status} saat cek status video.`;
      return { status: "processing", error_message: message };
    }
    if (!data.done) return { status: "processing" };
    if (data.error?.message) {
      await sql`UPDATE media_generations SET status = 'failed', error_message = ${data.error.message}, updated_at = now() WHERE id = ${id}`;
      return { status: "failed", error_message: data.error.message };
    }
    const uri = extractVideoUri(data);
    if (!uri) {
      await sql`UPDATE media_generations SET status = 'failed', error_message = 'Video selesai tapi URL tidak ditemukan.', updated_at = now() WHERE id = ${id}`;
      return { status: "failed", error_message: "Video selesai tapi URL tidak ditemukan." };
    }
    await sql`UPDATE media_generations SET status = 'completed', asset_url = ${uri}, updated_at = now() WHERE id = ${id}`;
    return { status: "completed", asset_url: `/api/media/asset/${id}` };
  } catch (e) {
    return { status: "processing", error_message: e instanceof Error ? e.message : "Cek status gagal." };
  }
}

/** Ambil URL mentah + key untuk proxy aset video. */
export async function mediaAssetSource(
  id: string,
): Promise<{ url: string; key: string | null; user_id: string | null } | null> {
  const rows = (await sql`
    SELECT user_id, asset_url, status FROM media_generations WHERE id = ${id} LIMIT 1`) as unknown as {
    user_id: string | null; asset_url: string | null; status: string;
  }[];
  const row = rows[0];
  if (!row || row.status !== "completed" || !row.asset_url) return null;
  return { url: row.asset_url, key: await providerKey("gemini"), user_id: row.user_id };
}

// ponytail: kepemilikan job Vio. Id job Vio numerik & berurutan dan semua user
// FreeTokenAI memakai SATU akun Vio, jadi tanpa catatan ini siapa pun bisa
// menebak id lalu mengambil hasil milik user lain. Dicatat di media_generations
// (provider='vio', operation=id Vio) saat POST generate diterima.
export function vioGenerationIds(data: unknown): string[] {
  const d = (data ?? {}) as { generation_ids?: unknown; generation_id?: unknown };
  const ids = Array.isArray(d.generation_ids) ? d.generation_ids : d.generation_id != null ? [d.generation_id] : [];
  return ids.map((x) => String(x)).filter((x) => /^\d+$/.test(x));
}

export async function recordVioJobs(
  userId: string | null,
  kind: "image" | "video",
  model: string,
  prompt: string,
  data: unknown,
): Promise<void> {
  for (const id of vioGenerationIds(data)) {
    await sql`
      INSERT INTO media_generations (user_id, provider, model_id, operation, status, prompt)
      VALUES (${userId}, 'vio', ${model.slice(0, 120)}, ${`${kind}:${id}`}, 'processing', ${prompt})`;
  }
}

/** Pemilik job Vio: undefined = job tak tercatat (bukan dari app ini / milik siapa pun). */
export async function vioJobOwner(id: string): Promise<{ user_id: string | null } | undefined> {
  const rows = (await sql`
    SELECT user_id FROM media_generations
    WHERE provider = 'vio' AND operation IN (${`image:${id}`}, ${`video:${id}`})
    ORDER BY created_at DESC LIMIT 1`) as unknown as { user_id: string | null }[];
  return rows[0];
}
