BEGIN;

ALTER TABLE vagas
    ADD COLUMN IF NOT EXISTS sexo VARCHAR(20) NOT NULL DEFAULT 'UNISSEX';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'vagas_sexo_valido'
          AND conrelid = 'vagas'::regclass
    ) THEN
        ALTER TABLE vagas
            ADD CONSTRAINT vagas_sexo_valido
            CHECK (sexo IN ('MASCULINO', 'FEMININO', 'UNISSEX'));
    END IF;
END;
$$;

COMMIT;

-- Depois de rodar:
-- SELECT id, codigo, titulo, sexo FROM vagas ORDER BY id DESC;
