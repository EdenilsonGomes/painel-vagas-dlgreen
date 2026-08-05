BEGIN;

-- ============================================================
-- GENESIS IA V13
-- Perguntas por vaga, interpretação auditável, áudio e demos.
-- Migração aditiva e idempotente. Não remove histórico.
-- ============================================================

CREATE TABLE IF NOT EXISTS vaga_triagem_versoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arquivada_at TIMESTAMPTZ,
  CONSTRAINT vaga_triagem_versoes_numero_positivo CHECK (numero > 0),
  CONSTRAINT vaga_triagem_versoes_status_valido CHECK (status IN ('ATIVA','ARQUIVADA')),
  CONSTRAINT vaga_triagem_versoes_unica UNIQUE (vaga_id, numero)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vaga_triagem_versao_ativa
  ON vaga_triagem_versoes (vaga_id)
  WHERE status = 'ATIVA';

CREATE TABLE IF NOT EXISTS vaga_perguntas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  versao_id BIGINT NOT NULL REFERENCES vaga_triagem_versoes(id) ON DELETE CASCADE,
  codigo VARCHAR(80) NOT NULL,
  ordem INTEGER NOT NULL,
  texto VARCHAR(500) NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  finalidade VARCHAR(30) NOT NULL DEFAULT 'CLASSIFICATORIA',
  obrigatoria BOOLEAN NOT NULL DEFAULT TRUE,
  opcoes JSONB NOT NULL DEFAULT '[]'::JSONB,
  regra_operador VARCHAR(30) NOT NULL DEFAULT 'SEMPRE',
  regra_valor JSONB,
  pontos INTEGER NOT NULL DEFAULT 0,
  mensagem_nao_atende VARCHAR(600),
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vaga_perguntas_codigo_versao_unico UNIQUE (versao_id, codigo),
  CONSTRAINT vaga_perguntas_ordem_versao_unica UNIQUE (versao_id, ordem),
  CONSTRAINT vaga_perguntas_ordem_positiva CHECK (ordem > 0),
  CONSTRAINT vaga_perguntas_pontos_validos CHECK (pontos BETWEEN 0 AND 1000),
  CONSTRAINT vaga_perguntas_tipo_valido CHECK (tipo IN (
    'SIM_NAO','UNICA_ESCOLHA','MULTIPLA_ESCOLHA','NUMERO','TEXTO_CURTO','TEXTO_LONGO'
  )),
  CONSTRAINT vaga_perguntas_finalidade_valida CHECK (finalidade IN (
    'ELIMINATORIA','CLASSIFICATORIA','ABERTA'
  )),
  CONSTRAINT vaga_perguntas_operador_valido CHECK (regra_operador IN (
    'SEMPRE','IGUAL','DIFERENTE','MAIOR_IGUAL','MENOR_IGUAL','CONTEM_QUALQUER','CONTEM_TODOS'
  )),
  CONSTRAINT vaga_perguntas_eliminatoria_objetiva CHECK (
    finalidade <> 'ELIMINATORIA' OR tipo IN ('SIM_NAO','UNICA_ESCOLHA','MULTIPLA_ESCOLHA','NUMERO')
  ),
  CONSTRAINT vaga_perguntas_opcoes_array CHECK (JSONB_TYPEOF(opcoes) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_vaga_perguntas_vaga_versao
  ON vaga_perguntas (vaga_id, versao_id, ordem)
  WHERE ativa IS TRUE;

CREATE TABLE IF NOT EXISTS candidato_triagens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  versao_id BIGINT NOT NULL REFERENCES vaga_triagem_versoes(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'EM_ANDAMENTO',
  score INTEGER NOT NULL DEFAULT 0,
  pergunta_atual_ordem INTEGER NOT NULL DEFAULT 1,
  iniciado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_triagens_status_valido CHECK (status IN (
    'EM_ANDAMENTO','CONCLUIDA','ELIMINADO','REVISAO','CANCELADA'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidato_triagem_ativa
  ON candidato_triagens (candidato_id, vaga_id)
  WHERE status IN ('EM_ANDAMENTO','REVISAO');
CREATE INDEX IF NOT EXISTS idx_candidato_triagens_candidato
  ON candidato_triagens (candidato_id, iniciado_at DESC);

CREATE TABLE IF NOT EXISTS candidato_respostas_triagem (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  triagem_id BIGINT NOT NULL REFERENCES candidato_triagens(id) ON DELETE CASCADE,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
  pergunta_id BIGINT NOT NULL REFERENCES vaga_perguntas(id) ON DELETE RESTRICT,
  mensagem_id TEXT,
  resposta_bruta TEXT NOT NULL,
  resposta_normalizada JSONB,
  resumo_ia TEXT,
  origem VARCHAR(20) NOT NULL DEFAULT 'TEXTO',
  confianca NUMERIC(5,4),
  atendida BOOLEAN,
  pontos INTEGER NOT NULL DEFAULT 0,
  precisa_revisao BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_respostas_origem_valida CHECK (origem IN ('TEXTO','AUDIO','PAINEL')),
  CONSTRAINT candidato_respostas_confianca_valida CHECK (confianca IS NULL OR (confianca >= 0 AND confianca <= 1)),
  CONSTRAINT candidato_respostas_pergunta_unica UNIQUE (triagem_id, pergunta_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidato_resposta_mensagem
  ON candidato_respostas_triagem (mensagem_id)
  WHERE mensagem_id IS NOT NULL AND BTRIM(mensagem_id) <> '';
CREATE INDEX IF NOT EXISTS idx_candidato_respostas_candidato
  ON candidato_respostas_triagem (candidato_id, created_at DESC);

CREATE TABLE IF NOT EXISTS genesis_chatbot_interpretacoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT REFERENCES candidatos(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  session TEXT NOT NULL,
  mensagem_id TEXT,
  origem VARCHAR(20) NOT NULL DEFAULT 'TEXTO',
  etapa VARCHAR(100),
  pergunta_id BIGINT REFERENCES vaga_perguntas(id) ON DELETE SET NULL,
  entrada_original TEXT NOT NULL,
  entrada_canonica TEXT,
  intencao VARCHAR(80),
  confianca NUMERIC(5,4),
  dados JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_interpretacoes_origem_valida CHECK (origem IN ('TEXTO','AUDIO','PAINEL')),
  CONSTRAINT genesis_interpretacoes_confianca_valida CHECK (confianca IS NULL OR (confianca >= 0 AND confianca <= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_genesis_interpretacao_mensagem
  ON genesis_chatbot_interpretacoes (session, mensagem_id)
  WHERE mensagem_id IS NOT NULL AND BTRIM(mensagem_id) <> '';
CREATE INDEX IF NOT EXISTS idx_genesis_interpretacoes_candidato
  ON genesis_chatbot_interpretacoes (candidato_id, created_at DESC);

-- O mesmo telefone pode conversar em sessões distintas sem colidir no debounce.
ALTER TABLE genesis_chatbot_entrada_buffer
  ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'TEXTO';

DO $$
DECLARE
  pk_name TEXT;
  pk_columns TEXT[];
BEGIN
  SELECT c.conname, ARRAY_AGG(a.attname ORDER BY key_position.ord)
  INTO pk_name, pk_columns
  FROM pg_constraint c
  CROSS JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS key_position(attnum, ord)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = key_position.attnum
  WHERE c.conrelid = 'genesis_chatbot_entrada_buffer'::REGCLASS
    AND c.contype = 'p'
  GROUP BY c.conname
  LIMIT 1;

  IF pk_name IS NOT NULL AND pk_columns IS DISTINCT FROM ARRAY['session','telefone']::TEXT[] THEN
    EXECUTE FORMAT('ALTER TABLE genesis_chatbot_entrada_buffer DROP CONSTRAINT %I', pk_name);
    pk_name := NULL;
  ELSIF pk_name IS NOT NULL AND pk_name <> 'genesis_chatbot_entrada_buffer_pkey_v13' THEN
    EXECUTE FORMAT(
      'ALTER TABLE genesis_chatbot_entrada_buffer RENAME CONSTRAINT %I TO genesis_chatbot_entrada_buffer_pkey_v13',
      pk_name
    );
    pk_name := 'genesis_chatbot_entrada_buffer_pkey_v13';
  END IF;

  IF pk_name IS NULL THEN
    ALTER TABLE genesis_chatbot_entrada_buffer
      ADD CONSTRAINT genesis_chatbot_entrada_buffer_pkey_v13 PRIMARY KEY (session, telefone);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v13_normalizar_texto(p_texto TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT BTRIM(REGEXP_REPLACE(
    UPPER(TRANSLATE(COALESCE(p_texto,''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^A-Z0-9]+',' ','g'));
$$;

CREATE OR REPLACE FUNCTION genesis_v13_sim_nao(p_texto TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE n TEXT := genesis_v13_normalizar_texto(p_texto);
BEGIN
  IF n IN ('3','NAO SEI','NAO LEMBRO','TALVEZ','ACHO QUE SIM','ACHO QUE NAO','PRECISO VER','PRECISO VERIFICAR','INCERTO','NAO TENHO CERTEZA')
     OR n ~ '^(NAO SEI|NAO LEMBRO|TALVEZ|ACHO QUE|PRECISO VER|PRECISO VERIFICAR|NAO TENHO CERTEZA) ' THEN RETURN 'INCERTO'; END IF;
  IF n IN ('1','SIM','S','TENHO','POSSUO','CONSIGO','POSSO','PODE','PODE SIM','CLARO','COM CERTEZA','OK','CONFIRMO','QUERO','VAMOS','BORA')
     OR n ~ '^(SIM|S) (EU )?(TENHO|POSSUO|CONSIGO|POSSO|CONFIRMO|QUERO|PODE|CLARO)( .*)?$'
     OR n ~ '^(TENHO|POSSUO|CONSIGO|POSSO|CONFIRMO) (SIM )?.+$' THEN RETURN 'SIM'; END IF;
  IF n IN ('2','NAO','N','NEGATIVO','AINDA NAO')
     OR n ~ '^NAO (EU )?(NAO )?(TENHO|POSSUO|CONSIGO|POSSO|QUERO|CONFIRMO|ESTOU|SOU)( .*)?$' THEN RETURN 'NAO'; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v13_extrair_numero(p_texto TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE m TEXT;
BEGIN
  m := (REGEXP_MATCH(COALESCE(p_texto,''), '(-?[0-9]+(?:[.,][0-9]+)?)'))[1];
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN REPLACE(m, ',', '.')::NUMERIC;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v13_indice_opcao(p_texto TEXT, p_opcoes JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  n TEXT := genesis_v13_normalizar_texto(p_texto);
  idx INTEGER;
  item RECORD;
BEGIN
  IF JSONB_TYPEOF(COALESCE(p_opcoes,'[]'::JSONB)) <> 'array' THEN RETURN NULL; END IF;
  IF n ~ '^([0-9]+)( .*)?$' THEN
    idx := (REGEXP_MATCH(n, '^([0-9]+)'))[1]::INTEGER;
    IF idx BETWEEN 1 AND JSONB_ARRAY_LENGTH(p_opcoes) THEN RETURN idx; END IF;
  END IF;
  FOR item IN
    SELECT ord::INTEGER AS indice, value #>> '{}' AS rotulo
    FROM JSONB_ARRAY_ELEMENTS(p_opcoes) WITH ORDINALITY AS x(value, ord)
  LOOP
    IF n = genesis_v13_normalizar_texto(item.rotulo)
       OR (CHAR_LENGTH(n) >= 3 AND genesis_v13_normalizar_texto(item.rotulo) LIKE '%' || n || '%') THEN
      RETURN item.indice;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v13_multiplas_opcoes(p_texto TEXT, p_opcoes JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  bruto TEXT := BTRIM(COALESCE(p_texto,''));
  total INTEGER;
  todos_validos BOOLEAN;
  resultado TEXT;
BEGIN
  IF bruto !~ '^[[:space:]]*[0-9]+([[:space:],;]+[0-9]+)*[[:space:]]*$'
     OR JSONB_TYPEOF(COALESCE(p_opcoes,'[]'::JSONB)) <> 'array' THEN RETURN NULL; END IF;
  SELECT COUNT(*)::INTEGER,
         BOOL_AND(n BETWEEN 1 AND JSONB_ARRAY_LENGTH(p_opcoes)),
         STRING_AGG(n::TEXT, ',' ORDER BY n)
  INTO total,todos_validos,resultado
  FROM (
    SELECT DISTINCT (m[1])::INTEGER AS n
    FROM REGEXP_MATCHES(bruto,'([0-9]+)','g') AS x(m)
  ) valores;
  IF total=0 OR todos_validos IS NOT TRUE THEN RETURN NULL; END IF;
  RETURN resultado;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v13_avaliar_resposta(
  p_tipo TEXT,
  p_finalidade TEXT,
  p_opcoes JSONB,
  p_operador TEXT,
  p_regra JSONB,
  p_pontos INTEGER,
  p_resposta TEXT,
  p_interpretacao JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(
  resposta_normalizada JSONB,
  atendida BOOLEAN,
  pontos INTEGER,
  precisa_revisao BOOLEAN,
  resumo TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  tipo TEXT := UPPER(COALESCE(p_tipo,''));
  finalidade TEXT := UPPER(COALESCE(p_finalidade,'CLASSIFICATORIA'));
  operador TEXT := UPPER(COALESCE(p_operador,'SEMPRE'));
  canonica TEXT := NULLIF(BTRIM(COALESCE(p_interpretacao->>'resposta_canonica', p_interpretacao->>'canonical', '')), '');
  valor_texto TEXT;
  sim_nao TEXT;
  indice INTEGER;
  numero NUMERIC;
  esperado_texto TEXT;
  esperado_numero NUMERIC;
  selecionados JSONB := '[]'::JSONB;
  esperado_array JSONB;
BEGIN
  resumo := NULLIF(BTRIM(COALESCE(p_interpretacao->>'resumo', p_interpretacao->>'summary', '')), '');
  valor_texto := COALESCE(canonica, BTRIM(COALESCE(p_resposta,'')));
  atendida := TRUE;
  precisa_revisao := FALSE;
  pontos := 0;

  IF tipo = 'SIM_NAO' THEN
    sim_nao := genesis_v13_sim_nao(valor_texto);
    IF sim_nao = 'INCERTO' THEN sim_nao := NULL; END IF;
    resposta_normalizada := CASE WHEN sim_nao IS NULL THEN NULL ELSE TO_JSONB(sim_nao) END;
    IF sim_nao IS NULL THEN
      atendida := NULL;
      precisa_revisao := TRUE;
    ELSE
      esperado_texto := UPPER(COALESCE(p_regra #>> '{}', p_regra->>0, ''));
      IF operador = 'DIFERENTE' THEN atendida := sim_nao <> esperado_texto;
      ELSIF operador = 'SEMPRE' OR esperado_texto = '' THEN atendida := TRUE;
      ELSE atendida := sim_nao = esperado_texto; END IF;
    END IF;

  ELSIF tipo = 'UNICA_ESCOLHA' THEN
    indice := genesis_v13_indice_opcao(valor_texto, COALESCE(p_opcoes,'[]'::JSONB));
    resposta_normalizada := CASE WHEN indice IS NULL THEN NULL ELSE TO_JSONB(indice) END;
    IF indice IS NULL THEN
      atendida := NULL;
      precisa_revisao := TRUE;
    ELSE
      esperado_texto := COALESCE(p_regra #>> '{}', p_regra->>0, '');
      IF operador = 'DIFERENTE' THEN atendida := indice::TEXT <> esperado_texto;
      ELSIF operador = 'SEMPRE' OR esperado_texto = '' THEN atendida := TRUE;
      ELSE atendida := indice::TEXT = esperado_texto; END IF;
    END IF;

  ELSIF tipo = 'MULTIPLA_ESCOLHA' THEN
    valor_texto := genesis_v13_multiplas_opcoes(valor_texto, COALESCE(p_opcoes,'[]'::JSONB));
    SELECT COALESCE(JSONB_AGG(DISTINCT n ORDER BY n), '[]'::JSONB)
    INTO selecionados
    FROM (
      SELECT (m[1])::INTEGER AS n
      FROM REGEXP_MATCHES(COALESCE(valor_texto,''), '([0-9]+)', 'g') AS x(m)
      WHERE (m[1])::INTEGER BETWEEN 1 AND JSONB_ARRAY_LENGTH(COALESCE(p_opcoes,'[]'::JSONB))
    ) q;
    resposta_normalizada := selecionados;
    IF JSONB_ARRAY_LENGTH(selecionados) = 0 THEN
      atendida := NULL;
      precisa_revisao := TRUE;
    ELSE
      esperado_array := CASE WHEN JSONB_TYPEOF(p_regra) = 'array' THEN p_regra ELSE JSONB_BUILD_ARRAY(p_regra) END;
      IF operador = 'CONTEM_TODOS' THEN atendida := selecionados @> esperado_array;
      ELSIF operador = 'CONTEM_QUALQUER' THEN
        atendida := EXISTS (
          SELECT 1 FROM JSONB_ARRAY_ELEMENTS(selecionados) s
          JOIN JSONB_ARRAY_ELEMENTS(esperado_array) e ON s = e
        );
      ELSIF operador = 'SEMPRE' THEN atendida := TRUE;
      ELSE atendida := selecionados = esperado_array; END IF;
    END IF;

  ELSIF tipo = 'NUMERO' THEN
    numero := CASE
      WHEN canonica IS NOT NULL OR BTRIM(COALESCE(p_resposta,'')) ~ '^-?[0-9]+([.,][0-9]+)?$'
        THEN genesis_v13_extrair_numero(valor_texto)
      ELSE NULL
    END;
    resposta_normalizada := CASE WHEN numero IS NULL THEN NULL ELSE TO_JSONB(numero) END;
    IF numero IS NULL THEN
      atendida := NULL;
      precisa_revisao := TRUE;
    ELSE
      esperado_numero := genesis_v13_extrair_numero(COALESCE(p_regra #>> '{}', p_regra->>0, ''));
      IF operador = 'MAIOR_IGUAL' THEN atendida := esperado_numero IS NOT NULL AND numero >= esperado_numero;
      ELSIF operador = 'MENOR_IGUAL' THEN atendida := esperado_numero IS NOT NULL AND numero <= esperado_numero;
      ELSIF operador = 'DIFERENTE' THEN atendida := esperado_numero IS NULL OR numero <> esperado_numero;
      ELSIF operador = 'SEMPRE' OR esperado_numero IS NULL THEN atendida := TRUE;
      ELSE atendida := numero = esperado_numero; END IF;
    END IF;

  ELSE
    resposta_normalizada := TO_JSONB(BTRIM(COALESCE(p_resposta,'')));
    atendida := NULLIF(BTRIM(COALESCE(p_resposta,'')), '') IS NOT NULL;
    precisa_revisao := FALSE;
    IF resumo IS NULL THEN resumo := LEFT(BTRIM(COALESCE(p_resposta,'')), 500); END IF;
  END IF;

  IF finalidade = 'ABERTA' THEN
    atendida := NULLIF(BTRIM(COALESCE(p_resposta,'')), '') IS NOT NULL;
    precisa_revisao := FALSE;
  END IF;
  IF atendida IS TRUE AND finalidade = 'CLASSIFICATORIA' THEN pontos := GREATEST(0, COALESCE(p_pontos,0)); END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_triagem_v13_garantir(p_candidato_id BIGINT, p_vaga_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE t candidato_triagens%ROWTYPE; versao BIGINT;
BEGIN
  IF p_candidato_id IS NULL OR p_vaga_id IS NULL THEN RETURN 'SEM_PERGUNTAS'; END IF;
  SELECT * INTO t
  FROM candidato_triagens
  WHERE candidato_id = p_candidato_id AND vaga_id = p_vaga_id
  ORDER BY iniciado_at DESC, id DESC
  LIMIT 1;
  IF FOUND AND t.status IN ('EM_ANDAMENTO','CONCLUIDA','ELIMINADO','REVISAO') THEN RETURN t.status; END IF;

  SELECT tv.id INTO versao
  FROM vaga_triagem_versoes tv
  WHERE tv.vaga_id = p_vaga_id AND tv.status = 'ATIVA'
    AND EXISTS (SELECT 1 FROM vaga_perguntas p WHERE p.versao_id = tv.id AND p.ativa IS TRUE)
  ORDER BY tv.numero DESC
  LIMIT 1;
  IF versao IS NULL THEN RETURN 'SEM_PERGUNTAS'; END IF;

  INSERT INTO candidato_triagens (candidato_id, vaga_id, versao_id, status)
  VALUES (p_candidato_id, p_vaga_id, versao, 'EM_ANDAMENTO')
  ON CONFLICT (candidato_id, vaga_id) WHERE status IN ('EM_ANDAMENTO','REVISAO') DO NOTHING;
  RETURN 'EM_ANDAMENTO';
END;
$$;

CREATE OR REPLACE FUNCTION genesis_triagem_v13_pergunta_atual(p_candidato_id BIGINT, p_vaga_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  t candidato_triagens%ROWTYPE;
  p vaga_perguntas%ROWTYPE;
  total INTEGER;
  respondidas INTEGER;
  lista TEXT;
BEGIN
  PERFORM genesis_triagem_v13_garantir(p_candidato_id, p_vaga_id);
  SELECT * INTO t FROM candidato_triagens
  WHERE candidato_id=p_candidato_id AND vaga_id=p_vaga_id
  ORDER BY iniciado_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR t.status <> 'EM_ANDAMENTO' THEN RETURN ''; END IF;
  SELECT COUNT(*)::INTEGER INTO total FROM vaga_perguntas WHERE versao_id=t.versao_id AND ativa IS TRUE;
  SELECT COUNT(*)::INTEGER INTO respondidas FROM candidato_respostas_triagem WHERE triagem_id=t.id;
  SELECT q.* INTO p
  FROM vaga_perguntas q
  WHERE q.versao_id=t.versao_id AND q.ativa IS TRUE
    AND NOT EXISTS (SELECT 1 FROM candidato_respostas_triagem r WHERE r.triagem_id=t.id AND r.pergunta_id=q.id)
  ORDER BY q.ordem LIMIT 1;
  IF NOT FOUND THEN RETURN ''; END IF;
  IF p.tipo = 'SIM_NAO' THEN lista := E'\n\n1 — Sim\n2 — Não';
  ELSIF p.tipo IN ('UNICA_ESCOLHA','MULTIPLA_ESCOLHA') THEN
    SELECT E'\n\n' || STRING_AGG(FORMAT('%s — %s', ord, value #>> '{}'), E'\n' ORDER BY ord)
    INTO lista FROM JSONB_ARRAY_ELEMENTS(p.opcoes) WITH ORDINALITY AS x(value,ord);
    IF p.tipo='MULTIPLA_ESCOLHA' THEN lista := COALESCE(lista,'') || E'\n\nVocê pode escolher mais de uma opção, separando os números por vírgula.'; END IF;
  ELSE lista := ''; END IF;
  RETURN FORMAT(E'Etapa %s de %s · perguntas da vaga\n\n%s%s\n\nVocê pode responder por texto ou áudio.', respondidas+1,total,p.texto,COALESCE(lista,''));
END;
$$;

-- ============================================================
-- Demonstrações isoladas de sete dias
-- ============================================================

CREATE TABLE IF NOT EXISTS genesis_demos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_nome VARCHAR(180) NOT NULL,
  contato_nome VARCHAR(150) NOT NULL,
  contato_email VARCHAR(254),
  contato_whatsapp VARCHAR(30),
  vaga_origem_id BIGINT REFERENCES vagas(id) ON DELETE SET NULL,
  vaga_titulo VARCHAR(180) NOT NULL DEFAULT 'Vaga demonstrativa',
  session_name VARCHAR(80) NOT NULL UNIQUE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'CRIADA',
  waha_status VARCHAR(50),
  whatsapp_conectado TEXT,
  criado_por BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  criado_por_nome VARCHAR(150),
  inicio_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ NOT NULL,
  conectado_em TIMESTAMPTZ,
  encerrado_em TIMESTAMPTZ,
  ultimo_erro TEXT,
  ultimo_status_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_demos_status_valido CHECK (status IN (
    'CRIADA','AGUARDANDO_QR','CONECTADA','EXPIRADA','ENCERRADA','ERRO'
  )),
  CONSTRAINT genesis_demos_periodo_valido CHECK (expira_em > inicio_em)
);

CREATE INDEX IF NOT EXISTS idx_genesis_demos_status_expiracao
  ON genesis_demos (status, expira_em);

CREATE TABLE IF NOT EXISTS genesis_demo_perguntas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demo_id BIGINT NOT NULL REFERENCES genesis_demos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  texto VARCHAR(500) NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  finalidade VARCHAR(30) NOT NULL DEFAULT 'CLASSIFICATORIA',
  obrigatoria BOOLEAN NOT NULL DEFAULT TRUE,
  opcoes JSONB NOT NULL DEFAULT '[]'::JSONB,
  regra_operador VARCHAR(30) NOT NULL DEFAULT 'SEMPRE',
  regra_valor JSONB,
  pontos INTEGER NOT NULL DEFAULT 0,
  mensagem_nao_atende VARCHAR(600),
  CONSTRAINT genesis_demo_perguntas_ordem_unica UNIQUE (demo_id, ordem),
  CONSTRAINT genesis_demo_perguntas_tipo_valido CHECK (tipo IN (
    'SIM_NAO','UNICA_ESCOLHA','MULTIPLA_ESCOLHA','NUMERO','TEXTO_CURTO','TEXTO_LONGO'
  )),
  CONSTRAINT genesis_demo_perguntas_finalidade_valida CHECK (finalidade IN (
    'ELIMINATORIA','CLASSIFICATORIA','ABERTA'
  )),
  CONSTRAINT genesis_demo_perguntas_eliminatoria_objetiva CHECK (
    finalidade <> 'ELIMINATORIA' OR tipo IN ('SIM_NAO','UNICA_ESCOLHA','MULTIPLA_ESCOLHA','NUMERO')
  )
);

CREATE TABLE IF NOT EXISTS genesis_demo_contatos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demo_id BIGINT NOT NULL REFERENCES genesis_demos(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  nome VARCHAR(150),
  etapa VARCHAR(80) NOT NULL DEFAULT 'AGUARDANDO_INICIO',
  status VARCHAR(30) NOT NULL DEFAULT 'EM_ANDAMENTO',
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_demo_contatos_unico UNIQUE (demo_id, telefone),
  CONSTRAINT genesis_demo_contatos_status_valido CHECK (status IN ('EM_ANDAMENTO','CONCLUIDA','NAO_ATENDEU'))
);

CREATE TABLE IF NOT EXISTS genesis_demo_respostas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demo_id BIGINT NOT NULL REFERENCES genesis_demos(id) ON DELETE CASCADE,
  contato_id BIGINT NOT NULL REFERENCES genesis_demo_contatos(id) ON DELETE CASCADE,
  pergunta_id BIGINT NOT NULL REFERENCES genesis_demo_perguntas(id) ON DELETE CASCADE,
  resposta_bruta TEXT NOT NULL,
  resposta_normalizada JSONB,
  resumo_ia TEXT,
  origem VARCHAR(20) NOT NULL DEFAULT 'TEXTO',
  confianca NUMERIC(5,4),
  atendida BOOLEAN,
  pontos INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_demo_resposta_unica UNIQUE (contato_id, pergunta_id)
);

CREATE TABLE IF NOT EXISTS genesis_demo_mensagens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demo_id BIGINT NOT NULL REFERENCES genesis_demos(id) ON DELETE CASCADE,
  contato_id BIGINT NOT NULL REFERENCES genesis_demo_contatos(id) ON DELETE CASCADE,
  quem VARCHAR(20) NOT NULL,
  mensagem TEXT NOT NULL,
  mensagem_id TEXT,
  origem VARCHAR(20) NOT NULL DEFAULT 'TEXTO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_demo_mensagens_quem_valido CHECK (quem IN ('USUARIO','IA'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_genesis_demo_mensagem_externa
  ON genesis_demo_mensagens (demo_id, mensagem_id)
  WHERE mensagem_id IS NOT NULL AND BTRIM(mensagem_id) <> '';

CREATE OR REPLACE FUNCTION genesis_demo_v13_pergunta_atual(p_contato_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE c genesis_demo_contatos%ROWTYPE; p genesis_demo_perguntas%ROWTYPE; total INTEGER; respondidas INTEGER; lista TEXT;
BEGIN
  SELECT * INTO c FROM genesis_demo_contatos WHERE id=p_contato_id;
  IF NOT FOUND THEN RETURN ''; END IF;
  SELECT COUNT(*)::INTEGER INTO total FROM genesis_demo_perguntas WHERE demo_id=c.demo_id;
  SELECT COUNT(*)::INTEGER INTO respondidas FROM genesis_demo_respostas WHERE contato_id=c.id;
  SELECT q.* INTO p FROM genesis_demo_perguntas q
  WHERE q.demo_id=c.demo_id
    AND NOT EXISTS (SELECT 1 FROM genesis_demo_respostas r WHERE r.contato_id=c.id AND r.pergunta_id=q.id)
  ORDER BY q.ordem LIMIT 1;
  IF NOT FOUND THEN RETURN ''; END IF;
  IF p.tipo='SIM_NAO' THEN lista:=E'\n\n1 — Sim\n2 — Não';
  ELSIF p.tipo IN ('UNICA_ESCOLHA','MULTIPLA_ESCOLHA') THEN
    SELECT E'\n\n'||STRING_AGG(FORMAT('%s — %s',ord,value #>> '{}'),E'\n' ORDER BY ord)
    INTO lista FROM JSONB_ARRAY_ELEMENTS(p.opcoes) WITH ORDINALITY x(value,ord);
    IF p.tipo='MULTIPLA_ESCOLHA' THEN lista:=COALESCE(lista,'')||E'\n\nEscolha uma ou mais opções, separando os números por vírgula.'; END IF;
  ELSE lista:=''; END IF;
  RETURN FORMAT(E'Etapa %s de %s da demonstração\n\n%s%s\n\nResponda por texto ou áudio.',respondidas+1,total,p.texto,COALESCE(lista,''));
END;
$$;

CREATE OR REPLACE FUNCTION genesis_demo_v13_processar_texto(
  p_session TEXT,
  p_telefone TEXT,
  p_mensagem TEXT,
  p_mensagem_id TEXT,
  p_origem TEXT DEFAULT 'TEXTO',
  p_interpretacao JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  d genesis_demos%ROWTYPE;
  c genesis_demo_contatos%ROWTYPE;
  p genesis_demo_perguntas%ROWTYPE;
  ev RECORD;
  nova BOOLEAN := FALSE;
  linhas_afetadas INTEGER := 0;
  msg TEXT := BTRIM(COALESCE(p_mensagem,''));
  resposta TEXT;
  proxima TEXT;
  confianca NUMERIC := NULLIF(COALESCE(p_interpretacao->>'confianca',p_interpretacao->>'confidence',''),'')::NUMERIC;
BEGIN
  SELECT * INTO d FROM genesis_demos
  WHERE session_name=p_session
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF d.status IN ('EXPIRADA','ENCERRADA') OR d.expira_em <= NOW() THEN
    UPDATE genesis_demos d0 SET status='EXPIRADA',updated_at=NOW() WHERE d0.id=d.id AND d0.status<>'ENCERRADA';
    RETURN QUERY SELECT 0::BIGINT,REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),p_session,
      'Este período de demonstração foi encerrado. Fale com a equipe da Gênesis IA para continuar.',
      'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,'EXPIRADA'::TEXT,'EXPIRADA'::TEXT,TRUE;
    RETURN;
  END IF;

  INSERT INTO genesis_demo_contatos(demo_id,telefone)
  VALUES(d.id,REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'))
  ON CONFLICT ON CONSTRAINT genesis_demo_contatos_unico DO NOTHING;
  GET DIAGNOSTICS linhas_afetadas = ROW_COUNT;
  nova := linhas_afetadas > 0;
  SELECT dc.* INTO c FROM genesis_demo_contatos dc WHERE dc.demo_id=d.id AND dc.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') FOR UPDATE;

  IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN
    INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,mensagem_id,origem)
    VALUES(d.id,c.id,'USUARIO',msg,p_mensagem_id,UPPER(COALESCE(p_origem,'TEXTO')))
    ON CONFLICT(demo_id,mensagem_id) WHERE mensagem_id IS NOT NULL AND BTRIM(mensagem_id)<>'' DO NOTHING;
    IF NOT FOUND THEN RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,FALSE; RETURN; END IF;
  ELSE
    INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,origem) VALUES(d.id,c.id,'USUARIO',msg,UPPER(COALESCE(p_origem,'TEXTO')));
  END IF;

  IF nova THEN
    resposta:=FORMAT(E'Olá! Esta é uma demonstração da Evelyn, assistente de recrutamento da Gênesis IA. 🤖\n\nVamos simular uma candidatura para a vaga %s. Nenhuma decisão real será tomada.\n\nResponda “começar” para iniciar. Você também pode enviar áudio.',d.vaga_titulo);
  ELSIF genesis_v13_normalizar_texto(msg) IN ('REINICIAR','RECOMECAR','COMECAR DE NOVO') THEN
    DELETE FROM genesis_demo_respostas WHERE contato_id=c.id;
    UPDATE genesis_demo_contatos SET nome=NULL,etapa='AGUARDANDO_NOME',status='EM_ANDAMENTO',score=0,updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    resposta:='Demonstração reiniciada. Como posso te chamar?';
  ELSIF c.etapa='AGUARDANDO_INICIO' THEN
    UPDATE genesis_demo_contatos SET etapa='AGUARDANDO_NOME',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    resposta:='Ótimo. Como posso te chamar?';
  ELSIF c.etapa='AGUARDANDO_NOME' THEN
    IF CHAR_LENGTH(msg) BETWEEN 2 AND 150 AND msg !~ '^\s*[0-9]+\s*$' THEN
      UPDATE genesis_demo_contatos SET nome=INITCAP(msg),etapa='PERGUNTAS_VAGA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
      proxima:=genesis_demo_v13_pergunta_atual(c.id);
      IF proxima='' THEN
        UPDATE genesis_demo_contatos SET etapa='CONCLUIDA',status='CONCLUIDA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
        resposta:='Perfeito. A demonstração foi concluída. Em um processo real, as respostas apareceriam organizadas para o recrutador.';
      ELSE resposta:='Prazer, '||SPLIT_PART(c.nome,' ',1)||E'!\n\n'||proxima; END IF;
    ELSE resposta:='Não consegui identificar seu nome. Informe apenas como gostaria de ser chamado.'; END IF;
  ELSIF c.etapa='PERGUNTAS_VAGA' THEN
    SELECT q.* INTO p FROM genesis_demo_perguntas q
    WHERE q.demo_id=d.id AND NOT EXISTS (SELECT 1 FROM genesis_demo_respostas r WHERE r.contato_id=c.id AND r.pergunta_id=q.id)
    ORDER BY q.ordem LIMIT 1;
    IF NOT FOUND THEN
      UPDATE genesis_demo_contatos SET etapa='CONCLUIDA',status='CONCLUIDA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
      resposta:='A demonstração foi concluída. Digite “reiniciar” se quiser testar novamente.';
    ELSE
      SELECT * INTO ev FROM genesis_v13_avaliar_resposta(p.tipo,p.finalidade,p.opcoes,p.regra_operador,p.regra_valor,p.pontos,msg,p_interpretacao);
      IF p.obrigatoria AND ev.resposta_normalizada IS NULL THEN
        resposta:=E'Não consegui entender com segurança. Pode responder novamente?\n\n'||genesis_demo_v13_pergunta_atual(c.id);
      ELSE
        INSERT INTO genesis_demo_respostas(demo_id,contato_id,pergunta_id,resposta_bruta,resposta_normalizada,resumo_ia,origem,confianca,atendida,pontos)
        VALUES(d.id,c.id,p.id,msg,ev.resposta_normalizada,ev.resumo,UPPER(COALESCE(p_origem,'TEXTO')),confianca,ev.atendida,ev.pontos)
        ON CONFLICT(contato_id,pergunta_id) DO NOTHING;
        UPDATE genesis_demo_contatos SET score=score+COALESCE(ev.pontos,0),updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
        IF p.finalidade='ELIMINATORIA' AND ev.atendida IS FALSE THEN
          UPDATE genesis_demo_contatos SET etapa='CONCLUIDA',status='NAO_ATENDEU',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
          resposta:=COALESCE(NULLIF(p.mensagem_nao_atende,''),'Nesta simulação, a resposta não atende a um requisito objetivo configurado para a vaga.')||E'\n\nA demonstração terminou sem alterar nenhum processo real. Digite “reiniciar” para testar novamente.';
        ELSE
          proxima:=genesis_demo_v13_pergunta_atual(c.id);
          IF proxima='' THEN
            UPDATE genesis_demo_contatos SET etapa='CONCLUIDA',status='CONCLUIDA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
            resposta:=E'Demonstração concluída! ✅\n\nAs respostas foram estruturadas e as abertas receberam um resumo para o recrutador. Digite “reiniciar” para testar novamente.';
          ELSE resposta:=proxima; END IF;
        END IF;
      END IF;
    END IF;
  ELSE resposta:='Esta demonstração já foi concluída. Digite “reiniciar” se quiser testar novamente.';
  END IF;

  INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,origem) VALUES(d.id,c.id,'IA',resposta,'TEXTO');
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$$;

-- ============================================================
-- Funções conversacionais V13 do fluxo principal
-- ============================================================

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_etapa_retomada(p_candidato_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  c candidatos%ROWTYPE;
  v vagas%ROWTYPE;
  doc RECORD;
  triagem_status TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_INTENCAO'; END IF;
  IF EXISTS (SELECT 1 FROM entrevistas e WHERE e.candidato_id=c.id AND UPPER(COALESCE(e.status,''))='AGENDADA') THEN RETURN 'ENTREVISTA_AGENDADA'; END IF;
  IF c.revisao_pendente IS TRUE THEN
    IF c.revisao_tipo='EXCECAO_EXPERIENCIA' THEN RETURN 'PENDENTE_APROVACAO_RECRUTADOR'; END IF;
    RETURN 'REVISAO_DOCUMENTAL';
  END IF;
  IF c.vaga_id IS NULL THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  SELECT * INTO v FROM vagas WHERE id=c.vaga_id;
  IF NOT FOUND OR v.status<>'ATIVA' THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  IF NULLIF(BTRIM(COALESCE(c.nome,'')),'') IS NULL THEN RETURN 'AGUARDANDO_NOME'; END IF;
  triagem_status:=genesis_triagem_v13_garantir(c.id,c.vaga_id);
  IF triagem_status='EM_ANDAMENTO' THEN RETURN 'PERGUNTAS_VAGA'; END IF;
  IF triagem_status='ELIMINADO' THEN RETURN 'NAO_APTO_NESTA_VAGA'; END IF;
  IF triagem_status='REVISAO' THEN RETURN 'PENDENTE_APROVACAO_RECRUTADOR'; END IF;
  IF COALESCE(v.experiencia_minima_meses,0)>0 AND c.experiencia_declarada IS NULL THEN RETURN 'AGUARDANDO_EXPERIENCIA'; END IF;
  IF c.deslocamento_faixa IS NULL THEN RETURN 'AGUARDANDO_TEMPO_DESLOCAMENTO'; END IF;
  IF c.deslocamento_chegada IS NULL THEN RETURN 'AGUARDANDO_CONFIRMACAO_CHEGADA'; END IF;
  IF REGEXP_REPLACE(COALESCE(c.cep,''),'\D','','g') !~ '^\d{8}$' THEN RETURN 'AGUARDANDO_CEP'; END IF;
  SELECT d.id,d.tipo,d.status_processamento INTO doc FROM documentos d
  WHERE d.candidato_id=c.id AND (UPPER(COALESCE(d.tipo,''))='CTPS' OR UPPER(COALESCE(d.titulo,'')) LIKE '%CTPS%')
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_CTPS'; END IF;
  IF UPPER(COALESCE(doc.status_processamento,'')) IN ('RECEBIDO','ARMAZENADO','PROCESSANDO','REPROCESSAMENTO_SOLICITADO') THEN RETURN 'PROCESSANDO_CTPS'; END IF;
  IF UPPER(COALESCE(doc.status_processamento,'')) IN ('REVISAO','INCONCLUSIVO','ERRO_PROCESSAMENTO') THEN RETURN 'REVISAO_DOCUMENTAL'; END IF;
  IF c.aprovado IS TRUE OR UPPER(COALESCE(c.status,''))='APROVADO' THEN RETURN 'AGUARDANDO_ESCOLHA_HORARIO'; END IF;
  IF c.etapa='NAO_APTO_NESTA_VAGA' THEN RETURN c.etapa; END IF;
  RETURN COALESCE(NULLIF(c.etapa,''),'AGUARDANDO_CTPS');
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_pergunta_atual(p_etapa TEXT, p_vaga_id BIGINT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE v RECORD; candidato BIGINT;
BEGIN
  SELECT * INTO v FROM vagas WHERE id=p_vaga_id;
  IF p_etapa='PERGUNTAS_VAGA' THEN
    SELECT id INTO candidato FROM candidatos WHERE vaga_id=p_vaga_id AND etapa='PERGUNTAS_VAGA' ORDER BY updated_at DESC LIMIT 1;
    RETURN genesis_triagem_v13_pergunta_atual(candidato,p_vaga_id);
  END IF;
  RETURN CASE p_etapa
    WHEN 'AGUARDANDO_INTENCAO' THEN genesis_chatbot_v1_menu_principal()
    WHEN 'ESCOLHENDO_VAGA' THEN genesis_chatbot_v1_listar_vagas()
    WHEN 'AGUARDANDO_ACAO_VAGA' THEN 'Responda: 1 para seguir com a candidatura, 2 para tirar uma dúvida sobre a vaga ou 3 para ver outra vaga.'
    WHEN 'DUVIDAS_GERAIS' THEN genesis_chatbot_v1_menu_duvidas_gerais()
    WHEN 'DUVIDAS_VAGA' THEN E'Escolha uma dúvida:\n\n1 — Salário e benefícios\n2 — Local, horário e escala\n3 — Requisitos da vaga\n4 — Entrevista pelo Google Meet\n0 — Voltar'
    WHEN 'RECRUTADOR_MENU' THEN genesis_chatbot_v1_menu_recrutador()
    WHEN 'AGUARDANDO_NOME' THEN 'Como posso te chamar?'
    WHEN 'AGUARDANDO_EXPERIENCIA' THEN FORMAT(E'Esta vaga exige %s mês(es) de experiência comprovada em carteira. Você possui essa experiência?\n\n1 — Sim\n2 — Não\n3 — Não tenho certeza\n\nMesmo respondendo não, sua CTPS será analisada antes da decisão.',COALESCE(v.experiencia_minima_meses,0))
    WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN FORMAT(E'A vaga fica em %s. Aproximadamente quanto tempo você levaria para chegar?\n\n1 — Até 30 minutos\n2 — De 30 minutos a 1 hora\n3 — De 1 hora a 1 hora e 30 minutos\n4 — Mais de 1 hora e 30 minutos\n5 — Não sei informar',COALESCE(NULLIF(CONCAT_WS(' · ',NULLIF(v.endereco_referencia,''),NULLIF(v.bairro,''),NULLIF(v.cidade,'')),''),'local informado na vaga'))
    WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN FORMAT(E'Considerando o horário de entrada %s, você consegue chegar antes do início do expediente?\n\n1 — Sim\n2 — Não\n3 — Preciso verificar',COALESCE(NULLIF(v.horario,''),'informado na vaga'))
    WHEN 'AGUARDANDO_CEP' THEN E'Para validar a região e encontrar futuras oportunidades próximas, envie seu CEP com 8 números.\n\nExemplo: 04345010'
    WHEN 'AGUARDANDO_CTPS' THEN E'Agora envie sua Carteira de Trabalho Digital completa como Documento PDF.\n\nNo aplicativo CTPS Digital, acesse Contratos, escolha Enviar Carteira de Trabalho, selecione o documento completo e envie aqui como PDF. Fotos e capturas de tela não são aceitas.'
    WHEN 'PROCESSANDO_CTPS' THEN 'Sua CTPS já foi recebida e está em análise. Aguarde a conclusão por aqui.'
    WHEN 'REVISAO_DOCUMENTAL' THEN 'Seu documento está armazenado e aguarda validação da equipe. Não precisa enviá-lo novamente agora.'
    WHEN 'PENDENTE_APROVACAO_RECRUTADOR' THEN 'Sua documentação foi analisada e a candidatura está em validação interna. A continuidade será enviada por aqui.'
    WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'Escolha uma das opções de horário enviadas anteriormente, respondendo com o número correspondente.'
    WHEN 'ENTREVISTA_AGENDADA' THEN 'Sua entrevista pelo Google Meet já está agendada. Os dados e o link foram enviados nesta conversa.'
    WHEN 'PAUSADO_ATENDIMENTO_HUMANO' THEN 'Seu atendimento automático está pausado e a etapa foi preservada. Um recrutador poderá continuar por aqui.'
    ELSE genesis_chatbot_v1_menu_principal()
  END;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_triagem_v13_processar_resposta(
  p_telefone TEXT,p_mensagem TEXT,p_mensagem_id TEXT,p_session TEXT,p_origem TEXT,p_interpretacao JSONB
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; t candidato_triagens%ROWTYPE; p vaga_perguntas%ROWTYPE; ev RECORD;
  resposta TEXT; proxima TEXT; nova_etapa TEXT; nova_status TEXT; msg_nova BOOLEAN:=TRUE; linhas_afetadas INTEGER:=0;
  incrementar_tentativa BOOLEAN:=FALSE;
  confianca NUMERIC:=NULLIF(COALESCE(p_interpretacao->>'confianca',p_interpretacao->>'confidence',''),'')::NUMERIC;
BEGIN
  SELECT c0.* INTO c FROM candidatos c0 WHERE c0.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT * FROM genesis_chatbot_v1_processar_texto(p_telefone,p_mensagem,p_mensagem_id,p_session); RETURN; END IF;
  IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN
    INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,contexto_snapshot,created_at)
    VALUES(c.id,'USUARIO',p_mensagem,p_mensagem_id,JSONB_BUILD_OBJECT('origem',UPPER(COALESCE(p_origem,'TEXTO')),'fluxo','CHATBOT_HIBRIDO_V13'),NOW())
    ON CONFLICT(mensagem_id) DO NOTHING;
    GET DIAGNOSTICS linhas_afetadas=ROW_COUNT;
    msg_nova:=linhas_afetadas>0;
  ELSE INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at) VALUES(c.id,'USUARIO',p_mensagem,JSONB_BUILD_OBJECT('origem',UPPER(COALESCE(p_origem,'TEXTO')),'fluxo','CHATBOT_HIBRIDO_V13'),NOW()); END IF;
  IF NOT msg_nova THEN RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,FALSE; RETURN; END IF;
  PERFORM genesis_triagem_v13_garantir(c.id,c.vaga_id);
  SELECT t0.* INTO t FROM candidato_triagens t0 WHERE t0.candidato_id=c.id AND t0.vaga_id=c.vaga_id ORDER BY t0.iniciado_at DESC,t0.id DESC LIMIT 1 FOR UPDATE;
  SELECT q.* INTO p FROM vaga_perguntas q WHERE q.versao_id=t.versao_id AND q.ativa IS TRUE
    AND NOT EXISTS(SELECT 1 FROM candidato_respostas_triagem r WHERE r.triagem_id=t.id AND r.pergunta_id=q.id)
  ORDER BY q.ordem LIMIT 1;
  IF NOT FOUND THEN
    UPDATE candidato_triagens SET status='CONCLUIDA',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
    nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id); nova_status:=c.status;
    resposta:=genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
  ELSIF genesis_v13_normalizar_texto(p_mensagem) ~ '(FALAR|CHAMAR|ATENDIMENTO).*(HUMANO|PESSOA|RECRUTADOR)|^(HUMANO|ATENDENTE|RECRUTADOR)$' THEN
    UPDATE candidato_revisoes cr SET
      motivo='Candidato solicitou ajuda durante as perguntas da vaga.',
      dados=JSONB_BUILD_OBJECT('etapa','PERGUNTAS_VAGA','pergunta_id',p.id,'mensagem',p_mensagem),
      updated_at=NOW()
    WHERE cr.candidato_id=c.id AND cr.tipo='SUPORTE_FLUXO' AND cr.status='PENDENTE';
    IF NOT FOUND THEN
      INSERT INTO candidato_revisoes(candidato_id,vaga_id,tipo,titulo,motivo,dados)
      VALUES(c.id,c.vaga_id,'SUPORTE_FLUXO','Atendimento humano solicitado',
        'Candidato solicitou ajuda durante as perguntas da vaga.',
        JSONB_BUILD_OBJECT('etapa','PERGUNTAS_VAGA','pergunta_id',p.id,'mensagem',p_mensagem));
    END IF;
    UPDATE candidatos SET atendimento_humano_solicitado=TRUE,revisao_pendente=TRUE,
      revisao_tipo='SUPORTE_FLUXO',revisao_motivo='Atendimento humano solicitado',updated_at=NOW()
    WHERE id=c.id RETURNING * INTO c;
    nova_etapa:='PERGUNTAS_VAGA';nova_status:=c.status;
    resposta:='Certo. Registrei seu pedido de atendimento com um recrutador. Sua pergunta atual foi preservada e a equipe poderá continuar por aqui.';
  ELSE
    SELECT * INTO ev FROM genesis_v13_avaliar_resposta(p.tipo,p.finalidade,p.opcoes,p.regra_operador,p.regra_valor,p.pontos,p_mensagem,p_interpretacao);
    IF p.obrigatoria AND ev.resposta_normalizada IS NULL THEN
      IF COALESCE(c.tentativas_etapa,0)+1 >= 3 THEN
        UPDATE candidato_revisoes cr SET
          motivo='A resposta não pôde ser interpretada com segurança após três tentativas.',
          dados=JSONB_BUILD_OBJECT('etapa','PERGUNTAS_VAGA','pergunta_id',p.id,'mensagem',p_mensagem,'tentativas',COALESCE(c.tentativas_etapa,0)+1),
          updated_at=NOW()
        WHERE cr.candidato_id=c.id AND cr.tipo='SUPORTE_FLUXO' AND cr.status='PENDENTE';
        IF NOT FOUND THEN
          INSERT INTO candidato_revisoes(candidato_id,vaga_id,tipo,titulo,motivo,dados)
          VALUES(c.id,c.vaga_id,'SUPORTE_FLUXO','Pergunta da vaga não concluída',
            'A resposta não pôde ser interpretada com segurança após três tentativas.',
            JSONB_BUILD_OBJECT('etapa','PERGUNTAS_VAGA','pergunta_id',p.id,'mensagem',p_mensagem,'tentativas',COALESCE(c.tentativas_etapa,0)+1));
        END IF;
        UPDATE candidatos SET atendimento_humano_solicitado=TRUE,revisao_pendente=TRUE,
          revisao_tipo='SUPORTE_FLUXO',revisao_motivo='Pergunta da vaga não concluída após três tentativas',updated_at=NOW()
        WHERE id=c.id RETURNING * INTO c;
        nova_etapa:='PAUSADO_ATENDIMENTO_HUMANO';nova_status:='EM_PROCESSO';
        resposta:='Não consegui concluir esta pergunta com segurança. Preservei sua candidatura e encaminhei o atendimento para um recrutador.';
      ELSE
        nova_etapa:='PERGUNTAS_VAGA'; nova_status:=c.status;incrementar_tentativa:=TRUE;
        resposta:=E'Não consegui entender essa resposta com segurança. Pode responder novamente?\n\n'||genesis_triagem_v13_pergunta_atual(c.id,c.vaga_id);
      END IF;
    ELSE
      INSERT INTO candidato_respostas_triagem(triagem_id,candidato_id,vaga_id,pergunta_id,mensagem_id,resposta_bruta,resposta_normalizada,resumo_ia,origem,confianca,atendida,pontos,precisa_revisao)
      VALUES(t.id,c.id,c.vaga_id,p.id,NULLIF(p_mensagem_id,''),p_mensagem,ev.resposta_normalizada,ev.resumo,UPPER(COALESCE(p_origem,'TEXTO')),confianca,ev.atendida,ev.pontos,ev.precisa_revisao)
      ON CONFLICT(triagem_id,pergunta_id) DO NOTHING;
      UPDATE candidato_triagens SET score=score+COALESCE(ev.pontos,0),pergunta_atual_ordem=p.ordem+1,updated_at=NOW() WHERE id=t.id;
      IF p.finalidade='ELIMINATORIA' AND ev.atendida IS FALSE THEN
        UPDATE candidato_triagens SET status='ELIMINADO',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
        UPDATE candidatos SET aprovado=FALSE,etapa='NAO_APTO_NESTA_VAGA',status='EM_PROCESSO',situacao_candidatura='NAO_APTO',
          motivo_reprovacao_codigo='PERGUNTA_ELIMINATORIA',motivo_reprovacao_categoria='REQUISITO',
          motivo_reprovacao_detalhe='Resposta não atendeu a requisito objetivo configurado para a vaga.',reprovacao_realocavel=TRUE,updated_at=NOW()
        WHERE id=c.id RETURNING * INTO c;
        nova_etapa:=c.etapa;nova_status:=c.status;
        resposta:=COALESCE(NULLIF(p.mensagem_nao_atende,''),'Neste momento, sua resposta não atende a um requisito objetivo desta oportunidade.')||E'\n\nSeu cadastro pode continuar disponível para outras vagas compatíveis.\n\n1 — Ver outras vagas\n2 — Encerrar por enquanto';
      ELSE
        proxima:=genesis_triagem_v13_pergunta_atual(c.id,c.vaga_id);
        IF proxima='' THEN
          UPDATE candidato_triagens SET status='CONCLUIDA',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
          nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id); nova_status:=c.status;
          resposta:=E'Obrigada. Concluímos as perguntas desta vaga. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
        ELSE nova_etapa:='PERGUNTAS_VAGA';nova_status:=c.status;resposta:=proxima; END IF;
      END IF;
    END IF;
  END IF;
  UPDATE candidatos c0 SET etapa=nova_etapa,status=COALESCE(nova_status,c0.status),pendencia_atual=CASE WHEN nova_etapa='PERGUNTAS_VAGA' THEN 'PERGUNTAS_VAGA' ELSE nova_etapa END,proxima_acao=nova_etapa,
    tentativas_etapa=CASE WHEN incrementar_tentativa THEN COALESCE(c0.tentativas_etapa,0)+1 ELSE 0 END,updated_at=NOW()
  WHERE c0.id=c.id RETURNING c0.* INTO c;
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,lote_resposta_id,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_HIBRIDO_V13','etapa',c.etapa,'pergunta_id',p.id),
    'v13-'||c.id||'-'||COALESCE(NULLIF(p_mensagem_id,''),MD5(CLOCK_TIMESTAMP()::TEXT)),NOW())
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v13_preparar_interpretacao(
  p_telefone TEXT,p_mensagem TEXT,p_session TEXT,p_origem TEXT DEFAULT 'TEXTO'
)
RETURNS TABLE(telefone TEXT,mensagem TEXT,session TEXT,origem TEXT,etapa TEXT,pergunta_id BIGINT,
  mensagem_canonica TEXT,precisa_ia BOOLEAN,contexto TEXT)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; dc genesis_demo_contatos%ROWTYPE; d genesis_demos%ROWTYPE;
  q vaga_perguntas%ROWTYPE; dq genesis_demo_perguntas%ROWTYPE; n TEXT:=genesis_v13_normalizar_texto(p_mensagem);
  canon TEXT; precisa BOOLEAN:=FALSE; ctx TEXT:=''; idx INTEGER; sn TEXT;
BEGIN
  telefone:=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g');mensagem:=COALESCE(p_mensagem,'');session:=COALESCE(NULLIF(p_session,''),'whats_junior');origem:=UPPER(COALESCE(p_origem,'TEXTO'));
  IF n ~ '(FALAR|CHAMAR|ATENDIMENTO).*(HUMANO|PESSOA|RECRUTADOR)|^(HUMANO|ATENDENTE|RECRUTADOR)$' THEN canon:='7'; END IF;
  SELECT * INTO d FROM genesis_demos WHERE session_name=session LIMIT 1;
  IF FOUND THEN
    SELECT * INTO dc FROM genesis_demo_contatos WHERE demo_id=d.id AND genesis_demo_contatos.telefone=genesis_chatbot_v13_preparar_interpretacao.telefone LIMIT 1;
    etapa:=COALESCE(dc.etapa,'AGUARDANDO_INICIO');
    IF etapa='PERGUNTAS_VAGA' THEN
      SELECT x.* INTO dq FROM genesis_demo_perguntas x WHERE x.demo_id=d.id AND NOT EXISTS(SELECT 1 FROM genesis_demo_respostas r WHERE r.contato_id=dc.id AND r.pergunta_id=x.id) ORDER BY x.ordem LIMIT 1;
      pergunta_id:=NULL;ctx:=COALESCE(dq.texto,'')||' Opções: '||COALESCE(dq.opcoes::TEXT,'[]');
      IF dq.tipo='SIM_NAO' THEN sn:=genesis_v13_sim_nao(p_mensagem);canon:=COALESCE(canon,CASE sn WHEN 'SIM' THEN '1' WHEN 'NAO' THEN '2' ELSE NULL END);
      ELSIF dq.tipo='UNICA_ESCOLHA' THEN idx:=genesis_v13_indice_opcao(p_mensagem,dq.opcoes);canon:=COALESCE(canon,idx::TEXT);
      ELSIF dq.tipo='MULTIPLA_ESCOLHA' THEN canon:=COALESCE(canon,genesis_v13_multiplas_opcoes(p_mensagem,dq.opcoes));
      ELSIF dq.tipo='NUMERO' AND BTRIM(COALESCE(p_mensagem,'')) ~ '^-?[0-9]+([.,][0-9]+)?$' THEN canon:=COALESCE(canon,BTRIM(p_mensagem)); END IF;
      precisa:=dq.tipo IN ('TEXTO_CURTO','TEXTO_LONGO') OR canon IS NULL;
    ELSIF etapa='AGUARDANDO_NOME' THEN canon:=p_mensagem;
    ELSE canon:=COALESCE(canon,p_mensagem); END IF;
    mensagem_canonica:=canon;precisa_ia:=precisa;contexto:=FORMAT('Demonstração. Etapa: %s. %s',etapa,ctx);RETURN NEXT;RETURN;
  END IF;

  SELECT * INTO c FROM candidatos WHERE candidatos.telefone=genesis_chatbot_v13_preparar_interpretacao.telefone LIMIT 1;
  etapa:=COALESCE(c.etapa,'AGUARDANDO_INTENCAO');
  IF canon IS NULL THEN
    CASE etapa
      WHEN 'AGUARDANDO_INTENCAO' THEN
        IF n ~ '(VAGA|EMPREGO|TRABALHO|CANDIDAT)' THEN canon:='1'; ELSIF n ~ '(DUVIDA|PERGUNTA|AJUDA)' THEN canon:='2'; ELSIF n ~ '(CONTINUAR|RETOMAR)' THEN canon:='3'; ELSIF n ~ '(RECRUTADOR|EMPRESA|CONTRATAR)' THEN canon:='4'; END IF;
      WHEN 'AGUARDANDO_ACAO_VAGA' THEN
        IF genesis_v13_sim_nao(p_mensagem)='SIM' OR n ~ '(SEGUIR|CANDIDAT|TENHO INTERESSE|QUERO)' THEN canon:='1'; ELSIF n ~ '(DUVIDA|PERGUNTA)' THEN canon:='2'; ELSIF n ~ '(OUTRA|VOLTAR|VER VAGA)' THEN canon:='3'; END IF;
      WHEN 'AGUARDANDO_EXPERIENCIA' THEN sn:=genesis_v13_sim_nao(p_mensagem);canon:=CASE sn WHEN 'SIM' THEN '1' WHEN 'NAO' THEN '2' WHEN 'INCERTO' THEN '3' END;
      WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN sn:=genesis_v13_sim_nao(p_mensagem);canon:=CASE sn WHEN 'SIM' THEN '1' WHEN 'NAO' THEN '2' WHEN 'INCERTO' THEN '3' END;
      WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN
        IF n ~ '(NAO SEI|INCERTO)' THEN canon:='5'; ELSIF n ~ '([0-2][0-9]|30) MIN' THEN canon:='1'; ELSIF n ~ '(3[1-9]|[4-5][0-9]|60) MIN|1 HORA$' THEN canon:='2'; ELSIF n ~ '(6[1-9]|[7-8][0-9]|90) MIN|1 HORA.*(MEIA|30)' THEN canon:='3'; ELSIF n ~ '([2-9]) HORA|MAIS.*90' THEN canon:='4'; END IF;
      WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN
        IF n ~ '(PRIMEIR|1)' THEN canon:='1'; ELSIF n ~ '(SEGUND|2)' THEN canon:='2'; ELSIF n ~ '(TERCEIR|3)' THEN canon:='3'; END IF;
      ELSE NULL;
    END CASE;
  END IF;
  IF etapa='PERGUNTAS_VAGA' THEN
    SELECT p.* INTO q FROM candidato_triagens t JOIN vaga_perguntas p ON p.versao_id=t.versao_id
    WHERE t.candidato_id=c.id AND t.vaga_id=c.vaga_id AND t.status='EM_ANDAMENTO' AND p.ativa IS TRUE
      AND NOT EXISTS(SELECT 1 FROM candidato_respostas_triagem r WHERE r.triagem_id=t.id AND r.pergunta_id=p.id)
    ORDER BY p.ordem LIMIT 1;
    pergunta_id:=q.id;ctx:=COALESCE(q.texto,'')||' Opções: '||COALESCE(q.opcoes::TEXT,'[]');
    IF q.tipo='SIM_NAO' THEN sn:=genesis_v13_sim_nao(p_mensagem);canon:=COALESCE(canon,CASE sn WHEN 'SIM' THEN '1' WHEN 'NAO' THEN '2' ELSE NULL END);
    ELSIF q.tipo='UNICA_ESCOLHA' THEN idx:=genesis_v13_indice_opcao(p_mensagem,q.opcoes);canon:=COALESCE(canon,idx::TEXT);
    ELSIF q.tipo='MULTIPLA_ESCOLHA' THEN canon:=COALESCE(canon,genesis_v13_multiplas_opcoes(p_mensagem,q.opcoes));
    ELSIF q.tipo='NUMERO' AND BTRIM(COALESCE(p_mensagem,'')) ~ '^-?[0-9]+([.,][0-9]+)?$' THEN canon:=COALESCE(canon,BTRIM(p_mensagem)); END IF;
    precisa:=q.tipo IN ('TEXTO_CURTO','TEXTO_LONGO') OR canon IS NULL;
  ELSIF etapa IN ('AGUARDANDO_NOME','AGUARDANDO_CEP','AGUARDANDO_CTPS','PROCESSANDO_CTPS','REVISAO_DOCUMENTAL') THEN precisa:=FALSE;
  ELSE precisa:=canon IS NULL AND etapa IN ('AGUARDANDO_INTENCAO','RECRUTADOR_MENU','DUVIDAS_GERAIS','DUVIDAS_VAGA','ESCOLHENDO_VAGA','AGUARDANDO_ACAO_VAGA','AGUARDANDO_EXPERIENCIA','AGUARDANDO_TEMPO_DESLOCAMENTO','AGUARDANDO_CONFIRMACAO_CHEGADA','AGUARDANDO_ESCOLHA_HORARIO'); END IF;
  mensagem_canonica:=COALESCE(canon,p_mensagem);precisa_ia:=precisa;
  contexto:=FORMAT('Etapa atual: %s. Pergunta: %s. Interprete apenas entre as opções exibidas; não tome decisões.',etapa,COALESCE(ctx,genesis_chatbot_v1_pergunta_atual(etapa,c.vaga_id)));
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v13_processar_texto(
  p_telefone TEXT,p_mensagem TEXT,p_mensagem_id TEXT,p_session TEXT DEFAULT 'whats_junior',p_origem TEXT DEFAULT 'TEXTO',p_interpretacao JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE prep RECORD; r RECORD; c candidatos%ROWTYPE; canon TEXT; conf NUMERIC; dados JSONB:=COALESCE(p_interpretacao,'{}'::JSONB);
BEGIN
  IF EXISTS(SELECT 1 FROM genesis_demos d WHERE d.session_name=p_session) THEN
    RETURN QUERY SELECT * FROM genesis_demo_v13_processar_texto(p_session,p_telefone,p_mensagem,p_mensagem_id,p_origem,dados);RETURN;
  END IF;
  SELECT * INTO prep FROM genesis_chatbot_v13_preparar_interpretacao(p_telefone,p_mensagem,p_session,p_origem);
  conf:=NULLIF(COALESCE(dados->>'confianca',dados->>'confidence',''),'')::NUMERIC;
  canon:=prep.mensagem_canonica;
  IF conf IS NOT NULL AND conf>=0.82 AND NULLIF(BTRIM(COALESCE(dados->>'resposta_canonica',dados->>'canonical','')),'') IS NOT NULL THEN canon:=COALESCE(dados->>'resposta_canonica',dados->>'canonical'); END IF;
  SELECT * INTO c FROM candidatos WHERE candidatos.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') LIMIT 1;
  IF c.etapa='PERGUNTAS_VAGA' THEN
    FOR r IN SELECT * FROM genesis_triagem_v13_processar_resposta(p_telefone,p_mensagem,p_mensagem_id,p_session,p_origem,dados||JSONB_BUILD_OBJECT('resposta_canonica',canon)) LOOP
      candidato_id:=r.candidato_id;telefone:=r.telefone;session:=r.session;mensagem_whatsapp:=r.mensagem_whatsapp;action:=r.action;opcao_numero:=r.opcao_numero;etapa:=r.etapa;status:=r.status;deve_enviar:=r.deve_enviar;RETURN NEXT;
    END LOOP;
  ELSE
    FOR r IN SELECT * FROM genesis_chatbot_v1_processar_texto(p_telefone,COALESCE(canon,p_mensagem),p_mensagem_id,p_session) LOOP
      IF r.etapa='PERGUNTAS_VAGA' THEN
        r.mensagem_whatsapp:=genesis_triagem_v13_pergunta_atual(r.candidato_id,(SELECT vaga_id FROM candidatos WHERE id=r.candidato_id));
        IF NULLIF(BTRIM(COALESCE(r.mensagem_whatsapp,'')),'') IS NOT NULL THEN
          UPDATE mensagens m0 SET mensagem=r.mensagem_whatsapp,contexto_snapshot=COALESCE(m0.contexto_snapshot,'{}'::JSONB)||JSONB_BUILD_OBJECT('fluxo','CHATBOT_HIBRIDO_V13','etapa','PERGUNTAS_VAGA')
          WHERE m0.id=(SELECT m.id FROM mensagens m WHERE m.candidato_id=r.candidato_id AND m.quem='IA' ORDER BY m.created_at DESC,m.id DESC LIMIT 1);
        END IF;
      END IF;
      IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN UPDATE mensagens SET mensagem=p_mensagem,contexto_snapshot=COALESCE(contexto_snapshot,'{}'::JSONB)||JSONB_BUILD_OBJECT('origem',UPPER(COALESCE(p_origem,'TEXTO')),'entrada_canonica',canon,'fluxo','CHATBOT_HIBRIDO_V13') WHERE mensagem_id=p_mensagem_id; END IF;
      candidato_id:=r.candidato_id;telefone:=r.telefone;session:=r.session;mensagem_whatsapp:=r.mensagem_whatsapp;action:=r.action;opcao_numero:=r.opcao_numero;etapa:=r.etapa;status:=r.status;deve_enviar:=r.deve_enviar;RETURN NEXT;
    END LOOP;
  END IF;
  SELECT * INTO c FROM candidatos WHERE candidatos.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') LIMIT 1;
  INSERT INTO genesis_chatbot_interpretacoes(candidato_id,telefone,session,mensagem_id,origem,etapa,pergunta_id,entrada_original,entrada_canonica,intencao,confianca,dados)
  VALUES(c.id,REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),p_session,NULLIF(p_mensagem_id,''),UPPER(COALESCE(p_origem,'TEXTO')),prep.etapa,prep.pergunta_id,p_mensagem,canon,COALESCE(dados->>'intencao',dados->>'intent'),conf,dados)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v13_midia_nao_suportada(
  p_telefone TEXT,p_mensagem_id TEXT,p_tipo TEXT,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE d genesis_demos%ROWTYPE; c genesis_demo_contatos%ROWTYPE; candidato_real candidatos%ROWTYPE; resposta TEXT; linhas_afetadas INTEGER:=0;
BEGIN
  SELECT * INTO d FROM genesis_demos WHERE session_name=p_session LIMIT 1;
  IF FOUND THEN
    INSERT INTO genesis_demo_contatos(demo_id,telefone) VALUES(d.id,REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g')) ON CONFLICT ON CONSTRAINT genesis_demo_contatos_unico DO NOTHING;
    SELECT * INTO c FROM genesis_demo_contatos WHERE demo_id=d.id AND genesis_demo_contatos.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g');
    IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN
      INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,mensagem_id,origem)
      VALUES(d.id,c.id,'USUARIO','[MÍDIA NÃO SUPORTADA: '||COALESCE(p_tipo,'ARQUIVO')||']',p_mensagem_id,UPPER(COALESCE(p_tipo,'ARQUIVO')))
      ON CONFLICT(demo_id,mensagem_id) WHERE mensagem_id IS NOT NULL AND BTRIM(mensagem_id)<>'' DO NOTHING;
      GET DIAGNOSTICS linhas_afetadas=ROW_COUNT;
      IF linhas_afetadas=0 THEN
        RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,FALSE;
        RETURN;
      END IF;
    ELSE
      INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,origem)
      VALUES(d.id,c.id,'USUARIO','[MÍDIA NÃO SUPORTADA: '||COALESCE(p_tipo,'ARQUIVO')||']',UPPER(COALESCE(p_tipo,'ARQUIVO')));
    END IF;
    resposta:='Nesta demonstração, responda por texto ou áudio. No processo completo, CTPS e currículo são aceitos somente como Documento PDF; fotos e capturas de tela não são processadas.';
    INSERT INTO genesis_demo_mensagens(demo_id,contato_id,quem,mensagem,origem)
    VALUES(d.id,c.id,'IA',resposta,'TEXTO');
    RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;RETURN;
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN
    SELECT c0.* INTO candidato_real FROM candidatos c0
    WHERE c0.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g')
    LIMIT 1;
    IF FOUND AND EXISTS(SELECT 1 FROM mensagens m WHERE m.candidato_id=candidato_real.id AND m.mensagem_id=p_mensagem_id) THEN
      RETURN QUERY SELECT candidato_real.id,candidato_real.telefone::TEXT,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,candidato_real.etapa::TEXT,candidato_real.status::TEXT,FALSE;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM genesis_chatbot_v1_midia_nao_suportada(p_telefone,p_mensagem_id,p_tipo,p_session);
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v13_buffer_registrar(
  p_telefone TEXT,p_mensagem TEXT,p_mensagem_id TEXT,p_session TEXT DEFAULT 'whats_junior',p_origem TEXT DEFAULT 'TEXTO'
)
RETURNS TABLE(telefone TEXT,mensagem TEXT,mensagem_id TEXT,session TEXT,origem TEXT,buffer_token TEXT)
LANGUAGE plpgsql
AS $$
DECLARE v_telefone TEXT:=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g');v_session TEXT:=COALESCE(NULLIF(p_session,''),'whats_junior');v_token TEXT:=MD5(CLOCK_TIMESTAMP()::TEXT||RANDOM()::TEXT||COALESCE(p_mensagem_id,'')||v_telefone||v_session);
BEGIN
  INSERT INTO genesis_chatbot_entrada_buffer(telefone,mensagem,mensagem_id,session,origem,token,updated_at)
  VALUES(v_telefone,COALESCE(p_mensagem,''),NULLIF(p_mensagem_id,''),v_session,UPPER(COALESCE(p_origem,'TEXTO')),v_token,NOW())
  ON CONFLICT ON CONSTRAINT genesis_chatbot_entrada_buffer_pkey_v13 DO UPDATE SET mensagem=EXCLUDED.mensagem,mensagem_id=EXCLUDED.mensagem_id,origem=EXCLUDED.origem,token=EXCLUDED.token,updated_at=NOW();
  RETURN QUERY SELECT v_telefone,COALESCE(p_mensagem,''),NULLIF(p_mensagem_id,''),v_session,UPPER(COALESCE(p_origem,'TEXTO')),v_token;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v13_buffer_consumir(p_telefone TEXT,p_session TEXT,p_token TEXT)
RETURNS TABLE(telefone TEXT,mensagem TEXT,mensagem_id TEXT,session TEXT,origem TEXT,processar BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY WITH consumida AS (
    DELETE FROM genesis_chatbot_entrada_buffer b
    WHERE b.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') AND b.session=COALESCE(NULLIF(p_session,''),'whats_junior') AND b.token=COALESCE(p_token,'')
    RETURNING b.telefone,b.mensagem,b.mensagem_id,b.session,b.origem
  ) SELECT c.telefone,c.mensagem,c.mensagem_id,c.session,c.origem,TRUE FROM consumida c
  UNION ALL SELECT REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),''::TEXT,NULL::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),'TEXTO'::TEXT,FALSE
  WHERE NOT EXISTS(SELECT 1 FROM consumida);
END;
$$;

COMMIT;

SELECT
  TO_REGCLASS('public.vaga_perguntas') AS vaga_perguntas,
  TO_REGCLASS('public.candidato_triagens') AS candidato_triagens,
  TO_REGCLASS('public.genesis_demos') AS genesis_demos,
  TO_REGPROCEDURE('public.genesis_chatbot_v13_processar_texto(text,text,text,text,text,jsonb)') AS processador_v13;
