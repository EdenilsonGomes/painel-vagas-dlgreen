'use strict';

// Isolated PostgreSQL/WASM, never production. Install @electric-sql/pglite
// in a temporary directory and set DASHBOARD_TEST_PGLITE to its module path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.DASHBOARD_TEST_PGLITE || '@electric-sql/pglite');
const { loadDashboardPerformance } = require('../lib/dashboard-performance');
const now = '2026-08-31T12:30:00-03:00';

for (const timezone of ['UTC', 'America/Sao_Paulo']) {
  test(`Dashboard SQL real: limites e movimentos (${timezone})`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`SET TIME ZONE '${timezone}';
        CREATE TABLE candidatos (id BIGINT PRIMARY KEY, created_at TIMESTAMP, updated_at TIMESTAMP, status TEXT);
        CREATE TABLE candidato_etapas_historico (candidato_id BIGINT, status_anterior TEXT, status_novo TEXT, created_at TIMESTAMPTZ);
        CREATE TABLE candidato_revisoes (candidato_id BIGINT, created_at TIMESTAMPTZ);
        CREATE TABLE entrevistas (id BIGINT PRIMARY KEY, candidato_id BIGINT, created_at TIMESTAMPTZ, inicio TIMESTAMPTZ, status TEXT);
      `);
      const empty = await loadDashboardPerformance(db, 1, now);
      assert.equal(empty.resumo.novos, 0);
      assert.equal(empty.resumo.comparecimento, null);
      assert.equal(empty.resumo.primeira_analise_minutos, null);
      assert.equal(empty.tendencia.length, 24);
      assert.equal(empty.tendencia[0].rotulo, '00:00');
      assert.equal(empty.tendencia[12].futuro, false);
      assert.equal(empty.tendencia[13].futuro, true);

      await db.exec(`
        INSERT INTO candidatos VALUES
          (1, TIMESTAMPTZ '2026-08-31 00:00-03', TIMESTAMPTZ '2026-08-31 12:00-03', 'APROVADO'),
          (2, TIMESTAMPTZ '2026-08-31 12:29-03', TIMESTAMPTZ '2026-08-31 12:29-03', 'CONTRATADO'),
          (3, TIMESTAMPTZ '2026-08-30 00:00-03', TIMESTAMPTZ '2026-08-31 11:00-03', 'APROVADO'),
          (4, TIMESTAMPTZ '2026-08-30 12:29-03', TIMESTAMPTZ '2026-08-30 12:29-03', 'NOVO'),
          (5, TIMESTAMPTZ '2026-08-30 12:31-03', TIMESTAMPTZ '2026-08-30 12:31-03', 'NOVO'),
          (6, TIMESTAMPTZ '2026-08-31 12:31-03', TIMESTAMPTZ '2026-08-31 12:31-03', 'NOVO'),
          (7, TIMESTAMPTZ '2026-07-01 10:00-03', TIMESTAMPTZ '2026-08-31 12:00-03', 'CONTRATADO');
        INSERT INTO candidato_etapas_historico VALUES
          (3, 'EM_PROCESSO', 'APROVADO', '2026-08-30 10:00-03'),
          (7, 'EM_PROCESSO', 'APROVADO', '2026-08-31 08:00-03'),
          (7, 'APROVADO', 'APROVADO', '2026-08-31 08:01-03'),
          (7, 'EM_PROCESSO', 'APROVADO', '2026-08-31 08:10-03'),
          (2, 'EM_ADMISSAO', 'CONTRATADO', '2026-08-31 12:29-03'),
          (7, 'APROVADO', 'CONTRATADO', '2026-08-31 11:00-03'),
          (7, 'EM_ADMISSAO', 'CONTRATADO', '2026-08-31 11:15-03');
        INSERT INTO candidato_revisoes VALUES (1, '2026-08-31 00:20-03'), (1, '2026-08-31 00:50-03');
        INSERT INTO entrevistas VALUES
          (1, 1, '2026-08-31 09:00-03', '2026-09-01 10:00-03', 'AGENDADA'),
          (2, 3, '2026-08-30 12:00-03', '2026-08-31 09:00-03', 'REALIZADA'),
          (3, 4, '2026-08-30 20:00-03', '2026-08-31 10:00-03', 'FALTOU'),
          (4, 5, '2026-08-31 08:00-03', '2026-08-31 10:00-03', 'CANCELADA'),
          (5, 7, '2026-08-31 08:00-03', '2026-08-31 11:00-03', 'AGENDADA'),
          (6, 2, '2026-08-31 08:00-03', '2026-08-31 11:00-03', 'REAGENDADA'),
          (7, 3, '2026-08-31 08:00-03', '2026-09-01 10:00-03', 'REALIZADA');
      `);
      const today = await loadDashboardPerformance(db, 1, now);
      assert.equal(today.periodo, '1D');
      assert.equal(today.granularidade, 'hora');
      assert.equal(today.resumo.novos, 2, 'Meia-noite entra; registros futuros não entram');
      assert.equal(today.resumo.novos_anterior, 2, 'Ontem para exatamente no mesmo horário');
      assert.equal(today.resumo.aprovados, 1, 'Conta avanço de candidato antigo, sem repetir nem usar updated_at');
      assert.equal(today.resumo.aprovados_anterior, 1, 'Edição de hoje não move a aprovação de ontem');
      assert.equal(today.resumo.contratacoes, 2, 'Contratações são deduplicadas por candidato');
      assert.equal(today.resumo.entrevistas, 5, 'Conta agendamentos criados, não a data da entrevista');
      assert.equal(today.resumo.entrevistas_anterior, 1);
      assert.equal(today.resumo.primeira_analise_minutos, 20);
      assert.equal(today.resumo.entrevistas_com_resultado, 2);
      assert.equal(today.resumo.entrevistas_realizadas, 1);
      assert.equal(today.resumo.comparecimento, 50);
      assert.equal(today.tendencia[0].candidaturas, 1);
      assert.equal(today.tendencia[12].candidaturas, 1);

      for (const days of [1, 7, 30]) {
        const result = await loadDashboardPerformance(db, days, now);
        assert.equal(result.tendencia.length, days === 1 ? 24 : days);
        for (const [chart, metric] of [['candidaturas', 'novos'], ['entrevistas', 'entrevistas'], ['contratacoes', 'contratacoes'], ['candidaturas_periodo_anterior', 'novos_anterior']]) {
          assert.equal(result.tendencia.reduce((sum, p) => sum + p[chart], 0), result.resumo[metric], `${days}D: gráfico coincide com ${metric}`);
        }
        if (days !== 1) {
          assert.equal(result.granularidade, 'dia');
          assert.equal(result.resumo.novos, 5);
          assert.equal(result.tendencia.at(-1).rotulo, '31/08');
        }
      }
      await db.exec("UPDATE entrevistas SET status = 'AGENDADA'");
      assert.equal((await loadDashboardPerformance(db, 1, now)).resumo.comparecimento, null, 'Horário passado não comprova presença');
      await db.exec("UPDATE entrevistas SET status = 'FALTOU' WHERE id = 2");
      assert.equal((await loadDashboardPerformance(db, 1, now)).resumo.comparecimento, 0, 'Ausência confirmada é 0%, não sem dados');
      const midnight = await loadDashboardPerformance(db, 1, '2026-09-01T00:00:00-03:00');
      assert.equal(midnight.resumo.novos, 0);
      assert.equal(midnight.resumo.novos_anterior, 0);
      assert.equal(midnight.tendencia.filter(p => !p.futuro).length, 1);
      assert.equal((await loadDashboardPerformance(db, 999, now)).periodo, '1D');
    } finally {
      await db.close();
    }
  });
}
