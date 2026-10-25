import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { permissionDenied } from "@/lib/permissions";

// ponytail: PRD §7.4/§5.3 + NFR#2 — key asli `rst_live_<128-bit>` hanya
// dikembalikan SEKALI di respons POST; DB simpan SHA-256 (validateApiKey di
// lib/billing.ts sudah mencocokkan hash ini) + key_prefix untuk tampilan.
// Key prefix = 10 char pertama (kolom VARCHAR(10), PRD §5.3).

async function workspaceOf(userId: string): Promise<string | null> {
  const rows = (await sql`
    SELECT id FROM workspaces WHERE user_id = ${userId} ORDER BY created_at LIMIT 1`) as unknown as {
    id: string;
  }[];
  return rows[0]?.id ?? null;
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Belum login." } },
    { status: 401 },
  );
}

async function authedWorkspace(req: Request) {
  const auth = await requireAuth(req);
  if (!auth) return { error: unauthorized() as NextResponse };
  const wsId = await workspaceOf(auth.user.id);
  if (!wsId)
    return {
      error: NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "Workspace belum ada — klaim QR dulu." } },
        { status: 404 },
      ) as NextResponse,
    };
  return { wsId };
}

export async function GET(req: Request) {
  const { wsId, error } = await authedWorkspace(req);
  if (error) return error;
  const rows = (await sql`
    SELECT id, name, key_prefix, is_active, created_at FROM api_keys
    WHERE workspace_id = ${wsId!} ORDER BY created_at DESC`) as unknown as {
    id: string;
    name: string;
    key_prefix: string;
    is_active: boolean;
    created_at: string;
  }[];
  return NextResponse.json({ api_keys: rows });
}

export async function POST(req: Request) {
  const { wsId, error } = await authedWorkspace(req);
  if (error) return error;
  const denied = await permissionDenied("customer", "ai.developer");
  if (denied) return denied;
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 100) || "Default Key";

  // ponytail: randomBytes(16) = 128-bit; cukup, tak perlu 256.
  const full = `rst_live_${randomBytes(16).toString("hex")}`;
  const keyHash = createHash("sha256").update(full).digest("hex");
  const rows = (await sql`
    INSERT INTO api_keys (workspace_id, key_hash, key_prefix, name)
    VALUES (${wsId!}, ${keyHash}, ${full.slice(0, 10)}, ${name})
    RETURNING id, name, key_prefix, is_active, created_at`) as unknown as {
    id: string;
    name: string;
    key_prefix: string;
    is_active: boolean;
    created_at: string;
  }[];
  // key asli HANYA di sini (NFR#2)
  return NextResponse.json({ key: full, api_key: rows[0] }, { status: 201 });
}
