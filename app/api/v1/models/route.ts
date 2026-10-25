import { NextResponse } from "next/server";
import { listModels, listProviders, type ModelKind } from "@/lib/model-registry";

// Selalu dinamis: katalog berubah setiap admin menambah model / mengganti ceklis.
export const dynamic = "force-dynamic";

// Katalog model untuk picker user (chat/gambar/video) dan daftar model Developer API (agent).
// Sumbernya HANYA katalog platform yang dikelola super_admin di /admin/models.
// Hanya metadata — TIDAK ada API key di dalamnya.
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind")?.trim();
  if (kind && !["chat", "image", "video", "agent"].includes(kind))
    return NextResponse.json(
      { error: { code: "INVALID_KIND", message: "kind harus chat | image | video | agent." } },
      { status: 400 },
    );
  const selected = kind as ModelKind | undefined;

  const platform = await listModels(selected);
  const providers = await listProviders();
  const providerName = new Map(providers.map((p) => [p.slug, p.name]));

  const models = platform.map((m) => ({
    id: m.id,
    kind: m.kind,
    kinds: m.kinds,
    model_id: m.model_id,
    label: m.label,
    cost: m.cost,
    is_default: m.is_default,
    provider_slug: m.provider_slug,
    provider_name: m.provider_slug ? (providerName.get(m.provider_slug) ?? m.provider_slug) : "Platform",
    source: "platform" as const,
  }));

  return NextResponse.json({ models });
}
