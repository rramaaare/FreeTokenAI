import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { encryptSecret, maskSecret } from "@/lib/secret-box";
import { cleanApiKey, invalidateRegistry, listProviders, parseCapabilities, testProviderKey } from "@/lib/model-registry";

// Edit provider: nama/base_url/kebutuhan (capabilities), toggle aktif, atau
// GANTI key (divalidasi handshake dulu — sama seperti saat tambah).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }
  const { id } = await params;

  let body: { name?: unknown; base_url?: unknown; capabilities?: unknown; is_active?: unknown; api_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "Body bukan JSON." } }, { status: 400 });
  }

  const rows = (await sql`SELECT slug, name, base_url FROM providers WHERE id = ${id} LIMIT 1`) as unknown as {
    slug: string; name: string; base_url: string;
  }[];
  if (!rows[0])
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Provider tidak ditemukan." } }, { status: 404 });

  try {
    if (typeof body.name === "string" && body.name.trim())
      await sql`UPDATE providers SET name = ${body.name.trim().slice(0, 100)} WHERE id = ${id}`;
    if (typeof body.base_url === "string")
      await sql`UPDATE providers SET base_url = ${body.base_url.trim().slice(0, 255)} WHERE id = ${id}`;
    if (body.capabilities !== undefined) {
      const caps = parseCapabilities(body.capabilities);
      await sql`UPDATE providers SET capabilities = ${caps}::varchar[] WHERE id = ${id}`;
    }
    if (typeof body.is_active === "boolean")
      await sql`UPDATE providers SET is_active = ${body.is_active} WHERE id = ${id}`;

    if (typeof body.api_key === "string" && body.api_key.trim()) {
      const key = cleanApiKey(body.api_key);
      if (key.length < 8)
        return NextResponse.json({ error: { code: "INVALID_KEY", message: "API key terlalu pendek (min 8)." } }, { status: 400 });
      const baseUrl = typeof body.base_url === "string" ? body.base_url.trim() : rows[0].base_url;
      const check = await testProviderKey(rows[0].slug, baseUrl, key);
      if (!check.ok)
        return NextResponse.json(
          { error: { code: "KEY_INVALID", message: `Validasi gagal: ${check.message}` } },
          { status: 422 },
        );
      await sql`
        UPDATE providers SET api_key_encrypted = ${encryptSecret(key)}, key_hint = ${maskSecret(key)},
          verified_at = now(), updated_at = now()
        WHERE id = ${id}`;
    }
    await sql`UPDATE providers SET updated_at = now() WHERE id = ${id}`;
  } catch {
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: "Gagal mengubah provider." } }, { status: 500 });
  }
  invalidateRegistry();
  return NextResponse.json({ ok: true, providers: await listProviders() });
}

// Hapus provider beserta seluruh modelnya (model ikut hilang dari katalog user).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }
  const { id } = await params;
  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM ai_models WHERE provider_id = ${id}`;
      await tx`DELETE FROM providers WHERE id = ${id}`;
    });
  } catch {
    return NextResponse.json({ error: { code: "SERVER_ERROR", message: "Gagal menghapus provider." } }, { status: 500 });
  }
  invalidateRegistry();
  return NextResponse.json({ ok: true });
}
