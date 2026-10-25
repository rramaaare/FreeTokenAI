import { NextResponse } from "next/server";
import { claimUrl } from "@/lib/app-url";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";

// ponytail: cek status struk untuk kasir — kode struk -> sudah diklaim / belum,
// siapa pengklaimnya (disamarkan), dan sisa saldo workspace pelanggan itu.
// Kasir hanya boleh lihat struk cafe-nya sendiri; super_admin semua cafe.

function mask(v: string | null): string | null {
  if (!v) return null;
  if (v.includes("@")) {
    const [name, domain] = v.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return v.length <= 6 ? `${v.slice(0, 2)}***` : `${v.slice(0, 4)}****${v.slice(-3)}`;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Akses tidak sah." } }, { status });
  }

  const code = (new URL(req.url).searchParams.get("code") ?? "").trim().toUpperCase().slice(0, 20);
  if (!code) {
    return NextResponse.json({ error: { code: "CODE_REQUIRED", message: "Kode struk wajib." } }, { status: 400 });
  }

  const rows = (await sql`
    SELECT r.code, r.tokens_granted, r.is_claimed, r.claimed_at, r.created_at, r.cafe_id,
           r.purchase_type, r.rupiah_amount, r.pos_reference_id,
           c.name AS cafe_name, u.email, u.phone_number, u.name AS user_name,
           w.token_balance, w.expires_at
    FROM receipts r
    LEFT JOIN cafes c ON c.id = r.cafe_id
    LEFT JOIN users u ON u.id = r.claimed_by_user_id
    LEFT JOIN workspaces w ON w.id = r.workspace_id
    WHERE r.code = ${code} LIMIT 1`) as unknown as Array<{
    code: string;
    tokens_granted: number;
    is_claimed: boolean;
    claimed_at: string | null;
    created_at: string;
    cafe_id: string | null;
    purchase_type: string | null;
    rupiah_amount: number | null;
    pos_reference_id: string | null;
    cafe_name: string | null;
    email: string | null;
    phone_number: string | null;
    user_name: string | null;
    token_balance: number | null;
    expires_at: string | null;
  }>;

  const r = rows[0];
  // kasir cafe lain diperlakukan sama dengan "tidak ada" supaya kode tak bisa ditebak lintas cafe.
  if (!r || (auth.user.role === "kasir" && r.cafe_id !== auth.user.cafe_id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Kode struk tidak ditemukan." } }, { status: 404 });
  }

  const expired = r.expires_at ? new Date(r.expires_at).getTime() < Date.now() : false;
  return NextResponse.json({
    receipt: {
      code: r.code,
      tokens: r.tokens_granted,
      created_at: r.created_at,
      cafe_name: r.cafe_name,
      claimed: Boolean(r.is_claimed),
      claimed_at: r.claimed_at,
      claim_url: claimUrl(req, r.code),
      purchase_type: r.purchase_type,
      rupiah_amount: r.rupiah_amount,
      pos_reference_id: r.pos_reference_id,
    },
    customer: r.is_claimed
      ? {
          name: r.user_name,
          contact: mask(r.email ?? r.phone_number),
          token_balance: r.token_balance ?? 0,
          expires_at: r.expires_at,
          expired,
        }
      : null,
  });
}
