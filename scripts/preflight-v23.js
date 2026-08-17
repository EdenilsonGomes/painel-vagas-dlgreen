'use strict';

const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const result = await pool.query(`
      SELECT
        TO_REGCLASS('public.notificacoes_operacionais') IS NOT NULL AS origem,
        TO_REGCLASS('public.painel_notificacoes_lidas') IS NOT NULL AS leituras,
        EXISTS(
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND indexname='painel_notificacoes_lidas_usuario_idx'
        ) AS indice
    `);
    const check = result.rows[0] || {};
    if (!check.origem) throw new Error('Migration 26 ausente: notificacoes_operacionais não existe.');
    if (!check.leituras || !check.indice) throw new Error('Migration 31 ausente ou incompleta. Execute npm run migrate:v23.');
    console.log('Pré-checagem V23 concluída.', { banco:label, notificacoes:true, leituraPersistente:true });
  } finally { await pool.end(); }
}

main().catch((error) => {
  console.error('Falha na pré-checagem V23:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
