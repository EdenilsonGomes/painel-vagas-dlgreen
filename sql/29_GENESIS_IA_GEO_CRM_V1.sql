BEGIN;

CREATE TABLE IF NOT EXISTS geo_ceps (
  cep VARCHAR(8) PRIMARY KEY,
  estado VARCHAR(2),
  cidade VARCHAR(160),
  bairro VARCHAR(180),
  logradouro TEXT,
  latitude NUMERIC(12,8),
  longitude NUMERIC(12,8),
  fonte VARCHAR(40) NOT NULL DEFAULT 'BRASILAPI',
  servico VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  ultimo_erro TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  consultado_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT geo_ceps_cep_check CHECK (cep ~ '^[0-9]{8}$'),
  CONSTRAINT geo_ceps_status_check CHECK (status IN ('PENDENTE','OK','SEM_COORDENADAS','NAO_ENCONTRADO','ERRO'))
);

CREATE INDEX IF NOT EXISTS idx_geo_ceps_status ON geo_ceps(status, consultado_at);

CREATE TABLE IF NOT EXISTS geo_vagas (
  vaga_id BIGINT PRIMARY KEY REFERENCES vagas(id) ON DELETE CASCADE,
  cep VARCHAR(8) REFERENCES geo_ceps(cep) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geo_vagas_cep ON geo_vagas(cep);

CREATE OR REPLACE FUNCTION genesis_geo_distancia_km(
  lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC
) RETURNS NUMERIC
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN NULL
    ELSE ROUND((6371.0088 * ACOS(
      LEAST(1.0, GREATEST(-1.0,
        COS(RADIANS(lat1::DOUBLE PRECISION)) * COS(RADIANS(lat2::DOUBLE PRECISION)) *
        COS(RADIANS(lon2::DOUBLE PRECISION) - RADIANS(lon1::DOUBLE PRECISION)) +
        SIN(RADIANS(lat1::DOUBLE PRECISION)) * SIN(RADIANS(lat2::DOUBLE PRECISION))
      ))
    ))::NUMERIC, 1)
  END;
$$;

CREATE TABLE IF NOT EXISTS crm_empresas (
  id BIGSERIAL PRIMARY KEY,
  nome VARCHAR(180) NOT NULL,
  segmento VARCHAR(160),
  cidade VARCHAR(160),
  estado VARCHAR(2),
  website TEXT,
  origem VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  prospeccao_lead_id BIGINT UNIQUE REFERENCES prospeccao_leads(id) ON DELETE SET NULL,
  empresa_operacional_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_empresas_nome ON crm_empresas(LOWER(nome));

CREATE TABLE IF NOT EXISTS crm_contatos (
  id BIGSERIAL PRIMARY KEY,
  crm_empresa_id BIGINT NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  nome VARCHAR(160),
  cargo VARCHAR(160),
  email VARCHAR(254),
  whatsapp VARCHAR(30),
  principal BOOLEAN NOT NULL DEFAULT FALSE,
  origem VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_contatos_empresa ON crm_contatos(crm_empresa_id);

CREATE TABLE IF NOT EXISTS crm_oportunidades (
  id BIGSERIAL PRIMARY KEY,
  crm_empresa_id BIGINT NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
  titulo VARCHAR(220) NOT NULL DEFAULT 'Oportunidade comercial',
  etapa VARCHAR(30) NOT NULL DEFAULT 'NOVO_LEAD',
  valor_estimado NUMERIC(12,2),
  responsavel_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  origem VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  prospeccao_lead_id BIGINT UNIQUE REFERENCES prospeccao_leads(id) ON DELETE SET NULL,
  demo_id BIGINT UNIQUE REFERENCES genesis_demos(id) ON DELETE SET NULL,
  proxima_acao VARCHAR(240),
  proxima_acao_em TIMESTAMPTZ,
  motivo_perda TEXT,
  ganho_em TIMESTAMPTZ,
  perdido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_oportunidades_etapa_check CHECK (etapa IN ('NOVO_LEAD','CONTATADO','RESPONDEU','QUALIFICADO','DEMONSTRACAO','PROPOSTA','NEGOCIACAO','GANHO','PERDIDO'))
);
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_etapa ON crm_oportunidades(etapa, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_oportunidades_empresa ON crm_oportunidades(crm_empresa_id);

CREATE TABLE IF NOT EXISTS crm_interacoes (
  id BIGSERIAL PRIMARY KEY,
  oportunidade_id BIGINT NOT NULL REFERENCES crm_oportunidades(id) ON DELETE CASCADE,
  tipo VARCHAR(40) NOT NULL DEFAULT 'NOTA',
  descricao TEXT NOT NULL,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_interacoes_oportunidade ON crm_interacoes(oportunidade_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_followups (
  id BIGSERIAL PRIMARY KEY,
  oportunidade_id BIGINT NOT NULL REFERENCES crm_oportunidades(id) ON DELETE CASCADE,
  titulo VARCHAR(240) NOT NULL,
  vencimento TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  responsavel_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_followups_status_check CHECK (status IN ('PENDENTE','CONCLUIDO','CANCELADO'))
);
CREATE INDEX IF NOT EXISTS idx_crm_followups_status ON crm_followups(status, vencimento);

COMMIT;
