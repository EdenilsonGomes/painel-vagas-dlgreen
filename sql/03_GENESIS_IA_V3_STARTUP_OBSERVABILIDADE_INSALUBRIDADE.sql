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

COMMIT;
