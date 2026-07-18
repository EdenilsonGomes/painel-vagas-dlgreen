BEGIN;

CREATE TABLE IF NOT EXISTS empresas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT empresas_nome_unico UNIQUE (nome)
);

CREATE TABLE IF NOT EXISTS vagas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    codigo VARCHAR(50) NOT NULL,
    titulo VARCHAR(150) NOT NULL,
    cargo VARCHAR(150) NOT NULL,
    descricao TEXT,
    cidade VARCHAR(100),
    estado CHAR(2) NOT NULL DEFAULT 'SP',
    bairro VARCHAR(100),
    endereco_referencia TEXT,
    tipo_contrato VARCHAR(50),
    modalidade VARCHAR(30) NOT NULL DEFAULT 'Presencial',
    escala VARCHAR(100),
    horario VARCHAR(150),
    salario NUMERIC(10, 2),
    beneficios TEXT,
    escolaridade_minima VARCHAR(100),
    experiencia_minima_meses INTEGER NOT NULL DEFAULT 0,
    aceita_sem_experiencia BOOLEAN NOT NULL DEFAULT FALSE,
    requisitos_obrigatorios TEXT,
    requisitos_desejaveis TEXT,
    quantidade_vagas INTEGER NOT NULL DEFAULT 1,
    formulario_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    data_inicio DATE,
    data_encerramento DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT vagas_empresa_fk
        FOREIGN KEY (empresa_id)
        REFERENCES empresas(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT vagas_codigo_por_empresa_unico
        UNIQUE (empresa_id, codigo),

    CONSTRAINT vagas_status_valido
        CHECK (status IN ('RASCUNHO', 'ATIVA', 'PAUSADA', 'ENCERRADA')),

    CONSTRAINT vagas_quantidade_positiva
        CHECK (quantidade_vagas >= 1),

    CONSTRAINT vagas_experiencia_nao_negativa
        CHECK (experiencia_minima_meses >= 0),

    CONSTRAINT vagas_salario_nao_negativo
        CHECK (salario IS NULL OR salario >= 0)
);

CREATE INDEX IF NOT EXISTS idx_vagas_status
    ON vagas (status);

CREATE INDEX IF NOT EXISTS idx_vagas_empresa_id
    ON vagas (empresa_id);

CREATE INDEX IF NOT EXISTS idx_vagas_codigo
    ON vagas (codigo);

CREATE INDEX IF NOT EXISTS idx_vagas_titulo
    ON vagas (titulo);

CREATE OR REPLACE FUNCTION atualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS empresas_atualizar_updated_at ON empresas;
CREATE TRIGGER empresas_atualizar_updated_at
BEFORE UPDATE ON empresas
FOR EACH ROW
EXECUTE FUNCTION atualizar_updated_at();

DROP TRIGGER IF EXISTS vagas_atualizar_updated_at ON vagas;
CREATE TRIGGER vagas_atualizar_updated_at
BEFORE UPDATE ON vagas
FOR EACH ROW
EXECUTE FUNCTION atualizar_updated_at();

INSERT INTO empresas (nome, ativo)
VALUES ('DL Green Terceirização de Serviços', TRUE)
ON CONFLICT (nome)
DO UPDATE SET
    ativo = TRUE,
    updated_at = NOW();

ALTER TABLE candidatos
    ADD COLUMN IF NOT EXISTS vaga_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'candidatos_vaga_id_fk'
          AND conrelid = 'candidatos'::regclass
    ) THEN
        ALTER TABLE candidatos
            ADD CONSTRAINT candidatos_vaga_id_fk
            FOREIGN KEY (vaga_id)
            REFERENCES vagas(id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_candidatos_vaga_id
    ON candidatos (vaga_id);

COMMIT;

-- Verificações rápidas após executar este arquivo:
-- SELECT * FROM empresas ORDER BY id;
-- SELECT * FROM vagas ORDER BY id;
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'candidatos' AND column_name = 'vaga_id';
