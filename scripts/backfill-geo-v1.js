'use strict';
const { databaseConfigFromEnv } = require('./db-config');
const {
  enrichMissingCeps,
  refreshSuspiciousZeroDistanceCeps,
  countSuspiciousZeroDistancePairs,
  listLowPrecisionClusterCeps,
  refreshLowPrecisionClusters,
} = require('../lib/geo-v1');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  const batch = Math.max(1, Math.min(Number(process.env.GEO_BACKFILL_BATCH || 10), 20));
  // Nominatim público exige no máximo 1 requisição/segundo. 1100ms dá margem.
  const delayMs = Math.max(1100, Number(process.env.GEO_BACKFILL_DELAY_MS || 1100));
  const max = Math.max(batch, Math.min(Number(process.env.GEO_BACKFILL_MAX || 300), 10000));
  const repairMax = Math.max(1, Math.min(Number(process.env.GEO_REPAIR_ZERO_MAX || 300), 1000));
  let total = 0;
  let success = 0;
  let noCoordinates = 0;
  let failures = 0;

  console.log(`Geo V1 R3 backfill em ${label}: lote=${batch}, pausa>=${delayMs}ms, máximo=${max} CEPs distintos.`);
  console.log('[Geo V1 R3] BrasilAPI = endereço/CEP; OpenStreetMap/Nominatim = coordenada precisa. Cache local permanece ativo.');

  try {
    const clusters = await listLowPrecisionClusterCeps(pool, repairMax);
    if (clusters.length > 0) {
      const first = clusters[0];
      console.log(`[Geo V1 R3] Detectados ${clusters.length} CEP(s) em clusters de baixa precisão da BrasilAPI. Exemplo: ${first.latitude}, ${first.longitude}. Regeocodificando pelo CEP...`);
      const repaired = await refreshLowPrecisionClusters(pool, { limit: repairMax, delayMs });
      console.log('[Geo V1 R3] Regeocodificação dos clusters concluída.', repaired);
    } else {
      console.log('[Geo V1 R3] Nenhum cluster antigo de baixa precisão da BrasilAPI pendente.');
    }

    const suspiciousBefore = await countSuspiciousZeroDistancePairs(pool);
    if (suspiciousBefore > 0) {
      console.log(`[Geo V1 R3] Ainda existem ${suspiciousBefore} par(es) candidato/vaga com CEP diferente e coordenada idêntica. Revalidando os CEPs envolvidos pelo Nominatim...`);
      const repair = await refreshSuspiciousZeroDistanceCeps(pool, { limit: repairMax, delayMs });
      console.log('[Geo V1 R3] Revalidação dos pares concluída.', repair);
    }

    while (total < max) {
      const limit = Math.min(batch, max - total);
      const result = await enrichMissingCeps(pool, { limit, delayMs });
      if (!result.solicitados) break;
      total += result.processados;
      success += result.sucesso;
      noCoordinates += result.sem_coordenadas;
      failures += result.falhas;
      console.log(`Novos/pendentes processados ${total}: ${success} com coordenadas, ${noCoordinates} sem coordenadas, ${failures} falha(s).`);
      if (result.processados < limit) break;
    }

    const suspiciousAfter = await countSuspiciousZeroDistancePairs(pool);
    const clustersAfter = await listLowPrecisionClusterCeps(pool, 20);
    console.log('Backfill Geo V1 R3 finalizado.', {
      ceps_novos_processados: total,
      sucesso: success,
      sem_coordenadas: noCoordinates,
      falhas: failures,
      pares_zero_suspeitos_antes: suspiciousBefore,
      pares_zero_suspeitos_depois: suspiciousAfter,
      clusters_brasilapi_restantes: clustersAfter.length,
    });

    if (suspiciousAfter > 0) {
      console.log('[Geo V1 R3] Alguns CEPs continuam sem granularidade suficiente no OpenStreetMap. Eles permanecem como "Baixa precisão" em vez de mostrar 0,0 km falso.');
    }
    if (total >= max) console.log('Limite de segurança atingido. Execute novamente se ainda houver CEPs pendentes.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Backfill Geo V1 R3 falhou:', error.message);
  process.exitCode = 1;
});
