BEGIN;

-- Correção idempotente para o botão "Resultado após entrevista".
ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS motivo_reprovacao_pos_entrevista TEXT,
  ADD COLUMN IF NOT EXISTS observacao_decisao_pos_entrevista TEXT,
  ADD COLUMN IF NOT EXISTS decisao_pos_entrevista_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decisao_pos_entrevista_por TEXT,
  ADD COLUMN IF NOT EXISTS admissao_iniciada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reprovacao_notificada_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS grupo_convites_envios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  grupo_id TEXT NOT NULL,
  codigo_convite TEXT,
  link_convite TEXT,
  mensagem TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  mensagem_waha_id TEXT,
  erro TEXT,
  enviado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidato_id, grupo_id)
);

CREATE INDEX IF NOT EXISTS idx_grupo_convites_status
  ON grupo_convites_envios (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidatos_status_etapa_updated
  ON candidatos (status, etapa, updated_at DESC);

COMMIT;

-- Conferência: as seis colunas devem aparecer.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'candidatos'
  AND column_name IN (
    'motivo_reprovacao_pos_entrevista',
    'observacao_decisao_pos_entrevista',
    'decisao_pos_entrevista_at',
    'decisao_pos_entrevista_por',
    'admissao_iniciada_at',
    'reprovacao_notificada_at'
  )
ORDER BY column_name;

SELECT TO_REGCLASS('public.grupo_convites_envios') AS tabela_convites;
