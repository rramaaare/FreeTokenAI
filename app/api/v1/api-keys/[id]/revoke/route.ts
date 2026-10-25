import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/db";

// ponytail: PRD §7.4 — cabut (bukan hapus) karena usage_logs.api_key_id
// mereferensikan baris ini; is_active=false langsung mematikan gateway
// (validateApiKey WHERE is_active=TRUE).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!auth)
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Belum login." } },
      { status: 401 },
    );
  const { id } = await params;
  const rows = (await sql`
    UPDATE api_keys SET is_active = FALSE
    WHERE id = ${id} AND workspace_id IN (
      SELECT id FROM workspaces WHERE user_id = ${auth.user.id}
    )
    RETURNING id, is_active`) as unknown as { id: string; is_active: boolean }[];
  if (!rows[0])
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "API key tidak ditemukan." } },
      { status: 404 },
    );
  return NextResponse.json({ api_key: rows[0] });
}
