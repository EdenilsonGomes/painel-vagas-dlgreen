BEGIN;

-- Genesis IA V4.1
-- Convite pontual, indicadores por período e apenas uma entrevista ativa.

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS vaga_escolhida_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reprovacao_notificada_at TIMESTAMPTZ;

UPDATE candidatos
SET vaga_escolhida_at = COALESCE(vaga_escolhida_at, created_at, updated_at, NOW())
WHERE vaga_id IS NOT NULL
  AND vaga_escolhida_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidatos_vaga_escolhida_periodo
  ON candidatos (vaga_id, vaga_escolhida_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidatos_created_at
  ON candidatos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mensagens_quem_created_at
  ON mensagens (quem, created_at DESC);

-- Corrige duplicidades antigas: mantém como AGENDADA somente a entrevista
-- mais recentemente criada/atualizada de cada candidato.
WITH ordenadas AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY candidato_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS ordem
  FROM entrevistas
  WHERE status = 'AGENDADA'
)
UPDATE entrevistas e
SET status = 'REAGENDADA', updated_at = NOW()
FROM ordenadas o
WHERE e.id = o.id
  AND o.ordem > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entrevistas_uma_agendada_por_candidato
  ON entrevistas (candidato_id)
  WHERE status = 'AGENDADA';

COMMIT;
