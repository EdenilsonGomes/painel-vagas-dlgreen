'use strict';
const { databaseConfigFromEnv } = require('./db-config');
const { enrichMissingCeps, refreshSuspiciousZeroDistanceCeps, countSuspiciousZeroDistancePairs } = require('../lib/geo-v1');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const batch = Math.max(1, Math.min(Number(process.env.GEO_BACKFILL_BATCH || 10), 20));
  const delayMs = Math.max(250, Number(process.env.GEO_BACKFILL_DELAY_MS || 650));
  const max = Math.max(batch, Math.min(Number(process.env.GEO_BACKFILL_MAX || 300), 10000));
  const repairMax = Math.max(1, Math.min(Number(process.env.GEO_REPAIR_ZERO_MAX || 100), 500));
  let total = 0;
  let success = 0;
  let noCoordinates = 0;
  let failures = 0;
  console.log(`Geo V1 backfill em ${label}: lote=${batch}, pausa=${delayMs}ms, máximo=${max} CEPs distintos.`);
  try {
    const suspiciousBefore = await countSuspiciousZeroDistancePairs(pool);
    if (suspiciousBefore > 0) {
      console.log(`[Geo V1] Detectados ${suspiciousBefore} candidato(s) com CEP diferente da vaga, mas a mesma coordenada. Revalidando os CEPs envolvidos...`);
      const repair = await refreshSuspiciousZeroDistanceCeps(pool, { limit: repairMax, delayMs });
      console.log('[Geo V1] Revalidação de distâncias 0,0 concluída.', repair);
    } else {
      console.log('[Geo V1] Nenhum par suspeito de CEPs diferentes com a mesma coordenada foi encontrado.');
    }

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

    const suspiciousAfter = await countSuspiciousZeroDistancePairs(pool);
    console.log('Backfill Geo V1 finalizado.', {
      ceps_processados: total,
      sucesso: success,
      sem_coordenadas: noCoordinates,
      falhas: failures,
      pares_zero_suspeitos_antes: suspiciousBefore,
      pares_zero_suspeitos_depois: suspiciousAfter,
    });
    if (suspiciousAfter > 0) {
      console.log('[Geo V1] ATENÇÃO: ainda existem CEPs diferentes com exatamente a mesma coordenada retornada pela fonte. A interface passará a mostrar "Baixa precisão" nesses casos, nunca 0,0 km falso.');
    }
    if (total >= max) console.log('Limite de segurança atingido. Execute novamente se ainda houver CEPs pendentes.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Backfill Geo V1 falhou:', error.message); process.exitCode = 1; });
