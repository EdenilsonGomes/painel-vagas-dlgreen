BEGIN;

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS ia_atendimento_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ia_pausada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ia_pausada_por TEXT,
  ADD COLUMN IF NOT EXISTS ia_pausa_motivo TEXT,
  ADD COLUMN IF NOT EXISTS ia_retomada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ia_retomada_por TEXT,
  ADD COLUMN IF NOT EXISTS ia_ultima_acao_manual TEXT,
  ADD COLUMN IF NOT EXISTS ia_ultima_acao_manual_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ia_ultima_acao_manual_por TEXT,
  ADD COLUMN IF NOT EXISTS ia_ultima_mensagem_manual TEXT;

UPDATE candidatos
SET ia_atendimento_ativo = TRUE
WHERE ia_atendimento_ativo IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidatos_ia_atendimento_ativo
  ON candidatos (ia_atendimento_ativo, updated_at DESC);

COMMENT ON COLUMN candidatos.ia_atendimento_ativo IS
  'TRUE permite respostas automáticas. FALSE mantém mensagens e documentos registrados, mas impede a IA de responder ao candidato.';

COMMENT ON COLUMN candidatos.ia_ultima_acao_manual IS
  'Última ação operacional iniciada pelo painel, como RETOMAR_ATENDIMENTO ou REPROCESSAR_CTPS.';

COMMIT;
