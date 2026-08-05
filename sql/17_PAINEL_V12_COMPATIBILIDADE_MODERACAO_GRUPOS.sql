BEGIN;

-- ============================================================
-- GÊNESIS RECRUITING OS V12
-- Compatibilidade da moderação com tabelas gg_groups legadas.
-- Migração aditiva, idempotente e sem remoção de registros.
-- ============================================================

-- Instalações antigas do diretório de grupos podem ter criado somente parte
-- das colunas. O painel consulta e atualiza todos os campos abaixo.
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS official BOOLEAN DEFAULT FALSE;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS moderation_note TEXT;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE gg_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE gg_groups ALTER COLUMN verified SET DEFAULT FALSE;
ALTER TABLE gg_groups ALTER COLUMN featured SET DEFAULT FALSE;
ALTER TABLE gg_groups ALTER COLUMN official SET DEFAULT FALSE;
ALTER TABLE gg_groups ALTER COLUMN submitted_at SET DEFAULT NOW();
ALTER TABLE gg_groups ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE gg_groups ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE gg_groups
SET verified = COALESCE(verified, FALSE),
    featured = COALESCE(featured, FALSE),
    official = COALESCE(official, FALSE),
    submitted_at = COALESCE(submitted_at, created_at, NOW()),
    created_at = COALESCE(created_at, submitted_at, NOW()),
    updated_at = COALESCE(updated_at, created_at, submitted_at, NOW())
WHERE verified IS NULL
   OR featured IS NULL
   OR official IS NULL
   OR submitted_at IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL;

-- Remove somente CHECKs da própria gg_groups que citam status. CHECKs de
-- categoria e demais regras permanecem intactos.
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'gg_groups'::regclass
      AND contype = 'c'
      AND POSITION('status' IN LOWER(pg_get_constraintdef(oid))) > 0
  LOOP
    EXECUTE FORMAT('ALTER TABLE gg_groups DROP CONSTRAINT %I', item.conname);
  END LOOP;
END;
$$;

-- Alguns MVPs usavam ENUM para status e outros usavam um CHECK que aceitava
-- "pending", mas não "approved". O portal e o painel atuais usam texto com os
-- cinco estados canônicos. Convertemos apenas quando o tipo for ENUM.
DO $$
DECLARE
  status_data_type TEXT;
BEGIN
  SELECT data_type
    INTO status_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'gg_groups'
    AND column_name = 'status';

  IF status_data_type = 'USER-DEFINED' THEN
    ALTER TABLE gg_groups ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE gg_groups ALTER COLUMN status TYPE VARCHAR(30) USING status::TEXT;
  END IF;
END;
$$;

ALTER TABLE gg_groups ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE gg_groups
  ADD CONSTRAINT gg_groups_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'suspended', 'expired'))
  NOT VALID;

-- Reinstala o gatilho caso a tabela tenha vindo do serviço legado.
CREATE OR REPLACE FUNCTION atualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gg_groups_atualizar_updated_at ON gg_groups;
CREATE TRIGGER gg_groups_atualizar_updated_at
BEFORE UPDATE ON gg_groups
FOR EACH ROW EXECUTE FUNCTION atualizar_updated_at();

COMMIT;

SELECT
  TO_REGCLASS('public.gg_groups') AS gg_groups,
  (SELECT column_default
     FROM information_schema.columns
    WHERE table_schema='public' AND table_name='gg_groups' AND column_name='status') AS status_default,
  (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
    WHERE conrelid='public.gg_groups'::regclass AND conname='gg_groups_status_check') AS status_rule;
