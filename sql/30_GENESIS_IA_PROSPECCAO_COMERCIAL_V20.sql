BEGIN;

ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS razao_social TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS porte_cadastral VARCHAR(80);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS capital_social NUMERIC(18,2);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS data_abertura DATE;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS funcionarios_estimados INTEGER;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS porte_estimado VARCHAR(30);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS tem_trabalhe_conosco BOOLEAN;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS portal_vagas_url TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS ats_detectado VARCHAR(80);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS vagas_abertas_estimadas INTEGER;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS cargos_detectados JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS oferta_sugerida VARCHAR(40);
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS motivo_abordagem TEXT;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS enriquecimento_status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS enriquecido_at TIMESTAMPTZ;
ALTER TABLE prospeccao_leads ADD COLUMN IF NOT EXISTS site_analisado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_cnpj_v20
  ON prospeccao_leads(cnpj) WHERE cnpj IS NOT NULL AND BTRIM(cnpj) <> '';
CREATE INDEX IF NOT EXISTS idx_prospeccao_leads_enriquecimento_v20
  ON prospeccao_leads(enriquecimento_status, score DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS prospeccao_enriquecimentos (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL UNIQUE REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  tentativas INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT,
  solicitado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  solicitado_por_nome VARCHAR(160),
  iniciado_at TIMESTAMPTZ,
  concluido_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_enriquecimentos_status_check CHECK (status IN ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHA'))
);
CREATE INDEX IF NOT EXISTS idx_prospeccao_enriquecimentos_fila_v20
  ON prospeccao_enriquecimentos(status, updated_at, id);

CREATE TABLE IF NOT EXISTS prospeccao_conversa_controle (
  lead_id BIGINT PRIMARY KEY REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  automacao_pausada BOOLEAN NOT NULL DEFAULT FALSE,
  assumida_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  assumida_por_nome VARCHAR(160),
  assumida_em TIMESTAMPTZ,
  lida_em TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prospeccao_mensagens_manuais (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  session_name VARCHAR(100) NOT NULL,
  telefone VARCHAR(30) NOT NULL,
  mensagem TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ENVIADO',
  waha_message_id TEXT,
  enviado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  enviado_por_nome VARCHAR(160),
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_mensagens_manuais_status_check CHECK (status IN ('ENVIADO','FALHA'))
);
CREATE INDEX IF NOT EXISTS idx_prospeccao_mensagens_manuais_lead_v20
  ON prospeccao_mensagens_manuais(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prospeccao_followups_auto (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES prospeccao_leads(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL DEFAULT 'FOLLOWUP_1',
  session_name VARCHAR(100) NOT NULL,
  telefone VARCHAR(30) NOT NULL,
  mensagem TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AGENDADO',
  agendado_para TIMESTAMPTZ NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  enviado_em TIMESTAMPTZ,
  waha_message_id TEXT,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prospeccao_followups_auto_status_check CHECK (status IN ('AGENDADO','PROCESSANDO','ENVIADO','CANCELADO','FALHA')),
  UNIQUE(lead_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_prospeccao_followups_auto_fila_v20
  ON prospeccao_followups_auto(status, agendado_para, id);

INSERT INTO prospeccao_modelos_mensagem(nome,mensagem,ativo)
SELECT 'V20 · Portal grátis', 'Oi! Tudo bem? Sou {nome_sdr}, da Gênesis IA. Vi a {empresa} e queria te mostrar uma forma simples de começar: conseguimos colocar um portal de vagas com a marca de vocês sem custo para iniciar o relacionamento. Posso te mostrar? Se não fizer sentido, me avisa que não volto a chamar.', TRUE
WHERE NOT EXISTS (SELECT 1 FROM prospeccao_modelos_mensagem WHERE nome='V20 · Portal grátis');

INSERT INTO prospeccao_modelos_mensagem(nome,mensagem,ativo)
SELECT 'V20 · Divulgação de vagas', 'Oi! Tudo bem? Sou {nome_sdr}, da Gênesis IA. Vi que a {empresa} já trabalha com recrutamento online. A gente ajuda a ampliar a entrada de candidatos e organizar atendimento e triagem pelo WhatsApp. Posso te mostrar rapidamente? Se não fizer sentido, me avisa que não volto a chamar.', TRUE
WHERE NOT EXISTS (SELECT 1 FROM prospeccao_modelos_mensagem WHERE nome='V20 · Divulgação de vagas');

INSERT INTO prospeccao_modelos_mensagem(nome,mensagem,ativo)
SELECT 'V20 · Automação de RH', 'Oi! Tudo bem? Sou {nome_sdr}, da Gênesis IA. Trabalhamos com automações para reduzir tarefas manuais no recrutamento, principalmente atendimento, triagem e agendamento. Vi a {empresa} e acredito que pode fazer sentido. Posso te mostrar em poucos minutos? Se não fizer sentido, me avisa que não volto a chamar.', TRUE
WHERE NOT EXISTS (SELECT 1 FROM prospeccao_modelos_mensagem WHERE nome='V20 · Automação de RH');

COMMIT;
