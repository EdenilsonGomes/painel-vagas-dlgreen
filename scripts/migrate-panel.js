'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const file = path.join(__dirname, '..', 'sql', '24_GENESIS_IA_V13_4_FLUXO_MALEAVEL_SEGURO.sql');
  try {
    if (!fs.existsSync(file)) throw new Error(`Patch não encontrado: ${file}`);
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(fs.readFileSync(file, 'utf8'));

    const result = await pool.query(`SELECT
      TO_REGPROCEDURE('public.genesis_v13_nome_valido(text)') IS NOT NULL AS nome_valido_ativo,
      TO_REGPROCEDURE('public.genesis_v13_resposta_duvida_vaga(bigint,text)') IS NOT NULL AS duvidas_vaga_ativas,
      POSITION('Passo 1 de 4' IN pg_get_functiondef('public.genesis_chatbot_v1_pergunta_atual(text,bigint)'::regprocedure)) > 0 AS progresso_ativo,
      POSITION('0.88' IN pg_get_functiondef('public.genesis_chatbot_v13_processar_texto(text,text,text,text,text,jsonb)'::regprocedure)) > 0 AS confianca_088_ativa,
      POSITION('CHATBOT_HIBRIDO_V13_4' IN pg_get_functiondef('public.genesis_chatbot_v13_processar_texto(text,text,text,text,text,jsonb)'::regprocedure)) > 0 AS processador_v13_4_ativo
    `);
    const validation = result.rows[0] || {};
    const missing = Object.entries(validation).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`A validação V13.4 ficou incompleta: ${missing.join(', ')}.`);
    console.log('Patch V13.4 concluído.', validation);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha ao aplicar o patch V13.4:', error.message);
  process.exitCode = 1;
});
