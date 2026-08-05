'use strict';

const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const tables = await pool.query(`SELECT
      TO_REGCLASS('public.vagas') AS vagas,
      TO_REGCLASS('public.candidatos') AS candidatos,
      TO_REGCLASS('public.app_usuarios') AS app_usuarios,
      TO_REGCLASS('public.portal_contas') AS portal_contas,
      TO_REGCLASS('public.gg_groups') AS gg_groups,
      TO_REGCLASS('public.portal_vagas_submissoes') AS portal_vagas_submissoes,
      TO_REGCLASS('public.vaga_triagem_versoes') AS vaga_triagem_versoes,
      TO_REGCLASS('public.vaga_perguntas') AS vaga_perguntas,
      TO_REGCLASS('public.candidato_triagens') AS candidato_triagens,
      TO_REGCLASS('public.candidato_respostas_triagem') AS candidato_respostas_triagem,
      TO_REGCLASS('public.genesis_demos') AS genesis_demos,
      TO_REGCLASS('public.genesis_demo_contatos') AS genesis_demo_contatos
    `);
    const missingTables = Object.entries(tables.rows[0] || {})
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missingTables.length) throw new Error(`Estruturas ausentes: ${missingTables.join(', ')}.`);

    const requiredColumns = [
      'id', 'status', 'verified', 'featured', 'official', 'rejection_reason',
      'moderation_note', 'approved_at', 'last_verified_at', 'updated_at',
    ];
    const columns = await pool.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='gg_groups'
        AND column_name=ANY($1::TEXT[])
    `, [requiredColumns]);
    const byName = new Map(columns.rows.map((item) => [item.column_name, item]));
    const missingColumns = requiredColumns.filter((name) => !byName.has(name));
    if (missingColumns.length) throw new Error(`Colunas ausentes em gg_groups: ${missingColumns.join(', ')}.`);

    for (const name of ['verified', 'featured', 'official']) {
      if (byName.get(name)?.data_type !== 'boolean') {
        throw new Error(`A coluna gg_groups.${name} deve ser BOOLEAN.`);
      }
    }

    const statusRules = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='public.gg_groups'::regclass
        AND contype='c'
        AND POSITION('status' IN LOWER(pg_get_constraintdef(oid))) > 0
    `);
    const incompatible = statusRules.rows.filter((item) => !String(item.definition || '').includes('approved'));
    const canonical = statusRules.rows.some((item) => String(item.definition || '').includes('approved'));
    if (incompatible.length || !canonical || byName.get('status')?.data_type === 'USER-DEFINED') {
      throw new Error('A regra legada de status bloqueia a aprovação de grupos. Execute npm run migrate:panel.');
    }

    const functions = await pool.query(`SELECT
      TO_REGPROCEDURE('public.genesis_chatbot_v13_preparar_interpretacao(text,text,text,text)') AS preparar,
      TO_REGPROCEDURE('public.genesis_chatbot_v13_processar_texto(text,text,text,text,text,jsonb)') AS processar,
      TO_REGPROCEDURE('public.genesis_chatbot_v13_midia_nao_suportada(text,text,text,text)') AS midia,
      TO_REGPROCEDURE('public.genesis_chatbot_v13_buffer_registrar(text,text,text,text,text)') AS buffer_registrar,
      TO_REGPROCEDURE('public.genesis_chatbot_v13_buffer_consumir(text,text,text)') AS buffer_consumir
    `);
    const missingFunctions = Object.entries(functions.rows[0] || {}).filter(([, value]) => !value).map(([name]) => name);
    if (missingFunctions.length) throw new Error(`Funções V13 ausentes: ${missingFunctions.join(', ')}. Execute npm run migrate:panel.`);

    const bufferPrimaryKey = await pool.query(`
      SELECT PG_GET_CONSTRAINTDEF(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='public.genesis_chatbot_entrada_buffer'::REGCLASS AND contype='p'
      LIMIT 1
    `);
    const bufferDefinition = String(bufferPrimaryKey.rows[0]?.definition || '');
    if (!bufferDefinition.includes('session') || !bufferDefinition.includes('telefone')) {
      throw new Error('O buffer do chatbot ainda não isola telefone por sessão. Execute npm run migrate:panel.');
    }

    console.log('Pré-checagem do painel concluída.', {
      banco: label,
      moderacaoGrupos: 'ok',
      triagemConversacional: 'ok',
      demosSeteDias: 'ok',
      wahaDemos: process.env.WAHA_BASE_URL && process.env.WAHA_API_KEY ? 'configurado' : 'não configurado',
      webhookDemos: process.env.DEMO_CHATBOT_WEBHOOK_URL || process.env.CHATBOT_WEBHOOK_URL ? 'configurado' : 'não configurado',
      portalBaseUrl: process.env.PORTAL_BASE_URL ? 'configurada' : 'não configurada',
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Pré-checagem falhou:', error.message);
  process.exitCode = 1;
});
