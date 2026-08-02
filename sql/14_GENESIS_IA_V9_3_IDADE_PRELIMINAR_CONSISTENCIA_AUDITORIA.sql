BEGIN;

-- ============================================================
-- GENESIS IA V9.3
-- Idade preliminar declarada + confirmação documental,
-- consistência entre status e etapa, snapshots para auditoria
-- e deduplicação idempotente das respostas da IA.
-- Execute após os SQLs 11, 12 e 13 das versões anteriores.
-- ============================================================

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS idade_declarada SMALLINT,
  ADD COLUMN IF NOT EXISTS idade_declarada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idade_pre_validada BOOLEAN,
  ADD COLUMN IF NOT EXISTS idade_confirmada_documentalmente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idade_divergencia_documental BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idade_validacao_observacao TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_idade_declarada_valida'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_idade_declarada_valida
      CHECK (idade_declarada IS NULL OR idade_declarada BETWEEN 14 AND 100);
  END IF;
END;
$$;

ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS contexto_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS lote_resposta_id TEXT,
  ADD COLUMN IF NOT EXISTS origem_mensagem_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mensagens_ia_lote_resposta
  ON mensagens (candidato_id, lote_resposta_id)
  WHERE quem = 'IA' AND lote_resposta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mensagens_contexto_snapshot
  ON mensagens USING GIN (contexto_snapshot)
  WHERE contexto_snapshot IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidatos_idade_confirmacao
  ON candidatos (idade_confirmada_documentalmente, idade_pre_validada, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documentos_processamento_pendente
  ON documentos (status_processamento, processando_at, candidato_id)
  WHERE status_processamento = 'PROCESSANDO';

-- Mantém somente a entrevista ativa mais recente por candidato antes de criar
-- a proteção definitiva contra agendamentos duplicados.
WITH entrevistas_ativas_ordenadas AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY candidato_id ORDER BY created_at DESC, id DESC) AS ordem
  FROM entrevistas
  WHERE status = 'AGENDADA'
)
UPDATE entrevistas e
SET status = 'REAGENDADA'
FROM entrevistas_ativas_ordenadas r
WHERE e.id = r.id AND r.ordem > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entrevistas_uma_ativa_por_candidato
  ON entrevistas (candidato_id)
  WHERE status = 'AGENDADA';

CREATE OR REPLACE FUNCTION genesis_idade_em_anos(data_nascimento DATE, data_referencia DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
  SELECT CASE
    WHEN data_nascimento IS NULL THEN NULL
    ELSE DATE_PART('year', AGE(data_referencia, data_nascimento))::INTEGER
  END;
$$;

-- Converte os dados existentes para o novo modelo.
UPDATE candidatos c
SET
  idade_declarada = CASE
    WHEN c.idade_declarada IS NOT NULL THEN c.idade_declarada
    WHEN c.data_nascimento_origem = 'INFORMADA' AND c.idade_calculada BETWEEN 14 AND 100
      THEN c.idade_calculada
    ELSE c.idade_declarada
  END,
  idade_declarada_em = CASE
    WHEN c.idade_declarada_em IS NOT NULL THEN c.idade_declarada_em
    WHEN c.data_nascimento_origem = 'INFORMADA' AND c.idade_calculada IS NOT NULL
      THEN COALESCE(c.data_nascimento_atualizada_em, c.updated_at, NOW())
    ELSE c.idade_declarada_em
  END,
  idade_confirmada_documentalmente = c.data_nascimento_origem IN ('CTPS','CURRICULO'),
  idade_pre_validada = CASE
    WHEN COALESCE(v.idade_minima, 0) <= 0 AND v.idade_maxima IS NULL THEN TRUE
    WHEN COALESCE(c.idade_calculada, c.idade_declarada) IS NULL THEN NULL
    ELSE COALESCE(c.idade_calculada, c.idade_declarada) >= COALESCE(v.idade_minima, 0)
      AND (v.idade_maxima IS NULL OR COALESCE(c.idade_calculada, c.idade_declarada) <= v.idade_maxima)
  END,
  idade_validada = CASE
    WHEN COALESCE(v.idade_minima, 0) <= 0 AND v.idade_maxima IS NULL THEN TRUE
    WHEN c.data_nascimento_origem IN ('CTPS','CURRICULO') AND c.data_nascimento IS NOT NULL THEN
      genesis_idade_em_anos(c.data_nascimento) >= COALESCE(v.idade_minima, 0)
      AND (v.idade_maxima IS NULL OR genesis_idade_em_anos(c.data_nascimento) <= v.idade_maxima)
    ELSE NULL
  END,
  idade_validacao_observacao = CASE
    WHEN c.data_nascimento_origem IN ('CTPS','CURRICULO') THEN 'Idade confirmada por documento.'
    WHEN c.data_nascimento_origem = 'INFORMADA' OR c.idade_declarada IS NOT NULL THEN 'Idade preliminar informada na conversa; aguarda confirmação pela CTPS ou currículo.'
    ELSE c.idade_validacao_observacao
  END
FROM vagas v
WHERE v.id = c.vaga_id;

-- Registros sem vaga não precisam de regra etária ativa.
UPDATE candidatos
SET
  idade_pre_validada = COALESCE(idade_pre_validada, TRUE),
  idade_validada = COALESCE(idade_validada, TRUE),
  idade_validacao_observacao = COALESCE(idade_validacao_observacao, 'Sem regra etária vinculada.')
WHERE vaga_id IS NULL;

CREATE OR REPLACE FUNCTION genesis_status_seguro_para_etapa(etapa_valor TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN etapa_valor IN (
      'APROVADO_TRIAGEM','AGUARDANDO_APRESENTACAO','GERANDO_OPCOES_ENTREVISTA',
      'ESCOLHENDO_HORARIO','AGUARDANDO_ENTREVISTA','ENTREVISTA_AGENDADA'
    ) THEN 'APROVADO'
    WHEN etapa_valor = 'PRIMEIRO_CONTATO' THEN 'NOVO'
    WHEN etapa_valor = 'EM_ADMISSAO' THEN 'EM_ADMISSAO'
    WHEN etapa_valor = 'CONTRATADO' THEN 'CONTRATADO'
    WHEN etapa_valor = 'ENCERRADO' THEN 'ENCERRADO'
    ELSE 'EM_PROCESSO'
  END;
$$;

CREATE OR REPLACE FUNCTION genesis_normalizar_status_etapa_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  etapa_reprovacao BOOLEAN;
  motivo_idade BOOLEAN;
BEGIN
  etapa_reprovacao := NEW.etapa IN (
    'REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA'
  );

  motivo_idade := COALESCE(NEW.motivo_reprovacao_codigo, NEW.motivo_reprovacao, '')
    IN ('IDADE_MINIMA_NAO_ATENDIDA','IDADE_MAXIMA_NAO_ATENDIDA','IDADE_DECLARADA_FORA_FAIXA');

  -- Uma comprovação documental válida desfaz somente reprovações etárias.
  IF COALESCE(NEW.idade_confirmada_documentalmente, FALSE)
     AND NEW.idade_validada IS TRUE
     AND motivo_idade
     AND NEW.status NOT IN ('CONTRATADO','ENCERRADO') THEN
    NEW.status := genesis_status_seguro_para_etapa(
      CASE
        WHEN NEW.etapa IN ('REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM') THEN
          CASE
            WHEN NEW.aprovado IS TRUE THEN 'AGUARDANDO_APRESENTACAO'
            WHEN NEW.cep IS NULL OR REGEXP_REPLACE(NEW.cep, '\D', '', 'g') !~ '^\d{8}$' THEN 'AGUARDANDO_CTPS_CEP'
            ELSE 'AGUARDANDO_CTPS'
          END
        ELSE NEW.etapa
      END
    );
    NEW.etapa := CASE
      WHEN NEW.aprovado IS TRUE THEN
        CASE WHEN REGEXP_REPLACE(COALESCE(NEW.cep,''), '\D', '', 'g') ~ '^\d{8}$'
          THEN 'AGUARDANDO_APRESENTACAO' ELSE 'AGUARDANDO_CEP' END
      WHEN REGEXP_REPLACE(COALESCE(NEW.cep,''), '\D', '', 'g') ~ '^\d{8}$' THEN 'AGUARDANDO_CTPS'
      ELSE 'AGUARDANDO_CTPS_CEP'
    END;
    NEW.aprovado := CASE WHEN NEW.aprovado IS FALSE THEN NULL ELSE NEW.aprovado END;
    NEW.motivo_reprovacao := NULL;
    NEW.motivo_reprovacao_codigo := NULL;
    NEW.motivo_reprovacao_categoria := NULL;
    NEW.motivo_reprovacao_detalhe := NULL;
    NEW.reprovacao_vaga_id := NULL;
    NEW.reprovacao_registrada_em := NULL;
  END IF;

  etapa_reprovacao := NEW.etapa IN (
    'REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA'
  );

  IF etapa_reprovacao THEN
    NEW.status := 'REPROVADO';
    IF COALESCE(NULLIF(NEW.motivo_reprovacao_codigo,''), NULLIF(NEW.motivo_reprovacao,'')) IS NULL THEN
      NEW.motivo_reprovacao_codigo := 'MOTIVO_NAO_DETALHADO';
      NEW.motivo_reprovacao_categoria := COALESCE(NEW.motivo_reprovacao_categoria, 'OUTRO');
      NEW.motivo_reprovacao_detalhe := COALESCE(
        NULLIF(NEW.motivo_reprovacao_detalhe,''),
        'Reprovação registrada sem detalhamento. Revisão administrativa necessária.'
      );
      NEW.motivo_reprovacao := COALESCE(NEW.motivo_reprovacao, 'MOTIVO_NAO_DETALHADO');
    END IF;
    NEW.reprovacao_registrada_em := COALESCE(NEW.reprovacao_registrada_em, NOW());
    NEW.reprovacao_vaga_id := COALESCE(NEW.reprovacao_vaga_id, NEW.vaga_id);
  ELSIF NEW.status = 'REPROVADO' THEN
    IF COALESCE(NULLIF(NEW.motivo_reprovacao_codigo,''), NULLIF(NEW.motivo_reprovacao,'')) IS NULL THEN
      -- Combinação impossível como REPROVADO + AGUARDANDO_CTPS:
      -- conserva a etapa e restaura um status coerente.
      NEW.status := genesis_status_seguro_para_etapa(NEW.etapa);
      IF NEW.status <> 'REPROVADO' AND NEW.aprovado IS FALSE THEN NEW.aprovado := NULL; END IF;
    ELSE
      -- Há uma reprovação real, então move a etapa para o ponto correto.
      NEW.etapa := CASE
        WHEN COALESCE(NEW.motivo_reprovacao_categoria,'') = 'ENTREVISTA' THEN 'REPROVADO_POS_ENTREVISTA'
        WHEN COALESCE(NEW.motivo_reprovacao_categoria,'') IN ('IDADE','EXPERIENCIA')
             AND COALESCE(NEW.ctps_analisada_at, NEW.reprovacao_registrada_em) IS NULL THEN 'REPROVADO_PRE_TRIAGEM'
        ELSE 'REPROVADO_TRIAGEM'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidatos_normalizar_status_etapa ON candidatos;
CREATE TRIGGER candidatos_normalizar_status_etapa
BEFORE INSERT OR UPDATE OF status, etapa, aprovado, motivo_reprovacao,
  motivo_reprovacao_codigo, motivo_reprovacao_categoria, motivo_reprovacao_detalhe,
  idade_validada, idade_confirmada_documentalmente, data_nascimento, data_nascimento_origem
ON candidatos
FOR EACH ROW EXECUTE FUNCTION genesis_normalizar_status_etapa_candidato();

-- Corrige combinações já existentes. O caso típico é REPROVADO em uma etapa normal,
-- sem motivo, embora a idade registrada seja válida.
UPDATE candidatos
SET
  status = genesis_status_seguro_para_etapa(etapa),
  aprovado = CASE WHEN aprovado IS FALSE THEN NULL ELSE aprovado END,
  motivo_reprovacao = NULL,
  motivo_reprovacao_codigo = NULL,
  motivo_reprovacao_categoria = NULL,
  motivo_reprovacao_detalhe = NULL,
  reprovacao_vaga_id = NULL,
  reprovacao_registrada_em = NULL,
  updated_at = NOW()
WHERE status = 'REPROVADO'
  AND etapa NOT IN ('REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA')
  AND COALESCE(NULLIF(motivo_reprovacao_codigo,''), NULLIF(motivo_reprovacao,'')) IS NULL;

-- Libera processamentos antigos interrompidos antes da atualização.
UPDATE documentos
SET
  tipo = CASE WHEN UPPER(COALESCE(tipo,'')) = 'PENDENTE' THEN 'PENDENTE_REVISAO' ELSE tipo END,
  titulo = CASE WHEN UPPER(COALESCE(tipo,'')) = 'PENDENTE' THEN 'Documento com processamento interrompido' ELSE titulo END,
  status_processamento = 'ERRO',
  resultado = COALESCE(resultado, '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'status', 'ERRO', 'codigo', 'PROCESSAMENTO_EXPIRADO',
    'mensagem', 'Processamento anterior interrompido; revisão necessária.'
  ),
  processado_at = NOW()
WHERE status_processamento = 'PROCESSANDO'
  AND COALESCE(processando_at, created_at) < NOW() - INTERVAL '10 minutes';

UPDATE candidatos
SET documento_processando = FALSE,
    processamento_token = NULL,
    processamento_bloqueado_ate = NULL,
    updated_at = NOW()
WHERE documento_processando IS TRUE
  AND processamento_bloqueado_ate IS NOT NULL
  AND processamento_bloqueado_ate < NOW();

-- Recupera reprovações etárias antigas quando a fonte documental comprova elegibilidade.
UPDATE candidatos
SET
  status = genesis_status_seguro_para_etapa(
    CASE WHEN aprovado IS TRUE THEN 'AGUARDANDO_APRESENTACAO'
         WHEN REGEXP_REPLACE(COALESCE(cep,''), '\D', '', 'g') ~ '^\d{8}$' THEN 'AGUARDANDO_CTPS'
         ELSE 'AGUARDANDO_CTPS_CEP' END
  ),
  etapa = CASE WHEN aprovado IS TRUE THEN
                  CASE WHEN REGEXP_REPLACE(COALESCE(cep,''), '\D', '', 'g') ~ '^\d{8}$'
                    THEN 'AGUARDANDO_APRESENTACAO' ELSE 'AGUARDANDO_CEP' END
               WHEN REGEXP_REPLACE(COALESCE(cep,''), '\D', '', 'g') ~ '^\d{8}$' THEN 'AGUARDANDO_CTPS'
               ELSE 'AGUARDANDO_CTPS_CEP' END,
  aprovado = CASE WHEN aprovado IS FALSE THEN NULL ELSE aprovado END,
  motivo_reprovacao = NULL,
  motivo_reprovacao_codigo = NULL,
  motivo_reprovacao_categoria = NULL,
  motivo_reprovacao_detalhe = NULL,
  reprovacao_vaga_id = NULL,
  reprovacao_registrada_em = NULL,
  updated_at = NOW()
WHERE idade_confirmada_documentalmente IS TRUE
  AND idade_validada IS TRUE
  AND COALESCE(motivo_reprovacao_codigo, motivo_reprovacao, '')
      IN ('IDADE_MINIMA_NAO_ATENDIDA','IDADE_MAXIMA_NAO_ATENDIDA','IDADE_DECLARADA_FORA_FAIXA');

COMMIT;

-- Verificações:
-- SELECT id, status, etapa, data_nascimento, data_nascimento_origem,
--        idade_declarada, idade_pre_validada, idade_confirmada_documentalmente,
--        idade_validada, motivo_reprovacao_codigo
-- FROM candidatos ORDER BY id DESC LIMIT 30;
