import { NextResponse } from "next/server";
import { corsHeaders, requireAdmin, requireAllowedOrigin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { permissionDenied } from "@/lib/permissions";
import { RECEIPT_VALID_DAYS, sweepExpiredReceipts } from "@/lib/receipts";

// ponytail: dashboard kasir = 1 endpoint scoped ke cafe milik kasir (JWT
// cafe_id). Fokus ke penjualan struk (bonus produk vs token ketengan), struk
// yang belum diklaim, dan sisa saldo prepaid cafe. Pemakaian AI pelanggan
// tetap diringkas — atribusi COALESCE(usage_logs.cafe_id, workspaces.cafe_id)
// sama seperti /admin/cafes/:id/usage untuk baris lama.
// "Ketengan" = retail + paket + manual/legacy (semua struk yang bukan bonus produk).
export async function OPTIONS(req: Request) {
  const origin = requireAllowedOrigin(req);
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

type SalesRow = {
  receipts: number;
  rupiah: number;
  tokens: number;
  product_receipts: number;
  product_rupiah: number;
  product_tokens: number;
  retail_receipts: number;
  retail_rupiah: number;
  retail_tokens: number;
  claimed: number;
};

export async function GET(req: Request) {
  const origin = requireAllowedOrigin(req);
  if (origin === "denied")
    return NextResponse.json(
      { error: { code: "FORBIDDEN_ORIGIN", message: "Origin tidak diizinkan." } },
      { status: 403, headers: corsHeaders(null) },
    );
  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string")
    return NextResponse.json(
      { error: { code: auth.toUpperCase(), message: "Akses kasir tidak sah." } },
      { status: auth === "unauthorized" ? 401 : 403, headers: corsHeaders(origin) },
    );
  const denied = await permissionDenied(auth.user.role, "kasir.dashboard", corsHeaders(origin));
  if (denied) return denied;

  const cafeId = new URL(req.url).searchParams.get("cafe_id") ?? auth.user.cafe_id;
  if (!cafeId)
    return NextResponse.json(
      { error: { code: "FORBIDDEN_CAFE", message: "Akun kasir belum terikat cafe." } },
      { status: 403, headers: corsHeaders(origin) },
    );
  if (auth.user.role !== "super_admin" && cafeId !== auth.user.cafe_id)
    return NextResponse.json(
      { error: { code: "FORBIDDEN_CAFE", message: "Bukan cafe Anda." } },
      { status: 403, headers: corsHeaders(origin) },
    );

  try {
    // token struk kedaluwarsa kembali ke saldo cafe — jalankan async non-blocking
    // supaya dashboard tidak lambat/timeout kalau banyak struk expired.
    void sweepExpiredReceipts(cafeId);
    const cafes = (await sql`
      SELECT id, name, prepaid_token_balance::int AS token_balance, is_active
      FROM cafes WHERE id = ${cafeId} LIMIT 1`) as unknown as {
      id: string; name: string; token_balance: number; is_active: boolean;
    }[];
    if (!cafes[0])
      return NextResponse.json(
        { error: { code: "CAFE_NOT_FOUND", message: "Cafe tidak ditemukan." } },
        { status: 404, headers: corsHeaders(origin) },
      );

    const [today, week, byDay, unclaimed, expiredWeek, recent, usage, byEndpoint, transactions] = (await Promise.all([
      salesSince(cafeId, sql`current_date`),
      salesSince(cafeId, sql`current_date - interval '6 days'`),
      sql`
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
          COALESCE(SUM(tokens_granted) FILTER (WHERE purchase_type = 'product'), 0)::int AS product,
          COALESCE(SUM(tokens_granted) FILTER (WHERE purchase_type IS DISTINCT FROM 'product'), 0)::int AS retail,
          COALESCE(SUM(rupiah_amount) FILTER (WHERE purchase_type IS DISTINCT FROM 'product'), 0)::bigint AS retail_rupiah
        FROM receipts
        WHERE cafe_id = ${cafeId} AND created_at >= current_date - interval '6 days'
        GROUP BY 1 ORDER BY 1`,
      sql`
        SELECT COUNT(*)::int AS receipts, COALESCE(SUM(tokens_granted), 0)::int AS tokens,
          MIN(created_at) AS oldest, MIN(expires_at) AS next_expiry
        FROM receipts WHERE cafe_id = ${cafeId} AND is_claimed IS NOT TRUE
          AND refunded_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      sql`
        SELECT COUNT(*)::int AS receipts, COALESCE(SUM(tokens_granted), 0)::int AS tokens
        FROM receipts WHERE cafe_id = ${cafeId} AND refunded_at >= current_date - interval '6 days'`,
      sql`
        SELECT code, tokens_granted AS tokens, purchase_type, rupiah_amount, COALESCE(is_claimed, FALSE) AS claimed,
          (is_claimed IS NOT TRUE AND (refunded_at IS NOT NULL OR expires_at <= now())) AS expired, created_at
        FROM receipts WHERE cafe_id = ${cafeId}
        ORDER BY created_at DESC LIMIT 8`,
      sql`
        SELECT
          COALESCE(SUM(ul.tokens_burned) FILTER (WHERE ul.created_at >= current_date), 0)::int AS today_tokens,
          COALESCE(SUM(ul.tokens_burned), 0)::int AS week_tokens,
          COUNT(DISTINCT ul.workspace_id) FILTER (WHERE ul.created_at >= current_date)::int AS today_customers,
          COUNT(DISTINCT ul.workspace_id)::int AS week_customers
        FROM usage_logs ul LEFT JOIN workspaces w ON w.id = ul.workspace_id
        WHERE COALESCE(ul.cafe_id, w.cafe_id) = ${cafeId} AND ul.status = 'success'
          AND ul.created_at >= current_date - interval '6 days'`,
      sql`
        SELECT ul.endpoint_type, COUNT(*)::int AS requests, COALESCE(SUM(ul.tokens_burned), 0)::int AS tokens
        FROM usage_logs ul LEFT JOIN workspaces w ON w.id = ul.workspace_id
        WHERE COALESCE(ul.cafe_id, w.cafe_id) = ${cafeId} AND ul.status = 'success'
          AND ul.created_at >= current_date - interval '6 days'
        GROUP BY ul.endpoint_type ORDER BY tokens DESC`,
      sql`
        SELECT type, amount, balance_after, note, created_at
        FROM cafe_token_transactions WHERE cafe_id = ${cafeId}
        ORDER BY created_at DESC LIMIT 5`,
    ])) as unknown as [
      SalesRow[],
      SalesRow[],
      { day: string; product: number; retail: number; retail_rupiah: string | number }[],
      { receipts: number; tokens: number; oldest: string | null; next_expiry: string | null }[],
      { receipts: number; tokens: number }[],
      { code: string; tokens: number; purchase_type: string | null; rupiah_amount: number | null; claimed: boolean; expired: boolean; created_at: string }[],
      { today_tokens: number; week_tokens: number; today_customers: number; week_customers: number }[],
      { endpoint_type: string; requests: number; tokens: number }[],
      { type: string; amount: number; balance_after: number; note: string | null; created_at: string }[],
    ];

    const byDayMap = new Map(byDay.map((d) => [d.day, d]));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const row = byDayMap.get(key);
      return { day: key, product: row?.product ?? 0, retail: row?.retail ?? 0, retail_rupiah: Number(row?.retail_rupiah ?? 0) };
    });

    // estimasi saldo cafe cukup berapa hari, dari rata-rata token terbit 7 hari.
    const avgDaily = days.reduce((s, d) => s + d.product + d.retail, 0) / 7;
    const daysLeft = avgDaily > 0 ? Math.floor(cafes[0].token_balance / avgDaily) : null;

    return NextResponse.json(
      {
        cafe: cafes[0],
        sales: { today: normalize(today[0]), week: normalize(week[0]) },
        by_day: days,
        balance_forecast: { avg_daily_tokens: Math.round(avgDaily), days_left: daysLeft },
        unclaimed: unclaimed[0] ?? { receipts: 0, tokens: 0, oldest: null, next_expiry: null },
        expired_week: expiredWeek[0] ?? { receipts: 0, tokens: 0 },
        receipt_valid_days: RECEIPT_VALID_DAYS,
        recent_receipts: recent,
        usage: usage[0] ?? { today_tokens: 0, week_tokens: 0, today_customers: 0, week_customers: 0 },
        by_endpoint: byEndpoint,
        transactions,
        generated_at: new Date().toISOString(),
      },
      { headers: corsHeaders(origin) },
    );
  } catch (err) {
    console.error("[kasir/dashboard]", err);
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: "Gagal memuat dashboard kasir." } },
      { status: 500, headers: corsHeaders(origin) },
    );
  }
}

// ponytail: nominal "ketengan" = uang token yang dibayar pelanggan; nominal
// "produk" = total belanja (bukan pendapatan token), jadi dilaporkan terpisah.
function salesSince(cafeId: string, since: ReturnType<typeof sql>) {
  return sql`
    SELECT
      COUNT(*)::int AS receipts,
      COALESCE(SUM(tokens_granted), 0)::int AS tokens,
      COUNT(*) FILTER (WHERE purchase_type = 'product')::int AS product_receipts,
      COALESCE(SUM(rupiah_amount) FILTER (WHERE purchase_type = 'product'), 0)::bigint AS product_rupiah,
      COALESCE(SUM(tokens_granted) FILTER (WHERE purchase_type = 'product'), 0)::int AS product_tokens,
      COUNT(*) FILTER (WHERE purchase_type IS DISTINCT FROM 'product')::int AS retail_receipts,
      COALESCE(SUM(rupiah_amount) FILTER (WHERE purchase_type IS DISTINCT FROM 'product'), 0)::bigint AS retail_rupiah,
      COALESCE(SUM(tokens_granted) FILTER (WHERE purchase_type IS DISTINCT FROM 'product'), 0)::int AS retail_tokens,
      COUNT(*) FILTER (WHERE is_claimed)::int AS claimed
    FROM receipts
    WHERE cafe_id = ${cafeId} AND created_at >= ${since}`;
}

// bigint dari postgres datang sebagai string.
function normalize(r: SalesRow | undefined) {
  const z = (v: unknown) => Number(v ?? 0);
  return {
    receipts: z(r?.receipts),
    tokens: z(r?.tokens),
    claimed: z(r?.claimed),
    product: { receipts: z(r?.product_receipts), rupiah: z(r?.product_rupiah), tokens: z(r?.product_tokens) },
    retail: { receipts: z(r?.retail_receipts), rupiah: z(r?.retail_rupiah), tokens: z(r?.retail_tokens) },
  };
}
