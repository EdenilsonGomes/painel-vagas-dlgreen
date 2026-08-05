BEGIN;

-- ============================================================
-- GENESIS IA — CHATBOT ESTÁTICO V1
-- Máquina de estados determinística, revisão humana de exceções,
-- resgate operacional e armazenamento seguro de documentos.
-- Execute após as migrações da V9.3.
-- ============================================================

ALTER TABLE vagas
  ADD COLUMN IF NOT EXISTS experiencia_revisao_minima_meses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS permitir_experiencia_informal_revisao BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chatbot_estatico_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS entrevista_dias_semana SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS entrevista_horarios JSONB NOT NULL DEFAULT '["09:00","10:00","14:00","15:00"]'::JSONB,
  ADD COLUMN IF NOT EXISTS entrevista_duracao_minutos INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS entrevista_busca_dias INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS entrevista_evitar_feriados BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vagas_experiencia_revisao_nao_negativa'
      AND conrelid = 'vagas'::regclass
  ) THEN
    ALTER TABLE vagas ADD CONSTRAINT vagas_experiencia_revisao_nao_negativa
      CHECK (experiencia_revisao_minima_meses >= 0);
  END IF;
END;
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vagas_experiencia_revisao_ate_exigida'
      AND conrelid = 'vagas'::regclass
  ) THEN
    ALTER TABLE vagas ADD CONSTRAINT vagas_experiencia_revisao_ate_exigida
      CHECK (experiencia_revisao_minima_meses <= experiencia_minima_meses);
  END IF;
END;
$$;

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS fluxo_versao VARCHAR(60),
  ADD COLUMN IF NOT EXISTS pendencia_atual VARCHAR(80),
  ADD COLUMN IF NOT EXISTS proxima_acao VARCHAR(100),
  ADD COLUMN IF NOT EXISTS etapa_anterior VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tentativas_etapa INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS perfil_contato VARCHAR(20) NOT NULL DEFAULT 'CANDIDATO',
  ADD COLUMN IF NOT EXISTS experiencia_declarada VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deslocamento_faixa VARCHAR(40),
  ADD COLUMN IF NOT EXISTS deslocamento_chegada VARCHAR(20),
  ADD COLUMN IF NOT EXISTS situacao_candidatura VARCHAR(40) NOT NULL DEFAULT 'EM_PROCESSO',
  ADD COLUMN IF NOT EXISTS revisao_pendente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revisao_tipo VARCHAR(50),
  ADD COLUMN IF NOT EXISTS revisao_motivo TEXT,
  ADD COLUMN IF NOT EXISTS ultima_pergunta_codigo VARCHAR(80),
  ADD COLUMN IF NOT EXISTS atendimento_humano_solicitado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maior_experiencia_compativel_dias INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maior_experiencia_compativel_texto TEXT;

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS classificacao_confianca VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_perfil_contato_valido'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_perfil_contato_valido
      CHECK (perfil_contato IN ('CANDIDATO','RECRUTADOR'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidatos_experiencia_declarada_valida'
      AND conrelid = 'candidatos'::regclass
  ) THEN
    ALTER TABLE candidatos ADD CONSTRAINT candidatos_experiencia_declarada_valida
      CHECK (experiencia_declarada IS NULL OR experiencia_declarada IN ('SIM','NAO','INCERTO'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS candidato_revisoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  vaga_id BIGINT REFERENCES vagas(id) ON DELETE SET NULL,
  documento_id BIGINT REFERENCES documentos(id) ON DELETE SET NULL,
  tipo VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  titulo VARCHAR(180) NOT NULL,
  motivo TEXT,
  experiencia_exigida_meses INTEGER,
  experiencia_comprovada_dias INTEGER,
  dados JSONB NOT NULL DEFAULT '{}'::JSONB,
  decisao VARCHAR(40),
  decisao_motivo TEXT,
  decidido_por TEXT,
  decidido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidato_revisoes_tipo_valido CHECK (tipo IN (
    'EXCECAO_EXPERIENCIA','REVISAO_DOCUMENTAL','SUPORTE_FLUXO','DIVERGENCIA_DADOS'
  )),
  CONSTRAINT candidato_revisoes_status_valido CHECK (status IN (
    'PENDENTE','APROVADO','NAO_APROVADO','REPROCESSAR','SOLICITAR_NOVO_PDF','CANCELADO','CONCLUIDO'
  ))
);

CREATE INDEX IF NOT EXISTS idx_candidato_revisoes_pendentes
  ON candidato_revisoes (status, created_at DESC)
  WHERE status = 'PENDENTE';
CREATE INDEX IF NOT EXISTS idx_candidato_revisoes_candidato
  ON candidato_revisoes (candidato_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidato_revisao_pendente_tipo
  ON candidato_revisoes (candidato_id, tipo)
  WHERE status = 'PENDENTE';

CREATE TABLE IF NOT EXISTS candidato_resgates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  auditoria_problema_id BIGINT REFERENCES auditoria_problemas(id) ON DELETE SET NULL,
  origem VARCHAR(40) NOT NULL DEFAULT 'PAINEL',
  motivo TEXT,
  acao_sugerida VARCHAR(80),
  mensagem_sugerida TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'SOLICITADO',
  solicitado_por TEXT,
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em TIMESTAMPTZ,
  resultado JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT candidato_resgates_status_valido CHECK (status IN (
    'SOLICITADO','EM_ANALISE','PRONTO','ENVIADO','RESPONDIDO','CONCLUIDO','CANCELADO','ERRO'
  ))
);

CREATE INDEX IF NOT EXISTS idx_candidato_resgates_status
  ON candidato_resgates (status, solicitado_em DESC);
CREATE INDEX IF NOT EXISTS idx_candidato_resgates_candidato
  ON candidato_resgates (candidato_id, solicitado_em DESC);

CREATE TABLE IF NOT EXISTS genesis_leads_recrutadores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telefone TEXT NOT NULL,
  interesse VARCHAR(50) NOT NULL,
  origem VARCHAR(30) NOT NULL DEFAULT 'CHATBOT',
  status VARCHAR(30) NOT NULL DEFAULT 'NOVO',
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genesis_leads_recrutadores_interesse_valido CHECK (interesse IN (
    'DIVULGAR_VAGAS','IMPLEMENTAR_IA'
  ))
);

CREATE INDEX IF NOT EXISTS idx_genesis_leads_recrutadores_status
  ON genesis_leads_recrutadores (status, created_at DESC);

CREATE TABLE IF NOT EXISTS genesis_chatbot_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  portal_url TEXT,
  comercial_url TEXT,
  limite_tentativas INTEGER NOT NULL DEFAULT 3,
  nome_assistente VARCHAR(60) NOT NULL DEFAULT 'Evelyn',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS genesis_chatbot_entrada_buffer (
  telefone TEXT PRIMARY KEY,
  mensagem TEXT NOT NULL,
  mensagem_id TEXT,
  session TEXT NOT NULL DEFAULT 'whats_junior',
  token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO genesis_chatbot_config (id, portal_url, comercial_url, limite_tentativas)
VALUES (1, 'https://projeto-genesis-portal.d7lmap.easypanel.host', NULL, 3)
ON CONFLICT (id) DO NOTHING;

-- Debounce determinístico: somente a última mensagem de uma sequência curta
-- continua no fluxo. Não usa IA e evita múltiplas respostas a mensagens fragmentadas.
CREATE OR REPLACE FUNCTION genesis_chatbot_v1_buffer_registrar(
  p_telefone TEXT,p_mensagem TEXT,p_mensagem_id TEXT,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(telefone TEXT,mensagem TEXT,mensagem_id TEXT,session TEXT,buffer_token TEXT)
LANGUAGE plpgsql
AS $$
DECLARE v_telefone TEXT:=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g');
  v_token TEXT:=MD5(CLOCK_TIMESTAMP()::TEXT||RANDOM()::TEXT||COALESCE(p_mensagem_id,'')||v_telefone);
BEGIN
  INSERT INTO genesis_chatbot_entrada_buffer(telefone,mensagem,mensagem_id,session,token,updated_at)
  VALUES(v_telefone,COALESCE(p_mensagem,''),NULLIF(p_mensagem_id,''),COALESCE(NULLIF(p_session,''),'whats_junior'),v_token,NOW())
  ON CONFLICT(telefone) DO UPDATE SET mensagem=EXCLUDED.mensagem,mensagem_id=EXCLUDED.mensagem_id,
    session=EXCLUDED.session,token=EXCLUDED.token,updated_at=NOW();
  RETURN QUERY SELECT v_telefone,COALESCE(p_mensagem,''),NULLIF(p_mensagem_id,''),COALESCE(NULLIF(p_session,''),'whats_junior'),v_token;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_buffer_consumir(p_telefone TEXT,p_token TEXT)
RETURNS TABLE(telefone TEXT,mensagem TEXT,mensagem_id TEXT,session TEXT,processar BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH consumida AS (
    DELETE FROM genesis_chatbot_entrada_buffer b
    WHERE b.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g')
      AND b.token=COALESCE(p_token,'')
    RETURNING b.telefone,b.mensagem,b.mensagem_id,b.session
  )
  SELECT c.telefone,c.mensagem,c.mensagem_id,c.session,TRUE FROM consumida c
  UNION ALL
  SELECT REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),''::TEXT,NULL::TEXT,'whats_junior'::TEXT,FALSE
  WHERE NOT EXISTS(SELECT 1 FROM consumida);
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_menu_principal()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT 'Olá! Sou a Evelyn, inteligência artificial de recrutamento da Gênesis IA. 🤖\n\nVou conduzir o atendimento por etapas. Para o processo funcionar corretamente, responda usando as opções indicadas.\n\n1 — Ver vagas disponíveis\n2 — Tirar uma dúvida\n3 — Continuar uma candidatura\n4 — Sou recrutador';
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_menu_recrutador()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT 'Como a Gênesis IA pode ajudar?\n\n1 — Gostaria de divulgar vagas no portal e nos grupos\n2 — Quero implementar IA na minha empresa\n0 — Voltar ao menu inicial';
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_menu_duvidas_gerais()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT 'Sobre qual assunto você tem dúvida?\n\n1 — Como ver as vagas disponíveis\n2 — Como enviar a CTPS Digital\n3 — Como funciona a entrevista pelo Google Meet\n4 — Falar com um recrutador\n0 — Voltar ao menu inicial';
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_listar_vagas()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lista TEXT;
  portal TEXT;
BEGIN
  SELECT STRING_AGG(FORMAT('%s — %s — %s', numero, titulo, localidade), E'\n' ORDER BY numero)
  INTO lista
  FROM (
    SELECT ROW_NUMBER() OVER (ORDER BY COALESCE(v.destaque_portal,FALSE) DESC, v.updated_at DESC, v.id DESC) AS numero,
      v.titulo,
      COALESCE(NULLIF(v.bairro,''), NULLIF(v.cidade,''), 'Local a confirmar') AS localidade
    FROM vagas v
    JOIN empresas e ON e.id=v.empresa_id
    WHERE v.status='ATIVA' AND e.ativo IS TRUE
      AND COALESCE(v.atendimento_chatbot,TRUE) IS TRUE
      AND COALESCE(v.chatbot_estatico_ativo,TRUE) IS TRUE
    ORDER BY COALESCE(v.destaque_portal,FALSE) DESC, v.updated_at DESC, v.id DESC
    LIMIT 5
  ) x;
  SELECT portal_url INTO portal FROM genesis_chatbot_config WHERE id=1;
  RETURN 'Vagas disponíveis:\n\n' || COALESCE(lista,'Nenhuma vaga ativa no momento.')
    || E'\n\nResponda com o número da vaga para ver os detalhes.'
    || CASE WHEN NULLIF(BTRIM(COALESCE(portal,'')),'') IS NOT NULL
      THEN E'\n\nVeja todas as oportunidades no portal:\n' || portal ELSE '' END;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_detalhes_vaga(p_vaga_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v RECORD;
  beneficios_texto TEXT;
BEGIN
  SELECT v.*, COALESCE(e.nome_publico,e.nome) AS empresa_nome
  INTO v FROM vagas v JOIN empresas e ON e.id=v.empresa_id WHERE v.id=p_vaga_id;
  IF NOT FOUND THEN RETURN 'Não localizei essa vaga. Digite 0 para voltar.'; END IF;
  beneficios_texto := COALESCE(NULLIF(BTRIM(v.beneficios),''), NULLIF(BTRIM(v.beneficios_observacao),''), 'Consulte os benefícios na entrevista.');
  RETURN FORMAT(
    '%s\n\n🏢 %s\n📍 %s\n🕐 %s\n💰 %s\n🎁 %s\n\nDeseja seguir com a candidatura ou consultar uma dúvida?\n\n1 — Seguir com o processo\n2 — Tenho uma dúvida sobre esta vaga\n3 — Ver outra vaga\n\nOutras dúvidas também poderão ser esclarecidas com o recrutador durante a entrevista.',
    v.titulo,
    v.empresa_nome,
    COALESCE(NULLIF(CONCAT_WS(' · ',NULLIF(v.endereco_referencia,''),NULLIF(v.bairro,''),NULLIF(v.cidade,''),NULLIF(v.estado,'')),''),'Local a confirmar'),
    COALESCE(NULLIF(CONCAT_WS(' · ',NULLIF(v.escala,''),NULLIF(v.horario,'')),''),'Horário a confirmar'),
    CASE WHEN v.salario IS NULL THEN 'Salário a confirmar' ELSE TO_CHAR(v.salario,'FM999G999G990D00') END,
    beneficios_texto
  );
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_pergunta_atual(p_etapa TEXT, p_vaga_id BIGINT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE v RECORD;
BEGIN
  SELECT * INTO v FROM vagas WHERE id=p_vaga_id;
  RETURN CASE p_etapa
    WHEN 'AGUARDANDO_INTENCAO' THEN genesis_chatbot_v1_menu_principal()
    WHEN 'ESCOLHENDO_VAGA' THEN genesis_chatbot_v1_listar_vagas()
    WHEN 'AGUARDANDO_ACAO_VAGA' THEN 'Responda: 1 para seguir com a candidatura, 2 para tirar uma dúvida sobre a vaga ou 3 para ver outra vaga.'
    WHEN 'DUVIDAS_GERAIS' THEN genesis_chatbot_v1_menu_duvidas_gerais()
    WHEN 'DUVIDAS_VAGA' THEN 'Escolha uma dúvida:\n\n1 — Salário e benefícios\n2 — Local, horário e escala\n3 — Requisitos da vaga\n4 — Entrevista pelo Google Meet\n0 — Voltar'
    WHEN 'RECRUTADOR_MENU' THEN genesis_chatbot_v1_menu_recrutador()
    WHEN 'AGUARDANDO_NOME' THEN 'Como posso te chamar?'
    WHEN 'AGUARDANDO_EXPERIENCIA' THEN FORMAT('Esta vaga exige %s mês(es) de experiência comprovada em carteira. Você possui essa experiência?\n\n1 — Sim\n2 — Não\n3 — Não tenho certeza\n\nMesmo respondendo não, sua CTPS será analisada antes da decisão.', COALESCE(v.experiencia_minima_meses,0))
    WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN FORMAT('A vaga fica em %s. Aproximadamente quanto tempo você levaria para chegar?\n\n1 — Até 30 minutos\n2 — De 30 minutos a 1 hora\n3 — De 1 hora a 1 hora e 30 minutos\n4 — Mais de 1 hora e 30 minutos\n5 — Não sei informar', COALESCE(NULLIF(CONCAT_WS(' · ',NULLIF(v.endereco_referencia,''),NULLIF(v.bairro,''),NULLIF(v.cidade,'')),''),'local informado na vaga'))
    WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN FORMAT('Considerando o horário de entrada %s, você consegue chegar antes do início do expediente?\n\n1 — Sim\n2 — Não\n3 — Preciso verificar', COALESCE(NULLIF(v.horario,''),'informado na vaga'))
    WHEN 'AGUARDANDO_CEP' THEN 'Para validar a região e encontrar futuras oportunidades próximas, envie seu CEP com 8 números.\n\nExemplo: 04345010'
    WHEN 'AGUARDANDO_CTPS' THEN 'Agora envie sua Carteira de Trabalho Digital completa como Documento PDF.\n\nNo aplicativo CTPS Digital, acesse Contratos, escolha Enviar Carteira de Trabalho, selecione o documento completo e envie aqui como PDF. Não envie apenas captura de tela.'
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

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_etapa_retomada(p_candidato_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  c candidatos%ROWTYPE;
  v vagas%ROWTYPE;
  doc RECORD;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_INTENCAO'; END IF;

  IF EXISTS (SELECT 1 FROM entrevistas e WHERE e.candidato_id=c.id AND UPPER(COALESCE(e.status,''))='AGENDADA') THEN
    RETURN 'ENTREVISTA_AGENDADA';
  END IF;
  IF c.revisao_pendente IS TRUE THEN
    IF c.revisao_tipo='EXCECAO_EXPERIENCIA' THEN RETURN 'PENDENTE_APROVACAO_RECRUTADOR'; END IF;
    RETURN 'REVISAO_DOCUMENTAL';
  END IF;
  IF c.vaga_id IS NULL THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  SELECT * INTO v FROM vagas WHERE id=c.vaga_id;
  IF NOT FOUND OR v.status<>'ATIVA' THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  IF NULLIF(BTRIM(COALESCE(c.nome,'')),'') IS NULL THEN RETURN 'AGUARDANDO_NOME'; END IF;
  IF COALESCE(v.experiencia_minima_meses,0)>0 AND c.experiencia_declarada IS NULL THEN RETURN 'AGUARDANDO_EXPERIENCIA'; END IF;
  IF c.deslocamento_faixa IS NULL THEN RETURN 'AGUARDANDO_TEMPO_DESLOCAMENTO'; END IF;
  IF c.deslocamento_chegada IS NULL THEN RETURN 'AGUARDANDO_CONFIRMACAO_CHEGADA'; END IF;
  IF REGEXP_REPLACE(COALESCE(c.cep,''),'\D','','g') !~ '^\d{8}$' THEN RETURN 'AGUARDANDO_CEP'; END IF;

  SELECT d.id,d.tipo,d.status_processamento INTO doc
  FROM documentos d
  WHERE d.candidato_id=c.id
    AND (UPPER(COALESCE(d.tipo,''))='CTPS' OR UPPER(COALESCE(d.titulo,'')) LIKE '%CTPS%')
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_CTPS'; END IF;
  IF UPPER(COALESCE(doc.status_processamento,'')) IN ('RECEBIDO','ARMAZENADO','PROCESSANDO','REPROCESSAMENTO_SOLICITADO') THEN RETURN 'PROCESSANDO_CTPS'; END IF;
  IF UPPER(COALESCE(doc.status_processamento,'')) IN ('REVISAO','INCONCLUSIVO','ERRO_PROCESSAMENTO') THEN RETURN 'REVISAO_DOCUMENTAL'; END IF;
  IF c.aprovado IS TRUE OR UPPER(COALESCE(c.status,''))='APROVADO' THEN RETURN 'AGUARDANDO_ESCOLHA_HORARIO'; END IF;
  IF c.etapa='NAO_APTO_NESTA_VAGA' THEN RETURN c.etapa; END IF;
  RETURN COALESCE(NULLIF(c.etapa,''),'AGUARDANDO_CTPS');
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_processar_texto(
  p_telefone TEXT,
  p_mensagem TEXT,
  p_mensagem_id TEXT,
  p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE (
  candidato_id BIGINT,
  telefone TEXT,
  session TEXT,
  mensagem_whatsapp TEXT,
  action TEXT,
  opcao_numero INTEGER,
  etapa TEXT,
  status TEXT,
  deve_enviar BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  c candidatos%ROWTYPE;
  v vagas%ROWTYPE;
  msg TEXT := BTRIM(COALESCE(p_mensagem,''));
  escolha INTEGER;
  codigo TEXT;
  vaga_escolhida BIGINT;
  cep_extraido TEXT;
  resposta TEXT;
  nova_etapa TEXT;
  nova_status TEXT;
  nova_acao TEXT := 'ENVIAR_MENSAGEM';
  opcao INTEGER := NULL;
  msg_nova BOOLEAN := TRUE;
  cfg genesis_chatbot_config%ROWTYPE;
  detalhe TEXT;
BEGIN
  SELECT * INTO cfg FROM genesis_chatbot_config WHERE id=1;

  INSERT INTO candidatos (telefone,status,etapa,canal,fluxo_versao,pendencia_atual,proxima_acao,created_at,updated_at)
  VALUES (REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),'NOVO','AGUARDANDO_INTENCAO','WhatsApp','CHATBOT_ESTATICO_V1','INTENCAO','RESPONDER_MENU',NOW(),NOW())
  ON CONFLICT (telefone) DO UPDATE SET updated_at=NOW(), fluxo_versao='CHATBOT_ESTATICO_V1'
  RETURNING * INTO c;

  IF NULLIF(BTRIM(COALESCE(p_mensagem_id,'')),'') IS NOT NULL THEN
    INSERT INTO mensagens (candidato_id,quem,mensagem,mensagem_id,created_at)
    VALUES (c.id,'USUARIO',msg,p_mensagem_id,NOW())
    ON CONFLICT (mensagem_id) DO NOTHING;
    GET DIAGNOSTICS escolha = ROW_COUNT;
    msg_nova := escolha > 0;
  ELSE
    INSERT INTO mensagens (candidato_id,quem,mensagem,created_at) VALUES (c.id,'USUARIO',msg,NOW());
  END IF;

  IF NOT msg_nova THEN
    RETURN QUERY SELECT c.id,c.telefone,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,c.etapa,c.status,FALSE;
    RETURN;
  END IF;

  <<processamento>>
  BEGIN
  codigo := UPPER((REGEXP_MATCH(msg,'(VAGA[-_ ]?\d+)','i'))[1]);
  IF codigo IS NOT NULL THEN
    codigo := REPLACE(REPLACE(codigo,'_','-'),' ','-');
    SELECT v.id INTO vaga_escolhida
    FROM vagas v
    WHERE v.status='ATIVA' AND UPPER(v.codigo)=codigo
    LIMIT 1;
    IF vaga_escolhida IS NOT NULL THEN
      UPDATE candidatos SET vaga_id=vaga_escolhida, vaga=(SELECT titulo FROM vagas WHERE id=vaga_escolhida),
        etapa='AGUARDANDO_ACAO_VAGA',status='EM_PROCESSO',situacao_candidatura='EM_PROCESSO',aprovado=NULL,
        revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,
        pendencia_atual='CONFIRMAR_CANDIDATURA',proxima_acao='ESCOLHER_ACAO_VAGA',tentativas_etapa=0,updated_at=NOW()
      WHERE id=c.id RETURNING * INTO c;
      resposta := 'Olá! Sou a Evelyn, inteligência artificial de recrutamento da Gênesis IA. 🤖\n\n' || genesis_chatbot_v1_detalhes_vaga(vaga_escolhida);
      EXIT processamento;
    END IF;
  END IF;

  IF msg='7' AND c.etapa NOT IN ('AGUARDANDO_INTENCAO','RECRUTADOR_MENU','DUVIDAS_GERAIS','DUVIDAS_VAGA','AGUARDANDO_ESCOLHA_HORARIO') THEN
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,'SUPORTE_FLUXO','Atendimento humano solicitado','Candidato solicitou ajuda durante o fluxo estático',JSONB_BUILD_OBJECT('etapa',c.etapa,'mensagem',msg))
    ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET updated_at=NOW(),motivo=EXCLUDED.motivo;
    UPDATE candidatos SET atendimento_humano_solicitado=TRUE,revisao_pendente=TRUE,revisao_tipo='SUPORTE_FLUXO',revisao_motivo='Atendimento humano solicitado',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    resposta := 'Certo. Registrei seu pedido de atendimento com um recrutador. Sua etapa atual foi preservada e a equipe poderá continuar por aqui.';
    EXIT processamento;
  END IF;

  escolha := CASE WHEN msg ~ '^\s*\d+\s*$' THEN BTRIM(msg)::INTEGER ELSE NULL END;

  CASE c.etapa
    WHEN 'AGUARDANDO_INTENCAO' THEN
      IF escolha=1 THEN nova_etapa:='ESCOLHENDO_VAGA'; resposta:=genesis_chatbot_v1_listar_vagas();
      ELSIF escolha=2 THEN nova_etapa:='DUVIDAS_GERAIS'; resposta:=genesis_chatbot_v1_menu_duvidas_gerais();
      ELSIF escolha=3 THEN
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:='Vamos continuar de onde você parou.

'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSIF escolha=4 THEN nova_etapa:='RECRUTADOR_MENU'; UPDATE candidatos SET perfil_contato='RECRUTADOR' WHERE id=c.id; resposta:=genesis_chatbot_v1_menu_recrutador();
      ELSE resposta:=genesis_chatbot_v1_menu_principal();
      END IF;

    WHEN 'RECRUTADOR_MENU' THEN
      IF escolha=0 THEN nova_etapa:='AGUARDANDO_INTENCAO'; resposta:=genesis_chatbot_v1_menu_principal();
      ELSIF escolha IN (1,2) THEN
        INSERT INTO genesis_leads_recrutadores (telefone,interesse,observacao)
        VALUES (c.telefone,CASE WHEN escolha=1 THEN 'DIVULGAR_VAGAS' ELSE 'IMPLEMENTAR_IA' END,'Origem: menu do Chatbot Estático V1');
        resposta := CASE WHEN escolha=1
          THEN 'Ótimo. Registrei seu interesse em divulgar vagas no portal e nos grupos da Gênesis IA.' || CASE WHEN NULLIF(BTRIM(COALESCE(cfg.portal_url,'')),'') IS NOT NULL THEN E'\n\nCadastre sua necessidade aqui:\n'||cfg.portal_url||'/anunciar-vaga' ELSE '' END || E'\n\nNossa equipe dará continuidade ao contato.'
          ELSE 'Ótimo. Registrei seu interesse em implementar IA na sua empresa. Nossa equipe comercial dará continuidade ao contato para entender o processo e apresentar uma solução.' END;
      ELSE resposta:=genesis_chatbot_v1_menu_recrutador(); END IF;

    WHEN 'DUVIDAS_GERAIS' THEN
      IF escolha=0 THEN nova_etapa:='AGUARDANDO_INTENCAO'; resposta:=genesis_chatbot_v1_menu_principal();
      ELSIF escolha=1 THEN resposta:='As vagas ativas ficam disponíveis no portal e também podem ser consultadas aqui pelo WhatsApp.\n\nDigite 0 para voltar ao menu.';
      ELSIF escolha=2 THEN resposta:='No aplicativo CTPS Digital, acesse Contratos, escolha Enviar Carteira de Trabalho, selecione o documento completo e envie aqui como Documento PDF.\n\nDigite 0 para voltar.';
      ELSIF escolha=3 THEN resposta:='A entrevista é realizada on-line pelo Google Meet. Após a aprovação da documentação, você escolhe um horário disponível e recebe o link nesta conversa.\n\nDigite 0 para voltar.';
      ELSIF escolha=4 THEN
        INSERT INTO candidato_revisoes (candidato_id,vaga_id,tipo,titulo,motivo) VALUES (c.id,c.vaga_id,'SUPORTE_FLUXO','Dúvida encaminhada ao recrutador','Solicitação feita no menu de dúvidas')
        ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET updated_at=NOW();
        resposta:='Registrei seu pedido. Um recrutador poderá responder por aqui.';
      ELSE resposta:=genesis_chatbot_v1_menu_duvidas_gerais(); END IF;

    WHEN 'ESCOLHENDO_VAGA' THEN
      IF escolha=0 THEN nova_etapa:='AGUARDANDO_INTENCAO'; resposta:=genesis_chatbot_v1_menu_principal();
      ELSE
        SELECT id INTO vaga_escolhida FROM (
          SELECT v.id,ROW_NUMBER() OVER (ORDER BY COALESCE(v.destaque_portal,FALSE) DESC,v.updated_at DESC,v.id DESC) AS numero
          FROM vagas v JOIN empresas e ON e.id=v.empresa_id
          WHERE v.status='ATIVA' AND e.ativo IS TRUE AND COALESCE(v.atendimento_chatbot,TRUE) IS TRUE AND COALESCE(v.chatbot_estatico_ativo,TRUE) IS TRUE
          ORDER BY COALESCE(v.destaque_portal,FALSE) DESC,v.updated_at DESC,v.id DESC LIMIT 5
        ) x WHERE numero=escolha;
        IF vaga_escolhida IS NULL THEN resposta:='Não localizei essa opção.\n\n'||genesis_chatbot_v1_listar_vagas();
        ELSE
          nova_etapa:='AGUARDANDO_ACAO_VAGA';
          UPDATE candidatos SET vaga_id=vaga_escolhida,vaga=(SELECT titulo FROM vagas WHERE id=vaga_escolhida),status='EM_PROCESSO',situacao_candidatura='EM_PROCESSO',
            aprovado=NULL,revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,pendencia_atual='CONFIRMAR_CANDIDATURA',proxima_acao='ESCOLHER_ACAO_VAGA'
          WHERE id=c.id;
          c.vaga_id:=vaga_escolhida;
          resposta:=genesis_chatbot_v1_detalhes_vaga(vaga_escolhida);
        END IF;
      END IF;

    WHEN 'AGUARDANDO_ACAO_VAGA' THEN
      IF escolha=1 THEN
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:='Perfeito. Vamos iniciar ou continuar sua candidatura.\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSIF escolha=2 THEN nova_etapa:='DUVIDAS_VAGA'; resposta:='Escolha uma dúvida:\n\n1 — Salário e benefícios\n2 — Local, horário e escala\n3 — Requisitos da vaga\n4 — Entrevista pelo Google Meet\n0 — Voltar';
      ELSIF escolha=3 THEN nova_etapa:='ESCOLHENDO_VAGA'; resposta:=genesis_chatbot_v1_listar_vagas();
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_ACAO_VAGA',c.vaga_id); END IF;

    WHEN 'DUVIDAS_VAGA' THEN
      SELECT * INTO v FROM vagas WHERE id=c.vaga_id;
      IF escolha=0 THEN nova_etapa:='AGUARDANDO_ACAO_VAGA'; resposta:=genesis_chatbot_v1_detalhes_vaga(c.vaga_id);
      ELSIF escolha=1 THEN resposta:=FORMAT('Salário: %s. Benefícios: %s.\n\nOutras dúvidas também poderão ser esclarecidas com o recrutador durante a entrevista.\n\n1 — Seguir com o processo\n2 — Consultar outra dúvida\n3 — Ver outra vaga',CASE WHEN v.salario IS NULL THEN 'a confirmar' ELSE TO_CHAR(v.salario,'FM999G999G990D00') END,COALESCE(NULLIF(v.beneficios,''),'consulte na entrevista')); nova_etapa:='AGUARDANDO_ACAO_VAGA';
      ELSIF escolha=2 THEN resposta:=FORMAT('Local: %s. Jornada: %s.\n\nOutras dúvidas também poderão ser esclarecidas com o recrutador durante a entrevista.\n\n1 — Seguir com o processo\n2 — Consultar outra dúvida\n3 — Ver outra vaga',COALESCE(NULLIF(CONCAT_WS(' · ',v.endereco_referencia,v.bairro,v.cidade,v.estado),''),'a confirmar'),COALESCE(NULLIF(CONCAT_WS(' · ',v.escala,v.horario),''),'a confirmar')); nova_etapa:='AGUARDANDO_ACAO_VAGA';
      ELSIF escolha=3 THEN resposta:=FORMAT('Experiência mínima: %s mês(es). Requisitos: %s.\n\nA CTPS será analisada mesmo que você responda que não possui experiência.\n\n1 — Seguir com o processo\n2 — Consultar outra dúvida\n3 — Ver outra vaga',COALESCE(v.experiencia_minima_meses,0),COALESCE(NULLIF(v.requisitos_obrigatorios,''),'não informados')); nova_etapa:='AGUARDANDO_ACAO_VAGA';
      ELSIF escolha=4 THEN resposta:='A entrevista é on-line pelo Google Meet. Após a aprovação da documentação, você escolhe um horário livre do Google Calendar e recebe o link por aqui.\n\n1 — Seguir com o processo\n2 — Consultar outra dúvida\n3 — Ver outra vaga'; nova_etapa:='AGUARDANDO_ACAO_VAGA';
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('DUVIDAS_VAGA',c.vaga_id); END IF;

    WHEN 'AGUARDANDO_NOME' THEN
      IF CHAR_LENGTH(msg) BETWEEN 2 AND 150 AND msg !~ '^\d+$' THEN
        UPDATE candidatos SET nome=INITCAP(msg) WHERE id=c.id;
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:='Obrigada.\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSE resposta:='Não consegui identificar seu nome. Informe apenas o nome pelo qual deseja ser chamado.'; END IF;

    WHEN 'AGUARDANDO_EXPERIENCIA' THEN
      IF escolha IN (1,2,3) THEN
        UPDATE candidatos SET experiencia_declarada=CASE escolha WHEN 1 THEN 'SIM' WHEN 2 THEN 'NAO' ELSE 'INCERTO' END WHERE id=c.id;
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:=genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_EXPERIENCIA',c.vaga_id); END IF;

    WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN
      IF escolha BETWEEN 1 AND 5 THEN
        UPDATE candidatos SET deslocamento_faixa=CASE escolha WHEN 1 THEN 'ATE_30_MIN' WHEN 2 THEN '30_A_60_MIN' WHEN 3 THEN '60_A_90_MIN' WHEN 4 THEN 'MAIS_90_MIN' ELSE 'NAO_SABE' END WHERE id=c.id;
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:=genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_TEMPO_DESLOCAMENTO',c.vaga_id); END IF;

    WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN
      IF escolha IN (1,2,3) THEN
        UPDATE candidatos SET deslocamento_chegada=CASE escolha WHEN 1 THEN 'SIM' WHEN 2 THEN 'NAO' ELSE 'INCERTO' END WHERE id=c.id;
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:=genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_CONFIRMACAO_CHEGADA',c.vaga_id); END IF;

    WHEN 'AGUARDANDO_CEP' THEN
      SELECT (REGEXP_MATCH(msg,'(?:^|\D)(\d{5})[-. ]?(\d{3})(?:\D|$)'))[1] || (REGEXP_MATCH(msg,'(?:^|\D)(\d{5})[-. ]?(\d{3})(?:\D|$)'))[2] INTO cep_extraido;
      IF cep_extraido ~ '^\d{8}$' THEN
        UPDATE candidatos SET cep=cep_extraido WHERE id=c.id;
        nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
        resposta:='CEP registrado. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      ELSE resposta:='Não consegui identificar um CEP válido. Envie os 8 números do CEP.\n\nExemplo: 04345010'; END IF;

    WHEN 'AGUARDANDO_CTPS' THEN resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_CTPS',c.vaga_id);
    WHEN 'PROCESSANDO_CTPS' THEN resposta:=genesis_chatbot_v1_pergunta_atual('PROCESSANDO_CTPS',c.vaga_id);
    WHEN 'REVISAO_DOCUMENTAL' THEN resposta:=genesis_chatbot_v1_pergunta_atual('REVISAO_DOCUMENTAL',c.vaga_id);
    WHEN 'PENDENTE_APROVACAO_RECRUTADOR' THEN resposta:=genesis_chatbot_v1_pergunta_atual('PENDENTE_APROVACAO_RECRUTADOR',c.vaga_id);
    WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN
      IF escolha IN (1,2,3) THEN nova_acao:='AGENDAR'; opcao:=escolha; resposta:='';
      ELSE resposta:=genesis_chatbot_v1_pergunta_atual('AGUARDANDO_ESCOLHA_HORARIO',c.vaga_id); END IF;
    WHEN 'ENTREVISTA_AGENDADA' THEN resposta:=genesis_chatbot_v1_pergunta_atual('ENTREVISTA_AGENDADA',c.vaga_id);
    WHEN 'NAO_APTO_NESTA_VAGA' THEN
      IF escolha=1 THEN
        nova_etapa:='ESCOLHENDO_VAGA';
        resposta:=genesis_chatbot_v1_listar_vagas();
      ELSIF escolha=2 THEN
        nova_etapa:='AGUARDANDO_INTENCAO';
        resposta:='Certo. Sua candidatura ficará registrada para futuras oportunidades. Quando quiser voltar, envie uma nova mensagem e escolha a opção 3 — Continuar uma candidatura.';
      ELSE
        resposta:='Para consultar outras oportunidades, responda 1. Para encerrar por enquanto, responda 2.';
      END IF;
    ELSE nova_etapa:='AGUARDANDO_INTENCAO'; resposta:=genesis_chatbot_v1_menu_principal();
  END CASE;
  END processamento;

  nova_etapa := COALESCE(nova_etapa,c.etapa);

  IF nova_acao='ENVIAR_MENSAGEM' AND nova_etapa='PROCESSANDO_CTPS' AND EXISTS (
    SELECT 1 FROM documentos d WHERE d.candidato_id=c.id AND d.conteudo IS NOT NULL
      AND UPPER(COALESCE(d.tipo,'')) IN ('CTPS','PENDENTE')
    ORDER BY d.created_at DESC,d.id DESC LIMIT 1
  ) THEN
    nova_acao:='REPROCESSAR_DOCUMENTO';
    resposta:='';
  ELSIF nova_acao='ENVIAR_MENSAGEM' AND nova_etapa='AGUARDANDO_ESCOLHA_HORARIO' THEN
    nova_acao:='GERAR_OPCOES';
    resposta:='';
  END IF;
  nova_status := CASE
    WHEN nova_etapa IN ('AGUARDANDO_ESCOLHA_HORARIO','ENTREVISTA_AGENDADA') THEN 'APROVADO'
    WHEN nova_etapa='AGUARDANDO_INTENCAO' AND c.status='NOVO' THEN 'NOVO'
    ELSE COALESCE(NULLIF(c.status,''),'EM_PROCESSO')
  END;

  IF nova_acao='ENVIAR_MENSAGEM'
     AND nova_etapa=c.etapa
     AND c.etapa IN ('AGUARDANDO_NOME','AGUARDANDO_EXPERIENCIA','AGUARDANDO_TEMPO_DESLOCAMENTO','AGUARDANDO_CONFIRMACAO_CHEGADA','AGUARDANDO_CEP','AGUARDANDO_CTPS')
     AND COALESCE(c.tentativas_etapa,0)+1 >= GREATEST(2,COALESCE(cfg.limite_tentativas,3)) THEN
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,'SUPORTE_FLUXO','Fluxo estático não concluído',
      FORMAT('O candidato não respondeu no formato esperado após %s tentativas na etapa %s.',COALESCE(c.tentativas_etapa,0)+1,c.etapa),
      JSONB_BUILD_OBJECT('etapa',c.etapa,'ultima_mensagem',msg,'tentativas',COALESCE(c.tentativas_etapa,0)+1))
    ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE'
    DO UPDATE SET motivo=EXCLUDED.motivo,dados=EXCLUDED.dados,updated_at=NOW();
    nova_etapa:='PAUSADO_ATENDIMENTO_HUMANO';
    nova_status:='EM_PROCESSO';
    resposta:='Não consegui concluir esta etapa automaticamente. Seu atendimento foi encaminhado para um recrutador e a candidatura foi preservada.';
    UPDATE candidatos SET atendimento_humano_solicitado=TRUE,revisao_pendente=TRUE,
      revisao_tipo='SUPORTE_FLUXO',revisao_motivo='Limite de tentativas do fluxo estático atingido'
    WHERE id=c.id;
  END IF;

  IF nova_acao='ENVIAR_MENSAGEM' THEN
    UPDATE candidatos SET etapa=nova_etapa,status=nova_status,
      pendencia_atual=CASE nova_etapa
        WHEN 'AGUARDANDO_INTENCAO' THEN 'INTENCAO' WHEN 'ESCOLHENDO_VAGA' THEN 'VAGA'
        WHEN 'AGUARDANDO_NOME' THEN 'NOME' WHEN 'AGUARDANDO_EXPERIENCIA' THEN 'EXPERIENCIA_DECLARADA'
        WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN 'TEMPO_DESLOCAMENTO'
        WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN 'CONFIRMACAO_CHEGADA'
        WHEN 'AGUARDANDO_CEP' THEN 'CEP' WHEN 'AGUARDANDO_CTPS' THEN 'CTPS'
        WHEN 'PROCESSANDO_CTPS' THEN 'PROCESSAMENTO_CTPS' WHEN 'REVISAO_DOCUMENTAL' THEN 'REVISAO_DOCUMENTAL'
        WHEN 'PENDENTE_APROVACAO_RECRUTADOR' THEN 'DECISAO_RECRUTADOR'
        WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'ESCOLHA_HORARIO' ELSE NULL END,
      proxima_acao=nova_etapa,ultima_pergunta_codigo=nova_etapa,
      tentativas_etapa=CASE WHEN nova_etapa=c.etapa THEN c.tentativas_etapa+1 ELSE 0 END,
      updated_at=NOW()
    WHERE id=c.id RETURNING * INTO c;
  ELSE
    UPDATE candidatos SET etapa=nova_etapa,status=nova_status,
      pendencia_atual=CASE nova_etapa
        WHEN 'PROCESSANDO_CTPS' THEN 'PROCESSAMENTO_CTPS'
        WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'ESCOLHA_HORARIO'
        ELSE pendencia_atual END,
      proxima_acao=nova_acao,tentativas_etapa=0,updated_at=NOW()
    WHERE id=c.id RETURNING * INTO c;
  END IF;

  IF NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL THEN
    INSERT INTO mensagens (candidato_id,quem,mensagem,contexto_snapshot,lote_resposta_id,created_at)
    VALUES (c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','etapa',c.etapa,'pendencia',c.pendencia_atual),
      'static-'||c.id||'-'||COALESCE(NULLIF(p_mensagem_id,''),MD5(CLOCK_TIMESTAMP()::TEXT)),NOW())
    ON CONFLICT (candidato_id,lote_resposta_id) WHERE quem='IA' AND lote_resposta_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN QUERY SELECT c.id,c.telefone,p_session,COALESCE(resposta,''),nova_acao,opcao,c.etapa,c.status,
    nova_acao<>'IGNORAR' AND NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL;
END;
$$;

-- Responde de forma determinística a áudio, imagem e outras mídias sem alterar a etapa.
CREATE OR REPLACE FUNCTION genesis_chatbot_v1_midia_nao_suportada(
  p_telefone TEXT,p_mensagem_id TEXT,p_tipo TEXT,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; resposta TEXT;
BEGIN
  INSERT INTO candidatos(telefone,status,etapa,canal,fluxo_versao,pendencia_atual,proxima_acao,created_at,updated_at)
  VALUES(REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),'NOVO','AGUARDANDO_INTENCAO','WhatsApp','CHATBOT_ESTATICO_V1','INTENCAO','RESPONDER_MENU',NOW(),NOW())
  ON CONFLICT(telefone) DO UPDATE SET updated_at=NOW(),fluxo_versao='CHATBOT_ESTATICO_V1'
  RETURNING * INTO c;
  INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,created_at)
  VALUES(c.id,'USUARIO','[MÍDIA NÃO SUPORTADA: '||COALESCE(p_tipo,'ARQUIVO')||']',NULLIF(p_mensagem_id,''),NOW())
  ON CONFLICT(mensagem_id) DO NOTHING;
  resposta:='Sou uma inteligência artificial e, nesta etapa, preciso que você responda em texto usando as opções indicadas. Para documentos, envie apenas arquivo PDF.\n\n'
    ||genesis_chatbot_v1_pergunta_atual(c.etapa,c.vaga_id);
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','midia_nao_suportada',p_tipo,'etapa_preservada',c.etapa),NOW());
  RETURN QUERY SELECT c.id,c.telefone,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa,c.status,TRUE;
END;
$$;

-- Registra o PDF bruto antes de qualquer OCR. O arquivo nunca depende do sucesso da análise.
CREATE OR REPLACE FUNCTION genesis_chatbot_v1_registrar_pdf(
  p_telefone TEXT,p_mensagem_id TEXT,p_nome_arquivo TEXT,p_mime_type TEXT,
  p_tamanho_bytes BIGINT,p_arquivo_base64 TEXT,p_hash_sha256 TEXT,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,documento_id BIGINT,telefone TEXT,session TEXT,etapa TEXT,status TEXT)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; doc_id BIGINT;
BEGIN
  INSERT INTO candidatos (telefone,status,etapa,canal,fluxo_versao,pendencia_atual,proxima_acao,created_at,updated_at)
  VALUES (REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),'NOVO','AGUARDANDO_INTENCAO','WhatsApp','CHATBOT_ESTATICO_V1','INTENCAO','RESPONDER_MENU',NOW(),NOW())
  ON CONFLICT (telefone) DO UPDATE SET updated_at=NOW(),fluxo_versao='CHATBOT_ESTATICO_V1'
  RETURNING * INTO c;

  INSERT INTO mensagens (candidato_id,quem,mensagem,mensagem_id,created_at)
  VALUES (c.id,'USUARIO','[DOCUMENTO PDF] '||COALESCE(NULLIF(p_nome_arquivo,''),'documento.pdf'),NULLIF(p_mensagem_id,''),NOW())
  ON CONFLICT (mensagem_id) DO NOTHING;

  SELECT id INTO doc_id FROM documentos
  WHERE candidato_id=c.id AND NULLIF(p_mensagem_id,'') IS NOT NULL AND mensagem_id=p_mensagem_id
  ORDER BY created_at DESC,id DESC LIMIT 1;
  IF doc_id IS NULL THEN
    INSERT INTO documentos (candidato_id,tipo,titulo,arquivo,nome_arquivo,mime_type,tamanho_bytes,conteudo,
      resultado,mensagem_id,hash_sha256,status_processamento,processando_at,created_at)
    VALUES (c.id,'PENDENTE','Documento PDF armazenado',COALESCE(NULLIF(p_nome_arquivo,''),'documento.pdf'),
      COALESCE(NULLIF(p_nome_arquivo,''),'documento.pdf'),COALESCE(NULLIF(p_mime_type,''),'application/pdf'),p_tamanho_bytes,
      CASE WHEN NULLIF(p_arquivo_base64,'') IS NULL THEN NULL ELSE DECODE(p_arquivo_base64,'base64') END,
      JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','armazenado_antes_ocr',TRUE,'status','ARMAZENADO'),
      NULLIF(p_mensagem_id,''),NULLIF(p_hash_sha256,''),'ARMAZENADO',NOW(),NOW())
    RETURNING id INTO doc_id;
  ELSE
    UPDATE documentos SET conteudo=COALESCE(conteudo,CASE WHEN NULLIF(p_arquivo_base64,'') IS NULL THEN NULL ELSE DECODE(p_arquivo_base64,'base64') END),
      tamanho_bytes=COALESCE(tamanho_bytes,p_tamanho_bytes),hash_sha256=COALESCE(hash_sha256,NULLIF(p_hash_sha256,'')),
      nome_arquivo=COALESCE(NULLIF(nome_arquivo,''),p_nome_arquivo),mime_type=COALESCE(NULLIF(mime_type,''),p_mime_type),
      status_processamento=CASE WHEN status_processamento='CONCLUIDO' THEN status_processamento ELSE 'ARMAZENADO' END,
      resultado=COALESCE(resultado,'{}'::JSONB)||JSONB_BUILD_OBJECT('armazenado_antes_ocr',TRUE)
    WHERE id=doc_id;
  END IF;

  UPDATE candidatos SET documento_processando=TRUE,processamento_bloqueado_ate=NOW()+INTERVAL '20 minutes',updated_at=NOW() WHERE id=c.id;
  UPDATE atendimento_logs SET candidato_id=c.id,status='PDF_ARMAZENADO',detalhe='PDF bruto armazenado antes do OCR.',updated_at=NOW()
    WHERE mensagem_id=NULLIF(p_mensagem_id,'');
  RETURN QUERY SELECT c.id,doc_id,c.telefone,p_session,c.etapa,c.status;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_aplicar_curriculo(
  p_candidato_id BIGINT,p_documento_id BIGINT,p_resultado JSONB,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; resposta TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  UPDATE documentos SET tipo='CURRICULO',titulo='Currículo',status_processamento='CONCLUIDO',
    classificacao_confianca=COALESCE(p_resultado#>>'{classificacao,confianca}',classificacao_confianca), resultado=COALESCE(resultado,'{}'::JSONB)||COALESCE(p_resultado,'{}'::JSONB),processado_at=NOW()
  WHERE id=p_documento_id AND candidato_id=c.id;
  UPDATE candidatos SET documento_processando=FALSE,processamento_token=NULL,processamento_bloqueado_ate=NULL,updated_at=NOW()
  WHERE id=c.id RETURNING * INTO c;
  resposta:='Recebi seu currículo e ele foi armazenado no seu cadastro. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(c.etapa,c.vaga_id);
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','documento','CURRICULO','etapa_preservada',c.etapa),NOW());
  RETURN QUERY SELECT c.id,c.telefone,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa,c.status,TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_aplicar_documento_inconclusivo(
  p_candidato_id BIGINT,p_documento_id BIGINT,p_resultado JSONB,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; resposta TEXT; etapa_destino TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  etapa_destino:=CASE WHEN c.etapa IN ('AGUARDANDO_CTPS','PROCESSANDO_CTPS') THEN 'REVISAO_DOCUMENTAL' ELSE c.etapa END;
  UPDATE documentos SET tipo='PENDENTE_REVISAO',titulo='Documento aguardando identificação',status_processamento='REVISAO',
    classificacao_confianca=COALESCE(p_resultado#>>'{classificacao,confianca}',classificacao_confianca), resultado=COALESCE(resultado,'{}'::JSONB)||COALESCE(p_resultado,'{}'::JSONB),processado_at=NOW()
  WHERE id=p_documento_id AND candidato_id=c.id;
  INSERT INTO candidato_revisoes(candidato_id,vaga_id,documento_id,tipo,titulo,motivo,dados)
  VALUES(c.id,c.vaga_id,p_documento_id,'REVISAO_DOCUMENTAL','Identificar documento recebido',
    'O arquivo foi armazenado, mas a classificação automática não foi conclusiva.',COALESCE(p_resultado,'{}'::JSONB))
  ON CONFLICT(candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET documento_id=EXCLUDED.documento_id,dados=EXCLUDED.dados,updated_at=NOW();
  UPDATE candidatos SET etapa=etapa_destino,revisao_pendente=TRUE,revisao_tipo='REVISAO_DOCUMENTAL',
    revisao_motivo='Documento não identificado automaticamente',documento_processando=FALSE,processamento_bloqueado_ate=NULL,updated_at=NOW()
  WHERE id=c.id RETURNING * INTO c;
  resposta:='Recebi e armazenei o arquivo, mas não consegui identificar o documento com segurança. Nossa equipe fará a validação e a continuidade será enviada por aqui.';
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','documento','INCONCLUSIVO','etapa',c.etapa),NOW());
  RETURN QUERY SELECT c.id,c.telefone,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa,c.status,TRUE;
END;
$$;

-- Aplica a análise documental e decide entre aprovação automática,
-- revisão humana por exceção, revisão documental ou não apto nesta vaga.
CREATE OR REPLACE FUNCTION genesis_chatbot_v1_aplicar_resultado_ctps(
  p_candidato_id BIGINT,
  p_documento_id BIGINT,
  p_analise JSONB,
  p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE (
  candidato_id BIGINT,
  telefone TEXT,
  session TEXT,
  mensagem_whatsapp TEXT,
  action TEXT,
  opcao_numero INTEGER,
  etapa TEXT,
  status TEXT,
  deve_enviar BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  c candidatos%ROWTYPE;
  v vagas%ROWTYPE;
  experiencia_dias INTEGER := COALESCE(NULLIF(p_analise->>'maior_experiencia_compativel_dias','')::INTEGER,NULLIF(p_analise->>'experiencia_dias','')::INTEGER,0);
  exigido_dias INTEGER;
  revisao_dias INTEGER;
  inconclusivo BOOLEAN := COALESCE((p_analise->>'inconclusivo')::BOOLEAN,FALSE);
  data_nasc DATE;
  idade INTEGER;
  sexo_doc TEXT;
  resposta TEXT;
  acao TEXT := 'ENVIAR_MENSAGEM';
  nova_etapa TEXT;
  nova_status TEXT;
  motivo TEXT;
  etapa_pendente TEXT;
  curriculo_para_revisao BOOLEAN := FALSE;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  SELECT * INTO v FROM vagas WHERE id=c.vaga_id;
  IF NOT FOUND THEN
    nova_etapa:='REVISAO_DOCUMENTAL'; motivo:='Candidato sem vaga ativa vinculada.'; inconclusivo:=TRUE;
  ELSIF COALESCE(v.permitir_experiencia_informal_revisao,FALSE) THEN
    SELECT EXISTS (
      SELECT 1
      FROM documentos d
      WHERE d.candidato_id=c.id
        AND UPPER(COALESCE(d.tipo,''))='CURRICULO'
        AND UPPER(COALESCE(d.status_processamento,''))='CONCLUIDO'
        AND JSONB_TYPEOF(COALESCE(d.resultado->'experiencias','[]'::JSONB))='array'
        AND JSONB_ARRAY_LENGTH(COALESCE(d.resultado->'experiencias','[]'::JSONB))>0
    ) INTO curriculo_para_revisao;
  END IF;

  BEGIN data_nasc := NULLIF(p_analise->>'data_nascimento','')::DATE; EXCEPTION WHEN OTHERS THEN data_nasc:=NULL; END;
  sexo_doc := UPPER(NULLIF(BTRIM(COALESCE(p_analise->>'sexo','')),''));
  IF sexo_doc NOT IN ('MASCULINO','FEMININO') THEN sexo_doc:=NULL; END IF;
  IF data_nasc IS NOT NULL THEN idade:=DATE_PART('year',AGE(CURRENT_DATE,data_nasc))::INTEGER; END IF;

  UPDATE documentos SET tipo='CTPS',titulo='Carteira de Trabalho Digital',status_processamento=CASE WHEN inconclusivo THEN 'REVISAO' ELSE 'CONCLUIDO' END,
    classificacao_confianca=COALESCE(p_analise#>>'{classificacao,confianca}',classificacao_confianca), resultado=COALESCE(resultado,'{}'::JSONB)||p_analise,processado_at=NOW()
  WHERE id=p_documento_id AND candidato_id=p_candidato_id;

  UPDATE candidatos SET
    nome=COALESCE(NULLIF(BTRIM(p_analise->>'nome'),''),nome),
    cpf=COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(p_analise->>'cpf',''),'\D','','g'),''),cpf),
    nome_mae=COALESCE(NULLIF(BTRIM(p_analise->>'nome_mae'),''),nome_mae),
    sexo=COALESCE(sexo_doc,sexo), sexo_origem=CASE WHEN sexo_doc IS NOT NULL THEN 'CTPS' ELSE sexo_origem END,
    sexo_atualizado_em=CASE WHEN sexo_doc IS NOT NULL THEN NOW() ELSE sexo_atualizado_em END,
    data_nascimento=COALESCE(data_nasc,data_nascimento),data_nascimento_origem=CASE WHEN data_nasc IS NOT NULL THEN 'CTPS' ELSE data_nascimento_origem END,
    data_nascimento_atualizada_em=CASE WHEN data_nasc IS NOT NULL THEN NOW() ELSE data_nascimento_atualizada_em END,
    idade_calculada=COALESCE(idade,idade_calculada),idade_confirmada_documentalmente=(data_nasc IS NOT NULL),
    idade_validada=CASE WHEN v.id IS NULL THEN idade_validada WHEN COALESCE(v.idade_minima,0)<=0 AND v.idade_maxima IS NULL THEN TRUE WHEN idade IS NULL THEN NULL ELSE idade>=COALESCE(v.idade_minima,0) AND (v.idade_maxima IS NULL OR idade<=v.idade_maxima) END,
    tempo_experiencia=COALESCE(NULLIF(p_analise->>'tempo_experiencia',''),tempo_experiencia),
    maior_experiencia_compativel_dias=experiencia_dias,
    maior_experiencia_compativel_texto=COALESCE(NULLIF(p_analise->>'maior_experiencia_compativel_texto',''),maior_experiencia_compativel_texto),
    experiencias_ctps=COALESCE(p_analise->'experiencias',experiencias_ctps),
    ctps_analisada_at=NOW(),documento_processando=FALSE,processamento_token=NULL,processamento_bloqueado_ate=NULL,updated_at=NOW()
  WHERE id=p_candidato_id RETURNING * INTO c;

  IF inconclusivo OR (v.id IS NOT NULL AND (COALESCE(v.idade_minima,0)>0 OR v.idade_maxima IS NOT NULL) AND data_nasc IS NULL) THEN
    nova_etapa:='REVISAO_DOCUMENTAL'; nova_status:='EM_PROCESSO';
    motivo:=COALESCE(NULLIF(p_analise->>'motivo_inconclusivo',''),'Não foi possível concluir todos os dados necessários da CTPS.');
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,documento_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,p_documento_id,'REVISAO_DOCUMENTAL','Documento precisa de validação',motivo,p_analise)
    ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET documento_id=EXCLUDED.documento_id,motivo=EXCLUDED.motivo,dados=EXCLUDED.dados,updated_at=NOW();
    resposta:='Recebemos sua CTPS e o documento está armazenado. Algumas informações precisam de validação da nossa equipe. Você receberá a continuidade por aqui e não precisa enviar o arquivo novamente agora.';
  ELSIF v.id IS NOT NULL AND idade IS NOT NULL AND ((COALESCE(v.idade_minima,0)>0 AND idade<v.idade_minima) OR (v.idade_maxima IS NOT NULL AND idade>v.idade_maxima)) THEN
    nova_etapa:='NAO_APTO_NESTA_VAGA'; nova_status:='EM_PROCESSO';
    UPDATE candidatos SET situacao_candidatura='NAO_APTO',motivo_reprovacao_codigo='FAIXA_ETARIA_NAO_ATENDIDA',motivo_reprovacao_categoria='IDADE',motivo_reprovacao_detalhe='Faixa etária documental da vaga não atendida.',reprovacao_realocavel=TRUE WHERE id=c.id;
    resposta:='Sua documentação foi analisada, mas não foi possível seguir nesta oportunidade. Seu cadastro continuará disponível para outras vagas compatíveis.\n\n1 — Ver outras vagas\n2 — Encerrar por enquanto';
  ELSE
    exigido_dias:=GREATEST(0,COALESCE(v.experiencia_minima_meses,0))*30;
    revisao_dias:=GREATEST(0,COALESCE(v.experiencia_revisao_minima_meses,0))*30;
    IF COALESCE(v.aceita_sem_experiencia,FALSE) OR experiencia_dias>=exigido_dias THEN
      UPDATE candidatos SET aprovado=TRUE,situacao_candidatura='APROVADO',revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL WHERE id=c.id;
      etapa_pendente:=genesis_chatbot_v1_etapa_retomada(c.id);
      nova_status:='APROVADO';
      IF etapa_pendente='AGUARDANDO_ESCOLHA_HORARIO' THEN
        nova_etapa:=etapa_pendente; acao:='GERAR_OPCOES'; resposta:='';
      ELSE
        nova_etapa:=etapa_pendente; acao:='ENVIAR_MENSAGEM';
        resposta:='Sua CTPS foi analisada e você atende aos requisitos documentais desta vaga. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
      END IF;
    ELSIF (revisao_dias>0 AND experiencia_dias>=revisao_dias AND revisao_dias<exigido_dias)
       OR curriculo_para_revisao THEN
      nova_etapa:='PENDENTE_APROVACAO_RECRUTADOR'; nova_status:='EM_PROCESSO';
      INSERT INTO candidato_revisoes (candidato_id,vaga_id,documento_id,tipo,titulo,motivo,experiencia_exigida_meses,experiencia_comprovada_dias,dados)
      VALUES (c.id,c.vaga_id,p_documento_id,'EXCECAO_EXPERIENCIA','Aprovação por exceção de experiência',
        CASE WHEN curriculo_para_revisao AND NOT (revisao_dias>0 AND experiencia_dias>=revisao_dias)
          THEN FORMAT('A CTPS comprovou %s dia(s). A vaga permite avaliar experiência informal declarada em currículo.',experiencia_dias)
          ELSE FORMAT('A CTPS comprovou %s dia(s), abaixo dos %s mês(es) exigidos, mas dentro da faixa de análise humana.',experiencia_dias,v.experiencia_minima_meses)
        END,
        v.experiencia_minima_meses,experiencia_dias,p_analise||JSONB_BUILD_OBJECT('curriculo_considerado',curriculo_para_revisao))
      ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET documento_id=EXCLUDED.documento_id,motivo=EXCLUDED.motivo,experiencia_exigida_meses=EXCLUDED.experiencia_exigida_meses,experiencia_comprovada_dias=EXCLUDED.experiencia_comprovada_dias,dados=EXCLUDED.dados,updated_at=NOW();
      UPDATE candidatos SET revisao_pendente=TRUE,revisao_tipo='EXCECAO_EXPERIENCIA',revisao_motivo='Experiência dentro da faixa de análise humana',situacao_candidatura='EM_REVISAO' WHERE id=c.id;
      resposta:='Sua documentação foi analisada e a candidatura está em uma etapa de validação interna. A continuidade será enviada por aqui.';
    ELSE
      nova_etapa:='NAO_APTO_NESTA_VAGA'; nova_status:='EM_PROCESSO';
      UPDATE candidatos SET aprovado=FALSE,situacao_candidatura='NAO_APTO',motivo_reprovacao_codigo='EXPERIENCIA_MINIMA_NAO_COMPROVADA',motivo_reprovacao_categoria='EXPERIENCIA',motivo_reprovacao_detalhe='Experiência comprovada abaixo da faixa mínima definida para análise humana.',reprovacao_realocavel=TRUE WHERE id=c.id;
      resposta:='Sua CTPS foi analisada, mas não conseguimos confirmar o tempo de experiência necessário para esta oportunidade. Seu cadastro continuará disponível para outras vagas compatíveis.\n\n1 — Ver outras vagas\n2 — Encerrar por enquanto';
    END IF;
  END IF;

  UPDATE candidatos SET etapa=nova_etapa,status=nova_status,pendencia_atual=CASE nova_etapa WHEN 'REVISAO_DOCUMENTAL' THEN 'REVISAO_DOCUMENTAL' WHEN 'PENDENTE_APROVACAO_RECRUTADOR' THEN 'DECISAO_RECRUTADOR' WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'ESCOLHA_HORARIO' ELSE NULL END,
    proxima_acao=CASE WHEN acao='GERAR_OPCOES' THEN 'GERAR_OPCOES_GOOGLE_CALENDAR' ELSE nova_etapa END,updated_at=NOW()
  WHERE id=c.id RETURNING * INTO c;

  IF NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL THEN
    INSERT INTO mensagens (candidato_id,quem,mensagem,contexto_snapshot,created_at)
    VALUES (c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','origem','CTPS','etapa',nova_etapa),NOW());
  END IF;

  INSERT INTO eventos (candidato_id,evento,descricao,created_at)
  VALUES (c.id,CASE WHEN acao='GERAR_OPCOES' THEN 'CTPS_APROVADA_AUTOMATICAMENTE' ELSE nova_etapa END,
    COALESCE(NULLIF(resposta,''),FORMAT('CTPS aprovada; experiência comprovada: %s dias.',experiencia_dias)),NOW());

  RETURN QUERY SELECT c.id,c.telefone,p_session,COALESCE(resposta,''),acao,NULL::INTEGER,c.etapa,c.status,
    acao<>'GERAR_OPCOES' AND NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_resolver_revisao_v1(
  p_revisao_id BIGINT,p_decisao TEXT,p_motivo TEXT,p_usuario TEXT
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,action TEXT,etapa TEXT,status TEXT,
  mensagem_whatsapp TEXT,mensagem_painel TEXT,documento_id BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE r candidato_revisoes%ROWTYPE; c candidatos%ROWTYPE; nova_etapa TEXT; nova_status TEXT;
  acao TEXT; msg TEXT; painel TEXT; status_revisao TEXT; etapa_destino TEXT;
BEGIN
  SELECT * INTO r FROM candidato_revisoes WHERE id=p_revisao_id AND status='PENDENTE' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM candidatos WHERE id=r.candidato_id FOR UPDATE;
  CASE UPPER(COALESCE(p_decisao,''))
    WHEN 'APROVAR' THEN
      status_revisao:='APROVADO'; nova_status:='APROVADO'; msg:='';
      UPDATE candidatos SET aprovado=TRUE,situacao_candidatura='APROVADO',revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,updated_at=NOW() WHERE id=c.id;
      etapa_destino:=genesis_chatbot_v1_etapa_retomada(c.id);
      nova_etapa:=etapa_destino;
      IF etapa_destino='AGUARDANDO_ESCOLHA_HORARIO' THEN
        acao:='GERAR_OPCOES'; painel:='Candidato aprovado por decisão do recrutador. A Gênesis consultará o Google Calendar.';
      ELSE
        acao:='ENVIAR_MENSAGEM';
        msg:='Sua candidatura foi aprovada na validação interna. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(etapa_destino,c.vaga_id);
        painel:='Candidato aprovado. A Gênesis retomará a próxima pendência do fluxo estático.';
      END IF;
      UPDATE candidatos SET etapa=nova_etapa,status=nova_status,
        pendencia_atual=CASE nova_etapa WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'ESCOLHA_HORARIO' WHEN 'AGUARDANDO_CEP' THEN 'CEP' WHEN 'AGUARDANDO_CTPS' THEN 'CTPS' ELSE nova_etapa END,
        proxima_acao=CASE WHEN acao='GERAR_OPCOES' THEN 'GERAR_OPCOES_GOOGLE_CALENDAR' ELSE nova_etapa END,updated_at=NOW() WHERE id=c.id;
    WHEN 'NAO_APROVAR' THEN
      status_revisao:='NAO_APROVADO'; nova_etapa:='NAO_APTO_NESTA_VAGA'; nova_status:='EM_PROCESSO'; acao:='ENVIAR_MENSAGEM';
      msg:='Após a validação da equipe, não foi possível seguir nesta oportunidade. Seu cadastro continuará disponível para outras vagas compatíveis.\n\n1 — Ver outras vagas\n2 — Encerrar por enquanto';
      painel:='Decisão registrada. A Gênesis comunicará o candidato.';
      UPDATE candidatos SET aprovado=FALSE,situacao_candidatura='NAO_APTO',revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,
        etapa=nova_etapa,status=nova_status,pendencia_atual=NULL,proxima_acao='OFERECER_OUTRAS_VAGAS',
        motivo_reprovacao_codigo='DECISAO_RECRUTADOR',motivo_reprovacao_categoria='OUTRO',motivo_reprovacao_detalhe=COALESCE(p_motivo,'Não aprovado na análise humana.'),reprovacao_realocavel=TRUE,updated_at=NOW() WHERE id=c.id;
    WHEN 'REPROCESSAR' THEN
      status_revisao:='REPROCESSAR'; nova_etapa:='PROCESSANDO_CTPS'; nova_status:='EM_PROCESSO'; acao:='REPROCESSAR_DOCUMENTO'; msg:='';
      painel:='Reprocessamento solicitado com o PDF já armazenado.';
      UPDATE documentos SET status_processamento='REPROCESSAMENTO_SOLICITADO' WHERE id=r.documento_id;
      UPDATE candidatos SET etapa=nova_etapa,status=nova_status,revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,
        documento_processando=TRUE,pendencia_atual='PROCESSAMENTO_CTPS',proxima_acao='REPROCESSAR_DOCUMENTO',updated_at=NOW() WHERE id=c.id;
    WHEN 'SOLICITAR_NOVO_PDF' THEN
      status_revisao:='SOLICITAR_NOVO_PDF'; nova_etapa:='AGUARDANDO_CTPS'; nova_status:='EM_PROCESSO'; acao:='ENVIAR_MENSAGEM';
      msg:='Não conseguimos visualizar todas as informações necessárias no arquivo. Envie novamente sua CTPS Digital completa como Documento PDF.';
      painel:='Pedido de novo PDF registrado. A Gênesis enviará a mensagem.';
      UPDATE candidatos SET etapa=nova_etapa,status=nova_status,revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,
        documento_processando=FALSE,pendencia_atual='CTPS',proxima_acao='RECEBER_CTPS',updated_at=NOW() WHERE id=c.id;
    ELSE RAISE EXCEPTION 'Decisão inválida: %',p_decisao;
  END CASE;
  UPDATE candidato_revisoes SET status=status_revisao,decisao=UPPER(p_decisao),decisao_motivo=p_motivo,
    decidido_por=p_usuario,decidido_em=NOW(),updated_at=NOW() WHERE id=r.id;
  INSERT INTO eventos(candidato_id,evento,descricao,created_at)
  VALUES(c.id,'REVISAO_RECRUTADOR_'||UPPER(p_decisao),COALESCE(p_motivo,painel),NOW());
  IF NULLIF(BTRIM(COALESCE(msg,'')),'') IS NOT NULL THEN
    INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
    VALUES(c.id,'IA',msg,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','origem','DECISAO_RECRUTADOR','revisao_id',r.id),NOW());
  END IF;
  SELECT * INTO c FROM candidatos WHERE id=r.candidato_id;
  RETURN QUERY SELECT c.id,c.telefone,acao,c.etapa,c.status,COALESCE(msg,''),painel,r.documento_id;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_chatbot_v1_acao_manual(
  p_candidato_id BIGINT,p_action TEXT,p_resgate_id BIGINT DEFAULT NULL,p_session TEXT DEFAULT 'whats_junior'
)
RETURNS TABLE(candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT,action TEXT,
  opcao_numero INTEGER,etapa TEXT,status TEXT,deve_enviar BOOLEAN,documento_id BIGINT,
  arquivo_base64 TEXT,nome_arquivo TEXT,mime_type TEXT,hash_sha256 TEXT,resgate_id BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE c candidatos%ROWTYPE; etapa_destino TEXT; acao TEXT:=UPPER(COALESCE(p_action,'RESGATAR'));
  msg TEXT:=''; d documentos%ROWTYPE;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  IF acao='RESGATAR' THEN
    etapa_destino:=genesis_chatbot_v1_etapa_retomada(c.id);
    UPDATE candidatos SET etapa=etapa_destino,pendencia_atual=CASE etapa_destino WHEN 'AGUARDANDO_CTPS' THEN 'CTPS' WHEN 'AGUARDANDO_CEP' THEN 'CEP' WHEN 'AGUARDANDO_ESCOLHA_HORARIO' THEN 'ESCOLHA_HORARIO' ELSE pendencia_atual END,updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    IF etapa_destino='AGUARDANDO_ESCOLHA_HORARIO' THEN acao:='GERAR_OPCOES'; ELSE acao:='ENVIAR_MENSAGEM'; msg:='Vamos retomar sua candidatura.\n\n'||genesis_chatbot_v1_pergunta_atual(etapa_destino,c.vaga_id); END IF;
  ELSIF acao='REPROCESSAR_DOCUMENTO' THEN
    SELECT * INTO d
    FROM documentos
    WHERE candidato_id=c.id
      AND conteudo IS NOT NULL
      AND (
        UPPER(COALESCE(tipo,'')) IN ('CTPS','PENDENTE')
        OR UPPER(COALESCE(titulo,'')) LIKE '%CTPS%'
        OR UPPER(COALESCE(nome_arquivo,'')) LIKE '%CTPS%'
        OR UPPER(COALESCE(nome_arquivo,'')) LIKE '%CARTEIRA%TRABALHO%'
      )
    ORDER BY CASE WHEN id=(SELECT documento_id FROM candidato_revisoes WHERE candidato_id=c.id ORDER BY created_at DESC LIMIT 1) THEN 0 ELSE 1 END,
      created_at DESC,id DESC
    LIMIT 1;
    IF NOT FOUND THEN
      acao:='ENVIAR_MENSAGEM'; etapa_destino:='AGUARDANDO_CTPS';
      UPDATE candidatos SET etapa=etapa_destino,documento_processando=FALSE,updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
      msg:='Não localizei o PDF armazenado para reprocessamento. Envie novamente sua CTPS Digital completa como Documento PDF.';
    ELSE etapa_destino:='PROCESSANDO_CTPS'; END IF;
  ELSIF acao='GERAR_OPCOES' THEN etapa_destino:='AGUARDANDO_ESCOLHA_HORARIO';
  ELSE acao:='ENVIAR_MENSAGEM'; etapa_destino:=genesis_chatbot_v1_etapa_retomada(c.id); msg:=genesis_chatbot_v1_pergunta_atual(etapa_destino,c.vaga_id); END IF;
  IF p_resgate_id IS NOT NULL THEN UPDATE candidato_resgates SET status='EM_ANALISE',processado_em=NOW(),resultado=resultado||JSONB_BUILD_OBJECT('etapa',etapa_destino,'action',acao) WHERE id=p_resgate_id; END IF;
  RETURN QUERY SELECT c.id,c.telefone,p_session,msg,acao,NULL::INTEGER,COALESCE(etapa_destino,c.etapa),c.status,
    acao='ENVIAR_MENSAGEM' AND NULLIF(BTRIM(msg),'') IS NOT NULL,
    d.id,CASE WHEN d.conteudo IS NULL THEN NULL ELSE ENCODE(d.conteudo,'base64') END,d.nome_arquivo,d.mime_type,d.hash_sha256,p_resgate_id;
END;
$$;

-- Atualiza registros existentes para a versão nova sem apagar histórico.
UPDATE candidatos
SET fluxo_versao=COALESCE(fluxo_versao,'LEGADO_V9'),
    situacao_candidatura=CASE
      WHEN status='APROVADO' THEN 'APROVADO'
      WHEN status='CONTRATADO' THEN 'CONTRATADO'
      WHEN status='REPROVADO' THEN 'NAO_APTO'
      ELSE COALESCE(situacao_candidatura,'EM_PROCESSO') END
WHERE fluxo_versao IS NULL OR situacao_candidatura IS NULL;

COMMIT;
