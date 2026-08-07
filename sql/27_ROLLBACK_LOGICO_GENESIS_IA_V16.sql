BEGIN;
-- Rollback lógico: remove somente gatilhos/funções V16. Colunas/tabela são mantidas
-- para não destruir documentos, auditoria ou dados criados após a implantação.
DROP TRIGGER IF EXISTS trg_genesis_v16_pausar_ia_suporte ON candidato_revisoes;
DROP TRIGGER IF EXISTS trg_genesis_v16_documento_aplicado ON documentos;
DROP FUNCTION IF EXISTS genesis_v16_limpar_pendencia_documento_aplicado();
DROP FUNCTION IF EXISTS genesis_v16_pausar_ia_em_suporte();
DROP FUNCTION IF EXISTS genesis_v16_etapa_retomada_apos_suporte(BIGINT);
DROP FUNCTION IF EXISTS genesis_v16_controle_entrada(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS genesis_v16_estagiar_documento(BIGINT,BIGINT,TEXT,JSONB,TEXT);
DROP FUNCTION IF EXISTS genesis_v16_registrar_pdf(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS genesis_v16_aplicar_resposta_triagem_humana(BIGINT,BIGINT,TEXT,TEXT);
DROP FUNCTION IF EXISTS genesis_v16_acao_manual(BIGINT,TEXT,BIGINT,TEXT,BIGINT);
COMMIT;
