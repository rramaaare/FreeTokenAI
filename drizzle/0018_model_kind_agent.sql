-- Kegunaan model baru "agent": model yang boleh dipanggil lewat Developer API
-- (/api/v1/chat/completions) oleh AI agent pelanggan. Diatur per model di /admin/models.
-- Idempoten: aman dijalankan berulang (npm run db:migrate).

ALTER TABLE ai_models DROP CONSTRAINT IF EXISTS ai_models_kinds_check;
ALTER TABLE ai_models
  ADD CONSTRAINT ai_models_kinds_check CHECK (kinds <@ ARRAY['chat', 'image', 'video', 'agent']::varchar[]);

-- Pertahankan perilaku gateway lama: model chat Groq (gpt-oss) dulu dipakai
-- hardcoded oleh Developer API, jadi otomatis dicentang agent.
UPDATE ai_models m
SET kinds = array_append(m.kinds, 'agent')
FROM providers p
WHERE p.id = m.provider_id
  AND p.slug = 'groq'
  AND 'chat' = ANY (m.kinds)
  AND NOT ('agent' = ANY (m.kinds));
