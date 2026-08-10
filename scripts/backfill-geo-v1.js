'use strict';
const { databaseConfigFromEnv } = require('./db-config');
const { enrichMissingCeps } = require('../lib/geo-v1');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const batch = Math.max(1, Math.min(Number(process.env.GEO_BACKFILL_BATCH || 10), 20));
  const delayMs = Math.max(250, Number(process.env.GEO_BACKFILL_DELAY_MS || 650));
  const max = Math.max(batch, Math.min(Number(process.env.GEO_BACKFILL_MAX || 300), 10000));
  let total = 0;
  let success = 0;
  let noCoordinates = 0;
  let failures = 0;
  console.log(`Geo V1 backfill em ${label}: lote=${batch}, pausa=${delayMs}ms, máximo=${max} CEPs distintos.`);
  try {
    while (total < max) {
      const limit = Math.min(batch, max - total);
      const result = await enrichMissingCeps(pool, { limit, delayMs });
      if (!result.solicitados) break;
      total += result.processados;
      success += result.sucesso;
      noCoordinates += result.sem_coordenadas;
      failures += result.falhas;
      console.log(`Processados ${total}: ${success} com coordenadas, ${noCoordinates} sem coordenadas, ${failures} falha(s).`);
      if (result.processados < limit) break;
    }
    console.log('Backfill Geo V1 finalizado.', { ceps_processados: total, sucesso: success, sem_coordenadas: noCoordinates, falhas: failures });
    if (total >= max) console.log('Limite de segurança atingido. Execute novamente se ainda houver CEPs pendentes.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Backfill Geo V1 falhou:', error.message); process.exitCode = 1; });
