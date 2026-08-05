'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const files = [
    '15_GENESIS_IA_CHATBOT_ESTATICO_V1.sql',
    '17_PAINEL_V12_COMPATIBILIDADE_MODERACAO_GRUPOS.sql',
    '18_GENESIS_IA_V13_TRIAGEM_CONVERSACIONAL_DEMOS.sql',
    '19_GENESIS_RECRUITING_OS_V14_MARCA_AGENDA_PROSPECCAO.sql',
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
    const v14 = await pool.query(`SELECT
      TO_REGCLASS('public.empresa_marcas') AS empresa_marcas,
      TO_REGCLASS('public.recrutador_agendas') AS recrutador_agendas,
      TO_REGCLASS('public.vaga_artes_ia') AS vaga_artes_ia,
      TO_REGCLASS('public.prospeccao_envios') AS prospeccao_envios,
      TO_REGCLASS('public.prospeccao_respostas') AS prospeccao_respostas,
      TO_REGPROCEDURE('public.genesis_aplicar_agenda_recrutador_vaga(bigint)') AS aplicar_agenda
    `);
    const missingV14 = Object.entries(v14.rows[0] || {}).filter(([, value]) => !value).map(([name]) => name);
    if (missingV14.length) throw new Error(`A migração V14 ficou incompleta: ${missingV14.join(', ')}.`);
    console.log('Migração do painel concluída.', { moderacaoGrupos: 'ok', triagemConversacional: 'ok', demosSeteDias: 'ok', marcaEmpresas: 'ok', agendasIndividuais: 'ok', artesIA: 'ok', prospeccaoAssistida: 'ok' });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na migração do painel:', error.message);
  process.exitCode = 1;
});
