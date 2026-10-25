import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "./db";
import { logReq, newRequestId } from "./obs";
import { requireAuth } from "./auth";

// ponytail: ledger dua arah (PRD §5.2) — burn saat deduct, refund saat refund,
// masing-masing SATU transaksi sql.begin dengan UPDATE workspaces-nya.
// Jangan return array dari callback sql.begin (itu mode pipeline postgres.js).

// Masa aktif workspace (aturan bisnis Okt 2026):
//  - isi ulang (klaim struk / top-up admin) = sisa masa aktif + 7 hari,
//    dihitung dari sekarang bila sudah lewat; dibatasi maks 30 hari ke depan
//    supaya klaim struk kecil berulang tidak menumpuk masa aktif tanpa batas.
//  - lewat masa aktif = AI ditolak (saldo tetap ada, aktif lagi saat isi ulang).
//  - pemakaian TIDAK memperpanjang masa aktif.
export const WORKSPACE_TOPUP_DAYS = 7;
export const WORKSPACE_MAX_DAYS = 30;

/** Ekspresi SQL expires_at baru saat isi ulang (dipakai klaim & top-up admin). */
export function extendedExpiry() {
  return sql`LEAST(
    GREATEST(COALESCE(expires_at, now()), now()) + make_interval(days => ${WORKSPACE_TOPUP_DAYS}),
    now() + make_interval(days => ${WORKSPACE_MAX_DAYS})
  )`;
}

export class InsufficientTokensError extends Error {
  balance: number;
  expired = false;
  constructor(balance: number) {
    super("Saldo Token tidak cukup.");
    this.balance = balance;
  }
}

// Turunan InsufficientTokensError supaya semua catch yang sudah ada ikut menanganinya.
export class WorkspaceExpiredError extends InsufficientTokensError {
  expired = true;
  constructor(balance: number) {
    super(balance);
    this.message = "Masa aktif workspace habis.";
  }
}

export function insufficientMessage(e: { balance: number; expired?: boolean }, lang: "id" | "en" = "id") {
  if (e.expired)
    return lang === "en"
      ? `Your workspace has expired (${e.balance} Tokens left). Claim a new receipt to reactivate it.`
      : `Masa aktif workspace habis (sisa ${e.balance} Token). Klaim struk baru untuk mengaktifkan lagi.`;
  return lang === "en"
    ? `Not enough Tokens (balance ${e.balance}). Claim a receipt first.`
    : `Saldo Token tidak cukup (sisa ${e.balance}). Klaim struk dulu.`;
}

export function insufficient(
  e: number | { balance: number; expired?: boolean },
  service: "chat" | "image" | "video" | "developer_api" = "chat",
) {
  const err = typeof e === "number" ? { balance: e, expired: false } : e;
  const userMessage = insufficientMessage(err);
  return NextResponse.json(
    {
      error: { code: err.expired ? "WORKSPACE_EXPIRED" : "INSUFFICIENT_TOKENS", message: userMessage },
      gatekeeper: {
        decision: "BLOCK",
        service,
        category: "credit",
        risk_level: "low",
        reason: err.expired ? "Masa aktif workspace sudah lewat." : "Saldo workspace tidak mencukupi biaya permintaan.",
        user_message: userMessage,
      },
    },
    { status: 402 },
  );
}

/** Tolak workspace yang sudah lewat masa aktif (sebelum memanggil provider). */
async function assertActive(workspaceId: string): Promise<number> {
  const rows = (await sql`
    SELECT token_balance, (expires_at IS NOT NULL AND expires_at <= now()) AS expired
    FROM workspaces WHERE id = ${workspaceId}`) as unknown as { token_balance: number; expired: boolean }[];
  const balance = rows[0]?.token_balance ?? 0;
  if (rows[0]?.expired) throw new WorkspaceExpiredError(balance);
  return balance;
}

// ponytail: PRD §6 — chat 1/10, image 3/50, video 5/200 (murah vs pro).
export function chatCost(model: string) {
  return /pro|120b/i.test(model) ? 10 : 1;
}

export function imageCost(model?: string) {
  return model === "nano-banana-pro" ? 50 : 3;
}

export function videoCost(model?: string) {
  return model === "veo-3.1-quality" ? 200 : 5;
}

export type BillingMeta = {
  apiKeyId?: string | null;
  modelId: string;
  endpointType: "chat" | "image" | "video";
  mediaUrl?: string | null;
  // ponytail: pengali biaya per request (mis. 2 gambar = 2×). Dibaca `withTokens`.
  units?: number;
  // ponytail: callback id usage_log yang baru dibuat — /api/chat menautkan
  // baris assistant chat_messages.usage_log_id (PRD §5.3). Opsional, aditif.
  onUsageLogged?: (usageId: string) => void;
};

export async function balanceOf(workspaceId: string): Promise<number> {
  const rows = (await sql`SELECT token_balance FROM workspaces WHERE id = ${workspaceId}`) as unknown as {
    token_balance: number;
  }[];
  return rows[0]?.token_balance ?? 0;
}

type Deduction = { balance: number; ledgerId: string };

// deduct gagal karena saldo kurang ATAU masa aktif lewat (race dengan assertActive).
async function deductFailure(workspaceId: string): Promise<InsufficientTokensError> {
  try {
    return new InsufficientTokensError(await assertActive(workspaceId));
  } catch (e) {
    if (e instanceof InsufficientTokensError) return e;
    throw e;
  }
}

async function deduct(workspaceId: string, cost: number): Promise<Deduction | null> {
  const out: Deduction | null = await sql.begin(async (tx) => {
    const rows = (await tx`
      UPDATE workspaces SET token_balance = token_balance - ${cost}
      WHERE id = ${workspaceId} AND token_balance >= ${cost}
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING token_balance`) as unknown as { token_balance: number }[];
    if (!rows[0]) return null;
    const led = (await tx`
      INSERT INTO token_transactions (workspace_id, type, amount, balance_after)
      VALUES (${workspaceId}, 'burn', ${-cost}, ${rows[0].token_balance})
      RETURNING id`) as unknown as { id: string }[];
    return { balance: rows[0].token_balance, ledgerId: led[0].id };
  });
  return out;
}

// ponytail: atribusi cafe untuk usage_logs — workspace dulu, fallback ke key.
async function resolveCafeId(
  tx: any,
  workspaceId: string | null,
  apiKeyId: string | null,
): Promise<string | null> {
  if (workspaceId) {
    const rows = (await tx`
      SELECT cafe_id FROM workspaces WHERE id = ${workspaceId} LIMIT 1`) as unknown as {
      cafe_id: string | null;
    }[];
    if (rows[0]?.cafe_id) return rows[0].cafe_id;
  }
  if (apiKeyId) {
    const rows = (await tx`
      SELECT cafe_id FROM api_keys WHERE id = ${apiKeyId} LIMIT 1`) as unknown as {
      cafe_id: string | null;
    }[];
    return rows[0]?.cafe_id ?? null;
  }
  return null;
}

// ponytail: counter monitoring. Request ber-key -> key itu; request dashboard
// (tanpa key) -> semua key aktif milik workspace tersebut, supaya angka
// "terpakai" di API Key Pelanggan ikut saldo workspace yang benar-benar burn.
async function syncKeyUsage(
  tx: any,
  workspaceId: string | null,
  apiKeyId: string | null,
  delta: number,
) {
  if (apiKeyId) {
    await tx`
      UPDATE api_keys SET tokens_used = GREATEST(tokens_used + ${delta}, 0),
        last_used_at = CASE WHEN ${delta} > 0 THEN now() ELSE last_used_at END
      WHERE id = ${apiKeyId}`;
    return;
  }
  if (workspaceId) {
    await tx`
      UPDATE api_keys SET tokens_used = GREATEST(tokens_used + ${delta}, 0),
        last_used_at = CASE WHEN ${delta} > 0 THEN now() ELSE last_used_at END
      WHERE workspace_id = ${workspaceId} AND is_active = TRUE AND revoked_at IS NULL`;
  }
}

async function logBurn(workspaceId: string, cost: number, meta: BillingMeta, ledgerId: string) {
  await sql.begin(async (tx) => {
    const cafeId = await resolveCafeId(tx, workspaceId, meta.apiKeyId ?? null);
    const usage = (await tx`
      INSERT INTO usage_logs (workspace_id, api_key_id, cafe_id, model_id, tokens_burned, endpoint_type, status, media_url)
      VALUES (${workspaceId}, ${meta.apiKeyId ?? null}, ${cafeId}, ${meta.modelId}, ${cost}, ${meta.endpointType}, 'success', ${meta.mediaUrl ?? null})
      RETURNING id`) as unknown as { id: string }[];
    await tx`
      UPDATE token_transactions SET reference_type = 'usage_log', reference_id = ${usage[0].id}
      WHERE id = ${ledgerId}`;
    await syncKeyUsage(tx, workspaceId, meta.apiKeyId ?? null, cost);
    meta.onUsageLogged?.(usage[0].id);
  });
}

async function refund(workspaceId: string, cost: number, meta: BillingMeta, ledgerId: string): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      UPDATE workspaces SET token_balance = token_balance + ${cost}
      WHERE id = ${workspaceId} RETURNING token_balance`) as unknown as { token_balance: number }[];
    const balance = rows[0]?.token_balance ?? 0;
    const cafeId = await resolveCafeId(tx, workspaceId, meta.apiKeyId ?? null);
    const usage = (await tx`
      INSERT INTO usage_logs (workspace_id, api_key_id, cafe_id, model_id, tokens_burned, endpoint_type, status, media_url)
      VALUES (${workspaceId}, ${meta.apiKeyId ?? null}, ${cafeId}, ${meta.modelId}, ${cost}, ${meta.endpointType}, 'refunded', ${meta.mediaUrl ?? null})
      RETURNING id`) as unknown as { id: string }[];
    await syncKeyUsage(tx, workspaceId, meta.apiKeyId ?? null, -cost);
    await tx`
      INSERT INTO token_transactions (workspace_id, type, amount, balance_after, reference_type, reference_id)
      VALUES (${workspaceId}, 'refund', ${cost}, ${balance}, 'usage_log', ${usage[0].id})`;
    await tx`
      UPDATE token_transactions SET reference_type = 'usage_log', reference_id = ${usage[0].id}
      WHERE id = ${ledgerId}`;
    return balance;
  });
}

// ponytail: deduct atomik -> vendor fn() -> sukses catat burn; throw /
// respons !ok (!=402) vendor catat refund. Jangan tahan transaksi DB selama vendor call.
// Workspace lewat masa aktif ditolak sebelum provider dipanggil (assertActive).
export async function withTokens<T extends NextResponse>(
  workspaceId: string,
  baseCost: number,
  fn: () => Promise<T>,
  meta: BillingMeta,
): Promise<T> {
  const cost = Math.max(1, Math.ceil(baseCost * (meta.units ?? 1)));
  await assertActive(workspaceId);
  const deducted = await deduct(workspaceId, cost);
  if (!deducted) throw await deductFailure(workspaceId);
  // ponytail: NFR#5 — satu log per billed call (choke point semua AI routes).
  const reqId = newRequestId();
  const t0 = Date.now();
  const done = (status: number, ok: boolean, note?: string) =>
    logReq({ reqId, workspaceId, endpoint: meta.endpointType, latencyMs: Date.now() - t0, status, ok, note });
  let res: T;
  try {
    res = await fn();
  } catch (e) {
    await refund(workspaceId, cost, meta, deducted.ledgerId);
    done(500, false, "throw->refund");
    throw e;
  }
  // ponytail: refund semua vendor gagal (!ok) kecuali 402 — 402 tak pernah
  // deduct (throw sebelum UPDATE), jadi refund di sini = ganda/salah.
  if (!res.ok && res.status !== 402) {
    await refund(workspaceId, cost, meta, deducted.ledgerId);
    done(res.status, false, "fail->refund");
    return res;
  }
  await logBurn(workspaceId, cost, meta, deducted.ledgerId);
  done(res.status, true);
  return res;
}

export type ValidKey = { id: string; workspace_id: string | null; cafe_id: string | null };

export class InsufficientKeyQuotaError extends Error {
  remaining: number;
  constructor(remaining: number) {
    super("Kuota API key tidak cukup.");
    this.remaining = remaining;
  }
}

async function keyQuotaRemaining(keyId: string): Promise<number> {
  const rows = (await sql`
    SELECT GREATEST(token_quota - tokens_used, 0)::int AS remaining
    FROM api_keys WHERE id = ${keyId}`) as unknown as { remaining: number }[];
  return rows[0]?.remaining ?? 0;
}

// ponytail: key kafe tanpa workspace (terbitan kasir). Kuotanya sudah dipotong
// dari saldo prepaid cafe saat terbit, jadi pemakaian ditagih ke kuota key —
// bukan ke workspaces.token_balance. Charge atomik sebelum vendor; refund bila gagal.
export async function withKeyTokens<T extends NextResponse>(
  keyId: string,
  cafeId: string | null,
  baseCost: number,
  fn: () => Promise<T>,
  meta: BillingMeta,
): Promise<T> {
  const cost = Math.max(1, Math.ceil(baseCost * (meta.units ?? 1)));
  const charged = (await sql`
    UPDATE api_keys SET tokens_used = tokens_used + ${cost}, last_used_at = now()
    WHERE id = ${keyId} AND is_active = TRUE AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND tokens_used + ${cost} <= token_quota
    RETURNING tokens_used`) as unknown as { tokens_used: number }[];
  if (!charged[0]) throw new InsufficientKeyQuotaError(await keyQuotaRemaining(keyId));

  const reqId = newRequestId();
  const t0 = Date.now();
  const done = (status: number, ok: boolean, note?: string) =>
    logReq({ reqId, workspaceId: null, endpoint: meta.endpointType, latencyMs: Date.now() - t0, status, ok, note });

  const logUsage = async (status: "success" | "refunded", delta: number) => {
    if (delta !== 0)
      await sql`UPDATE api_keys SET tokens_used = GREATEST(tokens_used + ${delta}, 0) WHERE id = ${keyId}`;
    await sql`
      INSERT INTO usage_logs (workspace_id, api_key_id, cafe_id, model_id, tokens_burned, endpoint_type, status, media_url)
      VALUES (NULL, ${keyId}, ${cafeId}, ${meta.modelId}, ${cost}, ${meta.endpointType}, ${status}, ${meta.mediaUrl ?? null})`;
  };

  let res: T;
  try {
    res = await fn();
  } catch (e) {
    await logUsage("refunded", -cost);
    done(500, false, "throw->refund");
    throw e;
  }
  if (!res.ok && res.status !== 402) {
    await logUsage("refunded", -cost);
    done(res.status, false, "fail->refund");
    return res;
  }
  await logUsage("success", 0);
  done(res.status, true);
  return res;
}

// ponytail: key mentah -> SHA-256 hex -> api_keys (aktif, belum revoke, belum expired).
// Hash 1 arah, DB tak pernah simpan key asli (NFR #2).
export async function validateApiKey(raw: string): Promise<ValidKey | null> {
  const hash = createHash("sha256").update(raw).digest("hex");
  const rows = (await sql`
    SELECT ak.id, ak.workspace_id, ak.cafe_id FROM api_keys ak
    WHERE ak.key_hash = ${hash} AND ak.is_active = TRUE
      AND ak.revoked_at IS NULL
      AND (ak.expires_at IS NULL OR ak.expires_at > now())
    LIMIT 1`) as unknown as ValidKey[];
  return rows[0] ?? null;
}

// ponytail: dashboard = cookie sesi -> workspace; tanpa login pakai workspace
// seed dev agar demo 1500 Token tetap jalan. Null = tak ada workspace sama sekali.
export async function workspaceIdForRequest(req: Request): Promise<string | null> {
  const auth = await requireAuth(req);
  if (auth) {
    const rows = (await sql`
      SELECT id FROM workspaces WHERE user_id = ${auth.user.id}
      ORDER BY created_at LIMIT 1`) as unknown as { id: string }[];
    if (rows[0]) return rows[0].id;
  }
  return null;
}

// ponytail: streaming metered-deduct (PRD §4.3) — pre-check min 5 token,
// provider stream, hitung incremental, stop finish_reason=token_exhausted,
// deduct presisi setelah stream (tokens_terkirim * rate/1k) dalam transaksi
// yang sama dengan chat_messages insert. Saldo tak pernah negatif.
export interface StreamMeteredResult {
  totalTokens: number;
  finishReason: "stop" | "length" | "aborted" | "token_exhausted" | "error";
  reply: string;
}

export async function withTokensStream(
  workspaceId: string,
  costPer1k: number,
  streamFn: (onChunk: (text: string, done: boolean, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }, providerFinish?: string) => void, signal: AbortSignal) => Promise<void>,
  meta: BillingMeta,
  signal: AbortSignal,
  // ponytail: token prompt (dokumen lampiran + history) ikut ditagih — provider
  // menagih input juga, jadi PDF panjang wajib lebih mahal (bukan cuma jawaban).
  inputChars = 0,
): Promise<StreamMeteredResult> {
  const inputTokens = inputChars > 0 ? Math.ceil(inputChars / 4) : 0;
  const balance = await assertActive(workspaceId);
  if (balance < 5) throw new InsufficientTokensError(balance);

  const reqId = newRequestId();
  const t0 = Date.now();
  const done = (status: number, ok: boolean, note?: string) =>
    logReq({ reqId, workspaceId, endpoint: meta.endpointType, latencyMs: Date.now() - t0, status, ok, note });

  let reply = "";
  let totalTokens = 0;
  let finishReason: StreamMeteredResult["finishReason"] = "stop";

  // Batas atas token terjangkau sudah termasuk prompt; tanpa ini stream bisa
  // menagih lebih dari saldo untuk dokumen raksasa.
  const tokensAllowed = Math.floor(balance / costPer1k) * 1000;
  if (inputTokens > tokensAllowed) {
    throw new InsufficientTokensError(balance);
  }

  await streamFn(
    (text, done, usage, providerFinish) => {
      if (done) {
        if (usage) totalTokens = Math.max(usage.totalTokens, inputTokens + usage.completionTokens);
        if (providerFinish === "length" || providerFinish === "MAX_TOKENS")
          finishReason = "length";
      } else {
        reply += text;
        totalTokens = inputTokens + countTokens(reply);
        if (totalTokens > tokensAllowed) {
          finishReason = "token_exhausted";
          throw new Error("TOKEN_EXHAUSTED");
        }
      }
    },
    signal,
  ).catch((e) => {
    if (e instanceof Error && e.message === "TOKEN_EXHAUSTED") {
      return;
    }
    if (signal.aborted) {
      finishReason = "aborted";
      return;
    }
    throw e;
  });

  if (totalTokens === 0) totalTokens = inputTokens;
  const actualTokens = totalTokens || 0;
  const cost = Math.ceil((actualTokens / 1000) * costPer1k);

  if (cost > 0) {
    const deducted = await deduct(workspaceId, cost);
    if (!deducted) throw await deductFailure(workspaceId);
    await logBurn(workspaceId, cost, meta, deducted.ledgerId);
    done(200, true);
  } else {
    done(200, true);
  }

  return { totalTokens: actualTokens, finishReason, reply };
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
