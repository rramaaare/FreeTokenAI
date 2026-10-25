-- Dua jalur billing via kasir:
--   product = pelanggan belanja produk cafe, dapat token bonus dari nominal belanja
--   retail  = pelanggan beli token ketengan (eceran) dengan harga per token cafe
-- Tarif per cafe, diatur super admin. Struk lama (paket/manual) tetap valid.
-- Idempoten: db:migrate menjalankan ulang semua file.

ALTER TABLE cafes ADD COLUMN IF NOT EXISTS retail_rupiah_per_token INT NOT NULL DEFAULT 10
    CHECK (retail_rupiah_per_token > 0);
-- Bonus belanja: tiap kelipatan Rp ini = 1 token (default Rp100 -> Rp10.000 = 100 token).
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS bonus_rupiah_per_token INT NOT NULL DEFAULT 100
    CHECK (bonus_rupiah_per_token > 0);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS purchase_type VARCHAR(20);
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS rupiah_amount INT;
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_purchase_type_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_purchase_type_check
    CHECK (purchase_type IS NULL OR purchase_type IN ('package', 'manual', 'product', 'retail'));
