BEGIN;

-- ============================================================
-- 1. LOG DE TODAS AS ENTRADAS RECEBIDAS PELO WHATSAPP
--    Este log é criado antes do cadastro do candidato. Assim,
--    mesmo que algum node posterior falhe, o acionamento permanece registrado.
-- ============================================================
CREATE TABLE IF NOT EXISTS atendimento_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mensagem_id TEXT,
    candidato_id BIGINT REFERENCES candidatos(id) ON DELETE SET NULL,
    telefone_extraido TEXT,
    raw_from TEXT,
    raw_sender_alt TEXT,
    tipo_mensagem VARCHAR(30),
    mime_type TEXT,
    nome_arquivo TEXT,
    status VARCHAR(40) NOT NULL DEFAULT 'RECEBIDO',
    detalhe TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atendimento_logs_mensagem_id
    ON atendimento_logs (mensagem_id)
    WHERE mensagem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atendimento_logs_created_at
    ON atendimento_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atendimento_logs_candidato
    ON atendimento_logs (candidato_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atendimento_logs_sem_vinculo
    ON atendimento_logs (created_at DESC)
    WHERE candidato_id IS NULL;

-- ============================================================
-- 2. AUDITORIA DE CANDIDATOS
--    Registra inclusões, alterações e exclusões, preservando os dados
--    mesmo quando o candidato é removido do cadastro principal.
-- ============================================================
CREATE TABLE IF NOT EXISTS auditoria_candidatos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    candidato_id BIGINT,
    acao VARCHAR(20) NOT NULL,
    nome TEXT,
    telefone TEXT,
    campos_alterados JSONB NOT NULL DEFAULT '[]'::JSONB,
    dados_antes JSONB,
    dados_depois JSONB,
    origem TEXT NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auditoria_candidatos_acao_valida
        CHECK (acao IN ('ADICIONADO', 'MODIFICADO', 'REMOVIDO'))
);

CREATE INDEX IF NOT EXISTS idx_auditoria_candidatos_created_at
    ON auditoria_candidatos (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_candidatos_candidato
    ON auditoria_candidatos (candidato_id, created_at DESC);

CREATE OR REPLACE FUNCTION genesis_auditar_candidato()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    antes JSONB;
    depois JSONB;
    campos JSONB;
    candidato_id_valor BIGINT;
    nome_valor TEXT;
    telefone_valor TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        depois := TO_JSONB(NEW);
        candidato_id_valor := NEW.id;
        nome_valor := NEW.nome;
        telefone_valor := NEW.telefone;

        INSERT INTO auditoria_candidatos
        (
            candidato_id, acao, nome, telefone,
            campos_alterados, dados_antes, dados_depois
        )
        VALUES
        (
            candidato_id_valor,
            'ADICIONADO',
            nome_valor,
            telefone_valor,
            '[]'::JSONB,
            NULL,
            depois
        );

        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        antes := TO_JSONB(OLD);
        candidato_id_valor := OLD.id;
        nome_valor := OLD.nome;
        telefone_valor := OLD.telefone;

        INSERT INTO auditoria_candidatos
        (
            candidato_id, acao, nome, telefone,
            campos_alterados, dados_antes, dados_depois
        )
        VALUES
        (
            candidato_id_valor,
            'REMOVIDO',
            nome_valor,
            telefone_valor,
            '[]'::JSONB,
            antes,
            NULL
        );

        RETURN OLD;
    END IF;

    -- Ignora atualização que alterou somente updated_at.
    antes := TO_JSONB(OLD) - 'updated_at';
    depois := TO_JSONB(NEW) - 'updated_at';

    IF antes IS NOT DISTINCT FROM depois THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(JSONB_AGG(chave ORDER BY chave), '[]'::JSONB)
    INTO campos
    FROM
    (
        SELECT chave
        FROM
        (
            SELECT JSONB_OBJECT_KEYS(antes) AS chave
            UNION
            SELECT JSONB_OBJECT_KEYS(depois) AS chave
        ) todas
        WHERE antes -> chave IS DISTINCT FROM depois -> chave
    ) alteradas;

    INSERT INTO auditoria_candidatos
    (
        candidato_id, acao, nome, telefone,
        campos_alterados, dados_antes, dados_depois
    )
    VALUES
    (
        NEW.id,
        'MODIFICADO',
        COALESCE(NEW.nome, OLD.nome),
        COALESCE(NEW.telefone, OLD.telefone),
        campos,
        TO_JSONB(OLD),
        TO_JSONB(NEW)
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_genesis_auditar_candidato ON candidatos;

CREATE TRIGGER trg_genesis_auditar_candidato
AFTER INSERT OR UPDATE OR DELETE ON candidatos
FOR EACH ROW
EXECUTE FUNCTION genesis_auditar_candidato();

-- ============================================================
-- 3. ALERTAS RESOLVIDOS PELO RECRUTADOR
--    Permite ocultar um alerta sem apagar candidato ou histórico.
-- ============================================================
CREATE TABLE IF NOT EXISTS alertas_resolvidos (
    chave TEXT PRIMARY KEY,
    resolvido_por TEXT,
    observacao TEXT,
    resolvido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. AJUSTES E ÍNDICES PARA DOCUMENTOS E AGENDA
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_documentos_candidato_tipo_data
    ON documentos (candidato_id, tipo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documentos_processando
    ON documentos (created_at DESC)
    WHERE UPPER(COALESCE(tipo, '')) = 'PENDENTE';

CREATE INDEX IF NOT EXISTS idx_candidatos_status_etapa_atualizacao
    ON candidatos (status, etapa, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_entrevistas_status_inicio
    ON entrevistas (status, inicio);

-- Garante que campos longos usados nos logs e análises não permaneçam VARCHAR(100).
DO $$
DECLARE
    campo RECORD;
BEGIN
    FOR campo IN
        SELECT *
        FROM (
            VALUES
                ('eventos', 'descricao'),
                ('candidato_estado', 'ultima_resposta'),
                ('candidato_estado', 'proxima_acao'),
                ('candidato_estado', 'aguardando'),
                ('documentos', 'arquivo'),
                ('documentos', 'nome_arquivo'),
                ('documentos', 'titulo'),
                ('mensagens', 'mensagem'),
                ('mensagens', 'mensagem_id'),
                ('candidatos', 'observacao_triagem'),
                ('candidatos', 'motivo_reprovacao')
        ) AS campos(tabela, coluna)
    LOOP
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = campo.tabela
              AND column_name = campo.coluna
              AND data_type = 'character varying'
        ) THEN
            EXECUTE FORMAT(
                'ALTER TABLE public.%I ALTER COLUMN %I TYPE TEXT USING %I::TEXT',
                campo.tabela,
                campo.coluna,
                campo.coluna
            );
        END IF;
    END LOOP;
END
$$;


-- ============================================================
-- 5. NORMALIZAÇÃO DE CAMPOS JSON LEGADOS
--    Evita erro de VARCHAR(100) quando a análise da CTPS é extensa.
-- ============================================================
CREATE OR REPLACE FUNCTION genesis_try_jsonb(valor TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF valor IS NULL OR BTRIM(valor) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN valor::JSONB;
    EXCEPTION WHEN OTHERS THEN
        RETURN JSONB_BUILD_OBJECT('valor_legado', valor);
    END;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documentos'
          AND column_name = 'resultado'
          AND data_type <> 'jsonb'
    ) THEN
        EXECUTE 'ALTER TABLE public.documentos ALTER COLUMN resultado TYPE JSONB USING genesis_try_jsonb(resultado::TEXT)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'candidatos'
          AND column_name = 'experiencias_ctps'
          AND data_type <> 'jsonb'
    ) THEN
        EXECUTE 'ALTER TABLE public.candidatos ALTER COLUMN experiencias_ctps TYPE JSONB USING genesis_try_jsonb(experiencias_ctps::TEXT)';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS genesis_try_jsonb(TEXT);

COMMIT;

-- Conferência rápida:
-- SELECT TO_REGCLASS('public.atendimento_logs');
-- SELECT TO_REGCLASS('public.auditoria_candidatos');
-- SELECT TO_REGCLASS('public.alertas_resolvidos');
