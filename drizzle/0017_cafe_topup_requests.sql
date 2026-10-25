-- TASK-XXX: Permintaan top-up saldo cafe oleh kasir (butuh approve super_admin).
-- Kasir submit request -> super_admin approve/reject -> saldo cafe bertambah + ledger.

CREATE TABLE IF NOT EXISTS cafe_topup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cafe_id UUID NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id), -- kasir yang minta
    amount INT NOT NULL CHECK (amount >= 1 AND amount <= 100000000),
    note VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id), -- super_admin yang approve
    approved_at TIMESTAMPTZ,
    rejection_reason VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cafe_topup_requests_cafe_id_idx ON cafe_topup_requests (cafe_id);
CREATE INDEX IF NOT EXISTS cafe_topup_requests_status_idx ON cafe_topup_requests (status);
CREATE INDEX IF NOT EXISTS cafe_topup_requests_created_idx ON cafe_topup_requests (created_at DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS cafe_topup_requests_updated_at ON cafe_topup_requests;
CREATE TRIGGER cafe_topup_requests_updated_at
    BEFORE UPDATE ON cafe_topup_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();