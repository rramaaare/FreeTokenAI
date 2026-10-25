-- Katalog hak akses baru (lib/permissions.ts). Hanya sel yang bisa dicentang
-- disimpan; izin lama (apikey.issue, token.topup, apikey.input, ...) dibuang.
DELETE FROM role_permissions
WHERE (role, permission_key) NOT IN (
    ('kasir', 'receipt.product'),
    ('kasir', 'receipt.retail'),
    ('kasir', 'receipt.package'),
    ('kasir', 'receipt.view'),
    ('kasir', 'kasir.dashboard'),
    ('customer', 'ai.chat'),
    ('customer', 'ai.image'),
    ('customer', 'ai.video'),
    ('customer', 'ai.developer')
);

INSERT INTO role_permissions (role, permission_key, allowed) VALUES
    ('kasir', 'receipt.product', TRUE),
    ('kasir', 'receipt.retail', TRUE),
    ('kasir', 'receipt.package', TRUE),
    ('kasir', 'receipt.view', TRUE),
    ('kasir', 'kasir.dashboard', TRUE),
    ('customer', 'ai.chat', TRUE),
    ('customer', 'ai.image', TRUE),
    ('customer', 'ai.video', TRUE),
    ('customer', 'ai.developer', TRUE)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Override per akun tidak dipakai lagi.
DELETE FROM user_permissions;
