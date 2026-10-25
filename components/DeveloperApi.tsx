"use client";

import { Ban, Check, Copy, Eye, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { API_KEY_CHANGED, generateApiKey, listApiKeys, revokeApiKey, type DevApiKey } from "@/lib/api-keys";
import { useT, type TKey } from "@/lib/i18n";

// ponytail: saran dari hasil tes langsung di repo ini (bukan brosur):
// llama-3.1/3.3 sudah dipensiunkan Groq (dikonfirmasi 404 dari API-nya),
// yang terbukti 200: gpt-oss-20b/120b + gemini-3.5-flash.
const FREE_MODELS: { use: TKey; id: TKey; why: TKey }[] = [
  { use: "dev.free1.use", id: "dev.free1.id", why: "dev.free1.why" },
  { use: "dev.free2.use", id: "dev.free2.id", why: "dev.free2.why" },
  { use: "dev.free3.use", id: "dev.free3.id", why: "dev.free3.why" },
  { use: "dev.free4.use", id: "dev.free4.id", why: "dev.free4.why" },
];

export default function DeveloperApi() {
  const { t } = useT();
  const [keys, setKeys] = useState<DevApiKey[]>([]);
  const [name, setName] = useState("");
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // ponytail: origin di-set setelah mount; baca window saat render = hydration mismatch
  const [origin, setOrigin] = useState("");

  const reload = useCallback(async () => {
    try {
      setKeys(await listApiKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat API key");
    }
  }, []);

  useEffect(() => {
    void reload();
    setOrigin(window.location.origin);
    const onChange = () => void reload();
    window.addEventListener(API_KEY_CHANGED, onChange);
    return () => window.removeEventListener(API_KEY_CHANGED, onChange);
  }, [reload]);

  async function onGenerate() {
    setBusy(true);
    setError("");
    try {
      const out = await generateApiKey(name || "Default Key");
      setName("");
      setJustCreated(out.key);
      setCopied(false);
      setReveal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat API key");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(k: DevApiKey) {
    if (!window.confirm(t("dev.revokeConfirm", { name: k.name }))) return;
    setError("");
    try {
      await revokeApiKey(k.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mencabut API key");
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // abaikan
    }
  }

  // key lengkap hanya diketahui sesaat setelah dibuat (server cuma simpan hash-nya).
  const activeKey = justCreated ?? "rst_live_TEMPEL_KEY_DISINI";
  const curl = `curl -X POST ${origin}/api/v1/chat/completions \\
  -H "Authorization: Bearer ${activeKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "freetokenai-chat-fast", "messages": [{"role": "user", "content": "Halo!"}]}'`;

  return (
    // min-w-0: anak flex default min-width:auto — tanpa ini baris curl panjang
    // melebarkan seluruh halaman melewati layar HP.
    <div className="h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">{t("dev.title")}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {t("dev.subtitle")}
          </p>
        </div>

        {/* Generate */}
        <section className="min-w-0 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800 sm:p-5">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">{t("dev.keyTitle")}</h2>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("dev.namePlaceholder")}
              maxLength={100}
              className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={busy}
              className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              <Plus size={15} /> {t("dev.generate")}
            </button>
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">{t("dev.billingNote")}</p>
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {justCreated && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {t("dev.copyNow")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 basis-full break-all sm:basis-0 sm:flex-1 rounded-lg bg-white px-2 py-1 font-mono text-xs dark:bg-neutral-900">
                  {reveal ? justCreated : "•".repeat(28)}
                </code>
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={t("dev.reveal")}
                  className="rounded-lg border border-neutral-200 p-1.5 dark:border-neutral-700"
                >
                  <Eye size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => copy(justCreated)}
                  className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-700"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t("dev.copied") : t("dev.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => setJustCreated(null)}
                  className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:underline"
                >
                  {t("dev.close")}
                </button>
              </div>
            </div>
          )}

          <ul className="mt-3 space-y-2">
            {keys.length === 0 && (
              <p className="text-[13px] text-neutral-400">{t("dev.noKeys")}</p>
            )}
            {keys.map((k) => (
              <li
                key={k.id}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${k.is_active ? "bg-green-500" : "bg-neutral-300"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-neutral-900 dark:text-white">{k.name}</p>
                  <p className="font-mono text-xs text-neutral-500">
                    {k.key_prefix}•••• {!k.is_active && t("dev.revoked")}
                  </p>
                </div>
                {k.is_active && (
                  <button
                    type="button"
                    onClick={() => void onRevoke(k)}
                    title={t("dev.revoke")}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  >
                    <Ban size={14} /> <span className="hidden sm:inline">{t("dev.revoke")}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Cara pakai */}
        <section className="min-w-0 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800 sm:p-5">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">{t("dev.usageTitle")}</h2>
          <p className="mt-1 text-[13px] text-neutral-500">
            {t("dev.usagePre")}<code className="break-all font-mono">/api/v1/chat/completions</code>{t("dev.usagePost")}
          </p>
          <pre className="mt-3 max-w-full overflow-x-auto rounded-xl bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-100 sm:text-xs">
            {curl}
          </pre>
        </section>

        {/* Model gratis */}
        <section className="min-w-0 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800 sm:p-5">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            {t("dev.modelsTitle")}
          </h2>
          <ul className="mt-3 space-y-3">
            {FREE_MODELS.map((m) => (
              <li key={m.id} className="text-[13px]">
                <p className="font-medium text-neutral-900 dark:text-white">{t(m.use)}</p>
                <code className="break-all font-mono text-xs text-primary">{t(m.id)}</code>
                <p className="mt-0.5 text-neutral-500">{t(m.why)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
