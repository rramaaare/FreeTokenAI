import { NextResponse } from "next/server";
import { claimUrl } from "@/lib/app-url";
import { corsHeaders, requireAdmin, requireAllowedOrigin } from "@/lib/auth";
import { sql } from "@/lib/db";

// ponytail: PRD §7.1 — POST /api/v1/admin/receipts/generate, idempoten via
// pos_reference_id UNIQUE (PRD §5.2). Kuota cafe dipotong atomik
// `UPDATE ... WHERE prepaid_token_balance >= n RETURNING` — tanpa read-then-write.
// 1) guard origin+role (requireAdmin) 2) INSERT receipt ON CONFLICT DO NOTHING
// 3) potong kuota 4) ledger cafe_token_transactions. Semua dalam SATU sql.begin
// agar tidak ada receipt tanpa potongan kuota.

class InsufficientQuotaError extends Error {}

type ReceiptOut = {
  id: string;
  code: string;
  tokens_granted: number;
  purchase_type: string | null;
  rupiah_amount: number | null;
  created_at: string;
};

// ponytail: format RST-<random 6 digit> (contoh PRD §4.1 RST-98234). Retry kecil
// bila tabrakan receipts_code_key (kolom UNIQUE).
function generateCode(): string {
  return `RST-${Math.floor(100000 + Math.random() * 900000)}`;
}

function err(origin: string | null, status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(req: Request) {
  const origin = requireAllowedOrigin(req);
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = requireAllowedOrigin(req);
  if (origin === "denied") return err(null, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan.");

  const auth = await requireAdmin(req, { roles: ["kasir", "super_admin"] });
  if (typeof auth === "string")
    return err(origin, auth === "unauthorized" ? 401 : 403, auth.toUpperCase(), "Akses admin tidak sah.");

  let body: {
    cafe_id?: unknown;
    mode?: unknown;
    rupiah_amount?: unknown;
    token_package_id?: unknown;
    tokens?: unknown;
    pos_reference_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return err(origin, 400, "INVALID_BODY", "Body bukan JSON.");
  }
  const ref = typeof body.pos_reference_id === "string" ? body.pos_reference_id.trim() : "";
  if (ref.length < 3 || ref.length > 100)
    return err(origin, 400, "INVALID_POS_REFERENCE", "pos_reference_id wajib 3–100 karakter.");

  // cafe yang berhak: super_admin boleh ke cafe mana pun (wajib kasih cafe_id);
  // kasir HANYA cafe miliknya — cafe_id di-body tak boleh mengarahkan ke cafe lain.
  const rawCafe =
    body.cafe_id !== undefined && body.cafe_id !== null && body.cafe_id !== ""
      ? String(body.cafe_id).trim()
      : "";
  let cafeId: string;
  if (auth.user.role === "kasir") {
    if (!auth.user.cafe_id) return err(origin, 403, "FORBIDDEN_CAFE", "Akun kasir belum terikat cafe.");
    if (rawCafe && rawCafe !== auth.user.cafe_id)
      return err(origin, 403, "FORBIDDEN_CAFE", "Kasir hanya boleh generate untuk cafe sendiri.");
    cafeId = auth.user.cafe_id;
  } else {
    if (!rawCafe) return err(origin, 400, "CAFE_REQUIRED", "cafe_id wajib untuk super_admin.");
    cafeId = rawCafe;
  }

  const cafe = (await sql`
    SELECT name, prepaid_token_balance, retail_rupiah_per_token, bonus_rupiah_per_token
    FROM cafes WHERE id = ${cafeId} LIMIT 1`) as unknown as {
    name: string;
    prepaid_token_balance: number;
    retail_rupiah_per_token: number;
    bonus_rupiah_per_token: number;
  }[];
  if (!cafe[0]) return err(origin, 404, "CAFE_NOT_FOUND", "Cafe tidak ditemukan.");

  // Jumlah token & nominal SELALU dihitung di server dari tarif cafe — angka
  // dari klien hanya input (nominal belanja / jumlah token), bukan hasil.
  //   product = bonus belanja: floor(nominal / bonus_rupiah_per_token)
  //   retail  = token ketengan: harga = token * retail_rupiah_per_token
  //   package = paket token; manual = token tanpa harga (kompat lama)
  let tokens: number;
  let rupiah: number | null = null;
  let pkgId: string | null = null;
  let purchaseType: "product" | "retail" | "package" | "manual";
  if (body.mode === "product") {
    const rp = Number(body.rupiah_amount);
    if (!Number.isInteger(rp) || rp <= 0 || rp > 1_000_000_000)
      return err(origin, 400, "INVALID_AMOUNT", "Nominal belanja wajib angka bulat Rp1–Rp1.000.000.000.");
    tokens = Math.floor(rp / cafe[0].bonus_rupiah_per_token);
    if (tokens < 1)
      return err(origin, 400, "AMOUNT_TOO_SMALL", `Nominal belanja minimal Rp${cafe[0].bonus_rupiah_per_token.toLocaleString("id-ID")} untuk dapat 1 token.`);
    rupiah = rp;
    purchaseType = "product";
  } else if (body.token_package_id !== undefined && body.token_package_id !== null && body.token_package_id !== "") {
    const tid = String(body.token_package_id).trim();
    const pkgs = (await sql`
      SELECT id, tokens_granted, rupiah_amount FROM token_packages
      WHERE id = ${tid} AND is_active = TRUE AND (cafe_id IS NULL OR cafe_id = ${cafeId})
      LIMIT 1`) as unknown as { id: string; tokens_granted: number; rupiah_amount: number }[];
    if (!pkgs[0]) return err(origin, 400, "PACKAGE_NOT_FOUND", "Paket token tidak ditemukan / tidak aktif.");
    pkgId = pkgs[0].id;
    tokens = pkgs[0].tokens_granted;
    rupiah = pkgs[0].rupiah_amount;
    purchaseType = "package";
  } else {
    const t = Number(body.tokens);
    if (!Number.isInteger(t) || t <= 0 || t > 10_000_000)
      return err(origin, 400, "INVALID_TOKENS", "tokens wajib integer antara 1 dan 10.000.000.");
    tokens = t;
    if (body.mode === "retail") {
      rupiah = t * cafe[0].retail_rupiah_per_token;
      purchaseType = "retail";
    } else {
      purchaseType = "manual";
    }
  }

  // fast-fail kuota (tanpa baca-tulis): saldo jelas tak cukup -> 402 langsung.
  // Pengecekan final tetap UPDATE atomik di dalam transaksi.
  if (cafe[0].prepaid_token_balance < tokens)
    return err(origin, 402, "INSUFFICIENT_CAFE_QUOTA", "Kuota token prepaid cafe tidak cukup.");

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    try {
      const out = (await sql.begin(async (tx: any) => {
        const ins = (await tx`
          INSERT INTO receipts (code, pos_reference_id, tokens_granted, cafe_id, token_package_id, created_by_user_id, purchase_type, rupiah_amount)
          VALUES (${code}, ${ref}, ${tokens}, ${cafeId}, ${pkgId}, ${auth.user.id}, ${purchaseType}, ${rupiah})
          ON CONFLICT (pos_reference_id) DO NOTHING
          RETURNING id, code, tokens_granted, purchase_type, rupiah_amount, created_at`) as unknown as ReceiptOut[];
        if (!ins[0]) {
          // idempoten: sudah pernah dibuat — kembalikan receipt yang sama (PRD §5.2).
          const ex = (await tx`
            SELECT id, code, tokens_granted, purchase_type, rupiah_amount, created_at
            FROM receipts WHERE pos_reference_id = ${ref} LIMIT 1`) as unknown as ReceiptOut[];
          return { kind: "existing" as const, receipt: ex[0] };
        }
        const upd = (await tx`
          UPDATE cafes SET prepaid_token_balance = prepaid_token_balance - ${tokens}
          WHERE id = ${cafeId} AND prepaid_token_balance >= ${tokens}
          RETURNING prepaid_token_balance`) as unknown as { prepaid_token_balance: number }[];
        if (!upd[0]) throw new InsufficientQuotaError();
        await tx`
          INSERT INTO cafe_token_transactions (cafe_id, type, amount, balance_after, reference_type, reference_id)
          VALUES (${cafeId}, 'reserve', ${-tokens}, ${upd[0].prepaid_token_balance}, 'receipt', ${ins[0].id})`;
        return { kind: "created" as const, receipt: ins[0] };
      })) as unknown as { kind: "created" | "existing"; receipt: ReceiptOut };
      const r = out.receipt;
      return NextResponse.json(
        {
          code: r.code,
          claim_url: claimUrl(req, r.code),
          tokens: r.tokens_granted,
          purchase_type: r.purchase_type,
          rupiah_amount: r.rupiah_amount,
          created_at: r.created_at,
          pos_reference_id: ref,
          cafe_name: cafe[0].name,
        },
        { status: out.kind === "created" ? 201 : 200, headers: corsHeaders(origin) },
      );
    } catch (e) {
      if (e instanceof InsufficientQuotaError)
        return err(origin, 402, "INSUFFICIENT_CAFE_QUOTA", "Kuota token prepaid cafe tidak cukup.");
      if (attempt < 5 && (e as { code?: string })?.code === "23505") continue; // receipts_code_key langka
      throw e;
    }
  }
  return err(origin, 500, "CODE_EXHAUSTED", "Gagal generate kode unik, coba lagi.");
}