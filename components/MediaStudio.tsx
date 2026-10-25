"use client";

import { ChevronDown, Clock, Dices, Download, ImageIcon, RotateCcw, Sparkles, Trash2, VideoIcon, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { loadMediaHistory, removeMediaAsset, type MediaSession } from "@/lib/media-history";
import { useT, type Lang, type TKey } from "@/lib/i18n";
import {
  MEDIA_HISTORY_CHANGED,
  MEDIA_JOBS_CHANGED,
  clearMediaJobsError,
  getMediaJobsError,
  listMediaJobs,
  startMediaJob,
  subscribeMediaJobs,
  type MediaJobState,
} from "@/lib/media-jobs";
import ModelPicker from "./ModelPicker";
import PillSelect from "./PillSelect";
import MediaPendingTile from "./MediaPendingTile";

type Kind = "image" | "video";

const IMAGE_STYLES = ["Otomatis", "Fotorealistik", "Anime", "Ilustrasi 3D", "Minimalis", "Sinematik", "Poster"];

const STYLE_KEYS: Record<string, TKey> = {
  Otomatis: "media.style.auto",
  Fotorealistik: "media.style.photo",
  Anime: "media.style.anime",
  "Ilustrasi 3D": "media.style.3d",
  Minimalis: "media.style.minimal",
  Sinematik: "media.style.cinematic",
  Poster: "media.style.poster",
};

// ponytail: models[] di CONFIG = fallback statis; picker sebenarnya tarik katalog
// dari /admin/models lewat /api/v1/models (state catalog di bawah).
const CONFIG: Record<
  Kind,
  {
    title: TKey;
    placeholder: TKey;
    models: { id: string; credits: number }[];
    ratios: string[];
    examples: Record<Lang, string[]>;
    randomIdeas: Record<Lang, string[]>;
  }
> = {
  image: {
    title: "media.image.title",
    placeholder: "media.image.placeholder",
    models: [
      { id: "nano-banana-2", credits: 3 },
      { id: "nano-banana-pro", credits: 50 },
      { id: "qwen-image", credits: 3 },
    ],
    ratios: ["1:1", "16:9", "9:16"],
    examples: {
      id: [
        "Rumah kayu di tepi danau saat pagi, fotorealistik",
        "Maskot restoran ramen, ilustrasi 3D lucu",
        "Banner promo kopi 16:9, minimalis",
      ],
      en: [
        "Wooden house by the lake in the morning, photorealistic",
        "Cute ramen restaurant mascot, 3D illustration",
        "Minimalist 16:9 coffee promo banner",
      ],
    },
    randomIdeas: {
      id: [
        "Kucing astronot di atas awan warna pastel, ilustrasi 3D",
        "Warung kopi di gang sempit Yogyakarta malam hari, sinematik",
        "Poster lomba badminton kampus, bold dan meriah",
      ],
      en: [
        "Astronaut cat above pastel clouds, 3D illustration",
        "Coffee stall in a narrow Yogyakarta alley at night, cinematic",
        "Campus badminton tournament poster, bold and festive",
      ],
    },
  },
  video: {
    title: "media.video.title",
    placeholder: "media.image.placeholder",
    models: [
      { id: "veo-3.1-lite", credits: 5 },
      { id: "veo-3.1-fast", credits: 40 },
      { id: "veo-3.1-quality", credits: 200 },
    ],
    ratios: ["1:1", "16:9", "9:16"],
    examples: {
      id: [
        "Kamera mendekat perlahan ke rumah danau, kabut pagi",
        "Uap mengepul dari mie ramen, sinematik",
        "Barista menuang latte art, slow motion",
      ],
      en: [
        "Slow camera push toward the lake house, morning mist",
        "Steam rising from ramen noodles, cinematic",
        "Barista pouring latte art, slow motion",
      ],
    },
    randomIdeas: {
      id: [
        "Drone terbang di atas sawah saat matahari terbit, kabut tipis",
        "Koki melempar mie ke wajan dengan api menyala, slow motion",
        "Kota futuristik saat hujan neon di malam hari, sinematik",
      ],
      en: [
        "Drone flying over rice fields at sunrise, light mist",
        "Chef tossing noodles into a flaming wok, slow motion",
        "Futuristic city in neon rain at night, cinematic",
      ],
    },
  },
};

const MAX_LEN = 5000;

type FeedItem = { url: string; prompt: string; model: string; session: MediaSession };

// ponytail: label relatif ala "41 menit lalu" + sisa expiry 30 hari (batas asset Vio).
function timeAgo(t: (key: TKey, vars?: Record<string, string | number>) => string, iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("media.justNow");
  if (mins < 60) return t("media.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("media.hoursAgo", { n: hours });
  return t("media.daysAgo", { n: Math.floor(hours / 24) });
}

function expiryLabel(t: (key: TKey, vars?: Record<string, string | number>) => string, iso: string): string {
  const daysLeft = Math.ceil((new Date(iso).getTime() + 30 * 86400000 - Date.now()) / 86400000);
  return daysLeft > 0 ? t("media.expiresIn", { n: daysLeft }) : t("media.expired");
}

export default function MediaStudio({ kind }: { kind: Kind }) {
  const { t, lang, locale } = useT();
  const cfg = CONFIG[kind];
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(cfg.models[0].id);
  const [ratio, setRatio] = useState(cfg.ratios[0]);
  const [style, setStyle] = useState(IMAGE_STYLES[0]);
  const [count, setCount] = useState(1);
  // ponytail: katalog model aktif dari /admin/models; fallback CONFIG bila API error.
  const [catalogModels, setCatalogModels] = useState<{ id: string; label?: string; credits: number; provider?: string }[]>(cfg.models);
  const models: { id: string; label?: string; credits: number; provider?: string }[] =
    catalogModels.length ? catalogModels : cfg.models;
  const [history, setHistory] = useState<MediaSession[]>([]);
  // ponytail: pending + error tinggal di job module-scope — selamat dari pindah page.
  const [pending, setPending] = useState<MediaJobState[]>(() => listMediaJobs(kind));
  const [error, setError] = useState(() => getMediaJobsError());
  const [selected, setSelected] = useState<FeedItem | null>(null);
  // ponytail: Pengaturan terkontrol (bukan <details>) — tutup via toggle, klik luar, atau Escape.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const valid = prompt.trim().length > 0;
  const Icon = kind === "image" ? ImageIcon : VideoIcon;
  const credits = (models.find((m) => m.id === model)?.credits ?? 0) * (kind === "image" ? count : 1);
  const fresh = cfg.examples[lang] ?? cfg.examples.id;
  const ideas = cfg.randomIdeas[lang] ?? cfg.randomIdeas.id;
  const styleLabel = (s: string) => (STYLE_KEYS[s] ? t(STYLE_KEYS[s]) : s);

  // ponytail: tarik katalog model sesuai jenis (image/video) + refresh riwayat.
  useEffect(() => {
    let alive = true;
    void import("@/lib/model-catalog").then(({ fetchCatalogModels }) =>
      fetchCatalogModels(kind).then((list) => {
        if (!alive) return;
        setCatalogModels(list.map((m) => ({ id: m.id, label: m.label, credits: m.cost, provider: m.provider })));
      }),
    );
    return () => {
      alive = false;
    };
  }, [kind]);

  // ponytail: sesi tersimpan ala PRD — feed = semua sesi, input dikosongkan.
  // Job yang jalan TIDAK direset saat ganti kind — ia milik module, bukan komponen.
  useEffect(() => {
    setHistory(loadMediaHistory(kind));
    setPrompt("");
    setPending(listMediaJobs(kind));
    setError(getMediaJobsError());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // ponytail: ganti kind -> model ikut model pertama dari katalog jenis itu
  // (bukan sisa model jenis lain) supaya biaya Token yang tampil benar.
  useEffect(() => {
    setModel(catalogModels[0]?.id ?? CONFIG[kind].models[0].id);
    setRatio(CONFIG[kind].ratios[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, catalogModels]);

  // ponytail: refresh saat job latar selesai / ada update — walau user sempat pindah page.
  useEffect(() => {
    const refresh = () => {
      setPending(listMediaJobs(kind));
      setError(getMediaJobsError());
    };
    const refreshHistory = () => setHistory(loadMediaHistory(kind));
    const unsub = subscribeMediaJobs(refresh);
    window.addEventListener(MEDIA_JOBS_CHANGED, refresh);
    window.addEventListener(MEDIA_HISTORY_CHANGED, refreshHistory);
    return () => {
      unsub();
      window.removeEventListener(MEDIA_JOBS_CHANGED, refresh);
      window.removeEventListener(MEDIA_HISTORY_CHANGED, refreshHistory);
    };
  }, [kind]);

  // ponytail: tutup modal & panel pengaturan pakai Escape.
  useEffect(() => {
    if (!selected && !settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected(null);
      setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, settingsOpen]);

  const feed: FeedItem[] = history.flatMap((s) =>
    (s.asset_urls ?? (s.asset_url ? [s.asset_url] : [])).map((url) => ({
      url,
      prompt: s.prompt,
      model: s.model,
      session: s,
    })),
  );

  function fillRandom() {
    const pick = ideas[Math.floor(Math.random() * ideas.length)];
    setPrompt(pick);
  }

  function changeModel(id: string) {
    setModel(id);
  }

  function recreate(item: FeedItem) {
    setPrompt(item.prompt);
    setModel(item.session.model);
    setRatio(item.session.ratio);
    if (kind === "image" && item.session.style) setStyle(item.session.style);
    if (kind === "image" && item.session.count) setCount(item.session.count);
    setSelected(null);
  }

  function removeItem(item: FeedItem) {
    setHistory(removeMediaAsset(kind, item.session.id, item.url));
    setSelected(null);
  }

  async function handleCreate() {
    if (!valid) return;
    const sent = prompt.trim();
    // ponytail: prompt hilang dari textfield SEGERA setelah terkirim (ala chat),
    // job dilempar ke module-scope — pindah page tidak membatalkan, loading
    // hanya di tile pending, boleh kirim paralel.
    const styledPrompt =
      kind === "image" && style !== IMAGE_STYLES[0] ? `${sent}, ${style.toLowerCase()}` : sent;
    setPrompt("");
    clearMediaJobsError();
    setError("");
    startMediaJob({ kind, sent, styledPrompt, model, ratio, count, style });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-neutral-950">
      <header className="px-4 pt-4 md:px-6 md:pt-5">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">{t(cfg.title)}</h1>
        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
          {kind === "image" ? t("media.textToImage") : t("media.textToVideo")} via VioStudio.
        </p>
      </header>

      {/* Feed galeri ala chat: semua hasil dalam satu aliran */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {feed.length === 0 && pending.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
              <Icon size={24} />
            </div>
            <h2 className="text-lg font-medium text-neutral-900 dark:text-white">
              {kind === "image" ? t("media.image.empty") : t("media.video.empty")}
            </h2>
            <p className="max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              {t("media.empty.desc")}
            </p>
            <div className="mt-2 flex w-full max-w-md flex-col gap-2">
              {fresh.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-left text-sm text-neutral-700 transition hover:border-primary hover:text-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {(feed.length > 0 || pending.length > 0) && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {pending.flatMap((p) =>
              Array.from({ length: p.count }).map((_, i) => (
                <MediaPendingTile key={`${p.key}-${i}`} kind={kind} text={p.text} startedAt={p.startedAt} />
              )),
            )}
            {feed.map((item, i) => (
              <button
                key={`${item.session.id}-${i}`}
                type="button"
                onClick={() => setSelected(item)}
                title={t("media.clickDetail", { prompt: item.prompt })}
                className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 text-left dark:border-neutral-800 dark:bg-neutral-900"
              >
                {kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.prompt} loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <video src={item.url} controls preload="metadata" className="aspect-square w-full bg-black object-cover" />
                )}
                <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                  {kind === "image" ? <ImageIcon size={11} /> : <VideoIcon size={11} />}
                  {kind === "image" ? t("media.imageLabel") : t("media.videoLabel")}
                </span>
                <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
                  <Download size={11} />
                  <a href={item.url} download target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {t("media.download")}
                  </a>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600 md:mx-6 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {t("media.failed", { error })}
        </p>
      )}

      {/* Composer mengambang ala contoh */}
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:pb-5">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-neutral-200 bg-neutral-50 p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2">
            <ModelPicker
              models={models.map((m) => ({ id: m.id, label: m.label ?? m.id, cost: m.credits, provider: m.provider }))}
              value={model}
              onChange={changeModel}
              priceNote={kind === "image" && count > 1 ? t("media.pricePerImageTotal", { credits, count }) : t("media.pricePerImage")}
            />
            <PillSelect value={ratio} options={cfg.ratios} onChange={setRatio} label={t("media.ratio")} />
            {kind === "image" && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSettingsOpen((o) => !o)}
                  aria-expanded={settingsOpen}
                  className="flex h-9 items-center gap-1 rounded-full border border-neutral-200 pl-3 pr-2 text-xs text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {t("video.settings")}
                  <ChevronDown size={12} className={`transition ${settingsOpen ? "rotate-180" : ""}`} />
                </button>
                {settingsOpen && (
                  <>
                    <div className="fixed inset-0 z-[90]" onClick={() => setSettingsOpen(false)} aria-hidden="true" />
                    <div className="fixed bottom-24 left-4 z-[100] w-[calc(100vw-2rem)] max-w-64 rounded-xl border border-neutral-200 bg-white p-3 shadow-2xl sm:left-1/2 sm:-translate-x-1/2 dark:border-neutral-700 dark:bg-neutral-900">
                      <p className="mb-1.5 text-xs font-medium text-neutral-900 dark:text-white">{t("media.style")}</p>
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {IMAGE_STYLES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStyle(s)}
                            className={`rounded-lg border px-2 py-1 text-xs transition ${
                              style === s
                                ? "border-primary font-medium text-primary"
                                : "border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                            }`}
                          >
                            {styleLabel(s)}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-xs text-neutral-500">
                          {t("media.count")}
                          <select
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                          >
                            <option value={1}>1×</option>
                            <option value={2}>2×</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={fillRandom}
              className="flex h-9 items-center gap-1 rounded-full border border-neutral-200 pl-3 pr-2 text-xs text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Dices size={12} />
              {t("media.random")}
            </button>
          </div>

          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, MAX_LEN))}
              placeholder={t(cfg.placeholder)}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              className="block w-full resize-none bg-transparent px-1 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-white"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!valid}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={15} />
              {t("media.create")}
            </button>
          </div>

          <div className="mt-1 flex items-center justify-between px-1 text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {t("media.tokens", { n: credits })}{kind === "image" && count > 1 ? ` (${count}×)` : ""}
              {kind === "image" && style !== IMAGE_STYLES[0] ? ` · ${styleLabel(style)}` : ""}
            </span>
            <span>
              {prompt.length} / {MAX_LEN.toLocaleString(locale)}
            </span>
          </div>
        </div>
      </div>

      {/* Modal detail hasil ala contoh: klik backdrop / X / Escape untuk tutup */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm md:items-center md:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("media.detail")}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-neutral-900 text-white shadow-2xl md:flex-row md:rounded-2xl"
          >
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
              {kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selected.url} alt={selected.prompt} className="max-h-[50vh] w-full object-contain md:max-h-[90vh]" />
              ) : (
                <video src={selected.url} controls autoPlay loop className="max-h-[50vh] w-full bg-black md:max-h-[90vh]" />
              )}
            </div>
            <div className="flex w-full flex-col gap-4 overflow-y-auto p-6 md:w-80 md:shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    {t("media.done")}
                  </span>
                  <span className="rounded-full bg-neutral-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-300">
                    {kind === "image" ? t("media.textToImage") : t("media.textToVideo")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={t("common.close")}
                  className="rounded-full p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{t("media.prompt")}</p>
                <p className="mt-1 text-sm text-neutral-200">{selected.prompt}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{t("media.model")}</p>
                  <p className="mt-1 text-sm font-semibold">{selected.session.model}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{t("media.ratio")}</p>
                  <p className="mt-1 text-sm font-semibold">{selected.session.ratio}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{t("media.credits")}</p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                    <Zap size={12} className="text-primary" />
                    {models.find((m) => m.id === selected.session.model)?.credits ?? "-"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{t("media.created")}</p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                    <Clock size={12} className="text-neutral-400" />
                    {timeAgo(t, selected.session.created_at)}
                  </p>
                </div>
              </div>
              <p className="text-xs text-neutral-500">{expiryLabel(t, selected.session.created_at)}</p>
              <a
                href={selected.url}
                download
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-hover"
              >
                <Download size={15} />
                {t("media.download")}
              </a>
              <button
                type="button"
                onClick={() => recreate(selected)}
                className="flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                <RotateCcw size={14} />
                {t("media.recreate")}
              </button>
              <button
                type="button"
                onClick={() => removeItem(selected)}
                className="flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400"
              >
                <Trash2 size={14} />
                {t("media.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
