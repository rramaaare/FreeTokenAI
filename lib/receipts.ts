import { sql } from "./db";

// Masa berlaku struk (aturan bisnis Okt 2026): struk yang belum diklaim dalam
// RECEIPT_VALID_DAYS hangus — tidak bisa diklaim lagi — dan tokennya kembali ke
// saldo prepaid cafe (ledger type 'refund', reference receipt).
export const RECEIPT_VALID_DAYS = 7;

export type ReceiptStatus = "unclaimed" | "claimed" | "expired";

/** Status struk dari kolomnya; "expired" juga untuk struk lewat masa berlaku yang belum di-sweep. */
export function receiptStatus(r: { is_claimed: boolean | null; refunded_at: string | null; expires_at: string | null }): ReceiptStatus {
  if (r.is_claimed) return "claimed";
  if (r.refunded_at || (r.expires_at && new Date(r.expires_at).getTime() <= Date.now())) return "expired";
  return "unclaimed";
}

// ponytail: tanpa cron — dipanggil lazy dari endpoint yang membaca/menulis saldo
// atau struk cafe (dashboard kasir, daftar/cek struk, generate, admin cafe).
// Aman dipanggil paralel: UPDATE ... WHERE refunded_at IS NULL mengunci baris,
// jadi satu struk hanya dikembalikan sekali; klaim yang sedang jalan (FOR UPDATE)
// membuat sweep menunggu lalu melewati struk yang ternyata sudah diklaim.
export async function sweepExpiredReceipts(cafeId?: string | null): Promise<number> {
  return (await sql.begin(async (tx: any) => {
    const expired = (await tx`
      UPDATE receipts SET refunded_at = now()
      WHERE is_claimed IS NOT TRUE AND refunded_at IS NULL
        AND expires_at IS NOT NULL AND expires_at <= now()
        AND cafe_id IS NOT NULL
        AND (${cafeId ?? null}::uuid IS NULL OR cafe_id = ${cafeId ?? null}::uuid)
      RETURNING id, cafe_id, tokens_granted, code`) as unknown as {
      id: string;
      cafe_id: string;
      tokens_granted: number;
      code: string;
    }[];
    let refunded = 0;
    for (const r of expired) {
      const upd = (await tx`
        UPDATE cafes SET prepaid_token_balance = prepaid_token_balance + ${r.tokens_granted}
        WHERE id = ${r.cafe_id}
        RETURNING prepaid_token_balance`) as unknown as { prepaid_token_balance: number }[];
      if (!upd[0]) continue;
      await tx`
        INSERT INTO cafe_token_transactions (cafe_id, type, amount, balance_after, reference_type, reference_id, note)
        VALUES (${r.cafe_id}, 'refund', ${r.tokens_granted}, ${upd[0].prepaid_token_balance}, 'receipt', ${r.id},
                ${`Struk ${r.code} kedaluwarsa (tidak diklaim ${RECEIPT_VALID_DAYS} hari)`})`;
      refunded += r.tokens_granted;
    }
    return refunded;
  })) as number;
}
