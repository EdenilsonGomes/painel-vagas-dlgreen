'use strict';

// One database snapshot keeps counters, comparison and chart on the same cutoff.
// Legacy timestamp-without-time-zone columns are interpreted in the database
// session's timezone, just as their NOW() defaults are when written.
const performanceSql = `
  WITH relogio AS (
    SELECT COALESCE($2::TIMESTAMPTZ, NOW()) AS agora
  ), calendario AS (
    SELECT agora, agora AT TIME ZONE 'America/Sao_Paulo' AS agora_local,
      DATE_TRUNC('day', agora AT TIME ZONE 'America/Sao_Paulo') AS hoje
    FROM relogio
  ), limites AS (
    SELECT *,
      (hoje - (($1::INTEGER - 1) * INTERVAL '1 day')) AT TIME ZONE 'America/Sao_Paulo' AS atual_inicio,
      agora AS atual_fim,
      (hoje - (($1::INTEGER * 2 - 1) * INTERVAL '1 day')) AT TIME ZONE 'America/Sao_Paulo' AS anterior_inicio,
      (CASE WHEN $1::INTEGER = 1 THEN agora_local - INTERVAL '1 day'
        ELSE hoje - (($1::INTEGER - 1) * INTERVAL '1 day') END) AT TIME ZONE 'America/Sao_Paulo' AS anterior_fim
    FROM calendario
  ), transicoes AS (
    SELECT h.candidato_id, h.created_at AS ocorrido_em,
      CASE WHEN UPPER(COALESCE(h.status_novo, '')) = 'CONTRATADO'
        AND UPPER(COALESCE(h.status_anterior, '')) <> 'CONTRATADO' THEN 'contratacoes'
        ELSE 'aprovados' END AS tipo
    FROM candidato_etapas_historico h
    CROSS JOIN limites l
    WHERE h.created_at >= l.anterior_inicio AND h.created_at < l.atual_fim
      AND (
        (UPPER(COALESCE(h.status_novo, '')) = 'APROVADO'
          AND UPPER(COALESCE(h.status_anterior, '')) NOT IN ('APROVADO', 'EM_ADMISSAO', 'CONTRATADO'))
        OR (UPPER(COALESCE(h.status_novo, '')) = 'CONTRATADO'
          AND UPPER(COALESCE(h.status_anterior, '')) <> 'CONTRATADO')
      )
  ), eventos_periodo AS (
    SELECT 'novos' AS tipo, c.id AS entidade_id, c.created_at::TIMESTAMPTZ AS ocorrido_em
    FROM candidatos c CROSS JOIN limites l
    WHERE c.created_at::TIMESTAMPTZ >= l.anterior_inicio AND c.created_at::TIMESTAMPTZ < l.atual_fim
    UNION ALL
    SELECT 'entrevistas', e.id, e.created_at
    FROM entrevistas e CROSS JOIN limites l
    WHERE e.created_at >= l.anterior_inicio AND e.created_at < l.atual_fim
    UNION ALL
    SELECT tipo, candidato_id, ocorrido_em FROM transicoes
  ), eventos_classificados AS (
    SELECT e.*, CASE
      WHEN e.ocorrido_em >= l.atual_inicio AND e.ocorrido_em < l.atual_fim THEN 'atual'
      WHEN e.ocorrido_em >= l.anterior_inicio AND e.ocorrido_em < l.anterior_fim THEN 'anterior'
    END AS periodo
    FROM eventos_periodo e CROSS JOIN limites l
  ), eventos_unicos AS (
    -- A candidate who re-enters an approved/hired status counts once per period.
    SELECT tipo, entidade_id, periodo, MIN(ocorrido_em) AS ocorrido_em
    FROM eventos_classificados WHERE periodo IS NOT NULL
    GROUP BY tipo, entidade_id, periodo
  ), base AS (
    SELECT
      COUNT(*) FILTER (WHERE tipo = 'novos' AND periodo = 'atual')::INTEGER AS novos,
      COUNT(*) FILTER (WHERE tipo = 'novos' AND periodo = 'anterior')::INTEGER AS novos_anterior,
      COUNT(*) FILTER (WHERE tipo = 'aprovados' AND periodo = 'atual')::INTEGER AS aprovados,
      COUNT(*) FILTER (WHERE tipo = 'aprovados' AND periodo = 'anterior')::INTEGER AS aprovados_anterior,
      COUNT(*) FILTER (WHERE tipo = 'entrevistas' AND periodo = 'atual')::INTEGER AS entrevistas,
      COUNT(*) FILTER (WHERE tipo = 'entrevistas' AND periodo = 'anterior')::INTEGER AS entrevistas_anterior,
      COUNT(*) FILTER (WHERE tipo = 'contratacoes' AND periodo = 'atual')::INTEGER AS contratacoes,
      COUNT(*) FILTER (WHERE tipo = 'contratacoes' AND periodo = 'anterior')::INTEGER AS contratacoes_anterior
    FROM eventos_unicos
  ), primeira_revisao AS (
    SELECT candidato_id, MIN(created_at) AS analisado_em
    FROM candidato_revisoes GROUP BY candidato_id
  ), analise AS (
    SELECT ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (pr.analisado_em - c.created_at::TIMESTAMPTZ)) / 60
    ))::NUMERIC, 0)::INTEGER AS primeira_analise_minutos
    FROM candidatos c
    JOIN primeira_revisao pr ON pr.candidato_id = c.id AND pr.analisado_em >= c.created_at::TIMESTAMPTZ
    CROSS JOIN limites l
    WHERE pr.analisado_em >= l.atual_inicio AND pr.analisado_em < l.atual_fim
  ), presencas AS (
    -- Scheduled, cancelled and rescheduled appointments are not attendance evidence.
    SELECT COUNT(*)::INTEGER AS entrevistas_com_resultado,
      COUNT(*) FILTER (WHERE UPPER(e.status) = 'REALIZADA')::INTEGER AS entrevistas_realizadas
    FROM entrevistas e CROSS JOIN limites l
    WHERE e.inicio >= l.atual_inicio AND e.inicio < l.atual_fim
      AND UPPER(e.status) IN ('REALIZADA', 'FALTOU')
  ), resumo AS (
    SELECT b.*, a.primeira_analise_minutos, p.entrevistas_com_resultado, p.entrevistas_realizadas,
      CASE WHEN p.entrevistas_com_resultado > 0
        THEN ROUND(p.entrevistas_realizadas::NUMERIC * 100 / p.entrevistas_com_resultado)::INTEGER
        ELSE NULL END AS comparecimento
    FROM base b CROSS JOIN analise a CROSS JOIN presencas p
  ), serie AS (
    SELECT indice,
      CASE WHEN $1::INTEGER = 1 THEN l.hoje + indice * INTERVAL '1 hour'
        ELSE l.hoje - (($1::INTEGER - 1 - indice) * INTERVAL '1 day') END AS inicio_local,
      CASE WHEN $1::INTEGER = 1 THEN INTERVAL '1 hour' ELSE INTERVAL '1 day' END AS passo
    FROM limites l CROSS JOIN GENERATE_SERIES(0, CASE WHEN $1::INTEGER = 1 THEN 23 ELSE $1::INTEGER - 1 END) AS indice
  ), pontos AS (
    SELECT s.indice, TO_CHAR(s.inicio_local, 'YYYY-MM-DD') AS dia,
      CASE WHEN $1::INTEGER = 1 THEN TO_CHAR(s.inicio_local, 'HH24:MI') ELSE TO_CHAR(s.inicio_local, 'DD/MM') END AS rotulo,
      s.inicio_local > l.agora_local AS futuro,
      (SELECT COUNT(*) FROM eventos_unicos e WHERE e.tipo = 'novos' AND e.periodo = 'atual'
        AND e.ocorrido_em >= s.inicio_local AT TIME ZONE 'America/Sao_Paulo'
        AND e.ocorrido_em < (s.inicio_local + s.passo) AT TIME ZONE 'America/Sao_Paulo')::INTEGER AS candidaturas,
      (SELECT COUNT(*) FROM eventos_unicos e WHERE e.tipo = 'entrevistas' AND e.periodo = 'atual'
        AND e.ocorrido_em >= s.inicio_local AT TIME ZONE 'America/Sao_Paulo'
        AND e.ocorrido_em < (s.inicio_local + s.passo) AT TIME ZONE 'America/Sao_Paulo')::INTEGER AS entrevistas,
      (SELECT COUNT(*) FROM eventos_unicos e WHERE e.tipo = 'contratacoes' AND e.periodo = 'atual'
        AND e.ocorrido_em >= s.inicio_local AT TIME ZONE 'America/Sao_Paulo'
        AND e.ocorrido_em < (s.inicio_local + s.passo) AT TIME ZONE 'America/Sao_Paulo')::INTEGER AS contratacoes,
      (SELECT COUNT(*) FROM eventos_unicos e WHERE e.tipo = 'novos' AND e.periodo = 'anterior'
        AND e.ocorrido_em >= (s.inicio_local - $1::INTEGER * INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo'
        AND e.ocorrido_em < (s.inicio_local - $1::INTEGER * INTERVAL '1 day' + s.passo) AT TIME ZONE 'America/Sao_Paulo')::INTEGER AS candidaturas_periodo_anterior
    FROM serie s CROSS JOIN limites l
  )
  SELECT (SELECT ROW_TO_JSON(r) FROM resumo r) AS resumo,
    (SELECT JSON_AGG(p ORDER BY p.indice) FROM pontos p) AS tendencia,
    l.agora AS atualizado_em, 'America/Sao_Paulo' AS fuso_horario,
    CASE WHEN $1::INTEGER = 1 THEN 'hora' ELSE 'dia' END AS granularidade
  FROM limites l
`;

async function loadDashboardPerformance(pool, days, now = null) {
  const normalizedDays = [1, 7, 30].includes(days) ? days : 1;
  const result = await pool.query(performanceSql, [normalizedDays, now]);
  return { ...result.rows[0], periodo: `${normalizedDays}D` };
}

module.exports = { performanceSql, loadDashboardPerformance };
