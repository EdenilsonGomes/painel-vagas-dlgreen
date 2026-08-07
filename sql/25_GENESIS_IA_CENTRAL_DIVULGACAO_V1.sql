-- Gênesis IA — Central de Divulgação V1
-- Migration isolada: não altera o chatbot, candidatos, mensagens ou regras da triagem.
BEGIN;

CREATE TABLE IF NOT EXISTS divulgacao_configuracoes (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL UNIQUE REFERENCES app_usuarios(id) ON DELETE CASCADE,
  empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
  onboarding_etapa SMALLINT NOT NULL DEFAULT 1 CHECK (onboarding_etapa BETWEEN 1 AND 4),
  onboarding_concluido BOOLEAN NOT NULL DEFAULT FALSE,
  usar_facebook BOOLEAN NOT NULL DEFAULT TRUE,
  usar_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_termo_aceito_at TIMESTAMPTZ,
  intervalo_min_segundos INTEGER NOT NULL DEFAULT 180 CHECK (intervalo_min_segundos BETWEEN 90 AND 7200),
  intervalo_max_segundos INTEGER NOT NULL DEFAULT 300 CHECK (intervalo_max_segundos BETWEEN 90 AND 10800),
  limite_diario INTEGER NOT NULL DEFAULT 20 CHECK (limite_diario BETWEEN 1 AND 100),
  hora_inicio TIME NOT NULL DEFAULT '08:00',
  hora_fim TIME NOT NULL DEFAULT '18:00',
  dias_semana SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (intervalo_max_segundos >= intervalo_min_segundos)
);

CREATE TABLE IF NOT EXISTS divulgacao_grupos (
  id BIGSERIAL PRIMARY KEY,
  canal VARCHAR(20) NOT NULL CHECK (canal IN ('FACEBOOK','WHATSAPP')),
  nome VARCHAR(220) NOT NULL,
  url TEXT,
  url_normalizada TEXT,
  external_id VARCHAR(180),
  session_name VARCHAR(120),
  empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
  owner_user_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  regiao VARCHAR(160),
  categorias TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cargos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  regras TEXT,
  observacoes TEXT,
  origem VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origem IN ('MANUAL','IMPORTACAO','WAHA')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  autorizado_envio BOOLEAN NOT NULL DEFAULT FALSE,
  somente_admin BOOLEAN,
  papel_usuario VARCHAR(30),
  participantes INTEGER,
  intervalo_minimo_horas INTEGER NOT NULL DEFAULT 24 CHECK (intervalo_minimo_horas BETWEEN 0 AND 720),
  ultima_publicacao_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((canal='FACEBOOK' AND url IS NOT NULL) OR (canal='WHATSAPP' AND external_id IS NOT NULL))
);

-- A chave de escopo compartilha grupos dentro da mesma empresa e isola recrutadores sem empresa.
DROP INDEX IF EXISTS divulgacao_grupos_facebook_url_uidx;
CREATE UNIQUE INDEX divulgacao_grupos_facebook_url_uidx
  ON divulgacao_grupos(url_normalizada, COALESCE(empresa_id, -owner_user_id))
  WHERE canal='FACEBOOK' AND url_normalizada IS NOT NULL;
DROP INDEX IF EXISTS divulgacao_grupos_whatsapp_uidx;
CREATE UNIQUE INDEX divulgacao_grupos_whatsapp_uidx
  ON divulgacao_grupos(session_name, external_id, COALESCE(empresa_id, -owner_user_id))
  WHERE canal='WHATSAPP' AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS divulgacao_grupos_scope_idx ON divulgacao_grupos(empresa_id, owner_user_id, canal, ativo);

CREATE TABLE IF NOT EXISTS divulgacao_campanhas (
  id BIGSERIAL PRIMARY KEY,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE RESTRICT,
  canal VARCHAR(20) NOT NULL CHECK (canal IN ('FACEBOOK','WHATSAPP')),
  nome VARCHAR(240) NOT NULL,
  texto_modelo TEXT NOT NULL,
  modelo VARCHAR(30) NOT NULL DEFAULT 'COMPLETO' CHECK (modelo IN ('CURTO','COMPLETO','PERSONALIZADO')),
  usar_imagem BOOLEAN NOT NULL DEFAULT TRUE,
  modo_envio VARCHAR(20) NOT NULL DEFAULT 'ASSISTIDO' CHECK (modo_envio IN ('ASSISTIDO','AUTOMATICO')),
  status VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','AGENDADA','EM_EXECUCAO','PAUSADA','CONCLUIDA','CANCELADA','FALHA')),
  agendada_para TIMESTAMPTZ,
  intervalo_min_segundos INTEGER NOT NULL DEFAULT 180 CHECK (intervalo_min_segundos BETWEEN 90 AND 7200),
  intervalo_max_segundos INTEGER NOT NULL DEFAULT 300 CHECK (intervalo_max_segundos BETWEEN 90 AND 10800),
  limite_diario INTEGER NOT NULL DEFAULT 20 CHECK (limite_diario BETWEEN 1 AND 100),
  empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  iniciada_at TIMESTAMPTZ,
  concluida_at TIMESTAMPTZ,
  pausada_at TIMESTAMPTZ,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (intervalo_max_segundos >= intervalo_min_segundos)
);
CREATE INDEX IF NOT EXISTS divulgacao_campanhas_scope_idx ON divulgacao_campanhas(empresa_id, created_by, status, created_at DESC);
CREATE INDEX IF NOT EXISTS divulgacao_campanhas_vaga_idx ON divulgacao_campanhas(vaga_id, canal, created_at DESC);

CREATE TABLE IF NOT EXISTS divulgacao_campanha_destinos (
  id BIGSERIAL PRIMARY KEY,
  campanha_id BIGINT NOT NULL REFERENCES divulgacao_campanhas(id) ON DELETE CASCADE,
  grupo_id BIGINT NOT NULL REFERENCES divulgacao_grupos(id) ON DELETE RESTRICT,
  tracking_token VARCHAR(80) NOT NULL UNIQUE,
  texto_override TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PRONTO','ENVIANDO','ENVIADO','PUBLICADO','PULADO','FALHA','BLOQUEADO')),
  agendado_para TIMESTAMPTZ,
  enviado_at TIMESTAMPTZ,
  publicado_at TIMESTAMPTZ,
  tentativas INTEGER NOT NULL DEFAULT 0,
  waha_message_id TEXT,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campanha_id, grupo_id)
);
CREATE INDEX IF NOT EXISTS divulgacao_destinos_fila_idx ON divulgacao_campanha_destinos(status, agendado_para, campanha_id);
CREATE INDEX IF NOT EXISTS divulgacao_destinos_grupo_idx ON divulgacao_campanha_destinos(grupo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS divulgacao_cliques (
  id BIGSERIAL PRIMARY KEY,
  destino_id BIGINT NOT NULL REFERENCES divulgacao_campanha_destinos(id) ON DELETE CASCADE,
  visitor_hash VARCHAR(128),
  referer TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS divulgacao_cliques_destino_idx ON divulgacao_cliques(destino_id, created_at DESC);

COMMENT ON TABLE divulgacao_configuracoes IS 'Onboarding e limites da Central de Divulgação por recrutador.';
COMMENT ON TABLE divulgacao_grupos IS 'Catálogo interno de grupos de Facebook e WhatsApp.';
COMMENT ON TABLE divulgacao_campanhas IS 'Campanhas vinculadas à tabela oficial vagas.';
COMMENT ON TABLE divulgacao_campanha_destinos IS 'Execução e rastreamento por grupo selecionado.';

COMMIT;
