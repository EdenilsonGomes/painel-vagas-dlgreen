'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const files = [
    '17_PAINEL_V12_COMPATIBILIDADE_MODERACAO_GRUPOS.sql',
    '18_GENESIS_IA_V13_TRIAGEM_CONVERSACIONAL_DEMOS.sql',
  ].map((name) => path.join(__dirname, '..', 'sql', name));
  try {
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`Aplicando ${path.basename(file)} em ${label}...`);
      await pool.query(sql);
    }

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
    const v13 = await pool.query(`SELECT
      TO_REGCLASS('public.vaga_perguntas') AS perguntas,
      TO_REGCLASS('public.candidato_triagens') AS triagens,
      TO_REGCLASS('public.genesis_demos') AS demos,
      TO_REGPROCEDURE('public.genesis_chatbot_v13_processar_texto(text,text,text,text,text,jsonb)') AS processador
    `);
    const missing = Object.entries(v13.rows[0] || {}).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`A migração V13 ficou incompleta: ${missing.join(', ')}.`);
    console.log('Migração do painel concluída.', { moderacaoGrupos: 'ok', triagemConversacional: 'ok', demosSeteDias: 'ok' });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na migração do painel:', error.message);
  process.exitCode = 1;
});
