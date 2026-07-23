-- ============================================================
-- CONSULTA A: vincular ao candidato um código de vaga informado
-- ============================================================
-- Use em um node Postgres chamado: Vincular vaga informada
-- Query Parameter $1: {{ $json.codigo_vaga_informado || '' }}
-- Query Parameter $2: ID do candidato encontrado no seu workflow
--
-- O node sempre devolve uma linha, mesmo quando não há código.

WITH vaga_encontrada AS (
    SELECT id, codigo
    FROM vagas
    WHERE UPPER(codigo) = UPPER(NULLIF($1, ''))
      AND status = 'ATIVA'
    ORDER BY updated_at DESC
    LIMIT 1
),
atualizado AS (
    UPDATE candidatos AS c
    SET
        vaga_id = v.id,
        updated_at = NOW()
    FROM vaga_encontrada AS v
    WHERE c.id = $2
    RETURNING c.id, c.vaga_id
)
SELECT
    NULLIF($1, '') AS codigo_informado,
    (SELECT id FROM vaga_encontrada) AS vaga_id_encontrada,
    (SELECT codigo FROM vaga_encontrada) AS codigo_vaga_encontrada,
    EXISTS (SELECT 1 FROM vaga_encontrada) AS codigo_valido,
    EXISTS (SELECT 1 FROM atualizado) AS candidato_atualizado;


-- ============================================================
-- CONSULTA B: carregar a vaga atual e a lista de vagas ativas
-- ============================================================
-- Use em um node Postgres chamado: Buscar contexto de vagas
-- Query Parameter $1: ID do candidato encontrado no seu workflow
--
-- O resultado sempre é uma linha com dois objetos JSON:
-- vaga_atual e vagas_ativas.

SELECT
    COALESCE(
        (
            SELECT jsonb_build_object(
                'id', v.id,
                'empresa_id', v.empresa_id,
                'codigo', v.codigo,
                'titulo', v.titulo,
                'cargo', v.cargo,
                'descricao', v.descricao,
                'cidade', v.cidade,
                'estado', v.estado,
                'bairro', v.bairro,
                'endereco_referencia', v.endereco_referencia,
                'tipo_contrato', v.tipo_contrato,
                'modalidade', v.modalidade,
                'escala', v.escala,
                'horario', v.horario,
                'salario', v.salario,
                'beneficios', v.beneficios,
                'escolaridade_minima', v.escolaridade_minima,
                'experiencia_minima_meses', v.experiencia_minima_meses,
                'aceita_sem_experiencia', v.aceita_sem_experiencia,
                'requisitos_obrigatorios', v.requisitos_obrigatorios,
                'requisitos_desejaveis', v.requisitos_desejaveis,
                'quantidade_vagas', v.quantidade_vagas,
                'formulario_url', v.formulario_url,
                'status', v.status,
                'data_inicio', v.data_inicio,
                'data_encerramento', v.data_encerramento
            )
            FROM candidatos c
            JOIN vagas v ON v.id = c.vaga_id
            WHERE c.id = $1
            LIMIT 1
        ),
        'null'::jsonb
    ) AS vaga_atual,

    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', lista.id,
                    'codigo', lista.codigo,
                    'titulo', lista.titulo,
                    'cargo', lista.cargo,
                    'cidade', lista.cidade,
                    'estado', lista.estado,
                    'bairro', lista.bairro,
                    'escala', lista.escala,
                    'horario', lista.horario,
                    'salario', lista.salario,
                    'beneficios', lista.beneficios,
                    'quantidade_vagas', lista.quantidade_vagas,
                    'formulario_url', lista.formulario_url
                )
                ORDER BY lista.updated_at DESC
            )
            FROM (
                SELECT *
                FROM vagas
                WHERE status = 'ATIVA'
                ORDER BY updated_at DESC
                LIMIT 20
            ) AS lista
        ),
        '[]'::jsonb
    ) AS vagas_ativas;


-- ============================================================
-- CONSULTA C: verificação manual durante os testes
-- ============================================================

SELECT
    c.id AS candidato_id,
    c.nome,
    c.telefone,
    c.vaga_id,
    v.codigo,
    v.titulo,
    v.status AS status_vaga
FROM candidatos c
LEFT JOIN vagas v ON v.id = c.vaga_id
ORDER BY c.updated_at DESC
LIMIT 20;
