BEGIN;

-- ============================================================
-- GENESIS RECRUITING OS V14
-- Marca white-label por empresa, agenda individual do recrutador,
-- artes de vagas geradas por IA e prospecção assistida segura.
-- Migração aditiva e idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- Empresa e identidade visual
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresa_marcas (
  empresa_id BIGINT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  slogan VARCHAR(180),
  cor_primaria VARCHAR(7) NOT NULL DEFAULT '#0F766E',
  cor_secundaria VARCHAR(7) NOT NULL DEFAULT '#0B1324',
  cor_destaque VARCHAR(7) NOT NULL DEFAULT '#22C55E',
  estilo_visual VARCHAR(30) NOT NULL DEFAULT 'CORPORATIVO',
  tom_comunicacao VARCHAR(30) NOT NULL DEFAULT 'PROFISSIONAL',
  whatsapp VARCHAR(30),
  email VARCHAR(180),
  website TEXT,
  logo_png BYTEA,
  logo_mime VARCHAR(60),
  logo_nome VARCHAR(180),
  logo_atualizada_em TIMESTAMPTZ,
  configurada BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT empresa_marcas_cor_primaria_check CHECK (cor_primaria ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT empresa_marcas_cor_secundaria_check CHECK (cor_secundaria ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT empresa_marcas_cor_destaque_check CHECK (cor_destaque ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT empresa_marcas_estilo_check CHECK (estilo_visual IN ('CORPORATIVO','HUMANO','MODERNO','MINIMALISTA','VIBRANTE')),
  CONSTRAINT empresa_marcas_tom_check CHECK (tom_comunicacao IN ('PROFISSIONAL','PROXIMO','DIRETO','INSPIRADOR'))
);

INSERT INTO empresa_marcas (empresa_id)
SELECT id FROM empresas
ON CONFLICT (empresa_id) DO NOTHING;

DROP TRIGGER IF EXISTS empresa_marcas_atualizar_updated_at ON empresa_marcas;
CREATE TRIGGER empresa_marcas_atualizar_updated_at
BEFORE UPDATE ON empresa_marcas
FOR EACH ROW EXECUTE FUNCTION atualizar_updated_at();

-- ------------------------------------------------------------
-- Usuário vinculado à empresa e agenda individual
-- ------------------------------------------------------------
ALTER TABLE app_usuarios
  ADD COLUMN IF NOT EXISTS empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL;

UPDATE app_usuarios u
SET empresa_id = (SELECT e.id FROM empresas e WHERE e.ativo IS TRUE ORDER BY e.id LIMIT 1)
WHERE u.empresa_id IS NULL
  AND u.perfil = 'RECRUTADOR'
  AND EXISTS (SELECT 1 FROM empresas e WHERE e.ativo IS TRUE);

CREATE INDEX IF NOT EXISTS idx_app_usuarios_empresa
  ON app_usuarios (empresa_id, ativo, nome);

CREATE TABLE IF NOT EXISTS recrutador_agendas (
  usuario_id BIGINT PRIMARY KEY REFERENCES app_usuarios(id) ON DELETE CASCADE,
  dias_semana SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  horarios JSONB NOT NULL DEFAULT '["09:00","10:00","14:00","15:00"]'::JSONB,
  duracao_minutos INTEGER NOT NULL DEFAULT 30,
  busca_dias INTEGER NOT NULL DEFAULT 7,
  evitar_feriados BOOLEAN NOT NULL DEFAULT TRUE,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Sao_Paulo',
  google_calendar_id TEXT,
  whatsapp_alerta VARCHAR(30),
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recrutador_agenda_duracao_check CHECK (duracao_minutos BETWEEN 10 AND 180),
  CONSTRAINT recrutador_agenda_busca_check CHECK (busca_dias BETWEEN 1 AND 60),
  CONSTRAINT recrutador_agenda_dias_check CHECK (CARDINALITY(dias_semana) BETWEEN 1 AND 7),
  CONSTRAINT recrutador_agenda_horarios_check CHECK (JSONB_TYPEOF(horarios) = 'array')
);

INSERT INTO recrutador_agendas (usuario_id)
SELECT id FROM app_usuarios WHERE ativo IS TRUE
ON CONFLICT (usuario_id) DO NOTHING;

ALTER TABLE vagas
  ADD COLUMN IF NOT EXISTS recrutador_responsavel_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agenda_personalizada BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE vagas v
SET recrutador_responsavel_id = COALESCE(
  v.recrutador_responsavel_id,
  (SELECT u.id FROM app_usuarios u
   WHERE u.ativo IS TRUE
     AND (u.empresa_id = v.empresa_id OR u.empresa_id IS NULL)
   ORDER BY CASE WHEN u.perfil = 'RECRUTADOR' THEN 0 ELSE 1 END, u.id
   LIMIT 1)
)
WHERE v.recrutador_responsavel_id IS NULL;

UPDATE vagas v SET
  entrevista_dias_semana = a.dias_semana,
  entrevista_horarios = a.horarios,
  entrevista_duracao_minutos = a.duracao_minutos,
  entrevista_busca_dias = a.busca_dias,
  entrevista_evitar_feriados = a.evitar_feriados,
  updated_at = NOW()
FROM recrutador_agendas a
WHERE a.usuario_id = v.recrutador_responsavel_id
  AND v.agenda_personalizada IS FALSE
  AND a.ativa IS TRUE;

CREATE INDEX IF NOT EXISTS idx_vagas_recrutador
  ON vagas (recrutador_responsavel_id, status, updated_at DESC);

-- Mantém as colunas legadas da vaga sincronizadas, pois o workflow atual
-- já as consome. Assim a agenda individual entra sem quebrar o n8n.
CREATE OR REPLACE FUNCTION genesis_aplicar_agenda_recrutador_vaga(p_vaga_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  agenda recrutador_agendas%ROWTYPE;
BEGIN
  SELECT a.* INTO agenda
  FROM vagas v
  JOIN recrutador_agendas a ON a.usuario_id = v.recrutador_responsavel_id
  WHERE v.id = p_vaga_id
    AND v.agenda_personalizada IS FALSE
    AND a.ativa IS TRUE;

  IF FOUND THEN
    UPDATE vagas SET
      entrevista_dias_semana = agenda.dias_semana,
      entrevista_horarios = agenda.horarios,
      entrevista_duracao_minutos = agenda.duracao_minutos,
      entrevista_busca_dias = agenda.busca_dias,
      entrevista_evitar_feriados = agenda.evitar_feriados,
      updated_at = NOW()
    WHERE id = p_vaga_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_propagar_agenda_recrutador()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE vagas SET
    entrevista_dias_semana = NEW.dias_semana,
    entrevista_horarios = NEW.horarios,
    entrevista_duracao_minutos = NEW.duracao_minutos,
    entrevista_busca_dias = NEW.busca_dias,
    entrevista_evitar_feriados = NEW.evitar_feriados,
    updated_at = NOW()
  WHERE recrutador_responsavel_id = NEW.usuario_id
    AND agenda_personalizada IS FALSE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recrutador_agenda_propagar_vagas ON recrutador_agendas;
CREATE TRIGGER recrutador_agenda_propagar_vagas
AFTER INSERT OR UPDATE ON recrutador_agendas
FOR EACH ROW EXECUTE FUNCTION genesis_propagar_agenda_recrutador();

-- ------------------------------------------------------------
-- Fotografias IA persistidas; textos e logo são compostos no download.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vaga_artes_ia (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'PRONTA',
  modelo VARCHAR(80) NOT NULL,
  prompt TEXT NOT NULL,
  imagem BYTEA NOT NULL,
  mime_type VARCHAR(60) NOT NULL DEFAULT 'image/jpeg',
  largura INTEGER,
  altura INTEGER,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vaga_artes_status_check CHECK (status IN ('PRONTA','FALHA','ARQUIVADA')),
  CONSTRAINT vaga_artes_versao_unica UNIQUE (vaga_id, versao)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vaga_arte_ativa
  ON vaga_artes_ia (vaga_id)
  WHERE ativa IS TRUE;
CREATE INDEX IF NOT EXISTS idx_vaga_artes_historico
  ON vaga_artes_ia (vaga_id, created_at DESC);

-- ------------------------------------------------------------
-- Revisão humana de incompatibilidade de sexo extraído da CTPS.
-- A decisão continua humana e o candidato permanece realocável.
-- ------------------------------------------------------------
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'candidato_revisoes'::REGCLASS
      AND contype = 'c'
      AND POSITION('tipo' IN LOWER(PG_GET_CONSTRAINTDEF(oid))) > 0
  LOOP
    EXECUTE FORMAT('ALTER TABLE candidato_revisoes DROP CONSTRAINT %I', item.conname);
  END LOOP;
END;
$$;

ALTER TABLE candidato_revisoes
  ADD CONSTRAINT candidato_revisoes_tipo_valido CHECK (tipo IN (
    'EXCECAO_EXPERIENCIA','REVISAO_DOCUMENTAL','SUPORTE_FLUXO',
    'DIVERGENCIA_DADOS','INCOMPATIBILIDADE_SEXO'
  ));

-- ------------------------------------------------------------
-- Prospecção: filtros, autorização, fila assistida e respostas.
-- ------------------------------------------------------------
ALTER TABLE prospeccao_leads
  ADD COLUMN IF NOT EXISTS contato_autorizado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contato_autorizado_origem VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contato_autorizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resposta_tipo VARCHAR(30),
  ADD COLUMN IF NOT EXISTS resposta_ultima_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS primeiro_contato_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_filtros_v14
  ON prospeccao_leads (prioridade, responsavel_id, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_resposta_v14
  ON prospeccao_leads (resposta_tipo, resposta_ultima_at DESC);

CREATE TABLE IF NOT EXISTS prospeccao_modelos_mensagem (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  mensagem TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO prospeccao_modelos_mensagem (nome, mensagem)
SELECT 'Apresentação inicial',
       'Olá! Meu nome é {nome_sdr}, da Gênesis. Vi a empresa {empresa} e gostaria de saber quem é a pessoa responsável por recrutamento ou operações. Posso explicar brevemente o motivo do contato?'
WHERE NOT EXISTS (SELECT 1 FROM prospeccao_modelos_mensagem);

CREATE TABLE IF NOT EXISTS prospeccao_envios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  modelo_id BIGINT REFERENCES prospeccao_modelos_mensagem(id) ON DELETE SET NULL,
  session_name VARCHAR(100) NOT NULL,
  telefone VARCHAR(30) NOT NULL,
  mensagem TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'AGENDADO',
  agendado_para TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aprovado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  enviado_em TIMESTAMPTZ,
  waha_message_id TEXT,
  erro TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_envios_status_check CHECK (status IN ('AGENDADO','PROCESSANDO','ENVIADO','FALHA','CANCELADO'))
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_envios_fila
  ON prospeccao_envios (status, agendado_para, created_at)
  WHERE status = 'AGENDADO';
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_primeiro_contato_aberto
  ON prospeccao_envios (lead_id)
  WHERE status IN ('AGENDADO','PROCESSANDO','ENVIADO');

CREATE TABLE IF NOT EXISTS prospeccao_respostas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id BIGINT REFERENCES prospeccao_leads(id) ON DELETE SET NULL,
  session_name VARCHAR(100) NOT NULL,
  telefone VARCHAR(30) NOT NULL,
  message_id TEXT,
  mensagem TEXT,
  classificacao VARCHAR(30) NOT NULL,
  regra_detectada VARCHAR(120),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_respostas_classificacao_check CHECK (classificacao IN ('HUMANA','AUTOMATICA','DESCADASTRO','VAZIA'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_resposta_message_id
  ON prospeccao_respostas (session_name, message_id)
  WHERE message_id IS NOT NULL AND BTRIM(message_id) <> '';
CREATE INDEX IF NOT EXISTS idx_prospeccao_respostas_lead
  ON prospeccao_respostas (lead_id, created_at DESC);

COMMIT;

SELECT
  TO_REGCLASS('public.empresa_marcas') AS empresa_marcas,
  TO_REGCLASS('public.recrutador_agendas') AS recrutador_agendas,
  TO_REGCLASS('public.vaga_artes_ia') AS vaga_artes_ia,
  TO_REGCLASS('public.prospeccao_envios') AS prospeccao_envios,
  TO_REGCLASS('public.prospeccao_respostas') AS prospeccao_respostas;
