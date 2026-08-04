BEGIN;

-- ============================================================
-- GENESIS IA V9.2
-- Captura segura de sexo declarado/documental, compatibilidade
-- informativa por vaga e motivos estruturados de reprovação.
-- A compatibilidade de sexo NÃO reprova nem bloqueia o candidato automaticamente.
-- A pergunta é opcional; ausência de resposta não impede o processo.
-- ============================================================

CREATE OR REPLACE FUNCTION genesis_normalizar_sexo(valor TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN valor IS NULL OR BTRIM(valor) = '' THEN NULL
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('M', 'MASC', 'MASCULINO', 'HOMEM', 'HOMEM CIS') THEN 'MASCULINO'
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('F', 'FEM', 'FEMININO', 'MULHER', 'MULHER CIS') THEN 'FEMININO'
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('UNISSEX', 'AMBOS', 'TODOS') THEN 'UNISSEX'
    ELSE NULL
  END;
$$;

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS sexo_origem VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sexo_atualizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sexo_perguntado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sexo_nao_informado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sexo_compativel_vaga BOOLEAN,
  ADD COLUMN IF NOT EXISTS sexo_revisao_necessaria BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_reprovacao_codigo VARCHAR(80),
  ADD COLUMN IF NOT EXISTS motivo_reprovacao_categoria VARCHAR(50),
  ADD COLUMN IF NOT EXISTS motivo_reprovacao_detalhe TEXT,
  ADD COLUMN IF NOT EXISTS reprovacao_realocavel BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reprovacao_vaga_id BIGINT REFERENCES vagas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reprovacao_registrada_em TIMESTAMPTZ;

UPDATE candidatos
SET sexo = genesis_normalizar_sexo(sexo)
WHERE sexo IS NOT NULL;

UPDATE candidatos
SET sexo_origem = CASE
  WHEN sexo IS NOT NULL AND sexo_origem IS NULL THEN 'IMPORTADA'
  ELSE sexo_origem
END,
sexo_atualizado_em = CASE
  WHEN sexo IS NOT NULL THEN COALESCE(sexo_atualizado_em, updated_at, created_at, NOW())
  ELSE sexo_atualizado_em
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_sexo_valido'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_sexo_valido
      CHECK (sexo IS NULL OR sexo IN ('MASCULINO', 'FEMININO'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_sexo_origem_valida'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_sexo_origem_valida
      CHECK (
        sexo_origem IS NULL
        OR sexo_origem IN ('INFORMADA','CTPS','CURRICULO','MANUAL','IMPORTADA')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_motivo_categoria_valida'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_motivo_categoria_valida
      CHECK (
        motivo_reprovacao_categoria IS NULL
        OR motivo_reprovacao_categoria IN (
          'IDADE','EXPERIENCIA','DOCUMENTO','DISPONIBILIDADE',
          'ENTREVISTA','DESISTENCIA','REQUISITO_DA_VAGA','OUTRO'
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_candidatos_sexo_busca
  ON candidatos (sexo, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidatos_sexo_revisao
  ON candidatos (sexo_revisao_necessaria, vaga_id, updated_at DESC)
  WHERE sexo_revisao_necessaria IS TRUE;

CREATE INDEX IF NOT EXISTS idx_candidatos_realocacao
  ON candidatos (reprovacao_realocavel, status, updated_at DESC)
  WHERE status = 'REPROVADO' AND reprovacao_realocavel IS TRUE;

CREATE OR REPLACE FUNCTION genesis_atualizar_compatibilidade_sexo_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  sexo_vaga TEXT;
BEGIN
  NEW.sexo := genesis_normalizar_sexo(NEW.sexo);

  SELECT genesis_normalizar_sexo(v.sexo)
    INTO sexo_vaga
  FROM vagas v
  WHERE v.id = NEW.vaga_id;

  IF NEW.vaga_id IS NULL OR sexo_vaga IS NULL OR sexo_vaga = 'UNISSEX' THEN
    NEW.sexo_compativel_vaga := TRUE;
    NEW.sexo_revisao_necessaria := FALSE;
  ELSIF NEW.sexo IS NULL THEN
    NEW.sexo_compativel_vaga := NULL;
    NEW.sexo_revisao_necessaria := NOT COALESCE(NEW.sexo_nao_informado, FALSE);
  ELSE
    NEW.sexo_compativel_vaga := (NEW.sexo = sexo_vaga);
    NEW.sexo_revisao_necessaria := (NEW.sexo <> sexo_vaga);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidatos_atualizar_compatibilidade_sexo ON candidatos;
CREATE TRIGGER candidatos_atualizar_compatibilidade_sexo
BEFORE INSERT OR UPDATE OF sexo, sexo_nao_informado, vaga_id ON candidatos
FOR EACH ROW EXECUTE FUNCTION genesis_atualizar_compatibilidade_sexo_candidato();

-- Recalcula os registros existentes após a criação das novas colunas.
UPDATE candidatos SET sexo = sexo;

CREATE OR REPLACE FUNCTION genesis_recalcular_candidatos_apos_sexo_vaga()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.sexo IS DISTINCT FROM NEW.sexo THEN
    UPDATE candidatos
    SET vaga_id = vaga_id
    WHERE vaga_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vagas_recalcular_compatibilidade_sexo ON vagas;
CREATE TRIGGER vagas_recalcular_compatibilidade_sexo
AFTER UPDATE OF sexo ON vagas
FOR EACH ROW EXECUTE FUNCTION genesis_recalcular_candidatos_apos_sexo_vaga();

CREATE TABLE IF NOT EXISTS candidato_reprovacoes_historico (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  vaga_id BIGINT REFERENCES vagas(id) ON DELETE SET NULL,
  etapa VARCHAR(80),
  categoria VARCHAR(50) NOT NULL DEFAULT 'OUTRO',
  codigo VARCHAR(80) NOT NULL,
  motivo TEXT NOT NULL,
  observacao TEXT,
  realocavel BOOLEAN NOT NULL DEFAULT TRUE,
  origem VARCHAR(30) NOT NULL DEFAULT 'SISTEMA',
  dados_contexto JSONB NOT NULL DEFAULT '{}'::JSONB,
  registrado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_reprovacoes_categoria_valida CHECK (
    categoria IN (
      'IDADE','EXPERIENCIA','DOCUMENTO','DISPONIBILIDADE',
      'ENTREVISTA','DESISTENCIA','REQUISITO_DA_VAGA','OUTRO'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_candidato_reprovacoes_candidato
  ON candidato_reprovacoes_historico (candidato_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidato_reprovacoes_realocavel
  ON candidato_reprovacoes_historico (realocavel, categoria, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidato_reprovacoes_vaga
  ON candidato_reprovacoes_historico (vaga_id, created_at DESC);

-- Estrutura motivos antigos sem apagar o texto legado.
UPDATE candidatos
SET
  motivo_reprovacao_codigo = COALESCE(
    motivo_reprovacao_codigo,
    CASE
      WHEN motivo_reprovacao IN ('IDADE_MINIMA_NAO_ATENDIDA','IDADE_MAXIMA_NAO_ATENDIDA') THEN motivo_reprovacao
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%DECLAR%' AND UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%EXPERI%' THEN 'EXPERIENCIA_DECLARADA_NAO_ATENDE'
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%EXPERI%COMPAT%' THEN 'EXPERIENCIA_NAO_COMPATIVEL'
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%EXPERI%' THEN 'EXPERIENCIA_INSUFICIENTE'
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%DOCUMENT%' OR UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%CTPS%' THEN 'DOCUMENTO_INSUFICIENTE'
      WHEN status = 'REPROVADO' THEN 'OUTRO'
      ELSE NULL
    END
  ),
  motivo_reprovacao_categoria = COALESCE(
    motivo_reprovacao_categoria,
    CASE
      WHEN motivo_reprovacao IN ('IDADE_MINIMA_NAO_ATENDIDA','IDADE_MAXIMA_NAO_ATENDIDA') THEN 'IDADE'
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%EXPERI%' THEN 'EXPERIENCIA'
      WHEN UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%DOCUMENT%' OR UPPER(COALESCE(motivo_reprovacao,'')) LIKE '%CTPS%' THEN 'DOCUMENTO'
      WHEN status = 'REPROVADO' THEN 'OUTRO'
      ELSE NULL
    END
  ),
  motivo_reprovacao_detalhe = COALESCE(motivo_reprovacao_detalhe, NULLIF(motivo_reprovacao,'')),
  reprovacao_vaga_id = COALESCE(reprovacao_vaga_id, vaga_id),
  reprovacao_registrada_em = CASE
    WHEN status = 'REPROVADO' THEN COALESCE(reprovacao_registrada_em, updated_at, NOW())
    ELSE reprovacao_registrada_em
  END
WHERE status = 'REPROVADO' OR motivo_reprovacao IS NOT NULL;

INSERT INTO candidato_reprovacoes_historico
(candidato_id, vaga_id, etapa, categoria, codigo, motivo, observacao, realocavel, origem, dados_contexto, created_at)
SELECT
  c.id,
  COALESCE(c.reprovacao_vaga_id, c.vaga_id),
  c.etapa,
  COALESCE(c.motivo_reprovacao_categoria, 'OUTRO'),
  COALESCE(c.motivo_reprovacao_codigo, 'OUTRO'),
  COALESCE(c.motivo_reprovacao_detalhe, c.motivo_reprovacao, 'Motivo não detalhado'),
  c.observacao_triagem,
  COALESCE(c.reprovacao_realocavel, TRUE),
  'MIGRACAO',
  JSONB_BUILD_OBJECT('status', c.status, 'etapa', c.etapa),
  COALESCE(c.reprovacao_registrada_em, c.updated_at, NOW())
FROM candidatos c
WHERE c.status = 'REPROVADO'
  AND NOT EXISTS (
    SELECT 1
    FROM candidato_reprovacoes_historico h
    WHERE h.candidato_id = c.id
      AND h.codigo = COALESCE(c.motivo_reprovacao_codigo, 'OUTRO')
      AND h.vaga_id IS NOT DISTINCT FROM COALESCE(c.reprovacao_vaga_id, c.vaga_id)
  );

COMMIT;

-- Verificações rápidas:
-- SELECT id, nome, sexo, sexo_origem, sexo_compativel_vaga, sexo_revisao_necessaria FROM candidatos ORDER BY id DESC LIMIT 20;
-- SELECT * FROM candidato_reprovacoes_historico ORDER BY id DESC LIMIT 20;
