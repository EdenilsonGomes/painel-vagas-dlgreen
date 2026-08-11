'use strict';
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  console.log(`Diagnóstico Geo V1 R3 em ${label}`);
  try {
    const cache = await pool.query(`
      SELECT COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE status='OK')::INTEGER AS ok,
        COUNT(*) FILTER (WHERE status='OK' AND latitude BETWEEN -35.5 AND 6.5 AND longitude BETWEEN -75.5 AND -28.0)::INTEGER AS ok_validos,
        COUNT(*) FILTER (WHERE status<>'OK')::INTEGER AS nao_ok,
        COUNT(*) FILTER (WHERE fonte='NOMINATIM')::INTEGER AS nominatim,
        COUNT(*) FILTER (WHERE fonte='BRASILAPI')::INTEGER AS brasilapi
      FROM geo_ceps
    `);
    const fontes = await pool.query(`
      SELECT fonte,COALESCE(servico,'') AS servico,status,COUNT(*)::INTEGER AS quantidade
      FROM geo_ceps GROUP BY fonte,servico,status ORDER BY quantidade DESC,fonte,servico
    `);
    const clusters = await pool.query(`
      SELECT latitude,longitude,COUNT(DISTINCT cep)::INTEGER AS ceps,
        STRING_AGG(cep, ', ' ORDER BY cep) AS exemplos
      FROM geo_ceps
      WHERE status='OK' AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY latitude,longitude
      HAVING COUNT(DISTINCT cep) >= 3
      ORDER BY ceps DESC
      LIMIT 10
    `);
    const vagas = await pool.query(`
      SELECT gv.vaga_id,gv.cep,g.status,g.fonte,g.servico,g.cidade,g.bairro,g.latitude,g.longitude
      FROM geo_vagas gv LEFT JOIN geo_ceps g ON g.cep=gv.cep
      ORDER BY gv.vaga_id
    `);
    const amostra = await pool.query(`
      SELECT c.id AS candidato_id,c.nome,
        REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') AS candidato_cep,
        c.vaga_id,gv.cep AS vaga_cep,
        gc.status AS candidato_geo_status,gc.fonte AS candidato_fonte,gc.servico AS candidato_servico,
        gc.latitude AS candidato_lat,gc.longitude AS candidato_lon,
        vg.status AS vaga_geo_status,vg.fonte AS vaga_fonte,vg.servico AS vaga_servico,
        vg.latitude AS vaga_lat,vg.longitude AS vaga_lon,
        genesis_geo_distancia_km(gc.latitude,gc.longitude,vg.latitude,vg.longitude) AS distancia_km,
        CASE WHEN REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') <> gv.cep
          AND gc.latitude=vg.latitude AND gc.longitude=vg.longitude THEN TRUE ELSE FALSE END AS mesma_coordenada_ceps_diferentes
      FROM candidatos c
      LEFT JOIN geo_vagas gv ON gv.vaga_id=c.vaga_id
      LEFT JOIN geo_ceps gc ON gc.cep=REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g')
      LEFT JOIN geo_ceps vg ON vg.cep=gv.cep
      WHERE LENGTH(REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g'))=8
      ORDER BY c.updated_at DESC NULLS LAST,c.id DESC
      LIMIT 20
    `);
    const suspicious = amostra.rows.filter((r) => r.mesma_coordenada_ceps_diferentes === true || r.mesma_coordenada_ceps_diferentes === 't').length;
    console.log('\nCACHE'); console.table(cache.rows);
    console.log('\nFONTES / PRECISÃO'); console.table(fontes.rows);
    console.log('\nCLUSTERS DE COORDENADA REPETIDA (>=3 CEPs)'); console.table(clusters.rows);
    console.log('\nVAGAS COM GEO'); console.table(vagas.rows);
    console.log('\nAMOSTRA DE CANDIDATOS'); console.table(amostra.rows);
    console.log(`\nNa amostra, pares com CEPs diferentes e coordenada idêntica: ${suspicious}`);
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Diagnóstico Geo V1 R3 falhou:', error); process.exitCode = 1; });
