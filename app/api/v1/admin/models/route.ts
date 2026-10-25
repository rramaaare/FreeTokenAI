import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { invalidateRegistry, parseCapabilities, type ModelKind } from "@/lib/model-registry";

const KINDS: ModelKind[] = ["chat", "image", "video", "agent"];

function forbidden(auth: unknown) {
  if (typeof auth !== "string") return null;
  const status = auth === "unauthorized" ? 401 : 403;
  return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
}

// Katalog model lengkap (termasuk non-aktif) untuk kelola /admin/models.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  const err = forbidden(auth);
  if (err) return err;
  try {
    const rows = (await sql`
      SELECT m.id, m.provider_id, m.kind, m.kinds, m.model_id, m.label, m.cost, m.is_active, m.is_default,
             m.sort_order, p.slug AS provider_slug, p.name AS provider_name
      FROM ai_models m LEFT JOIN providers p ON p.id = m.provider_id
      ORDER BY m.kind, m.sort_order, m.label`) as unknown as {
      id: string; provider_id: string | null; kind: ModelKind; kinds: ModelKind[] | null;
      model_id: string; label: string; cost: number;
      is_active: boolean; is_default: boolean; sort_order: number;
      provider_slug: string | null; provider_name: string | null;
    }[];
    return NextResponse.json({
      models: rows.map((r) => ({ ...r, kinds: r.kinds?.length ? r.kinds : [r.kind] })),
    });
  } catch {
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: "Gagal memuat model." } }, { status: 500 });
  }
}

// Tambah model — tunggal (model_id) ATAU massal (models: [{model_id, label?}]).
// `kinds` = ceklis kegunaan (chat/gambar/video), boleh lebih dari satu.
// Harga tidak lagi dikelola dari UI; model baru otomatis 1 Token.
export async function POST(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  const err = forbidden(auth);
  if (err) return err;

  let body: {
    kind?: unknown; kinds?: unknown; model_id?: unknown; label?: unknown;
    provider_id?: unknown; provider_slug?: unknown; is_default?: unknown;
    models?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "Body bukan JSON." } }, { status: 400 });
  }

  // kinds: array baru; kind lama tetap diterima (kompatibilitas).
  const requested = Array.isArray(body.kinds) || typeof body.kinds === "string" ? body.kinds : body.kind;
  const parsed = parseCapabilities(requested);
  const kinds = parsed.filter((k) => KINDS.includes(k));
  if (!kinds.length)
    return NextResponse.json({ error: { code: "INVALID_KIND", message: "Pilih minimal satu: chat | image | video | agent." } }, { status: 400 });

  // provider: id langsung (dari kartu) atau slug (mode lama)
  let providerId: string | null = null;
  try {
    if (typeof body.provider_id === "string" && body.provider_id) providerId = body.provider_id;
    else {
      const prov = (await sql`SELECT id FROM providers WHERE slug = ${String(body.provider_slug ?? "").trim() || "vio"} LIMIT 1`) as unknown as { id: string }[];
      providerId = prov[0]?.id ?? null;
    }
  } catch {
    providerId = null;
  }

  // Ceklis murni per model — tidak dibatasi capability provider.
  // Kolom kind (lama) hanya chat/image/video; model khusus agent tetap disimpan sebagai chat.
  const primary = kinds.find((k) => k !== "agent") ?? "chat";

  // mode massal: [{model_id, label?}, ...]
  if (Array.isArray(body.models)) {
    const items = body.models
      .map((x) => ({
        model_id: String((x as { model_id?: unknown })?.model_id ?? "").trim().slice(0, 120),
        label: String((x as { label?: unknown })?.label ?? "").trim().slice(0, 150),
      }))
      .filter((x) => x.model_id);
    if (!items.length)
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Tidak ada model_id valid." } }, { status: 400 });
    let added = 0;
    try {
      for (const item of items) {
        const res = await sql`
          INSERT INTO ai_models (provider_id, kind, kinds, model_id, label, cost)
          VALUES (${providerId}, ${primary}, ${kinds}::varchar[], ${item.model_id}, ${item.label || item.model_id}, 1)
          ON CONFLICT (kind, model_id) DO NOTHING
          RETURNING id`;
        if ((res as unknown as unknown[]).length) added++;
      }
    } catch {
      return NextResponse.json({ error: { code: "SERVER_ERROR", message: "Gagal menambah model massal." } }, { status: 500 });
    }
    invalidateRegistry();
    return NextResponse.json({ ok: true, added, skipped: items.length - added });
  }

  const modelId = String(body.model_id ?? "").trim().slice(0, 120);
  const label = String(body.label ?? "").trim().slice(0, 150);
  if (!modelId || !label)
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "model_id dan label wajib diisi." } }, { status: 400 });

  try {
    await sql`
      INSERT INTO ai_models (provider_id, kind, kinds, model_id, label, cost, is_default)
      VALUES (${providerId}, ${primary}, ${kinds}::varchar[], ${modelId}, ${label}, 1, ${body.is_default === true})
      ON CONFLICT (kind, model_id) DO UPDATE SET
        label = EXCLUDED.label,
        kinds = EXCLUDED.kinds`;
    if (body.is_default === true)
      await sql`UPDATE ai_models SET is_default = FALSE WHERE kind = ${primary} AND model_id <> ${modelId}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const code = msg.includes("duplicate") || msg.includes("unique") ? "DUPLICATE_MODEL" : "SERVER_ERROR";
    return NextResponse.json(
      { error: { code, message: code === "DUPLICATE_MODEL" ? "Model dengan id itu sudah ada." : "Gagal menambah model." } },
      { status: code === "DUPLICATE_MODEL" ? 409 : 500 },
    );
  }
  invalidateRegistry();
  return NextResponse.json({ ok: true, added: 1 });
}
