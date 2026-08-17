BEGIN;

CREATE TABLE IF NOT EXISTS painel_notificacoes_lidas (
  id BIGSERIAL PRIMARY KEY,
  notificacao_id BIGINT NOT NULL REFERENCES notificacoes_operacionais(id) ON DELETE CASCADE,
  usuario_id BIGINT NOT NULL REFERENCES app_usuarios(id) ON DELETE CASCADE,
  lida_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(notificacao_id,usuario_id)
);

CREATE INDEX IF NOT EXISTS painel_notificacoes_lidas_usuario_idx
  ON painel_notificacoes_lidas(usuario_id,lida_em DESC);

COMMENT ON TABLE painel_notificacoes_lidas IS
  'Estado persistente de leitura da Central de Notificações do Painel Gênesis.';

COMMIT;
