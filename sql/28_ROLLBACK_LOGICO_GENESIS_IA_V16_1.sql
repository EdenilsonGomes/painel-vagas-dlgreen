-- Rollback lógico V16.1: não apaga dados nem colunas.
-- Para voltar ao comportamento de links V15, reaplique a função genesis_v15_enfileirar_entrevista da migration 26.
-- As colunas meet_access_* podem permanecer sem impacto.
SELECT 'Rollback V16.1 é lógico e não destrutivo.' AS mensagem;
