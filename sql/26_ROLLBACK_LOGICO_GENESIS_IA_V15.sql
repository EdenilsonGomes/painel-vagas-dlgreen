-- Rollback lógico da Genesis IA V15.
-- Não apaga tabelas, mensagens, históricos ou propostas de reagendamento.
-- Use somente se precisar voltar aos workflows V13.4/V14.1.
BEGIN;

DROP TRIGGER IF EXISTS trg_genesis_v15_entrevista_alerta ON entrevistas;
DROP TRIGGER IF EXISTS trg_genesis_v15_revisao_alerta ON candidato_revisoes;

UPDATE notificacoes_operacionais
SET status='CANCELADA', updated_at=NOW(), erro=COALESCE(erro,'Cancelada pelo rollback lógico V15')
WHERE status IN ('PENDENTE','PROCESSANDO','FALHA');

COMMIT;
