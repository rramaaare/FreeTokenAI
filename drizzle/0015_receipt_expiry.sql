-- Masa berlaku struk: struk yang belum diklaim sampai expires_at hangus dan
-- tokennya dikembalikan ke saldo prepaid cafe (lib/receipts.ts sweepExpiredReceipts).
-- refunded_at = kapan token struk dikembalikan (NULL = belum / sudah diklaim).
-- Idempoten: db:migrate menjalankan ulang semua file.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Struk lama yang belum punya masa berlaku: 7 hari sejak dibuat (sama dengan RECEIPT_VALID_DAYS).
UPDATE receipts SET expires_at = created_at + interval '7 days'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS receipts_unclaimed_expiry_idx
    ON receipts (expires_at)
    WHERE is_claimed IS NOT TRUE AND refunded_at IS NULL;
