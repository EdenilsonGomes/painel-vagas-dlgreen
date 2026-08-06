'use strict';
const { Pool } = require('pg');

const ssl = String(process.env.DB_SSL || 'false').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL, ssl } : {
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl,
});

(async () => {
  try {
    const tables = [
      'candidato_dados_historico', 'candidato_estado_historico', 'entrevista_reagendamentos',
      'entrevista_acao_tokens', 'notificacoes_operacionais',
    ];
    const tableResult = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,
      [tables],
    );
    const foundTables = new Set(tableResult.rows.map((row) => row.tablename));
    const missingTables = tables.filter((name) => !foundTables.has(name));

    const requiredColumns = [
      ['candidatos','atendimento_humano_ativo'], ['candidatos','atendimento_humano_usuario_id'],
      ['mensagens','origem'], ['mensagens','autor_nome'], ['mensagens','client_message_id'],
      ['entrevistas','confirmacao_recrutador_status'], ['app_usuarios','telefone_whatsapp'],
      ['app_usuarios','alerta_entrevista'], ['app_usuarios','alerta_revisao'],
    ];
    const columnResult = await pool.query(`
      SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND (table_name,column_name) IN (
        SELECT * FROM UNNEST($1::text[],$2::text[])
      )
    `, [requiredColumns.map((item) => item[0]), requiredColumns.map((item) => item[1])]);
    const foundColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = requiredColumns.map((item) => item.join('.')).filter((name) => !foundColumns.has(name));

    const functions = [
      'genesis_v15_controle_entrada', 'genesis_v15_propor_reagendamento',
      'genesis_v15_preparar_resposta_reagendamento', 'genesis_v15_concluir_reagendamento',
    ];
    const functionResult = await pool.query(`SELECT proname FROM pg_proc WHERE proname=ANY($1::text[])`, [functions]);
    const foundFunctions = new Set(functionResult.rows.map((row) => row.proname));
    const missingFunctions = functions.filter((name) => !foundFunctions.has(name));

    const triggers = ['trg_genesis_v15_entrevista_alerta','trg_genesis_v15_revisao_alerta'];
    const triggerResult = await pool.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])`, [triggers]);
    const foundTriggers = new Set(triggerResult.rows.map((row) => row.tgname));
    const missingTriggers = triggers.filter((name) => !foundTriggers.has(name));

    if (missingTables.length || missingColumns.length || missingFunctions.length || missingTriggers.length) {
      throw new Error([
        `Tabelas ausentes: ${missingTables.join(', ') || 'nenhuma'}`,
        `Colunas ausentes: ${missingColumns.join(', ') || 'nenhuma'}`,
        `Funções ausentes: ${missingFunctions.join(', ') || 'nenhuma'}`,
        `Triggers ausentes: ${missingTriggers.join(', ') || 'nenhum'}`,
      ].join(' | '));
    }

    const duplicated = await pool.query(`
      SELECT client_message_id,COUNT(*) quantidade FROM mensagens
      WHERE client_message_id IS NOT NULL GROUP BY client_message_id HAVING COUNT(*)>1 LIMIT 1
    `);
    if (duplicated.rowCount) throw new Error('Foram encontrados client_message_id duplicados na tabela mensagens.');

    console.log('Pré-checagem Genesis IA V15 concluída: tabelas, colunas, funções, triggers e idempotência estão corretos.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
