"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

// ponytail: provider (Vio) butuh ±70–90 dtk per gambar/video. Tanpa penanda waktu,
// spinner polos terasa "nge-lag" — tile ini menampilkan timer berjalan + bar
// perkiraan (berhenti di 95% sampai hasil benar-benar datang).
const EXPECTED_SEC = { image: 75, video: 90 } as const;

export default function MediaPendingTile({
  kind,
  text,
  startedAt,
}: {
  kind: "image" | "video";
  text: string;
  startedAt: number;
}) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const pct = Math.min(95, Math.round((sec / EXPECTED_SEC[kind]) * 100));
  const slow = sec > EXPECTED_SEC[kind] * 1.5;

  return (
    <div
      className={`flex ${kind === "image" ? "aspect-square" : "aspect-video"} flex-col items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center dark:border-neutral-800 dark:bg-neutral-900`}
    >
      <Loader2 size={20} className="animate-spin text-primary" />
      <p className={`${kind === "image" ? "line-clamp-3" : "line-clamp-2"} text-xs text-neutral-500 dark:text-neutral-400`}>{text}</p>
      <p className="text-[11px] font-medium tabular-nums text-neutral-700 dark:text-neutral-200" aria-live="off">
        {t("media.waiting", { time: clock })}
      </p>
      <div className="h-1 w-3/4 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] leading-tight text-neutral-400">{slow ? t("media.waitSlow") : t("media.waitHint")}</span>
    </div>
  );
}
