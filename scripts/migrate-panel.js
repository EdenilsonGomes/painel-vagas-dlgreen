'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const file = path.join(__dirname, '..', 'sql', '17_PAINEL_V12_COMPATIBILIDADE_MODERACAO_GRUPOS.sql');
  try {
    const sql = fs.readFileSync(file, 'utf8');
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(sql);

    const result = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='public.gg_groups'::regclass
        AND conname='gg_groups_status_check'
    `);
    const definition = String(result.rows[0]?.definition || '');
    if (!definition.includes('approved')) {
      throw new Error('A regra de status de gg_groups ainda não aceita approved.');
    }
    console.log('Migração do painel concluída.', { moderacaoGrupos: 'ok' });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na migração do painel:', error.message);
  process.exitCode = 1;
});
