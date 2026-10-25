import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { encryptSecret, maskSecret } from "@/lib/secret-box";
import {
  cleanApiKey,
  discoverModels,
  invalidateRegistry,
  listProviders,
  testProviderKey,
} from "@/lib/model-registry";

function forbidden(auth: unknown) {
  if (typeof auth !== "string") return null;
  const status = auth === "unauthorized" ? 401 : 403;
  return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
}

// BYOK konsol super_admin: daftar provider + status key (masked saja, TIDAK pernah utuh).
export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  const err = forbidden(auth);
  if (err) return err;
  return NextResponse.json({ providers: await listProviders() });
}

// Tambah provider: isi nama + API key. Key DIUJI handshake dulu (401/403 = tolak),
// disimpan AES-256-GCM, lalu SEMUA model provider ditarik OTOMATIS dari /models.
export async function POST(req: Request) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  const err = forbidden(auth);
  if (err) return err;

  let body: { slug?: unknown; name?: unknown; base_url?: unknown; api_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "Body bukan JSON." } }, { status: 400 });
  }
  const slug = String(body.slug ?? "").trim().toLowerCase().slice(0, 50);
  const name = String(body.name ?? "").trim().slice(0, 100);
  const baseUrl = String(body.base_url ?? "").trim().slice(0, 255);
  const apiKey = cleanApiKey(String(body.api_key ?? ""));
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug) || !name)
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Slug (huruf/angka) dan nama wajib." } }, { status: 400 });
  if (!apiKey || apiKey.length < 8)
    return NextResponse.json({ error: { code: "INVALID_KEY", message: "API key wajib diisi (min 8 karakter)." } }, { status: 400 });

  const check = await testProviderKey(slug, baseUrl, apiKey);
  if (!check.ok)
    return NextResponse.json(
      { error: { code: "KEY_INVALID", message: `Validasi gagal: ${check.message}` } },
      { status: 422 },
    );

  try {
    await sql`
      INSERT INTO providers (slug, name, base_url, api_key_encrypted, key_hint, capabilities, verified_at, updated_at)
      VALUES (${slug}, ${name}, ${baseUrl}, ${encryptSecret(apiKey)}, ${maskSecret(apiKey)},
              ARRAY['chat','image','video']::varchar[], now(), now())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        base_url = EXCLUDED.base_url,
        api_key_encrypted = EXCLUDED.api_key_encrypted,
        key_hint = EXCLUDED.key_hint,
        is_active = TRUE,
        verified_at = EXCLUDED.verified_at,
        updated_at = now()`;
  } catch {
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: "Gagal menyimpan provider." } }, { status: 500 });
  }
  invalidateRegistry();

  // ---- tarik model OTOMATIS (best-effort: provider tetap tersimpan walau gagal) ----
  let discovered = 0;
  let discoverNote = "";
  try {
    const out = await discoverModels(slug, baseUrl, apiKey);
    for (const m of out.models) {
      await sql`
        INSERT INTO ai_models (provider_id, kind, kinds, model_id, label, cost)
        SELECT p.id, ${m.kind}, ARRAY[${m.kind}]::varchar[], ${m.model_id}, ${m.label}, 1
        FROM providers p WHERE p.slug = ${slug}
        ON CONFLICT (kind, model_id) DO NOTHING`;
    }
    discovered = out.models.length;
    discoverNote = discovered
      ? `${discovered} model ditarik otomatis dari ${out.source}.`
      : "Provider tersimpan; endpoint /models tidak mengembalikan model (tambah manual).";
  } catch (e) {
    discoverNote = `Model otomatis gagal: ${e instanceof Error ? e.message : "jaringan"} — bisa pakai "Ambil Model" nanti.`;
  }
  invalidateRegistry();

  return NextResponse.json({ ok: true, providers: await listProviders(), discovered, discover_note: discoverNote });
}
