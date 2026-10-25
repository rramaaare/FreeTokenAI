import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";

// ponytail: tarif billing cafe milik kasir — dipakai halaman Buat Struk untuk
// pratinjau token/harga dan kop struk cetak. Hitungan final tetap di
// /admin/receipts/generate.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string") {
    const status = auth === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Akses tidak sah." } }, { status });
  }
  const cafeId =
    auth.user.role === "super_admin" ? new URL(req.url).searchParams.get("cafe_id") ?? auth.user.cafe_id : auth.user.cafe_id;
  if (!cafeId)
    return NextResponse.json({ error: { code: "FORBIDDEN_CAFE", message: "Akun kasir belum terikat cafe." } }, { status: 403 });

  const rows = (await sql`
    SELECT id, name, retail_rupiah_per_token, bonus_rupiah_per_token
    FROM cafes WHERE id = ${cafeId} LIMIT 1`) as unknown as {
    id: string;
    name: string;
    retail_rupiah_per_token: number;
    bonus_rupiah_per_token: number;
  }[];
  if (!rows[0]) return NextResponse.json({ error: { code: "CAFE_NOT_FOUND", message: "Cafe tidak ditemukan." } }, { status: 404 });
  return NextResponse.json({ cafe: rows[0] });
}
