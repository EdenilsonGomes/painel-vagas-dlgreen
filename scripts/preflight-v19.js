'use strict';
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const tables = await pool.query(`
      SELECT
        TO_REGCLASS('public.geo_ceps') AS geo_ceps,
        TO_REGCLASS('public.geo_vagas') AS geo_vagas,
        TO_REGCLASS('public.crm_empresas') AS crm_empresas,
        TO_REGCLASS('public.crm_contatos') AS crm_contatos,
        TO_REGCLASS('public.crm_oportunidades') AS crm_oportunidades,
        TO_REGCLASS('public.crm_interacoes') AS crm_interacoes,
        TO_REGCLASS('public.crm_followups') AS crm_followups
    `);
    const missing = Object.entries(tables.rows[0] || {}).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Tabelas ausentes: ${missing.join(', ')}`);
    const fn = await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='genesis_geo_distancia_km') AS ok`);
    if (!fn.rows[0]?.ok) throw new Error('Função genesis_geo_distancia_km ausente.');
    const checks = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INTEGER FROM candidatos) AS candidatos,
        (SELECT COUNT(*)::INTEGER FROM candidatos WHERE LENGTH(REGEXP_REPLACE(COALESCE(cep,''),'\\D','','g'))=8) AS candidatos_com_cep,
        (SELECT COUNT(*)::INTEGER FROM vagas) AS vagas,
        (SELECT COUNT(*)::INTEGER FROM geo_vagas) AS vagas_com_cep,
        (SELECT COUNT(*)::INTEGER FROM prospeccao_leads) AS leads_prospeccao,
        (SELECT COUNT(*)::INTEGER FROM genesis_demos) AS demonstracoes,
        (SELECT COUNT(*)::INTEGER FROM geo_ceps) AS ceps_em_cache,
        (SELECT COUNT(*)::INTEGER FROM geo_ceps WHERE status='OK') AS ceps_com_coordenadas,
        (SELECT COUNT(*)::INTEGER FROM crm_oportunidades) AS oportunidades_crm
    `);
    console.log('Pré-checagem V19 concluída.', { banco: label, ...checks.rows[0] });
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Pré-checagem V19 falhou:', error.message); process.exitCode = 1; });
