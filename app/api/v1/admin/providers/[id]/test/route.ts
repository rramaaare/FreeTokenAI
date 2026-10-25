import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

// Uji koneksi API key ke provider (handshake /connect ala OpenCode).
// Bisa dipakai dengan key baru (body: api_key) ATAU key tersimpan (tanpa body).
// Tidak menyimpan apa pun — hanya memvalidasi.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { roles: ["super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Hanya super_admin." } }, { status });
  }
  const { id } = await params;

  let body: { api_key?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // tanpa body -> uji key tersimpan
  }

  const { cleanApiKey, providerKey, testProviderKey } = await import("@/lib/model-registry");
  const { sql } = await import("@/lib/db");
  const rows = (await sql`
    SELECT slug, base_url FROM providers WHERE id = ${id} LIMIT 1`) as unknown as {
    slug: string;
    base_url: string;
  }[];
  if (!rows[0])
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Provider tidak ditemukan." } }, { status: 404 });

  const key = typeof body.api_key === "string" && body.api_key.trim()
    ? cleanApiKey(body.api_key)
    : await providerKey(rows[0].slug);
  if (!key)
    return NextResponse.json(
      { error: { code: "NO_KEY", message: "Belum ada API key untuk diuji." } },
      { status: 400 },
    );

  const result = await testProviderKey(rows[0].slug, rows[0].base_url, key);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
