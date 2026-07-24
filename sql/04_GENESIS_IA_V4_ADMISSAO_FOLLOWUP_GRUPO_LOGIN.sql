BEGIN;

-- ============================================================
-- 1. INSALUBRIDADE NAS VAGAS
-- ============================================================
ALTER TABLE vagas
  ADD COLUMN IF NOT EXISTS possui_insalubridade BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS percentual_insalubridade NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS observacao_insalubridade TEXT;

ALTER TABLE vagas
  DROP CONSTRAINT IF EXISTS vagas_percentual_insalubridade_valido;

ALTER TABLE vagas
  ADD CONSTRAINT vagas_percentual_insalubridade_valido
  CHECK (
    percentual_insalubridade IS NULL
    OR (percentual_insalubridade >= 0 AND percentual_insalubridade <= 100)
  );

UPDATE vagas
SET percentual_insalubridade = NULL
WHERE possui_insalubridade IS FALSE;

-- ============================================================
-- 2. NOTAS INTERNAS
-- ============================================================
CREATE TABLE IF NOT EXISTS candidato_notas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  nota TEXT NOT NULL,
  criado_por TEXT NOT NULL DEFAULT 'Administrador',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidato_notas_candidato_data
  ON candidato_notas (candidato_id, created_at DESC);

-- ============================================================
-- 3. TAREFAS DO RECRUTADOR
-- ============================================================
CREATE TABLE IF NOT EXISTS candidato_tarefas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  prioridade VARCHAR(10) NOT NULL DEFAULT 'MEDIA',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
  vencimento TIMESTAMPTZ,
  criado_por TEXT NOT NULL DEFAULT 'Administrador',
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_tarefas_prioridade_valida
    CHECK (prioridade IN ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE')),
  CONSTRAINT candidato_tarefas_status_valido
    CHECK (status IN ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'))
);

CREATE INDEX IF NOT EXISTS idx_candidato_tarefas_status_vencimento
  ON candidato_tarefas (status, vencimento NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_candidato_tarefas_candidato
  ON candidato_tarefas (candidato_id, created_at DESC);

-- ============================================================
-- 4. ETIQUETAS
-- ============================================================
CREATE TABLE IF NOT EXISTS etiquetas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome VARCHAR(80) NOT NULL UNIQUE,
  cor VARCHAR(20) NOT NULL DEFAULT '#6366F1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidato_etiquetas (
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  etiqueta_id BIGINT NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidato_id, etiqueta_id)
);

INSERT INTO etiquetas (nome, cor)
VALUES
  ('Prioridade', '#EF4444'),
  ('Banco de talentos', '#8B5CF6'),
  ('Disponível imediatamente', '#10B981'),
  ('Documentação pendente', '#F59E0B'),
  ('Recontatar', '#3B82F6')
ON CONFLICT (nome) DO NOTHING;

-- ============================================================
-- 5. LOG DE ERROS DOS WORKFLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_erros (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id TEXT,
  workflow_nome TEXT,
  execution_id TEXT,
  node_nome TEXT,
  erro_tipo TEXT,
  erro_mensagem TEXT NOT NULL,
  telefone TEXT,
  candidato_id BIGINT REFERENCES candidatos(id) ON DELETE SET NULL,
  payload JSONB,
  resolvido BOOLEAN NOT NULL DEFAULT FALSE,
  resolvido_por TEXT,
  resolvido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_erros_pendentes
  ON workflow_erros (created_at DESC)
  WHERE resolvido IS FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_erros_execution_node
  ON workflow_erros (execution_id, node_nome);

-- ============================================================
-- 6. CONFIGURAÇÕES SIMPLES DO PAINEL
-- ============================================================
CREATE TABLE IF NOT EXISTS painel_configuracoes (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO painel_configuracoes (chave, valor)
VALUES
  ('empresa', jsonb_build_object(
    'nome_produto', 'Genesis IA',
    'whatsapp_divulgacao', '(11) 91302-2278',
    'horario_recrutadores_inicio', '08:00',
    'horario_recrutadores_fim', '18:00'
  ))
ON CONFLICT (chave) DO NOTHING;

-- ============================================================
-- 7. ÍNDICES DE LEITURA DO PAINEL
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_mensagens_candidato_data_desc
  ON mensagens (candidato_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_candidato_data_desc
  ON eventos (candidato_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entrevistas_inicio_status
  ON entrevistas (inicio, status);



-- ============================================================
-- 8. RESULTADO REAL APÓS A ENTREVISTA
-- ============================================================
ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS motivo_reprovacao_pos_entrevista TEXT,
  ADD COLUMN IF NOT EXISTS observacao_decisao_pos_entrevista TEXT,
  ADD COLUMN IF NOT EXISTS decisao_pos_entrevista_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decisao_pos_entrevista_por TEXT,
  ADD COLUMN IF NOT EXISTS admissao_iniciada_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS followup_pausado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_candidatos_status_etapa_updated
  ON candidatos (status, etapa, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidatos_em_admissao
  ON candidatos (admissao_iniciada_at DESC)
  WHERE status = 'EM_ADMISSAO';

-- ============================================================
-- 9. FOLLOW-UP LEVE PARA CANDIDATOS SEM RETORNO
-- ============================================================
CREATE TABLE IF NOT EXISTS candidato_followups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL,
  tentativa SMALLINT NOT NULL,
  mensagem TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  mensagem_waha_id TEXT,
  enviado_em TIMESTAMPTZ,
  respondido_em TIMESTAMPTZ,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_followups_tentativa_valida CHECK (tentativa BETWEEN 1 AND 2),
  CONSTRAINT candidato_followups_status_valido CHECK (status IN ('PENDENTE','ENVIADO','RESPONDIDO','ERRO','CANCELADO')),
  UNIQUE (candidato_id, etapa, tentativa)
);

CREATE INDEX IF NOT EXISTS idx_followups_status_data
  ON candidato_followups (status, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_followups_candidato_etapa
  ON candidato_followups (candidato_id, etapa, tentativa DESC);

-- ============================================================
-- 10. CONVITES PARA O GRUPO APÓS REPROVAÇÃO
-- ============================================================
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

-- ============================================================
-- 11. DIVULGAÇÃO ROTATIVA DE VAGAS NO GRUPO
-- ============================================================
CREATE TABLE IF NOT EXISTS divulgacao_vagas_envios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  grupo_id TEXT NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'IMAGEM',
  status VARCHAR(40) NOT NULL DEFAULT 'PENDENTE',
  mensagem_id TEXT,
  imagem_url TEXT,
  legenda TEXT,
  erro TEXT,
  enviado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_divulgacao_vagas_envios_rotacao
  ON divulgacao_vagas_envios (vaga_id, grupo_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_divulgacao_vagas_envios_status
  ON divulgacao_vagas_envios (status, created_at DESC);

CREATE TABLE IF NOT EXISTS configuracao_grupo_vagas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT 'Grupo de vagas',
  grupo_id TEXT NOT NULL UNIQUE,
  sessao_waha TEXT NOT NULL DEFAULT 'whats_junior',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  intervalo_minutos INTEGER NOT NULL DEFAULT 45,
  hora_inicio TIME NOT NULL DEFAULT '08:00',
  hora_fim TIME NOT NULL DEFAULT '19:00',
  dias_semana INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
  repeticao_minima_horas INTEGER NOT NULL DEFAULT 6,
  enviar_convite_reprovados BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT configuracao_grupo_intervalo_valido CHECK (intervalo_minutos BETWEEN 15 AND 1440),
  CONSTRAINT configuracao_grupo_repeticao_valida CHECK (repeticao_minima_horas BETWEEN 1 AND 168)
);

-- Edite o ID pelo workflow antes de ativar. A linha não é criada com um ID falso.

-- ============================================================
-- 12. CONFIGURAÇÕES DO PAINEL V4
-- ============================================================
INSERT INTO painel_configuracoes (chave, valor)
VALUES
  ('followup', jsonb_build_object(
    'ativo', true,
    'primeiro_contato_horas', 18,
    'segundo_contato_horas', 72,
    'maximo_tentativas', 2,
    'maximo_por_execucao', 10,
    'hora_inicio', '09:00',
    'hora_fim', '18:30'
  )),
  ('divulgacao_grupo', jsonb_build_object(
    'ativo', false,
    'intervalo_minutos', 45,
    'repeticao_minima_horas', 6,
    'hora_inicio', '08:00',
    'hora_fim', '19:00'
  ))
ON CONFLICT (chave)
DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW();

COMMIT;
