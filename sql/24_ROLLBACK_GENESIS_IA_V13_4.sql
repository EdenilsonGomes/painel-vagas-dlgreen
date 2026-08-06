-- Rollback do patch Genesis IA V13.4
-- Gerado a partir da estrutura real exportada antes das alterações.
BEGIN;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v13_preparar_interpretacao(p_telefone text, p_mensagem text, p_session text, p_origem text DEFAULT 'TEXTO'::text) RETURNS TABLE(telefone text, mensagem text, session text, origem text, etapa text, pergunta_id bigint, mensagem_canonica text, precisa_ia boolean, contexto text)
    LANGUAGE plpgsql
    AS $_$
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
$_$;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v1_etapa_retomada(p_candidato_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $_$
DECLARE
  c candidatos%ROWTYPE;
  v_vaga_status TEXT;
  v_experiencia_minima_meses INTEGER := 0;
  v_documento_status TEXT;
  triagem_status TEXT;
BEGIN
  SELECT c0.*
  INTO c
  FROM candidatos c0
  WHERE c0.id = p_candidato_id;

  IF NOT FOUND THEN
    RETURN 'AGUARDANDO_INTENCAO';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM entrevistas e
    WHERE e.candidato_id = c.id
      AND UPPER(COALESCE(e.status, '')) = 'AGENDADA'
  ) THEN
    RETURN 'ENTREVISTA_AGENDADA';
  END IF;

  IF c.revisao_pendente IS TRUE THEN
    IF c.revisao_tipo = 'EXCECAO_EXPERIENCIA' THEN
      RETURN 'PENDENTE_APROVACAO_RECRUTADOR';
    END IF;
    RETURN 'REVISAO_DOCUMENTAL';
  END IF;

  IF c.vaga_id IS NULL THEN
    RETURN 'ESCOLHENDO_VAGA';
  END IF;

  SELECT
    vg.status::TEXT,
    COALESCE(vg.experiencia_minima_meses, 0)
  INTO
    v_vaga_status,
    v_experiencia_minima_meses
  FROM vagas vg
  WHERE vg.id = c.vaga_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_vaga_status, '') <> 'ATIVA' THEN
    RETURN 'ESCOLHENDO_VAGA';
  END IF;

  IF NULLIF(BTRIM(COALESCE(c.nome, '')), '') IS NULL THEN
    RETURN 'AGUARDANDO_NOME';
  END IF;

  triagem_status := genesis_triagem_v13_garantir(c.id, c.vaga_id);

  IF triagem_status = 'EM_ANDAMENTO' THEN
    RETURN 'PERGUNTAS_VAGA';
  END IF;
  IF triagem_status = 'ELIMINADO' THEN
    RETURN 'NAO_APTO_NESTA_VAGA';
  END IF;
  IF triagem_status = 'REVISAO' THEN
    RETURN 'PENDENTE_APROVACAO_RECRUTADOR';
  END IF;

  IF COALESCE(v_experiencia_minima_meses, 0) > 0
     AND c.experiencia_declarada IS NULL THEN
    RETURN 'AGUARDANDO_EXPERIENCIA';
  END IF;

  IF c.deslocamento_faixa IS NULL THEN
    RETURN 'AGUARDANDO_TEMPO_DESLOCAMENTO';
  END IF;

  IF c.deslocamento_chegada IS NULL THEN
    RETURN 'AGUARDANDO_CONFIRMACAO_CHEGADA';
  END IF;

  IF REGEXP_REPLACE(COALESCE(c.cep, ''), '\D', '', 'g') !~ '^\d{8}$' THEN
    RETURN 'AGUARDANDO_CEP';
  END IF;

  SELECT d.status_processamento::TEXT
  INTO v_documento_status
  FROM documentos d
  WHERE d.candidato_id = c.id
    AND (
      UPPER(COALESCE(d.tipo, '')) = 'CTPS'
      OR UPPER(COALESCE(d.titulo, '')) LIKE '%CTPS%'
    )
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'AGUARDANDO_CTPS';
  END IF;

  IF UPPER(COALESCE(v_documento_status, '')) IN (
    'RECEBIDO',
    'ARMAZENADO',
    'PROCESSANDO',
    'REPROCESSAMENTO_SOLICITADO'
  ) THEN
    RETURN 'PROCESSANDO_CTPS';
  END IF;

  IF UPPER(COALESCE(v_documento_status, '')) IN (
    'REVISAO',
    'INCONCLUSIVO',
    'ERRO_PROCESSAMENTO'
  ) THEN
    RETURN 'REVISAO_DOCUMENTAL';
  END IF;

  IF c.aprovado IS TRUE OR UPPER(COALESCE(c.status, '')) = 'APROVADO' THEN
    RETURN 'AGUARDANDO_ESCOLHA_HORARIO';
  END IF;

  IF c.etapa = 'NAO_APTO_NESTA_VAGA' THEN
    RETURN c.etapa;
  END IF;

  RETURN COALESCE(NULLIF(c.etapa, ''), 'AGUARDANDO_CTPS');
END;
$_$;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v1_pergunta_atual(p_etapa text, p_vaga_id bigint DEFAULT NULL::bigint) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_candidato_id BIGINT;
  v_experiencia_minima_meses INTEGER := 0;
  v_endereco TEXT := 'local informado na vaga';
  v_horario TEXT := 'informado na vaga';
BEGIN
  -- PERGUNTAS_VAGA usa a pergunta pendente da triagem V13.
  IF p_etapa = 'PERGUNTAS_VAGA' THEN
    SELECT c.id
    INTO v_candidato_id
    FROM candidatos c
    WHERE c.vaga_id = p_vaga_id
      AND c.etapa = 'PERGUNTAS_VAGA'
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 1;

    RETURN COALESCE(
      genesis_triagem_v13_pergunta_atual(v_candidato_id, p_vaga_id),
      ''
    );
  END IF;

  -- Não utiliza RECORD genérico. Quando ainda não existe vaga vinculada,
  -- mantém valores padrão e permite menus como ESCOLHENDO_VAGA funcionarem.
  IF p_vaga_id IS NOT NULL THEN
    SELECT
      COALESCE(vg.experiencia_minima_meses, 0),
      COALESCE(
        NULLIF(
          CONCAT_WS(
            ' · ',
            NULLIF(vg.endereco_referencia, ''),
            NULLIF(vg.bairro, ''),
            NULLIF(vg.cidade, '')
          ),
          ''
        ),
        'local informado na vaga'
      ),
      COALESCE(NULLIF(vg.horario, ''), 'informado na vaga')
    INTO
      v_experiencia_minima_meses,
      v_endereco,
      v_horario
    FROM vagas vg
    WHERE vg.id = p_vaga_id
    LIMIT 1;
  END IF;

  v_experiencia_minima_meses := COALESCE(v_experiencia_minima_meses, 0);
  v_endereco := COALESCE(NULLIF(v_endereco, ''), 'local informado na vaga');
  v_horario := COALESCE(NULLIF(v_horario, ''), 'informado na vaga');

  RETURN CASE p_etapa
    WHEN 'AGUARDANDO_INTENCAO' THEN genesis_chatbot_v1_menu_principal()
    WHEN 'ESCOLHENDO_VAGA' THEN genesis_chatbot_v1_listar_vagas()
    WHEN 'AGUARDANDO_ACAO_VAGA' THEN
      'Responda: 1 para seguir com a candidatura, 2 para tirar uma dúvida sobre a vaga ou 3 para ver outra vaga.'
    WHEN 'DUVIDAS_GERAIS' THEN genesis_chatbot_v1_menu_duvidas_gerais()
    WHEN 'DUVIDAS_VAGA' THEN E'Escolha uma dúvida:\n\n1 — Salário e benefícios\n2 — Local, horário e escala\n3 — Requisitos da vaga\n4 — Entrevista pelo Google Meet\n0 — Voltar'
    WHEN 'RECRUTADOR_MENU' THEN genesis_chatbot_v1_menu_recrutador()
    WHEN 'AGUARDANDO_NOME' THEN 'Como posso te chamar?'
    WHEN 'AGUARDANDO_EXPERIENCIA' THEN FORMAT(
      E'Esta vaga exige %s mês(es) de experiência comprovada em carteira. Você possui essa experiência?\n\n1 — Sim\n2 — Não\n3 — Não tenho certeza\n\nMesmo respondendo não, sua CTPS será analisada antes da decisão.',
      v_experiencia_minima_meses
    )
    WHEN 'AGUARDANDO_TEMPO_DESLOCAMENTO' THEN FORMAT(
      E'A vaga fica em %s. Aproximadamente quanto tempo você levaria para chegar?\n\n1 — Até 30 minutos\n2 — De 30 minutos a 1 hora\n3 — De 1 hora a 1 hora e 30 minutos\n4 — Mais de 1 hora e 30 minutos\n5 — Não sei informar',
      v_endereco
    )
    WHEN 'AGUARDANDO_CONFIRMACAO_CHEGADA' THEN FORMAT(
      E'Considerando o horário de entrada %s, você consegue chegar antes do início do expediente?\n\n1 — Sim\n2 — Não\n3 — Preciso verificar',
      v_horario
    )
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

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v1_aplicar_curriculo(p_candidato_id bigint, p_documento_id bigint, p_resultado jsonb, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
DECLARE c candidatos%ROWTYPE; resposta TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  UPDATE documentos SET tipo='CURRICULO',titulo='Currículo',status_processamento='CONCLUIDO',
    classificacao_confianca=COALESCE(p_resultado#>>'{classificacao,confianca}',classificacao_confianca), resultado=COALESCE(resultado,'{}'::JSONB)||COALESCE(p_resultado,'{}'::JSONB),processado_at=NOW()
  WHERE id=p_documento_id AND candidato_id=c.id;
  UPDATE candidatos SET documento_processando=FALSE,processamento_token=NULL,processamento_bloqueado_ate=NULL,updated_at=NOW()
  WHERE id=c.id RETURNING * INTO c;
  resposta:='Recebi seu currículo e ele foi armazenado no seu cadastro. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(c.etapa::TEXT,c.vaga_id);
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','documento','CURRICULO','etapa_preservada',c.etapa::TEXT),NOW());
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v1_midia_nao_suportada(p_telefone text, p_mensagem_id text, p_tipo text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
    ||genesis_chatbot_v1_pergunta_atual(c.etapa::TEXT,c.vaga_id);
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','midia_nao_suportada',p_tipo,'etapa_preservada',c.etapa::TEXT),NOW());
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v13_midia_nao_suportada(p_telefone text, p_mensagem_id text, p_tipo text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v1_processar_texto(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $_$
#variable_conflict use_column
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
    RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,''::TEXT,'IGNORAR'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,FALSE;
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

  IF msg='7' AND c.etapa::TEXT NOT IN ('AGUARDANDO_INTENCAO','RECRUTADOR_MENU','DUVIDAS_GERAIS','DUVIDAS_VAGA','AGUARDANDO_ESCOLHA_HORARIO') THEN
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,'SUPORTE_FLUXO','Atendimento humano solicitado','Candidato solicitou ajuda durante o fluxo estático',JSONB_BUILD_OBJECT('etapa',c.etapa::TEXT,'mensagem',msg))
    ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET updated_at=NOW(),motivo=EXCLUDED.motivo;
    UPDATE candidatos SET atendimento_humano_solicitado=TRUE,revisao_pendente=TRUE,revisao_tipo='SUPORTE_FLUXO',revisao_motivo='Atendimento humano solicitado',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    resposta := 'Certo. Registrei seu pedido de atendimento com um recrutador. Sua etapa atual foi preservada e a equipe poderá continuar por aqui.';
    EXIT processamento;
  END IF;

  escolha := CASE WHEN msg ~ '^\s*\d+\s*$' THEN BTRIM(msg)::INTEGER ELSE NULL END;

  CASE c.etapa::TEXT
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
        VALUES (c.telefone::TEXT,CASE WHEN escolha=1 THEN 'DIVULGAR_VAGAS' ELSE 'IMPLEMENTAR_IA' END,'Origem: menu do Chatbot Estático V1');
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

  nova_etapa := COALESCE(nova_etapa,c.etapa::TEXT);

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
    WHEN nova_etapa='AGUARDANDO_INTENCAO' AND c.status::TEXT='NOVO' THEN 'NOVO'
    ELSE COALESCE(NULLIF(c.status::TEXT,''),'EM_PROCESSO')
  END;

  IF nova_acao='ENVIAR_MENSAGEM'
     AND nova_etapa=c.etapa::TEXT
     AND c.etapa::TEXT IN ('AGUARDANDO_NOME','AGUARDANDO_EXPERIENCIA','AGUARDANDO_TEMPO_DESLOCAMENTO','AGUARDANDO_CONFIRMACAO_CHEGADA','AGUARDANDO_CEP','AGUARDANDO_CTPS')
     AND COALESCE(c.tentativas_etapa,0)+1 >= GREATEST(2,COALESCE(cfg.limite_tentativas,3)) THEN
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,'SUPORTE_FLUXO','Fluxo estático não concluído',
      FORMAT('O candidato não respondeu no formato esperado após %s tentativas na etapa %s.',COALESCE(c.tentativas_etapa,0)+1,c.etapa::TEXT),
      JSONB_BUILD_OBJECT('etapa',c.etapa::TEXT,'ultima_mensagem',msg,'tentativas',COALESCE(c.tentativas_etapa,0)+1))
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
      tentativas_etapa=CASE WHEN nova_etapa=c.etapa::TEXT THEN c.tentativas_etapa+1 ELSE 0 END,
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
    VALUES (c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','etapa',c.etapa::TEXT,'pendencia',c.pendencia_atual),
      'static-'||c.id||'-'||COALESCE(NULLIF(p_mensagem_id,''),MD5(CLOCK_TIMESTAMP()::TEXT)),NOW())
    ON CONFLICT (candidato_id,lote_resposta_id) WHERE quem='IA' AND lote_resposta_id IS NOT NULL DO NOTHING;
  END IF;

  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,COALESCE(resposta,''),nova_acao,opcao,c.etapa::TEXT,c.status::TEXT,
    nova_acao<>'IGNORAR' AND NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL;
END;
$_$;

CREATE OR REPLACE FUNCTION public.genesis_chatbot_v13_processar_texto(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text, p_origem text DEFAULT 'TEXTO'::text, p_interpretacao jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
  IF c.etapa::TEXT='PERGUNTAS_VAGA' THEN
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

DROP FUNCTION IF EXISTS public.genesis_v13_resposta_duvida_vaga(BIGINT,TEXT);
DROP FUNCTION IF EXISTS public.genesis_v13_nome_valido(TEXT);

COMMIT;