'use strict';

const { databaseConfigFromEnv } = require('./db-config');

function validUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(undefined|null|false)$/i.test(raw)) return false;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const panelUrl = process.env.PANEL_URL || process.env.PUBLIC_BASE_URL || '';
    if (!validUrl(panelUrl)) {
      throw new Error(`PANEL_URL inválido: ${JSON.stringify(panelUrl)}. Configure a URL pública https:// do painel.`);
    }

    const columns = ['meet_access_type', 'meet_access_configured_at', 'meet_access_error'];
    const columnResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='entrevistas'
         AND column_name=ANY($1::text[])`,
      [columns],
    );
    const found = new Set(columnResult.rows.map((row) => row.column_name));
    const missing = columns.filter((column) => !found.has(column));
    if (missing.length) {
      throw new Error(`Migration 28 ausente. Colunas: ${missing.join(', ')}`);
    }

    const functionResult = await pool.query(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname='genesis_v15_enfileirar_entrevista'
         AND p.pronargs=0
       LIMIT 1`,
    );
    if (!functionResult.rowCount) {
      throw new Error('Função genesis_v15_enfileirar_entrevista não encontrada.');
    }

    const functionDef = String(functionResult.rows[0].def || '');
    // R4: o R2 verificava o literal "'/e/'", mas a função correta contém
    // "'{{PANEL_URL}}/e/'". Validamos os componentes relevantes sem depender
    // da posição das aspas no pg_get_functiondef().
    if (!functionDef.includes('/e/') || !functionDef.includes('PANEL_URL')) {
      throw new Error('Função de alerta ainda não usa o link curto {{PANEL_URL}}/e/.');
    }

    console.log('Pré-checagem V16.1 concluída.', {
      banco: label,
      panelUrl,
      linksCurtos: true,
      meetAccessFields: true,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na pré-checagem V16.1:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
