// ponytail: job media jalan di module-scope agar selamat dari pindah page.
// Navigasi SPA tidak reload module — POST + poll jalan terus walau MediaStudio
// unmount; selesai -> saveMediaSession. Satu-satunya yang hilang saat full
// reload adalah genId yang belum selesai (localStorage hanya simpan hasil jadi).
import { saveMediaSession } from "./media-history";
import { notifyWorkspaceChanged } from "./settings";
import { notifyTokensExhausted } from "./token-events";

export type MediaJobState = { key: string; kind: "image" | "video"; text: string; count: number; startedAt: number };

export const MEDIA_JOBS_CHANGED = "ftai:media-jobs-changed";
export const MEDIA_HISTORY_CHANGED = "ftai:media-history-changed";

let jobs: MediaJobState[] = [];
let lastError = "";
const listeners = new Set<() => void>();

function emit(name: string) {
  listeners.forEach((fn) => fn());
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

export function listMediaJobs(kind: "image" | "video"): MediaJobState[] {
  return jobs.filter((j) => j.kind === kind);
}

export function getMediaJobsError(): string {
  return lastError;
}

export function clearMediaJobsError() {
  lastError = "";
}

export function subscribeMediaJobs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function pollGeneration(id: number): Promise<string> {
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 10 * 60 * 1000) {
    // ponytail: interval rekomendasi docs — 1s x10, lalu 5s, lalu 10s. Disederhanakan: 2s lalu 5s flat.
    // Vio butuh ±70–90 dtk per job (diukur Okt 2026): cek tiap 3 dtk supaya hasil
    // tampil maks 3 dtk setelah selesai (dulu 5 dtk), request tetap ringan.
    await new Promise((r) => setTimeout(r, n < 2 ? 2000 : 3000));
    n++;
    const res = await fetch(`/api/generations/${id}`);
    const data = await res.json();
    if (data.status === "completed") return String(data.asset_url);
    if (data.status === "failed") throw new Error(data.error_message || "Generate gagal.");
  }
  throw new Error("Timeout 10 menit — coba lagi.");
}

export function startMediaJob(args: {
  kind: "image" | "video";
  sent: string;
  styledPrompt: string;
  model: string;
  ratio: string;
  count: number;
  style?: string;
  formData?: FormData; // for video multipart
  duration?: number;
  motion?: string;
  quality?: string;
  fps?: number;
}): string {
  const key = crypto.randomUUID();
  const slots = args.kind === "image" ? args.count : 1;
  jobs = [...jobs, { key, kind: args.kind, text: args.sent, count: slots, startedAt: Date.now() }];
  lastError = "";
  emit(MEDIA_JOBS_CHANGED);

  // ponytail: fire-and-forget — tidak di-await pemanggil, jadi unmount tidak membatalkan.
  (async () => {
    try {
      const endpoint = args.kind === "image" ? "/api/images/generate" : "/api/videos/generate";
      let res: Response;
      if (args.kind === "image") {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: args.styledPrompt,
            model: args.model,
            aspect_ratio: args.ratio,
            count: args.count,
          }),
        });
      } else if (args.formData) {
        // Video: multipart/form-data
        res = await fetch(endpoint, {
          method: "POST",
          body: args.formData,
        });
      } else {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: args.sent,
            model: args.model,
            aspect_ratio: args.ratio,
            duration: args.duration ?? 5,
            motion: args.motion ?? "medium",
            quality: args.quality ?? "720p",
            fps: args.fps ?? 30,
            mode: "t2v",
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === "INSUFFICIENT_TOKENS" || data?.error?.code === "WORKSPACE_EXPIRED") notifyTokensExhausted();
        throw new Error(data?.error?.message || `Gagal (${res.status})`);
      }
      // saldo sudah dipotong server saat POST diterima — segarkan saldo TopBar.
      notifyWorkspaceChanged();

      // Gambar sinkron: provider langsung mengembalikan hasil.
      const immediate = (data.asset_urls as string[] | undefined) ?? (data.asset_url ? [data.asset_url] : []);
      if (data.status === "completed" && immediate.length) {
        saveMediaSession({
          kind: args.kind,
          prompt: args.sent,
          style: args.kind === "image" ? args.style : undefined,
          model: args.model,
          ratio: args.ratio,
          count: args.kind === "image" ? args.count : undefined,
          duration: args.duration,
          motion: args.motion,
          quality: args.quality,
          fps: args.fps,
          asset_url: immediate[0],
          asset_urls: immediate.slice(0, slots),
        });
        emit(MEDIA_HISTORY_CHANGED);
        return;
      }

      const genIds: number[] = data.generation_ids ?? (data.generation_id ? [data.generation_id] : []);
      if (!genIds.length) throw new Error("Respons API tanpa generation_id.");
      // ponytail: jumlah maks 2 — poll paralel, gagal satu = tampilkan yg sukses saja.
      const settled = await Promise.allSettled(genIds.map((id) => pollGeneration(id)));
      const urls = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!urls.length)
        throw new Error(settled[0].status === "rejected" ? (settled[0].reason as Error).message : "Generate gagal.");
      saveMediaSession({
        kind: args.kind,
        prompt: args.sent,
        style: args.kind === "image" ? args.style : undefined,
        model: args.model,
        ratio: args.ratio,
        count: args.kind === "image" ? args.count : undefined,
        duration: args.duration,
        motion: args.motion,
        quality: args.quality,
        fps: args.fps,
        asset_url: urls[0],
        asset_urls: urls,
      });
      emit(MEDIA_HISTORY_CHANGED);
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Terjadi kesalahan.";
    } finally {
      jobs = jobs.filter((j) => j.key !== key);
      emit(MEDIA_JOBS_CHANGED);
    }
  })();

  return key;
}
