BEGIN;

-- ============================================================
-- GENESIS IA V6
-- Usuários, permissões, prospecção Apify, benefícios e auditoria
-- ============================================================

CREATE TABLE IF NOT EXISTS app_usuarios (
  id BIGSERIAL PRIMARY KEY,
  usuario VARCHAR(60) NOT NULL,
  senha_hash TEXT NOT NULL,
  nome VARCHAR(150) NOT NULL,
  perfil VARCHAR(20) NOT NULL DEFAULT 'RECRUTADOR',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  deve_trocar_senha BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_login_at TIMESTAMPTZ,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_usuarios_usuario_unico UNIQUE (usuario),
  CONSTRAINT app_usuarios_perfil_check CHECK (perfil IN ('ADMIN', 'RECRUTADOR'))
);

CREATE INDEX IF NOT EXISTS idx_app_usuarios_ativo_perfil
  ON app_usuarios (ativo, perfil, nome);

CREATE TABLE IF NOT EXISTS app_auditoria (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  usuario_nome VARCHAR(150),
  acao VARCHAR(100) NOT NULL,
  entidade VARCHAR(80),
  entidade_id TEXT,
  detalhes JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_auditoria_created_at
  ON app_auditoria (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_auditoria_usuario
  ON app_auditoria (usuario_id, created_at DESC);

-- Valores de benefícios usados no cálculo de ganhos aproximados.
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS vale_refeicao_valor NUMERIC(12,2);
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS vale_alimentacao_valor NUMERIC(12,2);
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS premio_assiduidade_valor NUMERIC(12,2);
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS outros_beneficios_valor NUMERIC(12,2);
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS vale_transporte_descricao TEXT;
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS beneficios_observacao TEXT;

COMMENT ON COLUMN vagas.vale_refeicao_valor IS 'Valor mensal aproximado do VR para divulgação.';
COMMENT ON COLUMN vagas.vale_alimentacao_valor IS 'Valor mensal aproximado do VA para divulgação.';
COMMENT ON COLUMN vagas.premio_assiduidade_valor IS 'Valor mensal aproximado do prêmio de assiduidade.';
COMMENT ON COLUMN vagas.outros_beneficios_valor IS 'Soma mensal aproximada de outros benefícios monetários.';
COMMENT ON COLUMN vagas.vale_transporte_descricao IS 'Descrição do VT; não entra no cálculo de ganhos aproximados.';
COMMENT ON COLUMN vagas.beneficios_observacao IS 'Observações adicionais sobre benefícios e regras de pagamento.';

-- ============================================================
-- Prospecção Apify
-- ============================================================

CREATE TABLE IF NOT EXISTS prospeccao_configuracao (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  orcamento_mensal_usd NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  custo_estimado_por_1000_usd NUMERIC(10,4) NOT NULL DEFAULT 1.50,
  custo_estimado_inicio_usd NUMERIC(10,4) NOT NULL DEFAULT 0.007,
  limite_padrao INTEGER NOT NULL DEFAULT 25,
  limite_maximo_execucao INTEGER NOT NULL DEFAULT 100,
  permitir_enriquecimento BOOLEAN NOT NULL DEFAULT FALSE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_config_singleton CHECK (id = 1),
  CONSTRAINT prospeccao_config_limites CHECK (
    orcamento_mensal_usd >= 0
    AND custo_estimado_por_1000_usd >= 0
    AND limite_padrao BETWEEN 1 AND 500
    AND limite_maximo_execucao BETWEEN 1 AND 1000
    AND limite_padrao <= limite_maximo_execucao
  )
);

INSERT INTO prospeccao_configuracao (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS prospeccao_execucoes (
  id BIGSERIAL PRIMARY KEY,
  apify_run_id TEXT UNIQUE,
  apify_dataset_id TEXT,
  actor_id TEXT NOT NULL,
  termo_busca TEXT NOT NULL,
  localizacao TEXT NOT NULL,
  quantidade_solicitada INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PREPARANDO',
  custo_estimado_usd NUMERIC(12,4) NOT NULL DEFAULT 0,
  custo_real_usd NUMERIC(12,4),
  quantidade_encontrada INTEGER NOT NULL DEFAULT 0,
  quantidade_importada INTEGER NOT NULL DEFAULT 0,
  quantidade_duplicada INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  input_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  retorno_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  iniciado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  iniciado_por_nome VARCHAR(150),
  iniciado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_exec_status_check CHECK (
    status IN ('PREPARANDO','RUNNING','READY','SUCCEEDED','FAILED','TIMING-OUT','ABORTING','ABORTED','TIMED-OUT')
  ),
  CONSTRAINT prospeccao_exec_quantidade_check CHECK (quantidade_solicitada BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_execucoes_status
  ON prospeccao_execucoes (status, iniciado_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospeccao_execucoes_mes
  ON prospeccao_execucoes (iniciado_at DESC);

CREATE TABLE IF NOT EXISTS prospeccao_leads (
  id BIGSERIAL PRIMARY KEY,
  execucao_id BIGINT REFERENCES prospeccao_execucoes(id) ON DELETE SET NULL,
  empresa_nome TEXT NOT NULL,
  categoria TEXT,
  categorias JSONB NOT NULL DEFAULT '[]'::JSONB,
  telefone TEXT,
  telefone_normalizado TEXT,
  website TEXT,
  dominio TEXT,
  email TEXT,
  endereco TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  cep TEXT,
  pais TEXT,
  google_place_id TEXT,
  google_maps_url TEXT,
  latitude NUMERIC(12,8),
  longitude NUMERIC(12,8),
  avaliacao NUMERIC(4,2),
  quantidade_avaliacoes INTEGER,
  score INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'NOVO',
  prioridade VARCHAR(15) NOT NULL DEFAULT 'MEDIA',
  nao_contatar BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_descarte TEXT,
  responsavel_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  observacao TEXT,
  dados_brutos JSONB NOT NULL DEFAULT '{}'::JSONB,
  coletado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_lead_status_check CHECK (
    status IN ('NOVO','EM_ANALISE','APROVADO_CONTATO','PRIMEIRO_CONTATO','RESPONDEU','REUNIAO','PROPOSTA','CLIENTE','DESCARTADO','SEM_INTERESSE','CONTATO_INVALIDO','NAO_CONTATAR')
  ),
  CONSTRAINT prospeccao_lead_prioridade_check CHECK (prioridade IN ('BAIXA','MEDIA','ALTA')),
  CONSTRAINT prospeccao_lead_score_check CHECK (score BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_leads_place_id
  ON prospeccao_leads (google_place_id)
  WHERE google_place_id IS NOT NULL AND BTRIM(google_place_id) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_leads_dominio
  ON prospeccao_leads (dominio)
  WHERE dominio IS NOT NULL AND BTRIM(dominio) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospeccao_leads_telefone
  ON prospeccao_leads (telefone_normalizado)
  WHERE telefone_normalizado IS NOT NULL AND BTRIM(telefone_normalizado) <> '';
CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_status_score
  ON prospeccao_leads (status, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_local
  ON prospeccao_leads (estado, cidade, categoria);

CREATE TABLE IF NOT EXISTS prospeccao_notas (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  nota TEXT NOT NULL,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_notas_lead
  ON prospeccao_notas (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prospeccao_contatos (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  canal VARCHAR(20) NOT NULL,
  resultado VARCHAR(50),
  mensagem TEXT,
  realizado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  realizado_por_nome VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_contatos_canal_check CHECK (canal IN ('WHATSAPP','TELEFONE','EMAIL','LINKEDIN','OUTRO'))
);

CREATE INDEX IF NOT EXISTS idx_prospeccao_contatos_lead
  ON prospeccao_contatos (lead_id, created_at DESC);

COMMIT;

-- Conferência rápida
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'vagas'
  AND column_name IN (
    'vale_refeicao_valor',
    'vale_alimentacao_valor',
    'premio_assiduidade_valor',
    'outros_beneficios_valor',
    'vale_transporte_descricao',
    'beneficios_observacao'
  )
ORDER BY column_name;

SELECT TO_REGCLASS('public.app_usuarios') AS app_usuarios,
       TO_REGCLASS('public.prospeccao_execucoes') AS prospeccao_execucoes,
       TO_REGCLASS('public.prospeccao_leads') AS prospeccao_leads;
