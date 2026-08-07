--
-- PostgreSQL database dump
--

\restrict m367uYlatp2rxOxsZsJLBgmJ8jwMY3rcxwrsQrK3peqMqTxdNKVaVL4Mdzjw1zM

-- Dumped from database version 17.10 (Debian 17.10-1.pgdg13+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: atualizar_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atualizar_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: definir_portal_publicado_em(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.definir_portal_publicado_em() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'ATIVA'
     AND COALESCE(NEW.publicar_portal, TRUE) IS TRUE
     AND NEW.portal_publicado_em IS NULL THEN
    NEW.portal_publicado_em = NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: genesis_aplicar_agenda_recrutador_vaga(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_aplicar_agenda_recrutador_vaga(p_vaga_id bigint) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  agenda recrutador_agendas%ROWTYPE;
BEGIN
  SELECT a.* INTO agenda
  FROM vagas v
  JOIN recrutador_agendas a ON a.usuario_id = v.recrutador_responsavel_id
  WHERE v.id = p_vaga_id
    AND v.agenda_personalizada IS FALSE
    AND a.ativa IS TRUE;

  IF FOUND THEN
    UPDATE vagas SET
      entrevista_dias_semana = agenda.dias_semana,
      entrevista_horarios = agenda.horarios,
      entrevista_duracao_minutos = agenda.duracao_minutos,
      entrevista_busca_dias = agenda.busca_dias,
      entrevista_evitar_feriados = agenda.evitar_feriados,
      updated_at = NOW()
    WHERE id = p_vaga_id;
  END IF;
END;
$$;


--
-- Name: genesis_atualizar_compatibilidade_sexo_candidato(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_atualizar_compatibilidade_sexo_candidato() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  sexo_vaga TEXT;
BEGIN
  NEW.sexo := genesis_normalizar_sexo(NEW.sexo);

  SELECT genesis_normalizar_sexo(v.sexo)
    INTO sexo_vaga
  FROM vagas v
  WHERE v.id = NEW.vaga_id;

  IF NEW.vaga_id IS NULL OR sexo_vaga IS NULL OR sexo_vaga = 'UNISSEX' THEN
    NEW.sexo_compativel_vaga := TRUE;
    NEW.sexo_revisao_necessaria := FALSE;
  ELSIF NEW.sexo IS NULL THEN
    NEW.sexo_compativel_vaga := NULL;
    NEW.sexo_revisao_necessaria := NOT COALESCE(NEW.sexo_nao_informado, FALSE);
  ELSE
    NEW.sexo_compativel_vaga := (NEW.sexo = sexo_vaga);
    NEW.sexo_revisao_necessaria := (NEW.sexo <> sexo_vaga);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: genesis_auditar_candidato(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_auditar_candidato() RETURNS trigger
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


--
-- Name: genesis_chatbot_v13_buffer_consumir(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v13_buffer_consumir(p_telefone text, p_session text, p_token text) RETURNS TABLE(telefone text, mensagem text, mensagem_id text, session text, origem text, processar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY WITH consumida AS (
    DELETE FROM genesis_chatbot_entrada_buffer b
    WHERE b.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') AND b.session=COALESCE(NULLIF(p_session,''),'whats_junior') AND b.token=COALESCE(p_token,'')
    RETURNING b.telefone,b.mensagem,b.mensagem_id,b.session,b.origem
  ) SELECT c.telefone::TEXT,c.mensagem::TEXT,c.mensagem_id::TEXT,c.session::TEXT,c.origem::TEXT,TRUE FROM consumida c
  UNION ALL SELECT REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),''::TEXT,NULL::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),'TEXTO'::TEXT,FALSE
  WHERE NOT EXISTS(SELECT 1 FROM consumida);
END;
$$;


--
-- Name: genesis_chatbot_v13_buffer_registrar(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v13_buffer_registrar(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text, p_origem text DEFAULT 'TEXTO'::text) RETURNS TABLE(telefone text, mensagem text, mensagem_id text, session text, origem text, buffer_token text)
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


--
-- Name: genesis_chatbot_v13_midia_nao_suportada(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v13_midia_nao_suportada(p_telefone text, p_mensagem_id text, p_tipo text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
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


--
-- Name: genesis_chatbot_v13_preparar_interpretacao(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v13_preparar_interpretacao(p_telefone text, p_mensagem text, p_session text, p_origem text DEFAULT 'TEXTO'::text) RETURNS TABLE(telefone text, mensagem text, session text, origem text, etapa text, pergunta_id bigint, mensagem_canonica text, precisa_ia boolean, contexto text)
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


--
-- Name: genesis_chatbot_v13_processar_texto(text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v13_processar_texto(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text, p_origem text DEFAULT 'TEXTO'::text, p_interpretacao jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
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


--
-- Name: genesis_chatbot_v1_acao_manual(bigint, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_acao_manual(p_candidato_id bigint, p_action text, p_resgate_id bigint DEFAULT NULL::bigint, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean, documento_id bigint, arquivo_base64 text, nome_arquivo text, mime_type text, hash_sha256 text, resgate_id bigint)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,msg,acao,NULL::INTEGER,COALESCE(etapa_destino,c.etapa::TEXT),c.status::TEXT,
    acao='ENVIAR_MENSAGEM' AND NULLIF(BTRIM(msg),'') IS NOT NULL,
    d.id,CASE WHEN d.conteudo IS NULL THEN NULL ELSE ENCODE(d.conteudo,'base64') END,d.nome_arquivo::TEXT,d.mime_type::TEXT,d.hash_sha256::TEXT,p_resgate_id;
END;
$$;


--
-- Name: genesis_chatbot_v1_aplicar_curriculo(bigint, bigint, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_aplicar_curriculo(p_candidato_id bigint, p_documento_id bigint, p_resultado jsonb, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
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


--
-- Name: genesis_chatbot_v1_aplicar_documento_inconclusivo(bigint, bigint, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_aplicar_documento_inconclusivo(p_candidato_id bigint, p_documento_id bigint, p_resultado jsonb, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
DECLARE c candidatos%ROWTYPE; resposta TEXT; etapa_destino TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;
  etapa_destino:=CASE WHEN c.etapa::TEXT IN ('AGUARDANDO_CTPS','PROCESSANDO_CTPS') THEN 'REVISAO_DOCUMENTAL' ELSE c.etapa::TEXT END;
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
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_ESTATICO_V1','documento','INCONCLUSIVO','etapa',c.etapa::TEXT),NOW());
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$$;


--
-- Name: genesis_chatbot_v1_aplicar_resultado_ctps(bigint, bigint, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_aplicar_resultado_ctps(p_candidato_id bigint, p_documento_id bigint, p_analise jsonb, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
  ELSIF v.id IS NOT NULL AND sexo_doc IS NOT NULL
    AND UPPER(COALESCE(v.sexo,'UNISSEX')) IN ('MASCULINO','FEMININO')
    AND sexo_doc <> UPPER(v.sexo) THEN
    nova_etapa:='PENDENTE_APROVACAO_RECRUTADOR'; nova_status:='EM_PROCESSO';
    INSERT INTO candidato_revisoes (candidato_id,vaga_id,documento_id,tipo,titulo,motivo,dados)
    VALUES (c.id,c.vaga_id,p_documento_id,'INCOMPATIBILIDADE_SEXO','Validar compatibilidade operacional',
      'O dado explícito da CTPS difere do critério interno configurado para a vaga. A decisão final precisa ser confirmada pelo recrutador.',
      p_analise||JSONB_BUILD_OBJECT('sexo_documento',sexo_doc,'sexo_vaga',v.sexo))
    ON CONFLICT (candidato_id,tipo) WHERE status='PENDENTE' DO UPDATE SET
      documento_id=EXCLUDED.documento_id,motivo=EXCLUDED.motivo,dados=EXCLUDED.dados,updated_at=NOW();
    UPDATE candidatos SET revisao_pendente=TRUE,revisao_tipo='INCOMPATIBILIDADE_SEXO',
      revisao_motivo='Compatibilidade operacional pendente de validação',situacao_candidatura='EM_REVISAO',
      sexo_revisao_necessaria=TRUE WHERE id=c.id;
    resposta:='Sua documentação foi recebida e está em validação interna. Você não precisa enviar novamente; a continuidade será informada por aqui.';
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

  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,COALESCE(resposta,''),acao,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,
    acao<>'GERAR_OPCOES' AND NULLIF(BTRIM(COALESCE(resposta,'')),'') IS NOT NULL;
END;
$$;


--
-- Name: genesis_chatbot_v1_buffer_consumir(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_buffer_consumir(p_telefone text, p_token text) RETURNS TABLE(telefone text, mensagem text, mensagem_id text, session text, processar boolean)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH consumida AS (
    DELETE FROM genesis_chatbot_entrada_buffer b
    WHERE b.telefone=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g')
      AND b.token=COALESCE(p_token,'')
    RETURNING b.telefone,b.mensagem,b.mensagem_id,b.session
  )
  SELECT c.telefone::TEXT,c.mensagem::TEXT,c.mensagem_id::TEXT,c.session::TEXT,TRUE FROM consumida c
  UNION ALL
  SELECT REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g'),''::TEXT,NULL::TEXT,'whats_junior'::TEXT,FALSE
  WHERE NOT EXISTS(SELECT 1 FROM consumida);
END;
$$;


--
-- Name: genesis_chatbot_v1_buffer_registrar(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_buffer_registrar(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(telefone text, mensagem text, mensagem_id text, session text, buffer_token text)
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


--
-- Name: genesis_chatbot_v1_detalhes_vaga(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_detalhes_vaga(p_vaga_id bigint) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
  v_titulo TEXT;
  v_empresa_nome TEXT;
  v_beneficios TEXT;
  v_beneficios_observacao TEXT;
  v_endereco_referencia TEXT;
  v_bairro TEXT;
  v_cidade TEXT;
  v_estado TEXT;
  v_escala TEXT;
  v_horario TEXT;
  v_salario NUMERIC;
  v_beneficios_texto TEXT;
  v_local_texto TEXT;
  v_jornada_texto TEXT;
BEGIN
  IF p_vaga_id IS NULL THEN
    RETURN 'Não localizei essa vaga. Digite 0 para voltar.';
  END IF;

  SELECT
    vg.titulo::TEXT,
    COALESCE(emp.nome_publico, emp.nome)::TEXT,
    vg.beneficios::TEXT,
    vg.beneficios_observacao::TEXT,
    vg.endereco_referencia::TEXT,
    vg.bairro::TEXT,
    vg.cidade::TEXT,
    vg.estado::TEXT,
    vg.escala::TEXT,
    vg.horario::TEXT,
    vg.salario
  INTO
    v_titulo,
    v_empresa_nome,
    v_beneficios,
    v_beneficios_observacao,
    v_endereco_referencia,
    v_bairro,
    v_cidade,
    v_estado,
    v_escala,
    v_horario,
    v_salario
  FROM vagas vg
  JOIN empresas emp ON emp.id = vg.empresa_id
  WHERE vg.id = p_vaga_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'Não localizei essa vaga. Digite 0 para voltar.';
  END IF;

  v_beneficios_texto := COALESCE(
    NULLIF(BTRIM(COALESCE(v_beneficios, '')), ''),
    NULLIF(BTRIM(COALESCE(v_beneficios_observacao, '')), ''),
    'Consulte os benefícios na entrevista.'
  );

  v_local_texto := COALESCE(
    NULLIF(
      CONCAT_WS(
        ' · ',
        NULLIF(v_endereco_referencia, ''),
        NULLIF(v_bairro, ''),
        NULLIF(v_cidade, ''),
        NULLIF(v_estado, '')
      ),
      ''
    ),
    'Local a confirmar'
  );

  v_jornada_texto := COALESCE(
    NULLIF(
      CONCAT_WS(
        ' · ',
        NULLIF(v_escala, ''),
        NULLIF(v_horario, '')
      ),
      ''
    ),
    'Horário a confirmar'
  );

  RETURN FORMAT(
    E'%s\n\n🏢 %s\n📍 %s\n🕐 %s\n💰 %s\n🎁 %s\n\nDeseja seguir com a candidatura ou consultar uma dúvida?\n\n1 — Seguir com o processo\n2 — Tenho uma dúvida sobre esta vaga\n3 — Ver outra vaga\n\nOutras dúvidas também poderão ser esclarecidas com o recrutador durante a entrevista.',
    COALESCE(NULLIF(v_titulo, ''), 'Vaga'),
    COALESCE(NULLIF(v_empresa_nome, ''), 'Empresa contratante'),
    v_local_texto,
    v_jornada_texto,
    CASE
      WHEN v_salario IS NULL THEN 'Salário a confirmar'
      ELSE 'R$ ' || TO_CHAR(v_salario, 'FM999G999G990D00')
    END,
    v_beneficios_texto
  );
END;
$_$;


--
-- Name: genesis_chatbot_v1_etapa_retomada(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_etapa_retomada(p_candidato_id bigint) RETURNS text
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


--
-- Name: genesis_chatbot_v1_listar_vagas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_listar_vagas() RETURNS text
    LANGUAGE plpgsql STABLE
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


--
-- Name: genesis_chatbot_v1_menu_duvidas_gerais(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_menu_duvidas_gerais() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT 'Sobre qual assunto você tem dúvida?\n\n1 — Como ver as vagas disponíveis\n2 — Como enviar a CTPS Digital\n3 — Como funciona a entrevista pelo Google Meet\n4 — Falar com um recrutador\n0 — Voltar ao menu inicial';
$$;


--
-- Name: genesis_chatbot_v1_menu_principal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_menu_principal() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT 'Olá! Sou a Evelyn, inteligência artificial de recrutamento da Gênesis IA. 🤖\n\nVou conduzir o atendimento por etapas. Para o processo funcionar corretamente, responda usando as opções indicadas.\n\n1 — Ver vagas disponíveis\n2 — Tirar uma dúvida\n3 — Continuar uma candidatura\n4 — Sou recrutador';
$$;


--
-- Name: genesis_chatbot_v1_menu_recrutador(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_menu_recrutador() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT 'Como a Gênesis IA pode ajudar?\n\n1 — Gostaria de divulgar vagas no portal e nos grupos\n2 — Quero implementar IA na minha empresa\n0 — Voltar ao menu inicial';
$$;


--
-- Name: genesis_chatbot_v1_midia_nao_suportada(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_midia_nao_suportada(p_telefone text, p_mensagem_id text, p_tipo text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
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


--
-- Name: genesis_chatbot_v1_normalizar_mensagem_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_normalizar_mensagem_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF UPPER(COALESCE(NEW.quem,'')) IN ('IA','SISTEMA') THEN
    NEW.mensagem := genesis_chatbot_v1_normalizar_quebras(NEW.mensagem);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: genesis_chatbot_v1_normalizar_quebras(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_normalizar_quebras(p_texto text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT REPLACE(
    REPLACE(COALESCE(p_texto,''), E'\\r\\n', E'\n'),
    E'\\n', E'\n'
  );
$$;


--
-- Name: genesis_chatbot_v1_pergunta_atual(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_pergunta_atual(p_etapa text, p_vaga_id bigint DEFAULT NULL::bigint) RETURNS text
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


--
-- Name: genesis_chatbot_v1_processar_texto(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_processar_texto(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
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


--
-- Name: genesis_chatbot_v1_registrar_pdf(text, text, text, text, bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_chatbot_v1_registrar_pdf(p_telefone text, p_mensagem_id text, p_nome_arquivo text, p_mime_type text, p_tamanho_bytes bigint, p_arquivo_base64 text, p_hash_sha256 text, p_session text DEFAULT 'whats_junior'::text) RETURNS TABLE(candidato_id bigint, documento_id bigint, telefone text, session text, etapa text, status text)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
  RETURN QUERY SELECT c.id,doc_id,c.telefone::TEXT,p_session,c.etapa::TEXT,c.status::TEXT;
END;
$$;


--
-- Name: genesis_demo_v13_pergunta_atual(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_demo_v13_pergunta_atual(p_contato_id bigint) RETURNS text
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


--
-- Name: genesis_demo_v13_processar_texto(text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_demo_v13_processar_texto(p_session text, p_telefone text, p_mensagem text, p_mensagem_id text, p_origem text DEFAULT 'TEXTO'::text, p_interpretacao jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $_$
#variable_conflict use_column
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
  SELECT dc.* INTO c FROM genesis_demo_contatos dc WHERE dc.demo_id=d.id AND dc.telefone::TEXT=REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g') FOR UPDATE;

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
  ELSIF c.etapa::TEXT='AGUARDANDO_INICIO' THEN
    UPDATE genesis_demo_contatos SET etapa='AGUARDANDO_NOME',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
    resposta:='Ótimo. Como posso te chamar?';
  ELSIF c.etapa::TEXT='AGUARDANDO_NOME' THEN
    IF CHAR_LENGTH(msg) BETWEEN 2 AND 150 AND msg !~ '^\s*[0-9]+\s*$' THEN
      UPDATE genesis_demo_contatos SET nome=INITCAP(msg),etapa='PERGUNTAS_VAGA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
      proxima:=genesis_demo_v13_pergunta_atual(c.id);
      IF proxima='' THEN
        UPDATE genesis_demo_contatos SET etapa='CONCLUIDA',status='CONCLUIDA',updated_at=NOW() WHERE id=c.id RETURNING * INTO c;
        resposta:='Perfeito. A demonstração foi concluída. Em um processo real, as respostas apareceriam organizadas para o recrutador.';
      ELSE resposta:='Prazer, '||SPLIT_PART(c.nome,' ',1)||E'!\n\n'||proxima; END IF;
    ELSE resposta:='Não consegui identificar seu nome. Informe apenas como gostaria de ser chamado.'; END IF;
  ELSIF c.etapa::TEXT='PERGUNTAS_VAGA' THEN
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
$_$;


--
-- Name: genesis_idade_em_anos(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_idade_em_anos(data_nascimento date, data_referencia date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN data_nascimento IS NULL THEN NULL
    ELSE DATE_PART('year', AGE(data_referencia, data_nascimento))::INTEGER
  END;
$$;


--
-- Name: genesis_normalizar_sexo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_normalizar_sexo(valor text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN valor IS NULL OR BTRIM(valor) = '' THEN NULL
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('M', 'MASC', 'MASCULINO', 'HOMEM', 'HOMEM CIS') THEN 'MASCULINO'
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('F', 'FEM', 'FEMININO', 'MULHER', 'MULHER CIS') THEN 'FEMININO'
    WHEN UPPER(TRANSLATE(BTRIM(valor), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN ('UNISSEX', 'AMBOS', 'TODOS') THEN 'UNISSEX'
    ELSE NULL
  END;
$$;


--
-- Name: genesis_normalizar_status_etapa_candidato(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_normalizar_status_etapa_candidato() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
  etapa_reprovacao BOOLEAN;
  motivo_idade BOOLEAN;
BEGIN
  etapa_reprovacao := NEW.etapa IN (
    'REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA'
  );

  motivo_idade := COALESCE(NEW.motivo_reprovacao_codigo, NEW.motivo_reprovacao, '')
    IN ('IDADE_MINIMA_NAO_ATENDIDA','IDADE_MAXIMA_NAO_ATENDIDA','IDADE_DECLARADA_FORA_FAIXA');

  -- Uma comprovação documental válida desfaz somente reprovações etárias.
  IF COALESCE(NEW.idade_confirmada_documentalmente, FALSE)
     AND NEW.idade_validada IS TRUE
     AND motivo_idade
     AND NEW.status NOT IN ('CONTRATADO','ENCERRADO') THEN
    NEW.status := genesis_status_seguro_para_etapa(
      CASE
        WHEN NEW.etapa IN ('REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM') THEN
          CASE
            WHEN NEW.aprovado IS TRUE THEN 'AGUARDANDO_APRESENTACAO'
            WHEN NEW.cep IS NULL OR REGEXP_REPLACE(NEW.cep, '\D', '', 'g') !~ '^\d{8}$' THEN 'AGUARDANDO_CTPS_CEP'
            ELSE 'AGUARDANDO_CTPS'
          END
        ELSE NEW.etapa
      END
    );
    NEW.etapa := CASE
      WHEN NEW.aprovado IS TRUE THEN
        CASE WHEN REGEXP_REPLACE(COALESCE(NEW.cep,''), '\D', '', 'g') ~ '^\d{8}$'
          THEN 'AGUARDANDO_APRESENTACAO' ELSE 'AGUARDANDO_CEP' END
      WHEN REGEXP_REPLACE(COALESCE(NEW.cep,''), '\D', '', 'g') ~ '^\d{8}$' THEN 'AGUARDANDO_CTPS'
      ELSE 'AGUARDANDO_CTPS_CEP'
    END;
    NEW.aprovado := CASE WHEN NEW.aprovado IS FALSE THEN NULL ELSE NEW.aprovado END;
    NEW.motivo_reprovacao := NULL;
    NEW.motivo_reprovacao_codigo := NULL;
    NEW.motivo_reprovacao_categoria := NULL;
    NEW.motivo_reprovacao_detalhe := NULL;
    NEW.reprovacao_vaga_id := NULL;
    NEW.reprovacao_registrada_em := NULL;
  END IF;

  etapa_reprovacao := NEW.etapa IN (
    'REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA'
  );

  IF etapa_reprovacao THEN
    NEW.status := 'REPROVADO';
    IF COALESCE(NULLIF(NEW.motivo_reprovacao_codigo,''), NULLIF(NEW.motivo_reprovacao,'')) IS NULL THEN
      NEW.motivo_reprovacao_codigo := 'MOTIVO_NAO_DETALHADO';
      NEW.motivo_reprovacao_categoria := COALESCE(NEW.motivo_reprovacao_categoria, 'OUTRO');
      NEW.motivo_reprovacao_detalhe := COALESCE(
        NULLIF(NEW.motivo_reprovacao_detalhe,''),
        'Reprovação registrada sem detalhamento. Revisão administrativa necessária.'
      );
      NEW.motivo_reprovacao := COALESCE(NEW.motivo_reprovacao, 'MOTIVO_NAO_DETALHADO');
    END IF;
    NEW.reprovacao_registrada_em := COALESCE(NEW.reprovacao_registrada_em, NOW());
    NEW.reprovacao_vaga_id := COALESCE(NEW.reprovacao_vaga_id, NEW.vaga_id);
  ELSIF NEW.status = 'REPROVADO' THEN
    IF COALESCE(NULLIF(NEW.motivo_reprovacao_codigo,''), NULLIF(NEW.motivo_reprovacao,'')) IS NULL THEN
      -- Combinação impossível como REPROVADO + AGUARDANDO_CTPS:
      -- conserva a etapa e restaura um status coerente.
      NEW.status := genesis_status_seguro_para_etapa(NEW.etapa);
      IF NEW.status <> 'REPROVADO' AND NEW.aprovado IS FALSE THEN NEW.aprovado := NULL; END IF;
    ELSE
      -- Há uma reprovação real, então move a etapa para o ponto correto.
      NEW.etapa := CASE
        WHEN COALESCE(NEW.motivo_reprovacao_categoria,'') = 'ENTREVISTA' THEN 'REPROVADO_POS_ENTREVISTA'
        WHEN COALESCE(NEW.motivo_reprovacao_categoria,'') IN ('IDADE','EXPERIENCIA')
             AND COALESCE(NEW.ctps_analisada_at, NEW.reprovacao_registrada_em) IS NULL THEN 'REPROVADO_PRE_TRIAGEM'
        ELSE 'REPROVADO_TRIAGEM'
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$_$;


--
-- Name: genesis_portal_marcar_publicacao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_portal_marcar_publicacao() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.status = 'ATIVA'
       AND NEW.publicar_portal IS TRUE
       AND (
            OLD.status IS DISTINCT FROM NEW.status
            OR OLD.publicar_portal IS DISTINCT FROM NEW.publicar_portal
            OR NEW.portal_publicado_em IS NULL
       )
    THEN
        NEW.portal_publicado_em = COALESCE(NEW.portal_publicado_em, NOW());
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: genesis_portal_proteger_vaga_externa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_portal_proteger_vaga_externa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF UPPER(COALESCE(NEW.origem_vaga, '')) IN ('PORTAL_EMPRESA', 'EMPRESA_EXTERNA')
       OR UPPER(COALESCE(NEW.canal_candidatura, '')) IN ('URL_EXTERNA', 'EMAIL')
    THEN
        NEW.atendimento_chatbot = FALSE;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: genesis_propagar_agenda_recrutador(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_propagar_agenda_recrutador() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE vagas SET
    entrevista_dias_semana = NEW.dias_semana,
    entrevista_horarios = NEW.horarios,
    entrevista_duracao_minutos = NEW.duracao_minutos,
    entrevista_busca_dias = NEW.busca_dias,
    entrevista_evitar_feriados = NEW.evitar_feriados,
    updated_at = NOW()
  WHERE recrutador_responsavel_id = NEW.usuario_id
    AND agenda_personalizada IS FALSE;
  RETURN NEW;
END;
$$;


--
-- Name: genesis_recalcular_candidatos_apos_sexo_vaga(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_recalcular_candidatos_apos_sexo_vaga() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.sexo IS DISTINCT FROM NEW.sexo THEN
    UPDATE candidatos
    SET vaga_id = vaga_id
    WHERE vaga_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: genesis_registrar_mudanca_etapa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_registrar_mudanca_etapa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.etapa IS DISTINCT FROM NEW.etapa OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO candidato_etapas_historico
        (candidato_id, etapa_anterior, etapa_nova, status_anterior, status_novo, origem, dados_contexto)
        VALUES
        (NEW.id, OLD.etapa, NEW.etapa, OLD.status, NEW.status, 'BANCO',
         JSONB_BUILD_OBJECT('vaga_id', NEW.vaga_id, 'aprovado', NEW.aprovado, 'cep', NEW.cep));
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: genesis_resolver_revisao_v1(bigint, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_resolver_revisao_v1(p_revisao_id bigint, p_decisao text, p_motivo text, p_usuario text) RETURNS TABLE(candidato_id bigint, telefone text, action text, etapa text, status text, mensagem_whatsapp text, mensagem_painel text, documento_id bigint)
    LANGUAGE plpgsql
    AS $$
#variable_conflict use_column
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
        motivo_reprovacao_codigo=CASE WHEN r.tipo='INCOMPATIBILIDADE_SEXO' THEN 'INCOMPATIBILIDADE_OPERACIONAL_VAGA' ELSE 'DECISAO_RECRUTADOR' END,
        motivo_reprovacao_categoria=CASE WHEN r.tipo='INCOMPATIBILIDADE_SEXO' THEN 'REQUISITO_DA_VAGA' ELSE 'OUTRO' END,
        motivo_reprovacao_detalhe=COALESCE(p_motivo,'Não aprovado na análise humana.'),
        reprovacao_realocavel=TRUE,sexo_revisao_necessaria=FALSE,updated_at=NOW() WHERE id=c.id;
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
  RETURN QUERY SELECT c.id,c.telefone::TEXT,acao,c.etapa::TEXT,c.status::TEXT,COALESCE(msg,''),painel,r.documento_id;
END;
$$;


--
-- Name: genesis_status_seguro_para_etapa(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_status_seguro_para_etapa(etapa_valor text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN etapa_valor IN (
      'APROVADO_TRIAGEM','AGUARDANDO_APRESENTACAO','GERANDO_OPCOES_ENTREVISTA',
      'ESCOLHENDO_HORARIO','AGUARDANDO_ENTREVISTA','ENTREVISTA_AGENDADA'
    ) THEN 'APROVADO'
    WHEN etapa_valor = 'PRIMEIRO_CONTATO' THEN 'NOVO'
    WHEN etapa_valor = 'EM_ADMISSAO' THEN 'EM_ADMISSAO'
    WHEN etapa_valor = 'CONTRATADO' THEN 'CONTRATADO'
    WHEN etapa_valor = 'ENCERRADO' THEN 'ENCERRADO'
    ELSE 'EM_PROCESSO'
  END;
$$;


--
-- Name: genesis_triagem_v13_garantir(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_triagem_v13_garantir(p_candidato_id bigint, p_vaga_id bigint) RETURNS text
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


--
-- Name: genesis_triagem_v13_pergunta_atual(bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_triagem_v13_pergunta_atual(p_candidato_id bigint, p_vaga_id bigint) RETURNS text
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


--
-- Name: genesis_triagem_v13_processar_resposta(text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_triagem_v13_processar_resposta(p_telefone text, p_mensagem text, p_mensagem_id text, p_session text, p_origem text, p_interpretacao jsonb) RETURNS TABLE(candidato_id bigint, telefone text, session text, mensagem_whatsapp text, action text, opcao_numero integer, etapa text, status text, deve_enviar boolean)
    LANGUAGE plpgsql
    AS $_$
#variable_conflict use_column
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
    nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id); nova_status:=c.status::TEXT;
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
    nova_etapa:='PERGUNTAS_VAGA';nova_status:=c.status::TEXT;
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
        nova_etapa:='PERGUNTAS_VAGA'; nova_status:=c.status::TEXT;incrementar_tentativa:=TRUE;
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
        nova_etapa:=c.etapa::TEXT;nova_status:=c.status::TEXT;
        resposta:=COALESCE(NULLIF(p.mensagem_nao_atende,''),'Neste momento, sua resposta não atende a um requisito objetivo desta oportunidade.')||E'\n\nSeu cadastro pode continuar disponível para outras vagas compatíveis.\n\n1 — Ver outras vagas\n2 — Encerrar por enquanto';
      ELSE
        proxima:=genesis_triagem_v13_pergunta_atual(c.id,c.vaga_id);
        IF proxima='' THEN
          UPDATE candidato_triagens SET status='CONCLUIDA',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
          nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id); nova_status:=c.status::TEXT;
          resposta:=E'Obrigada. Concluímos as perguntas desta vaga. ✅\n\n'||genesis_chatbot_v1_pergunta_atual(nova_etapa,c.vaga_id);
        ELSE nova_etapa:='PERGUNTAS_VAGA';nova_status:=c.status::TEXT;resposta:=proxima; END IF;
      END IF;
    END IF;
  END IF;
  UPDATE candidatos c0 SET etapa=nova_etapa,status=COALESCE(nova_status,c0.status),pendencia_atual=CASE WHEN nova_etapa='PERGUNTAS_VAGA' THEN 'PERGUNTAS_VAGA' ELSE nova_etapa END,proxima_acao=nova_etapa,
    tentativas_etapa=CASE WHEN incrementar_tentativa THEN COALESCE(c0.tentativas_etapa,0)+1 ELSE 0 END,updated_at=NOW()
  WHERE c0.id=c.id RETURNING c0.* INTO c;
  INSERT INTO mensagens(candidato_id,quem,mensagem,contexto_snapshot,lote_resposta_id,created_at)
  VALUES(c.id,'IA',resposta,JSONB_BUILD_OBJECT('fluxo','CHATBOT_HIBRIDO_V13','etapa',c.etapa::TEXT,'pergunta_id',p.id),
    'v13-'||c.id||'-'||COALESCE(NULLIF(p_mensagem_id,''),MD5(CLOCK_TIMESTAMP()::TEXT)),NOW())
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT c.id,c.telefone::TEXT,p_session,resposta,'ENVIAR_MENSAGEM'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,TRUE;
END;
$_$;


--
-- Name: genesis_v13_avaliar_resposta(text, text, jsonb, text, jsonb, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_avaliar_resposta(p_tipo text, p_finalidade text, p_opcoes jsonb, p_operador text, p_regra jsonb, p_pontos integer, p_resposta text, p_interpretacao jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(resposta_normalizada jsonb, atendida boolean, pontos integer, precisa_revisao boolean, resumo text)
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: genesis_v13_extrair_numero(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_extrair_numero(p_texto text) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
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


--
-- Name: genesis_v13_indice_opcao(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_indice_opcao(p_texto text, p_opcoes jsonb) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
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
$_$;


--
-- Name: genesis_v13_multiplas_opcoes(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_multiplas_opcoes(p_texto text, p_opcoes jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
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
$_$;


--
-- Name: genesis_v13_normalizar_mensagem_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_normalizar_mensagem_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF UPPER(COALESCE(NEW.quem, '')) = 'IA' THEN
    NEW.mensagem := public.genesis_v13_normalizar_quebras(NEW.mensagem);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: genesis_v13_normalizar_quebras(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_normalizar_quebras(p_texto text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT REPLACE(
    REPLACE(
      REPLACE(
        COALESCE(p_texto, ''),
        CHR(92) || 'r' || CHR(92) || 'n',
        CHR(10)
      ),
      CHR(92) || 'n',
      CHR(10)
    ),
    CHR(92) || 't',
    CHR(9)
  );
$$;


--
-- Name: genesis_v13_normalizar_texto(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_normalizar_texto(p_texto text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT BTRIM(REGEXP_REPLACE(
    UPPER(TRANSLATE(COALESCE(p_texto,''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^A-Z0-9]+',' ','g'));
$$;


--
-- Name: genesis_v13_sim_nao(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.genesis_v13_sim_nao(p_texto text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
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
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alertas_resolvidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alertas_resolvidos (
    chave text NOT NULL,
    resolvido_por text,
    observacao text,
    resolvido_em timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_auditoria (
    id bigint NOT NULL,
    usuario_id bigint,
    usuario_nome character varying(150),
    acao character varying(100) NOT NULL,
    entidade character varying(80),
    entidade_id text,
    detalhes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_auditoria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_auditoria_id_seq OWNED BY public.app_auditoria.id;


--
-- Name: app_usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_usuarios (
    id bigint NOT NULL,
    usuario character varying(60) NOT NULL,
    senha_hash text NOT NULL,
    nome character varying(150) NOT NULL,
    perfil character varying(20) DEFAULT 'RECRUTADOR'::character varying NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    deve_trocar_senha boolean DEFAULT false NOT NULL,
    ultimo_login_at timestamp with time zone,
    criado_por bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    empresa_id bigint,
    CONSTRAINT app_usuarios_perfil_check CHECK (((perfil)::text = ANY ((ARRAY['ADMIN'::character varying, 'RECRUTADOR'::character varying])::text[])))
);


--
-- Name: app_usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_usuarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_usuarios_id_seq OWNED BY public.app_usuarios.id;


--
-- Name: atendimento_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.atendimento_logs (
    id bigint NOT NULL,
    mensagem_id text,
    candidato_id bigint,
    telefone_extraido text,
    raw_from text,
    raw_sender_alt text,
    tipo_mensagem character varying(30),
    mime_type text,
    nome_arquivo text,
    status character varying(40) DEFAULT 'RECEBIDO'::character varying NOT NULL,
    detalhe text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: atendimento_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.atendimento_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.atendimento_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auditoria_candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_candidatos (
    id bigint NOT NULL,
    candidato_id bigint,
    acao character varying(20) NOT NULL,
    nome text,
    telefone text,
    campos_alterados jsonb DEFAULT '[]'::jsonb NOT NULL,
    dados_antes jsonb,
    dados_depois jsonb,
    origem text DEFAULT CURRENT_USER NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditoria_candidatos_acao_valida CHECK (((acao)::text = ANY ((ARRAY['ADICIONADO'::character varying, 'MODIFICADO'::character varying, 'REMOVIDO'::character varying])::text[])))
);


--
-- Name: auditoria_candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auditoria_candidatos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auditoria_candidatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auditoria_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_feedback (
    id bigint NOT NULL,
    problema_id bigint NOT NULL,
    decisao character varying(20) NOT NULL,
    observacao text,
    revisado_por text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditoria_feedback_decisao_valida CHECK (((decisao)::text = ANY ((ARRAY['CONFIRMADO'::character varying, 'FALSO_POSITIVO'::character varying, 'CORRIGIDO'::character varying, 'IGNORADO'::character varying])::text[])))
);


--
-- Name: auditoria_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auditoria_feedback ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auditoria_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auditoria_problemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_problemas (
    id bigint NOT NULL,
    auditoria_id bigint,
    candidato_id bigint,
    vaga_id bigint,
    categoria character varying(80) NOT NULL,
    gravidade character varying(15) NOT NULL,
    origem_deteccao character varying(20) DEFAULT 'REGRA'::character varying NOT NULL,
    confianca numeric(5,2),
    titulo character varying(220) NOT NULL,
    descricao text NOT NULL,
    evidencia jsonb DEFAULT '{}'::jsonb NOT NULL,
    comportamento_esperado text,
    sugestao_correcao text,
    mensagem_usuario_id bigint,
    mensagem_ia_id bigint,
    fingerprint character varying(64) NOT NULL,
    status_revisao character varying(20) DEFAULT 'NOVO'::character varying NOT NULL,
    revisado_por text,
    revisado_at timestamp with time zone,
    observacao_revisao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditoria_problemas_gravidade_valida CHECK (((gravidade)::text = ANY ((ARRAY['CRITICA'::character varying, 'ALTA'::character varying, 'MEDIA'::character varying, 'BAIXA'::character varying])::text[]))),
    CONSTRAINT auditoria_problemas_origem_valida CHECK (((origem_deteccao)::text = ANY ((ARRAY['REGRA'::character varying, 'IA'::character varying])::text[]))),
    CONSTRAINT auditoria_problemas_status_valido CHECK (((status_revisao)::text = ANY ((ARRAY['NOVO'::character varying, 'CONFIRMADO'::character varying, 'FALSO_POSITIVO'::character varying, 'CORRIGIDO'::character varying, 'IGNORADO'::character varying])::text[])))
);


--
-- Name: auditoria_problemas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auditoria_problemas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auditoria_problemas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auditorias_conversas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditorias_conversas (
    id bigint NOT NULL,
    origem character varying(20) DEFAULT 'MANUAL'::character varying NOT NULL,
    inicio_periodo timestamp with time zone NOT NULL,
    fim_periodo timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'PROCESSANDO'::character varying NOT NULL,
    total_conversas integer DEFAULT 0 NOT NULL,
    conversas_sem_alerta integer DEFAULT 0 NOT NULL,
    quantidade_criticos integer DEFAULT 0 NOT NULL,
    quantidade_altos integer DEFAULT 0 NOT NULL,
    quantidade_medios integer DEFAULT 0 NOT NULL,
    quantidade_baixos integer DEFAULT 0 NOT NULL,
    nota_qualidade numeric(5,2),
    resumo text,
    solicitado_por text,
    erro text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auditorias_conversas_origem_valida CHECK (((origem)::text = ANY ((ARRAY['MANUAL'::character varying, 'AUTOMATICA'::character varying, 'API'::character varying])::text[]))),
    CONSTRAINT auditorias_conversas_status_valido CHECK (((status)::text = ANY ((ARRAY['PROCESSANDO'::character varying, 'CONCLUIDA'::character varying, 'ERRO'::character varying])::text[])))
);


--
-- Name: auditorias_conversas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auditorias_conversas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auditorias_conversas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_estado; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_estado (
    candidato_id bigint NOT NULL,
    etapa character varying(100),
    proxima_acao text,
    ultima_pergunta text,
    ultima_resposta text,
    aguardando text,
    ultima_interacao timestamp without time zone DEFAULT now()
);


--
-- Name: candidato_etapas_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_etapas_historico (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    etapa_anterior text,
    etapa_nova text,
    status_anterior text,
    status_novo text,
    origem text DEFAULT 'SISTEMA'::text NOT NULL,
    dados_contexto jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidato_etapas_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_etapas_historico ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_etapas_historico_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_etiquetas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_etiquetas (
    candidato_id bigint NOT NULL,
    etiqueta_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidato_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_followups (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    etapa text NOT NULL,
    tentativa smallint NOT NULL,
    mensagem text NOT NULL,
    status character varying(30) DEFAULT 'PENDENTE'::character varying NOT NULL,
    mensagem_waha_id text,
    enviado_em timestamp with time zone,
    respondido_em timestamp with time zone,
    erro text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_followups_status_valido CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'ENVIADO'::character varying, 'RESPONDIDO'::character varying, 'ERRO'::character varying, 'CANCELADO'::character varying])::text[]))),
    CONSTRAINT candidato_followups_tentativa_valida CHECK (((tentativa >= 1) AND (tentativa <= 2)))
);


--
-- Name: candidato_followups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_followups ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_followups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_notas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_notas (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    nota text NOT NULL,
    criado_por text DEFAULT 'Administrador'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidato_notas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_notas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_notas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_reprovacoes_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_reprovacoes_historico (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    vaga_id bigint,
    etapa character varying(80),
    categoria character varying(50) DEFAULT 'OUTRO'::character varying NOT NULL,
    codigo character varying(80) NOT NULL,
    motivo text NOT NULL,
    observacao text,
    realocavel boolean DEFAULT true NOT NULL,
    origem character varying(30) DEFAULT 'SISTEMA'::character varying NOT NULL,
    dados_contexto jsonb DEFAULT '{}'::jsonb NOT NULL,
    registrado_por text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_reprovacoes_categoria_valida CHECK (((categoria)::text = ANY ((ARRAY['IDADE'::character varying, 'EXPERIENCIA'::character varying, 'DOCUMENTO'::character varying, 'DISPONIBILIDADE'::character varying, 'ENTREVISTA'::character varying, 'DESISTENCIA'::character varying, 'REQUISITO_DA_VAGA'::character varying, 'OUTRO'::character varying])::text[])))
);


--
-- Name: candidato_reprovacoes_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_reprovacoes_historico ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_reprovacoes_historico_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_resgates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_resgates (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    auditoria_problema_id bigint,
    origem character varying(40) DEFAULT 'PAINEL'::character varying NOT NULL,
    motivo text,
    acao_sugerida character varying(80),
    mensagem_sugerida text,
    status character varying(30) DEFAULT 'SOLICITADO'::character varying NOT NULL,
    solicitado_por text,
    solicitado_em timestamp with time zone DEFAULT now() NOT NULL,
    processado_em timestamp with time zone,
    resultado jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT candidato_resgates_status_valido CHECK (((status)::text = ANY ((ARRAY['SOLICITADO'::character varying, 'EM_ANALISE'::character varying, 'PRONTO'::character varying, 'ENVIADO'::character varying, 'RESPONDIDO'::character varying, 'CONCLUIDO'::character varying, 'CANCELADO'::character varying, 'ERRO'::character varying])::text[])))
);


--
-- Name: candidato_resgates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_resgates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_resgates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_respostas_triagem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_respostas_triagem (
    id bigint NOT NULL,
    triagem_id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    pergunta_id bigint NOT NULL,
    mensagem_id text,
    resposta_bruta text NOT NULL,
    resposta_normalizada jsonb,
    resumo_ia text,
    origem character varying(20) DEFAULT 'TEXTO'::character varying NOT NULL,
    confianca numeric(5,4),
    atendida boolean,
    pontos integer DEFAULT 0 NOT NULL,
    precisa_revisao boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_respostas_confianca_valida CHECK (((confianca IS NULL) OR ((confianca >= (0)::numeric) AND (confianca <= (1)::numeric)))),
    CONSTRAINT candidato_respostas_origem_valida CHECK (((origem)::text = ANY ((ARRAY['TEXTO'::character varying, 'AUDIO'::character varying, 'PAINEL'::character varying])::text[])))
);


--
-- Name: candidato_respostas_triagem_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_respostas_triagem ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_respostas_triagem_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_revisoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_revisoes (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    vaga_id bigint,
    documento_id bigint,
    tipo character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'PENDENTE'::character varying NOT NULL,
    titulo character varying(180) NOT NULL,
    motivo text,
    experiencia_exigida_meses integer,
    experiencia_comprovada_dias integer,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    decisao character varying(40),
    decisao_motivo text,
    decidido_por text,
    decidido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_revisoes_status_valido CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'APROVADO'::character varying, 'NAO_APROVADO'::character varying, 'REPROCESSAR'::character varying, 'SOLICITAR_NOVO_PDF'::character varying, 'CANCELADO'::character varying, 'CONCLUIDO'::character varying])::text[]))),
    CONSTRAINT candidato_revisoes_tipo_valido CHECK (((tipo)::text = ANY ((ARRAY['EXCECAO_EXPERIENCIA'::character varying, 'REVISAO_DOCUMENTAL'::character varying, 'SUPORTE_FLUXO'::character varying, 'DIVERGENCIA_DADOS'::character varying, 'INCOMPATIBILIDADE_SEXO'::character varying])::text[])))
);


--
-- Name: candidato_revisoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_revisoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_revisoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_tarefas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_tarefas (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    titulo text NOT NULL,
    descricao text,
    prioridade character varying(10) DEFAULT 'MEDIA'::character varying NOT NULL,
    status character varying(20) DEFAULT 'PENDENTE'::character varying NOT NULL,
    vencimento timestamp with time zone,
    criado_por text DEFAULT 'Administrador'::text NOT NULL,
    concluido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_tarefas_prioridade_valida CHECK (((prioridade)::text = ANY ((ARRAY['BAIXA'::character varying, 'MEDIA'::character varying, 'ALTA'::character varying, 'URGENTE'::character varying])::text[]))),
    CONSTRAINT candidato_tarefas_status_valido CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'EM_ANDAMENTO'::character varying, 'CONCLUIDA'::character varying, 'CANCELADA'::character varying])::text[])))
);


--
-- Name: candidato_tarefas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_tarefas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_tarefas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidato_triagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidato_triagens (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    versao_id bigint NOT NULL,
    status character varying(30) DEFAULT 'EM_ANDAMENTO'::character varying NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    pergunta_atual_ordem integer DEFAULT 1 NOT NULL,
    iniciado_at timestamp with time zone DEFAULT now() NOT NULL,
    concluido_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidato_triagens_status_valido CHECK (((status)::text = ANY ((ARRAY['EM_ANDAMENTO'::character varying, 'CONCLUIDA'::character varying, 'ELIMINADO'::character varying, 'REVISAO'::character varying, 'CANCELADA'::character varying])::text[])))
);


--
-- Name: candidato_triagens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.candidato_triagens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.candidato_triagens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidatos (
    id bigint NOT NULL,
    telefone character varying(20) NOT NULL,
    cpf character varying(20),
    nome character varying(150),
    sexo character varying(20),
    nome_mae character varying(150),
    data_nascimento date,
    cep character varying(10),
    cidade character varying(100),
    estado character varying(50),
    vaga character varying(100),
    cargo text,
    tempo_experiencia text,
    aprovado boolean,
    status character varying(50) DEFAULT 'NOVO'::character varying,
    etapa character varying(100) DEFAULT 'PRIMEIRO_CONTATO'::character varying,
    origem character varying(50),
    canal character varying(50) DEFAULT 'WhatsApp'::character varying,
    ativo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    experiencia_6_meses boolean,
    vaga_id bigint,
    apresentacao_profissional text,
    personalidade_resumo text,
    personalidade_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    personalidade_updated_at timestamp with time zone,
    observacao_triagem text,
    motivo_reprovacao text,
    dias_faltantes_experiencia integer,
    meses_faltantes_experiencia numeric(8,2),
    tempo_faltante_experiencia text,
    maior_experiencia_compativel_dias integer,
    maior_experiencia_compativel_texto text,
    experiencia_minima_dias integer,
    tempo_medio_empresas_dias integer,
    tempo_medio_empresas_texto text,
    mediana_permanencia_dias integer,
    mediana_permanencia_texto text,
    quantidade_vinculos_validos integer,
    experiencias_ctps jsonb DEFAULT '[]'::jsonb NOT NULL,
    ctps_analisada_at timestamp with time zone,
    motivo_reprovacao_pos_entrevista text,
    observacao_decisao_pos_entrevista text,
    decisao_pos_entrevista_at timestamp with time zone,
    decisao_pos_entrevista_por text,
    admissao_iniciada_at timestamp with time zone,
    followup_bloqueado boolean DEFAULT false NOT NULL,
    followup_pausado_at timestamp with time zone,
    vaga_escolhida_at timestamp with time zone,
    reprovacao_notificada_at timestamp with time zone,
    ia_atendimento_ativo boolean DEFAULT true NOT NULL,
    ia_pausada_em timestamp with time zone,
    ia_pausada_por text,
    ia_pausa_motivo text,
    ia_retomada_em timestamp with time zone,
    ia_retomada_por text,
    ia_ultima_acao_manual text,
    ia_ultima_acao_manual_em timestamp with time zone,
    ia_ultima_acao_manual_por text,
    ia_ultima_mensagem_manual text,
    processamento_token uuid,
    processamento_bloqueado_ate timestamp with time zone,
    documento_processando boolean DEFAULT false NOT NULL,
    idade_validada boolean,
    idade_validada_em timestamp with time zone,
    idade_calculada integer,
    sexo_origem character varying(20),
    sexo_atualizado_em timestamp with time zone,
    sexo_perguntado_em timestamp with time zone,
    sexo_nao_informado boolean DEFAULT false NOT NULL,
    sexo_compativel_vaga boolean,
    sexo_revisao_necessaria boolean DEFAULT false NOT NULL,
    motivo_reprovacao_codigo character varying(80),
    motivo_reprovacao_categoria character varying(50),
    motivo_reprovacao_detalhe text,
    reprovacao_realocavel boolean DEFAULT true NOT NULL,
    reprovacao_vaga_id bigint,
    reprovacao_registrada_em timestamp with time zone,
    data_nascimento_origem character varying(20),
    data_nascimento_atualizada_em timestamp with time zone,
    idade_declarada smallint,
    idade_declarada_em timestamp with time zone,
    idade_pre_validada boolean,
    idade_confirmada_documentalmente boolean DEFAULT false NOT NULL,
    idade_divergencia_documental boolean DEFAULT false NOT NULL,
    idade_validacao_observacao text,
    fluxo_versao character varying(60),
    pendencia_atual character varying(80),
    proxima_acao character varying(100),
    etapa_anterior character varying(100),
    tentativas_etapa integer DEFAULT 0 NOT NULL,
    perfil_contato character varying(20) DEFAULT 'CANDIDATO'::character varying NOT NULL,
    experiencia_declarada character varying(20),
    deslocamento_faixa character varying(40),
    deslocamento_chegada character varying(20),
    situacao_candidatura character varying(40) DEFAULT 'EM_PROCESSO'::character varying NOT NULL,
    revisao_pendente boolean DEFAULT false NOT NULL,
    revisao_tipo character varying(50),
    revisao_motivo text,
    ultima_pergunta_codigo character varying(80),
    atendimento_humano_solicitado boolean DEFAULT false NOT NULL,
    CONSTRAINT candidatos_data_nascimento_origem_valida CHECK (((data_nascimento_origem IS NULL) OR ((data_nascimento_origem)::text = ANY ((ARRAY['INFORMADA'::character varying, 'CTPS'::character varying, 'CURRICULO'::character varying, 'MANUAL'::character varying, 'IMPORTADA'::character varying])::text[])))),
    CONSTRAINT candidatos_experiencia_declarada_valida CHECK (((experiencia_declarada IS NULL) OR ((experiencia_declarada)::text = ANY ((ARRAY['SIM'::character varying, 'NAO'::character varying, 'INCERTO'::character varying])::text[])))),
    CONSTRAINT candidatos_idade_declarada_valida CHECK (((idade_declarada IS NULL) OR ((idade_declarada >= 14) AND (idade_declarada <= 100)))),
    CONSTRAINT candidatos_motivo_categoria_valida CHECK (((motivo_reprovacao_categoria IS NULL) OR ((motivo_reprovacao_categoria)::text = ANY ((ARRAY['IDADE'::character varying, 'EXPERIENCIA'::character varying, 'DOCUMENTO'::character varying, 'DISPONIBILIDADE'::character varying, 'ENTREVISTA'::character varying, 'DESISTENCIA'::character varying, 'REQUISITO_DA_VAGA'::character varying, 'OUTRO'::character varying])::text[])))),
    CONSTRAINT candidatos_perfil_contato_valido CHECK (((perfil_contato)::text = ANY ((ARRAY['CANDIDATO'::character varying, 'RECRUTADOR'::character varying])::text[]))),
    CONSTRAINT candidatos_sexo_origem_valida CHECK (((sexo_origem IS NULL) OR ((sexo_origem)::text = ANY ((ARRAY['INFORMADA'::character varying, 'CTPS'::character varying, 'CURRICULO'::character varying, 'MANUAL'::character varying, 'IMPORTADA'::character varying])::text[])))),
    CONSTRAINT candidatos_sexo_valido CHECK (((sexo IS NULL) OR ((sexo)::text = ANY ((ARRAY['MASCULINO'::character varying, 'FEMININO'::character varying])::text[]))))
);


--
-- Name: COLUMN candidatos.ia_atendimento_ativo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidatos.ia_atendimento_ativo IS 'TRUE permite respostas automáticas. FALSE mantém mensagens e documentos registrados, mas impede a IA de responder ao candidato.';


--
-- Name: COLUMN candidatos.ia_ultima_acao_manual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.candidatos.ia_ultima_acao_manual IS 'Última ação operacional iniciada pelo painel, como RETOMAR_ATENDIMENTO ou REPROCESSAR_CTPS.';


--
-- Name: candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.candidatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.candidatos_id_seq OWNED BY public.candidatos.id;


--
-- Name: configuracao_grupo_vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracao_grupo_vagas (
    id bigint NOT NULL,
    nome text DEFAULT 'Grupo de vagas'::text NOT NULL,
    grupo_id text NOT NULL,
    sessao_waha text DEFAULT 'whats_junior'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    intervalo_minutos integer DEFAULT 45 NOT NULL,
    hora_inicio time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    hora_fim time without time zone DEFAULT '19:00:00'::time without time zone NOT NULL,
    dias_semana integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6] NOT NULL,
    repeticao_minima_horas integer DEFAULT 6 NOT NULL,
    enviar_convite_reprovados boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT configuracao_grupo_intervalo_valido CHECK (((intervalo_minutos >= 15) AND (intervalo_minutos <= 1440))),
    CONSTRAINT configuracao_grupo_repeticao_valida CHECK (((repeticao_minima_horas >= 1) AND (repeticao_minima_horas <= 168)))
);


--
-- Name: configuracao_grupo_vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.configuracao_grupo_vagas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.configuracao_grupo_vagas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: divulgacao_vagas_envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.divulgacao_vagas_envios (
    id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    grupo_id text NOT NULL,
    tipo character varying(30) DEFAULT 'IMAGEM'::character varying NOT NULL,
    status character varying(40) DEFAULT 'PENDENTE'::character varying NOT NULL,
    mensagem_id text,
    imagem_url text,
    legenda text,
    erro text,
    enviado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: divulgacao_vagas_envios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.divulgacao_vagas_envios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.divulgacao_vagas_envios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    tipo character varying(50),
    titulo text,
    arquivo text,
    created_at timestamp without time zone DEFAULT now(),
    nome_arquivo text,
    mime_type text,
    tamanho_bytes bigint,
    conteudo bytea,
    resultado jsonb,
    mensagem_id text,
    hash_sha256 character varying(64),
    status_processamento character varying(30) DEFAULT 'CONCLUIDO'::character varying NOT NULL,
    classificacao_confianca character varying(20),
    processando_at timestamp with time zone,
    processado_at timestamp with time zone,
    data_nascimento_extraida date
);


--
-- Name: documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documentos_id_seq OWNED BY public.documentos.id;


--
-- Name: empresa_marcas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresa_marcas (
    empresa_id bigint NOT NULL,
    slogan character varying(180),
    cor_primaria character varying(7) DEFAULT '#0F766E'::character varying NOT NULL,
    cor_secundaria character varying(7) DEFAULT '#0B1324'::character varying NOT NULL,
    cor_destaque character varying(7) DEFAULT '#22C55E'::character varying NOT NULL,
    estilo_visual character varying(30) DEFAULT 'CORPORATIVO'::character varying NOT NULL,
    tom_comunicacao character varying(30) DEFAULT 'PROFISSIONAL'::character varying NOT NULL,
    whatsapp character varying(30),
    email character varying(180),
    website text,
    logo_png bytea,
    logo_mime character varying(60),
    logo_nome character varying(180),
    logo_atualizada_em timestamp with time zone,
    configurada boolean DEFAULT false NOT NULL,
    updated_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT empresa_marcas_cor_destaque_check CHECK (((cor_destaque)::text ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT empresa_marcas_cor_primaria_check CHECK (((cor_primaria)::text ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT empresa_marcas_cor_secundaria_check CHECK (((cor_secundaria)::text ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT empresa_marcas_estilo_check CHECK (((estilo_visual)::text = ANY ((ARRAY['CORPORATIVO'::character varying, 'HUMANO'::character varying, 'MODERNO'::character varying, 'MINIMALISTA'::character varying, 'VIBRANTE'::character varying])::text[]))),
    CONSTRAINT empresa_marcas_tom_check CHECK (((tom_comunicacao)::text = ANY ((ARRAY['PROFISSIONAL'::character varying, 'PROXIMO'::character varying, 'DIRETO'::character varying, 'INSPIRADOR'::character varying])::text[])))
);


--
-- Name: empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas (
    id bigint NOT NULL,
    nome character varying(150) NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nome_publico character varying(180),
    descricao_publica text,
    logo_url text,
    site_url text,
    cidade character varying(120),
    estado character(2),
    exibir_no_portal boolean DEFAULT true NOT NULL
);


--
-- Name: empresas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.empresas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.empresas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: entrevista_opcoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrevista_opcoes (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    lote character varying(80) NOT NULL,
    opcao smallint NOT NULL,
    inicio timestamp with time zone NOT NULL,
    fim timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'OFERECIDA'::character varying NOT NULL,
    expira_em timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entrevista_opcoes_check CHECK ((fim > inicio)),
    CONSTRAINT entrevista_opcoes_opcao_check CHECK (((opcao >= 1) AND (opcao <= 3))),
    CONSTRAINT entrevista_opcoes_status_check CHECK (((status)::text = ANY ((ARRAY['OFERECIDA'::character varying, 'SELECIONADA'::character varying, 'EXPIRADA'::character varying, 'CANCELADA'::character varying])::text[])))
);


--
-- Name: entrevista_opcoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entrevista_opcoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entrevista_opcoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entrevista_opcoes_id_seq OWNED BY public.entrevista_opcoes.id;


--
-- Name: entrevistas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrevistas (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    vaga_id bigint,
    opcao_id bigint,
    inicio timestamp with time zone NOT NULL,
    fim timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'AGENDADA'::character varying NOT NULL,
    calendar_id text NOT NULL,
    google_event_id text,
    google_event_url text,
    meet_link text,
    recrutadora_telefone character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entrevistas_check CHECK ((fim > inicio)),
    CONSTRAINT entrevistas_status_check CHECK (((status)::text = ANY ((ARRAY['AGENDADA'::character varying, 'CANCELADA'::character varying, 'REALIZADA'::character varying, 'FALTOU'::character varying, 'REAGENDADA'::character varying])::text[])))
);


--
-- Name: entrevistas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entrevistas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entrevistas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entrevistas_id_seq OWNED BY public.entrevistas.id;


--
-- Name: etiquetas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etiquetas (
    id bigint NOT NULL,
    nome character varying(80) NOT NULL,
    cor character varying(20) DEFAULT '#6366F1'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: etiquetas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.etiquetas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.etiquetas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eventos (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    evento character varying(100),
    descricao text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eventos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eventos_id_seq OWNED BY public.eventos.id;


--
-- Name: genesis_chatbot_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_chatbot_config (
    id smallint DEFAULT 1 NOT NULL,
    portal_url text,
    comercial_url text,
    limite_tentativas integer DEFAULT 3 NOT NULL,
    nome_assistente character varying(60) DEFAULT 'Evelyn'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_chatbot_config_id_check CHECK ((id = 1))
);


--
-- Name: genesis_chatbot_entrada_buffer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_chatbot_entrada_buffer (
    telefone text NOT NULL,
    mensagem text NOT NULL,
    mensagem_id text,
    session text DEFAULT 'whats_junior'::text NOT NULL,
    token text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origem text DEFAULT 'TEXTO'::character varying NOT NULL
);


--
-- Name: genesis_chatbot_interpretacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_chatbot_interpretacoes (
    id bigint NOT NULL,
    candidato_id bigint,
    telefone text NOT NULL,
    session text NOT NULL,
    mensagem_id text,
    origem character varying(20) DEFAULT 'TEXTO'::character varying NOT NULL,
    etapa character varying(100),
    pergunta_id bigint,
    entrada_original text NOT NULL,
    entrada_canonica text,
    intencao character varying(80),
    confianca numeric(5,4),
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_interpretacoes_confianca_valida CHECK (((confianca IS NULL) OR ((confianca >= (0)::numeric) AND (confianca <= (1)::numeric)))),
    CONSTRAINT genesis_interpretacoes_origem_valida CHECK (((origem)::text = ANY ((ARRAY['TEXTO'::character varying, 'AUDIO'::character varying, 'PAINEL'::character varying])::text[])))
);


--
-- Name: genesis_chatbot_interpretacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_chatbot_interpretacoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_chatbot_interpretacoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_demo_contatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_demo_contatos (
    id bigint NOT NULL,
    demo_id bigint NOT NULL,
    telefone text NOT NULL,
    nome character varying(150),
    etapa character varying(80) DEFAULT 'AGUARDANDO_INICIO'::character varying NOT NULL,
    status character varying(30) DEFAULT 'EM_ANDAMENTO'::character varying NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_demo_contatos_status_valido CHECK (((status)::text = ANY ((ARRAY['EM_ANDAMENTO'::character varying, 'CONCLUIDA'::character varying, 'NAO_ATENDEU'::character varying])::text[])))
);


--
-- Name: genesis_demo_contatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_demo_contatos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_demo_contatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_demo_mensagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_demo_mensagens (
    id bigint NOT NULL,
    demo_id bigint NOT NULL,
    contato_id bigint NOT NULL,
    quem character varying(20) NOT NULL,
    mensagem text NOT NULL,
    mensagem_id text,
    origem character varying(20) DEFAULT 'TEXTO'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_demo_mensagens_quem_valido CHECK (((quem)::text = ANY ((ARRAY['USUARIO'::character varying, 'IA'::character varying])::text[])))
);


--
-- Name: genesis_demo_mensagens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_demo_mensagens ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_demo_mensagens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_demo_perguntas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_demo_perguntas (
    id bigint NOT NULL,
    demo_id bigint NOT NULL,
    ordem integer NOT NULL,
    texto character varying(500) NOT NULL,
    tipo character varying(30) NOT NULL,
    finalidade character varying(30) DEFAULT 'CLASSIFICATORIA'::character varying NOT NULL,
    obrigatoria boolean DEFAULT true NOT NULL,
    opcoes jsonb DEFAULT '[]'::jsonb NOT NULL,
    regra_operador character varying(30) DEFAULT 'SEMPRE'::character varying NOT NULL,
    regra_valor jsonb,
    pontos integer DEFAULT 0 NOT NULL,
    mensagem_nao_atende character varying(600),
    CONSTRAINT genesis_demo_perguntas_eliminatoria_objetiva CHECK ((((finalidade)::text <> 'ELIMINATORIA'::text) OR ((tipo)::text = ANY ((ARRAY['SIM_NAO'::character varying, 'UNICA_ESCOLHA'::character varying, 'MULTIPLA_ESCOLHA'::character varying, 'NUMERO'::character varying])::text[])))),
    CONSTRAINT genesis_demo_perguntas_finalidade_valida CHECK (((finalidade)::text = ANY ((ARRAY['ELIMINATORIA'::character varying, 'CLASSIFICATORIA'::character varying, 'ABERTA'::character varying])::text[]))),
    CONSTRAINT genesis_demo_perguntas_tipo_valido CHECK (((tipo)::text = ANY ((ARRAY['SIM_NAO'::character varying, 'UNICA_ESCOLHA'::character varying, 'MULTIPLA_ESCOLHA'::character varying, 'NUMERO'::character varying, 'TEXTO_CURTO'::character varying, 'TEXTO_LONGO'::character varying])::text[])))
);


--
-- Name: genesis_demo_perguntas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_demo_perguntas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_demo_perguntas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_demo_respostas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_demo_respostas (
    id bigint NOT NULL,
    demo_id bigint NOT NULL,
    contato_id bigint NOT NULL,
    pergunta_id bigint NOT NULL,
    resposta_bruta text NOT NULL,
    resposta_normalizada jsonb,
    resumo_ia text,
    origem character varying(20) DEFAULT 'TEXTO'::character varying NOT NULL,
    confianca numeric(5,4),
    atendida boolean,
    pontos integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: genesis_demo_respostas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_demo_respostas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_demo_respostas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_demos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_demos (
    id bigint NOT NULL,
    empresa_nome character varying(180) NOT NULL,
    contato_nome character varying(150) NOT NULL,
    contato_email character varying(254),
    contato_whatsapp character varying(30),
    vaga_origem_id bigint,
    vaga_titulo character varying(180) DEFAULT 'Vaga demonstrativa'::character varying NOT NULL,
    session_name character varying(80) NOT NULL,
    token_hash character(64) NOT NULL,
    status character varying(30) DEFAULT 'CRIADA'::character varying NOT NULL,
    waha_status character varying(50),
    whatsapp_conectado text,
    criado_por bigint,
    criado_por_nome character varying(150),
    inicio_em timestamp with time zone DEFAULT now() NOT NULL,
    expira_em timestamp with time zone NOT NULL,
    conectado_em timestamp with time zone,
    encerrado_em timestamp with time zone,
    ultimo_erro text,
    ultimo_status_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_demos_periodo_valido CHECK ((expira_em > inicio_em)),
    CONSTRAINT genesis_demos_status_valido CHECK (((status)::text = ANY ((ARRAY['CRIADA'::character varying, 'AGUARDANDO_QR'::character varying, 'CONECTADA'::character varying, 'EXPIRADA'::character varying, 'ENCERRADA'::character varying, 'ERRO'::character varying])::text[])))
);


--
-- Name: genesis_demos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_demos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_demos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: genesis_leads_recrutadores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.genesis_leads_recrutadores (
    id bigint NOT NULL,
    telefone text NOT NULL,
    interesse character varying(50) NOT NULL,
    origem character varying(30) DEFAULT 'CHATBOT'::character varying NOT NULL,
    status character varying(30) DEFAULT 'NOVO'::character varying NOT NULL,
    observacao text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genesis_leads_recrutadores_interesse_valido CHECK (((interesse)::text = ANY ((ARRAY['DIVULGAR_VAGAS'::character varying, 'IMPLEMENTAR_IA'::character varying])::text[])))
);


--
-- Name: genesis_leads_recrutadores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.genesis_leads_recrutadores ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.genesis_leads_recrutadores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: gg_group_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gg_group_clicks (
    id integer NOT NULL,
    group_id integer NOT NULL,
    visitor_hash character varying(80) NOT NULL,
    source character varying(240),
    job_id bigint,
    created_at timestamp with time zone NOT NULL,
    sessao_id character varying(120),
    utm_source character varying(160),
    utm_medium character varying(160),
    utm_campaign character varying(200)
);


--
-- Name: gg_group_clicks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gg_group_clicks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gg_group_clicks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gg_group_clicks_id_seq OWNED BY public.gg_group_clicks.id;


--
-- Name: gg_group_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gg_group_reports (
    id integer NOT NULL,
    group_id integer NOT NULL,
    reason character varying(100) NOT NULL,
    details text,
    contact character varying(180),
    status character varying(30) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by bigint
);


--
-- Name: gg_group_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gg_group_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gg_group_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gg_group_reports_id_seq OWNED BY public.gg_group_reports.id;


--
-- Name: gg_group_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gg_group_views (
    id integer NOT NULL,
    group_id integer NOT NULL,
    visitor_day_hash character varying(80) NOT NULL,
    source character varying(240),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: gg_group_views_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gg_group_views_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gg_group_views_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gg_group_views_id_seq OWNED BY public.gg_group_views.id;


--
-- Name: gg_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gg_groups (
    id integer NOT NULL,
    name character varying(160) NOT NULL,
    slug character varying(190) NOT NULL,
    description text NOT NULL,
    rules text,
    invite_url text,
    image_url text,
    category character varying(80) NOT NULL,
    state character varying(2) DEFAULT 'SP'::character varying NOT NULL,
    city character varying(120) NOT NULL,
    region character varying(120),
    group_type character varying(40) DEFAULT 'emprego'::character varying NOT NULL,
    admin_only boolean DEFAULT false NOT NULL,
    accepts_jobs boolean DEFAULT false NOT NULL,
    charges_members boolean DEFAULT false NOT NULL,
    owner_name character varying(160),
    owner_email character varying(180),
    owner_phone character varying(30),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    owner_account_id bigint,
    rejection_reason text,
    moderation_note text,
    approved_at timestamp with time zone,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    seo_title character varying(180),
    seo_description character varying(320),
    invite_code_hash character(64),
    official boolean DEFAULT false NOT NULL,
    accepts_candidate_messages boolean DEFAULT false NOT NULL
);


--
-- Name: gg_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gg_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gg_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gg_groups_id_seq OWNED BY public.gg_groups.id;


--
-- Name: gg_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gg_jobs (
    id integer NOT NULL,
    title character varying(180) NOT NULL,
    slug character varying(210) NOT NULL,
    company character varying(180) NOT NULL,
    description text NOT NULL,
    requirements text,
    benefits text,
    salary character varying(100),
    schedule character varying(160),
    state character varying(2) NOT NULL,
    city character varying(120) NOT NULL,
    region character varying(120),
    category character varying(80) NOT NULL,
    contact_url text,
    contact_phone character varying(30),
    recruiter_name character varying(160),
    recruiter_email character varying(180),
    status character varying(30) NOT NULL,
    featured boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: gg_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gg_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gg_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gg_jobs_id_seq OWNED BY public.gg_jobs.id;


--
-- Name: grupo_convites_envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grupo_convites_envios (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    grupo_id text NOT NULL,
    codigo_convite text,
    link_convite text,
    mensagem text,
    status character varying(30) DEFAULT 'PENDENTE'::character varying NOT NULL,
    mensagem_waha_id text,
    erro text,
    enviado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grupo_convites_envios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.grupo_convites_envios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.grupo_convites_envios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mensagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensagens (
    id bigint NOT NULL,
    candidato_id bigint NOT NULL,
    quem character varying(30),
    mensagem text,
    mensagem_id text,
    lida boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    contexto_snapshot jsonb,
    lote_resposta_id text,
    origem_mensagem_id text
);


--
-- Name: mensagens_buffer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensagens_buffer (
    candidato_id bigint NOT NULL,
    texto text DEFAULT ''::text NOT NULL,
    versao bigint DEFAULT 0 NOT NULL,
    ultima_mensagem_em timestamp with time zone DEFAULT now() NOT NULL,
    processando boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mensagens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mensagens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mensagens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mensagens_id_seq OWNED BY public.mensagens.id;


--
-- Name: n8n_chat_histories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.n8n_chat_histories (
    id integer NOT NULL,
    session_id character varying(255) NOT NULL,
    message jsonb NOT NULL
);


--
-- Name: n8n_chat_histories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.n8n_chat_histories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: n8n_chat_histories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.n8n_chat_histories_id_seq OWNED BY public.n8n_chat_histories.id;


--
-- Name: painel_configuracoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.painel_configuracoes (
    chave text NOT NULL,
    valor jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portal_contas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_contas (
    id bigint NOT NULL,
    tipo character varying(20) NOT NULL,
    nome character varying(160) NOT NULL,
    email character varying(200) NOT NULL,
    senha_hash text NOT NULL,
    whatsapp character varying(30) NOT NULL,
    empresa_nome character varying(180),
    cnpj character varying(30),
    cidade character varying(120),
    estado character(2),
    status character varying(20) DEFAULT 'ATIVA'::character varying NOT NULL,
    lead_status character varying(30) DEFAULT 'NOVO'::character varying NOT NULL,
    consentimento_comercial boolean DEFAULT false NOT NULL,
    aceite_termos_em timestamp with time zone,
    origem character varying(80) DEFAULT 'CADASTRO_PORTAL'::character varying NOT NULL,
    observacao_interna text,
    ultimo_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_contas_lead_status_check CHECK (((lead_status)::text = ANY ((ARRAY['NOVO'::character varying, 'CONTATADO'::character varying, 'QUALIFICADO'::character varying, 'CLIENTE'::character varying, 'SEM_INTERESSE'::character varying])::text[]))),
    CONSTRAINT portal_contas_status_check CHECK (((status)::text = ANY ((ARRAY['ATIVA'::character varying, 'BLOQUEADA'::character varying, 'EXCLUIDA'::character varying])::text[]))),
    CONSTRAINT portal_contas_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['RECRUTADOR'::character varying, 'EMPRESA'::character varying])::text[])))
);


--
-- Name: portal_contas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_contas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_contas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_contas_id_seq OWNED BY public.portal_contas.id;


--
-- Name: portal_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_eventos (
    id bigint NOT NULL,
    vaga_id bigint,
    evento character varying(60) NOT NULL,
    sessao_id character varying(120),
    pagina text,
    origem text,
    meio text,
    campanha text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_hash character varying(128),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portal_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_eventos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_grupo_imagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_grupo_imagens (
    grupo_id integer NOT NULL,
    conteudo bytea NOT NULL,
    mime_type character varying(80) DEFAULT 'image/webp'::character varying NOT NULL,
    largura integer,
    altura integer,
    tamanho_bytes integer NOT NULL,
    origem character varying(30) DEFAULT 'UPLOAD'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portal_leads_empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_leads_empresas (
    id bigint NOT NULL,
    empresa_nome character varying(180) NOT NULL,
    cnpj character varying(30),
    contato_nome character varying(160) NOT NULL,
    email character varying(200) NOT NULL,
    whatsapp character varying(40) NOT NULL,
    cidade character varying(120),
    estado character(2),
    quantidade_vagas integer,
    cargos_interesse text,
    mensagem text,
    origem character varying(120),
    utm_source character varying(160),
    utm_medium character varying(160),
    utm_campaign character varying(200),
    status character varying(30) DEFAULT 'NOVO'::character varying NOT NULL,
    responsavel character varying(120),
    observacao_interna text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_leads_empresas_status_valido CHECK (((status)::text = ANY ((ARRAY['NOVO'::character varying, 'EM_CONTATO'::character varying, 'QUALIFICADO'::character varying, 'PROPOSTA'::character varying, 'CLIENTE'::character varying, 'DESCARTADO'::character varying])::text[])))
);


--
-- Name: portal_leads_empresas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.portal_leads_empresas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.portal_leads_empresas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: portal_sessoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_sessoes (
    token_hash character(64) NOT NULL,
    conta_id bigint NOT NULL,
    ip_hash character varying(128),
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portal_vaga_grupos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_vaga_grupos (
    vaga_id bigint NOT NULL,
    grupo_id integer NOT NULL,
    status character varying(30) DEFAULT 'SUGERIDO'::character varying NOT NULL,
    codigo_campanha character varying(100),
    publicado_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_vaga_grupos_status_check CHECK (((status)::text = ANY ((ARRAY['SUGERIDO'::character varying, 'PLANEJADO'::character varying, 'PUBLICADO'::character varying, 'PAUSADO'::character varying])::text[])))
);


--
-- Name: portal_vagas_submissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_vagas_submissoes (
    id bigint NOT NULL,
    conta_id bigint NOT NULL,
    empresa_nome character varying(180) NOT NULL,
    titulo character varying(180) NOT NULL,
    cargo character varying(180) NOT NULL,
    descricao text NOT NULL,
    requisitos text,
    beneficios text,
    cidade character varying(120) NOT NULL,
    estado character(2) DEFAULT 'SP'::bpchar NOT NULL,
    bairro character varying(120),
    modalidade character varying(40) DEFAULT 'Presencial'::character varying NOT NULL,
    tipo_contrato character varying(60),
    escala character varying(120),
    horario character varying(180),
    salario numeric(12,2),
    quantidade_vagas integer DEFAULT 1 NOT NULL,
    whatsapp_contato character varying(30),
    status character varying(30) DEFAULT 'PENDENTE'::character varying NOT NULL,
    rejection_reason text,
    moderation_note text,
    vaga_id bigint,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT portal_vagas_submissoes_qtd_check CHECK ((quantidade_vagas >= 1)),
    CONSTRAINT portal_vagas_submissoes_salario_check CHECK (((salario IS NULL) OR (salario >= (0)::numeric))),
    CONSTRAINT portal_vagas_submissoes_status_check CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'EM_REVISAO'::character varying, 'APROVADA'::character varying, 'REJEITADA'::character varying, 'CONVERTIDA'::character varying, 'CANCELADA'::character varying])::text[])))
);


--
-- Name: portal_vagas_submissoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.portal_vagas_submissoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: portal_vagas_submissoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.portal_vagas_submissoes_id_seq OWNED BY public.portal_vagas_submissoes.id;


--
-- Name: prospeccao_configuracao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_configuracao (
    id smallint DEFAULT 1 NOT NULL,
    orcamento_mensal_usd numeric(10,2) DEFAULT 5.00 NOT NULL,
    custo_estimado_por_1000_usd numeric(10,4) DEFAULT 1.50 NOT NULL,
    custo_estimado_inicio_usd numeric(10,4) DEFAULT 0.007 NOT NULL,
    limite_padrao integer DEFAULT 25 NOT NULL,
    limite_maximo_execucao integer DEFAULT 100 NOT NULL,
    permitir_enriquecimento boolean DEFAULT false NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    updated_by bigint,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospeccao_config_limites CHECK (((orcamento_mensal_usd >= (0)::numeric) AND (custo_estimado_por_1000_usd >= (0)::numeric) AND ((limite_padrao >= 1) AND (limite_padrao <= 500)) AND ((limite_maximo_execucao >= 1) AND (limite_maximo_execucao <= 1000)) AND (limite_padrao <= limite_maximo_execucao))),
    CONSTRAINT prospeccao_config_singleton CHECK ((id = 1))
);


--
-- Name: prospeccao_contatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_contatos (
    id bigint NOT NULL,
    lead_id bigint NOT NULL,
    canal character varying(20) NOT NULL,
    resultado character varying(50),
    mensagem text,
    realizado_por bigint,
    realizado_por_nome character varying(150),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospeccao_contatos_canal_check CHECK (((canal)::text = ANY ((ARRAY['WHATSAPP'::character varying, 'TELEFONE'::character varying, 'EMAIL'::character varying, 'LINKEDIN'::character varying, 'OUTRO'::character varying])::text[])))
);


--
-- Name: prospeccao_contatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospeccao_contatos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospeccao_contatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospeccao_contatos_id_seq OWNED BY public.prospeccao_contatos.id;


--
-- Name: prospeccao_envios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_envios (
    id bigint NOT NULL,
    lead_id bigint NOT NULL,
    modelo_id bigint,
    session_name character varying(100) NOT NULL,
    telefone character varying(30) NOT NULL,
    mensagem text NOT NULL,
    status character varying(30) DEFAULT 'AGENDADO'::character varying NOT NULL,
    agendado_para timestamp with time zone DEFAULT now() NOT NULL,
    aprovado_por bigint,
    enviado_em timestamp with time zone,
    waha_message_id text,
    erro text,
    tentativas integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospeccao_envios_status_check CHECK (((status)::text = ANY ((ARRAY['AGENDADO'::character varying, 'PROCESSANDO'::character varying, 'ENVIADO'::character varying, 'FALHA'::character varying, 'CANCELADO'::character varying])::text[])))
);


--
-- Name: prospeccao_envios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.prospeccao_envios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.prospeccao_envios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: prospeccao_execucoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_execucoes (
    id bigint NOT NULL,
    apify_run_id text,
    apify_dataset_id text,
    actor_id text NOT NULL,
    termo_busca text NOT NULL,
    localizacao text NOT NULL,
    quantidade_solicitada integer NOT NULL,
    status character varying(30) DEFAULT 'PREPARANDO'::character varying NOT NULL,
    custo_estimado_usd numeric(12,4) DEFAULT 0 NOT NULL,
    custo_real_usd numeric(12,4),
    quantidade_encontrada integer DEFAULT 0 NOT NULL,
    quantidade_importada integer DEFAULT 0 NOT NULL,
    quantidade_duplicada integer DEFAULT 0 NOT NULL,
    erro text,
    input_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    retorno_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    iniciado_por bigint,
    iniciado_por_nome character varying(150),
    iniciado_at timestamp with time zone DEFAULT now() NOT NULL,
    concluido_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospeccao_exec_quantidade_check CHECK (((quantidade_solicitada >= 1) AND (quantidade_solicitada <= 1000))),
    CONSTRAINT prospeccao_exec_status_check CHECK (((status)::text = ANY ((ARRAY['PREPARANDO'::character varying, 'RUNNING'::character varying, 'READY'::character varying, 'SUCCEEDED'::character varying, 'FAILED'::character varying, 'TIMING-OUT'::character varying, 'ABORTING'::character varying, 'ABORTED'::character varying, 'TIMED-OUT'::character varying])::text[])))
);


--
-- Name: prospeccao_execucoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospeccao_execucoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospeccao_execucoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospeccao_execucoes_id_seq OWNED BY public.prospeccao_execucoes.id;


--
-- Name: prospeccao_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_leads (
    id bigint NOT NULL,
    execucao_id bigint,
    empresa_nome text NOT NULL,
    categoria text,
    categorias jsonb DEFAULT '[]'::jsonb NOT NULL,
    telefone text,
    telefone_normalizado text,
    website text,
    dominio text,
    email text,
    endereco text,
    bairro text,
    cidade text,
    estado text,
    cep text,
    pais text,
    google_place_id text,
    google_maps_url text,
    latitude numeric(12,8),
    longitude numeric(12,8),
    avaliacao numeric(4,2),
    quantidade_avaliacoes integer,
    score integer DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'NOVO'::character varying NOT NULL,
    prioridade character varying(15) DEFAULT 'MEDIA'::character varying NOT NULL,
    nao_contatar boolean DEFAULT false NOT NULL,
    motivo_descarte text,
    responsavel_id bigint,
    observacao text,
    dados_brutos jsonb DEFAULT '{}'::jsonb NOT NULL,
    coletado_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    contato_autorizado boolean DEFAULT false NOT NULL,
    contato_autorizado_origem character varying(200),
    contato_autorizado_em timestamp with time zone,
    resposta_tipo character varying(30),
    resposta_ultima_at timestamp with time zone,
    primeiro_contato_at timestamp with time zone,
    CONSTRAINT prospeccao_lead_prioridade_check CHECK (((prioridade)::text = ANY ((ARRAY['BAIXA'::character varying, 'MEDIA'::character varying, 'ALTA'::character varying])::text[]))),
    CONSTRAINT prospeccao_lead_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT prospeccao_lead_status_check CHECK (((status)::text = ANY ((ARRAY['NOVO'::character varying, 'EM_ANALISE'::character varying, 'APROVADO_CONTATO'::character varying, 'PRIMEIRO_CONTATO'::character varying, 'RESPONDEU'::character varying, 'REUNIAO'::character varying, 'PROPOSTA'::character varying, 'CLIENTE'::character varying, 'DESCARTADO'::character varying, 'SEM_INTERESSE'::character varying, 'CONTATO_INVALIDO'::character varying, 'NAO_CONTATAR'::character varying])::text[])))
);


--
-- Name: prospeccao_leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospeccao_leads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospeccao_leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospeccao_leads_id_seq OWNED BY public.prospeccao_leads.id;


--
-- Name: prospeccao_modelos_mensagem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_modelos_mensagem (
    id bigint NOT NULL,
    nome character varying(120) NOT NULL,
    mensagem text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_por bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prospeccao_modelos_mensagem_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.prospeccao_modelos_mensagem ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.prospeccao_modelos_mensagem_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: prospeccao_notas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_notas (
    id bigint NOT NULL,
    lead_id bigint NOT NULL,
    nota text NOT NULL,
    criado_por bigint,
    criado_por_nome character varying(150),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prospeccao_notas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospeccao_notas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospeccao_notas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospeccao_notas_id_seq OWNED BY public.prospeccao_notas.id;


--
-- Name: prospeccao_respostas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospeccao_respostas (
    id bigint NOT NULL,
    lead_id bigint,
    session_name character varying(100) NOT NULL,
    telefone character varying(30) NOT NULL,
    message_id text,
    mensagem text,
    classificacao character varying(30) NOT NULL,
    regra_detectada character varying(120),
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospeccao_respostas_classificacao_check CHECK (((classificacao)::text = ANY ((ARRAY['HUMANA'::character varying, 'AUTOMATICA'::character varying, 'DESCADASTRO'::character varying, 'VAZIA'::character varying])::text[])))
);


--
-- Name: prospeccao_respostas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.prospeccao_respostas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.prospeccao_respostas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recrutador_agendas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recrutador_agendas (
    usuario_id bigint NOT NULL,
    dias_semana smallint[] DEFAULT ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint] NOT NULL,
    horarios jsonb DEFAULT '["09:00", "10:00", "14:00", "15:00"]'::jsonb NOT NULL,
    duracao_minutos integer DEFAULT 30 NOT NULL,
    busca_dias integer DEFAULT 7 NOT NULL,
    evitar_feriados boolean DEFAULT true NOT NULL,
    timezone character varying(80) DEFAULT 'America/Sao_Paulo'::character varying NOT NULL,
    google_calendar_id text,
    whatsapp_alerta character varying(30),
    ativa boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recrutador_agenda_busca_check CHECK (((busca_dias >= 1) AND (busca_dias <= 60))),
    CONSTRAINT recrutador_agenda_dias_check CHECK (((cardinality(dias_semana) >= 1) AND (cardinality(dias_semana) <= 7))),
    CONSTRAINT recrutador_agenda_duracao_check CHECK (((duracao_minutos >= 10) AND (duracao_minutos <= 180))),
    CONSTRAINT recrutador_agenda_horarios_check CHECK ((jsonb_typeof(horarios) = 'array'::text))
);


--
-- Name: vaga_artes_ia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vaga_artes_ia (
    id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    versao integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'PRONTA'::character varying NOT NULL,
    modelo character varying(80) NOT NULL,
    prompt text NOT NULL,
    imagem bytea NOT NULL,
    mime_type character varying(60) DEFAULT 'image/jpeg'::character varying NOT NULL,
    largura integer,
    altura integer,
    ativa boolean DEFAULT true NOT NULL,
    criado_por bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vaga_artes_status_check CHECK (((status)::text = ANY ((ARRAY['PRONTA'::character varying, 'FALHA'::character varying, 'ARQUIVADA'::character varying])::text[])))
);


--
-- Name: vaga_artes_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vaga_artes_ia ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vaga_artes_ia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vaga_perguntas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vaga_perguntas (
    id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    versao_id bigint NOT NULL,
    codigo character varying(80) NOT NULL,
    ordem integer NOT NULL,
    texto character varying(500) NOT NULL,
    tipo character varying(30) NOT NULL,
    finalidade character varying(30) DEFAULT 'CLASSIFICATORIA'::character varying NOT NULL,
    obrigatoria boolean DEFAULT true NOT NULL,
    opcoes jsonb DEFAULT '[]'::jsonb NOT NULL,
    regra_operador character varying(30) DEFAULT 'SEMPRE'::character varying NOT NULL,
    regra_valor jsonb,
    pontos integer DEFAULT 0 NOT NULL,
    mensagem_nao_atende character varying(600),
    ativa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vaga_perguntas_eliminatoria_objetiva CHECK ((((finalidade)::text <> 'ELIMINATORIA'::text) OR ((tipo)::text = ANY ((ARRAY['SIM_NAO'::character varying, 'UNICA_ESCOLHA'::character varying, 'MULTIPLA_ESCOLHA'::character varying, 'NUMERO'::character varying])::text[])))),
    CONSTRAINT vaga_perguntas_finalidade_valida CHECK (((finalidade)::text = ANY ((ARRAY['ELIMINATORIA'::character varying, 'CLASSIFICATORIA'::character varying, 'ABERTA'::character varying])::text[]))),
    CONSTRAINT vaga_perguntas_opcoes_array CHECK ((jsonb_typeof(opcoes) = 'array'::text)),
    CONSTRAINT vaga_perguntas_operador_valido CHECK (((regra_operador)::text = ANY ((ARRAY['SEMPRE'::character varying, 'IGUAL'::character varying, 'DIFERENTE'::character varying, 'MAIOR_IGUAL'::character varying, 'MENOR_IGUAL'::character varying, 'CONTEM_QUALQUER'::character varying, 'CONTEM_TODOS'::character varying])::text[]))),
    CONSTRAINT vaga_perguntas_ordem_positiva CHECK ((ordem > 0)),
    CONSTRAINT vaga_perguntas_pontos_validos CHECK (((pontos >= 0) AND (pontos <= 1000))),
    CONSTRAINT vaga_perguntas_tipo_valido CHECK (((tipo)::text = ANY ((ARRAY['SIM_NAO'::character varying, 'UNICA_ESCOLHA'::character varying, 'MULTIPLA_ESCOLHA'::character varying, 'NUMERO'::character varying, 'TEXTO_CURTO'::character varying, 'TEXTO_LONGO'::character varying])::text[])))
);


--
-- Name: vaga_perguntas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vaga_perguntas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vaga_perguntas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vaga_triagem_versoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vaga_triagem_versoes (
    id bigint NOT NULL,
    vaga_id bigint NOT NULL,
    numero integer NOT NULL,
    status character varying(20) DEFAULT 'ATIVA'::character varying NOT NULL,
    criado_por bigint,
    criado_por_nome character varying(150),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    arquivada_at timestamp with time zone,
    CONSTRAINT vaga_triagem_versoes_numero_positivo CHECK ((numero > 0)),
    CONSTRAINT vaga_triagem_versoes_status_valido CHECK (((status)::text = ANY ((ARRAY['ATIVA'::character varying, 'ARQUIVADA'::character varying])::text[])))
);


--
-- Name: vaga_triagem_versoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vaga_triagem_versoes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vaga_triagem_versoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vagas (
    id bigint NOT NULL,
    empresa_id bigint NOT NULL,
    codigo character varying(50) NOT NULL,
    titulo character varying(150) NOT NULL,
    cargo character varying(150) NOT NULL,
    descricao text,
    cidade character varying(100),
    estado character(2) DEFAULT 'SP'::bpchar NOT NULL,
    bairro character varying(100),
    endereco_referencia text,
    tipo_contrato character varying(50),
    modalidade character varying(30) DEFAULT 'Presencial'::character varying NOT NULL,
    escala character varying(100),
    horario character varying(150),
    salario numeric(10,2),
    beneficios text,
    escolaridade_minima character varying(100),
    experiencia_minima_meses integer DEFAULT 0 NOT NULL,
    aceita_sem_experiencia boolean DEFAULT false NOT NULL,
    requisitos_obrigatorios text,
    requisitos_desejaveis text,
    quantidade_vagas integer DEFAULT 1 NOT NULL,
    formulario_url text,
    status character varying(20) DEFAULT 'RASCUNHO'::character varying NOT NULL,
    data_inicio date,
    data_encerramento date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    exigir_experiencia_compativel boolean DEFAULT true NOT NULL,
    cargos_compativeis text,
    cbos_compativeis text,
    possui_insalubridade boolean DEFAULT false NOT NULL,
    percentual_insalubridade numeric(5,2),
    observacao_insalubridade text,
    publicar_portal boolean DEFAULT true NOT NULL,
    destaque_portal boolean DEFAULT false NOT NULL,
    atendimento_chatbot boolean DEFAULT true NOT NULL,
    canal_candidatura character varying(30) DEFAULT 'WHATSAPP_GENESIS'::character varying NOT NULL,
    candidatura_url text,
    candidatura_email character varying(200),
    whatsapp_candidatura character varying(30),
    imagem_capa_url text,
    seo_titulo character varying(180),
    seo_descricao character varying(320),
    portal_publicado_em timestamp with time zone,
    origem_vaga character varying(40) DEFAULT 'RECRUTADOR_INTERNO'::character varying NOT NULL,
    vale_refeicao_valor numeric(12,2),
    vale_alimentacao_valor numeric(12,2),
    premio_assiduidade_valor numeric(12,2),
    outros_beneficios_valor numeric(12,2),
    vale_transporte_descricao text,
    beneficios_observacao text,
    sexo character varying(20) DEFAULT 'UNISSEX'::character varying NOT NULL,
    idade_minima integer DEFAULT 25 NOT NULL,
    entrevista_dias_semana smallint[] DEFAULT ARRAY[(1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint, (5)::smallint] NOT NULL,
    entrevista_horarios jsonb DEFAULT '["09:00", "10:00", "14:00", "15:00"]'::jsonb NOT NULL,
    entrevista_duracao_minutos integer DEFAULT 30 NOT NULL,
    entrevista_busca_dias integer DEFAULT 7 NOT NULL,
    entrevista_evitar_feriados boolean DEFAULT true NOT NULL,
    idade_maxima integer,
    experiencia_revisao_minima_meses integer DEFAULT 0 NOT NULL,
    permitir_experiencia_informal_revisao boolean DEFAULT false NOT NULL,
    chatbot_estatico_ativo boolean DEFAULT true NOT NULL,
    recrutador_responsavel_id bigint,
    agenda_personalizada boolean DEFAULT false NOT NULL,
    CONSTRAINT vagas_canal_candidatura_check CHECK (((canal_candidatura)::text = ANY ((ARRAY['WHATSAPP_GENESIS'::character varying, 'URL_EXTERNA'::character varying, 'EMAIL'::character varying])::text[]))),
    CONSTRAINT vagas_canal_candidatura_valido CHECK (((canal_candidatura)::text = ANY ((ARRAY['WHATSAPP_GENESIS'::character varying, 'URL_EXTERNA'::character varying, 'EMAIL'::character varying])::text[]))),
    CONSTRAINT vagas_entrevista_busca_dias_valida CHECK (((entrevista_busca_dias >= 1) AND (entrevista_busca_dias <= 60))),
    CONSTRAINT vagas_entrevista_duracao_valida CHECK (((entrevista_duracao_minutos >= 10) AND (entrevista_duracao_minutos <= 180))),
    CONSTRAINT vagas_experiencia_nao_negativa CHECK ((experiencia_minima_meses >= 0)),
    CONSTRAINT vagas_experiencia_revisao_ate_exigida CHECK ((experiencia_revisao_minima_meses <= experiencia_minima_meses)),
    CONSTRAINT vagas_experiencia_revisao_nao_negativa CHECK ((experiencia_revisao_minima_meses >= 0)),
    CONSTRAINT vagas_faixa_etaria_valida CHECK (((idade_maxima IS NULL) OR (idade_maxima >= idade_minima))),
    CONSTRAINT vagas_idade_maxima_valida CHECK (((idade_maxima IS NULL) OR ((idade_maxima >= 14) AND (idade_maxima <= 100)))),
    CONSTRAINT vagas_idade_minima_valida CHECK (((idade_minima >= 14) AND (idade_minima <= 100))),
    CONSTRAINT vagas_percentual_insalubridade_valido CHECK (((percentual_insalubridade IS NULL) OR ((percentual_insalubridade >= (0)::numeric) AND (percentual_insalubridade <= (100)::numeric)))),
    CONSTRAINT vagas_quantidade_positiva CHECK ((quantidade_vagas >= 1)),
    CONSTRAINT vagas_salario_nao_negativo CHECK (((salario IS NULL) OR (salario >= (0)::numeric))),
    CONSTRAINT vagas_sexo_valido CHECK (((sexo)::text = ANY ((ARRAY['MASCULINO'::character varying, 'FEMININO'::character varying, 'UNISSEX'::character varying])::text[]))),
    CONSTRAINT vagas_status_valido CHECK (((status)::text = ANY ((ARRAY['RASCUNHO'::character varying, 'ATIVA'::character varying, 'PAUSADA'::character varying, 'ENCERRADA'::character varying])::text[])))
);


--
-- Name: COLUMN vagas.vale_refeicao_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.vale_refeicao_valor IS 'Valor mensal aproximado do VR para divulgação.';


--
-- Name: COLUMN vagas.vale_alimentacao_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.vale_alimentacao_valor IS 'Valor mensal aproximado do VA para divulgação.';


--
-- Name: COLUMN vagas.premio_assiduidade_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.premio_assiduidade_valor IS 'Valor mensal aproximado do prêmio de assiduidade.';


--
-- Name: COLUMN vagas.outros_beneficios_valor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.outros_beneficios_valor IS 'Soma mensal aproximada de outros benefícios monetários.';


--
-- Name: COLUMN vagas.vale_transporte_descricao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.vale_transporte_descricao IS 'Descrição do VT; não entra no cálculo de ganhos aproximados.';


--
-- Name: COLUMN vagas.beneficios_observacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vagas.beneficios_observacao IS 'Observações adicionais sobre benefícios e regras de pagamento.';


--
-- Name: vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vagas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vagas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: vagas_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vagas_templates (
    id bigint NOT NULL,
    nome character varying(160) NOT NULL,
    descricao text,
    empresa_id bigint,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_por text,
    atualizado_por text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vagas_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.vagas_templates ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.vagas_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: workflow_erros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_erros (
    id bigint NOT NULL,
    workflow_id text,
    workflow_nome text,
    execution_id text,
    node_nome text,
    erro_tipo text,
    erro_mensagem text NOT NULL,
    telefone text,
    candidato_id bigint,
    payload jsonb,
    resolvido boolean DEFAULT false NOT NULL,
    resolvido_por text,
    resolvido_em timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workflow_erros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.workflow_erros ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workflow_erros_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: workflow_execucao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_execucao (
    id bigint NOT NULL,
    candidato_id bigint,
    workflow character varying(100),
    etapa character varying(100),
    status character varying(50),
    inicio timestamp without time zone DEFAULT now(),
    fim timestamp without time zone,
    erro text
);


--
-- Name: workflow_execucao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_execucao_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_execucao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_execucao_id_seq OWNED BY public.workflow_execucao.id;


--
-- Name: app_auditoria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_auditoria ALTER COLUMN id SET DEFAULT nextval('public.app_auditoria_id_seq'::regclass);


--
-- Name: app_usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_usuarios ALTER COLUMN id SET DEFAULT nextval('public.app_usuarios_id_seq'::regclass);


--
-- Name: candidatos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos ALTER COLUMN id SET DEFAULT nextval('public.candidatos_id_seq'::regclass);


--
-- Name: documentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos ALTER COLUMN id SET DEFAULT nextval('public.documentos_id_seq'::regclass);


--
-- Name: entrevista_opcoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevista_opcoes ALTER COLUMN id SET DEFAULT nextval('public.entrevista_opcoes_id_seq'::regclass);


--
-- Name: entrevistas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas ALTER COLUMN id SET DEFAULT nextval('public.entrevistas_id_seq'::regclass);


--
-- Name: eventos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos ALTER COLUMN id SET DEFAULT nextval('public.eventos_id_seq'::regclass);


--
-- Name: gg_group_clicks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_clicks ALTER COLUMN id SET DEFAULT nextval('public.gg_group_clicks_id_seq'::regclass);


--
-- Name: gg_group_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_reports ALTER COLUMN id SET DEFAULT nextval('public.gg_group_reports_id_seq'::regclass);


--
-- Name: gg_group_views id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_views ALTER COLUMN id SET DEFAULT nextval('public.gg_group_views_id_seq'::regclass);


--
-- Name: gg_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_groups ALTER COLUMN id SET DEFAULT nextval('public.gg_groups_id_seq'::regclass);


--
-- Name: gg_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_jobs ALTER COLUMN id SET DEFAULT nextval('public.gg_jobs_id_seq'::regclass);


--
-- Name: mensagens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensagens ALTER COLUMN id SET DEFAULT nextval('public.mensagens_id_seq'::regclass);


--
-- Name: n8n_chat_histories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.n8n_chat_histories ALTER COLUMN id SET DEFAULT nextval('public.n8n_chat_histories_id_seq'::regclass);


--
-- Name: portal_contas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_contas ALTER COLUMN id SET DEFAULT nextval('public.portal_contas_id_seq'::regclass);


--
-- Name: portal_vagas_submissoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vagas_submissoes ALTER COLUMN id SET DEFAULT nextval('public.portal_vagas_submissoes_id_seq'::regclass);


--
-- Name: prospeccao_contatos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_contatos ALTER COLUMN id SET DEFAULT nextval('public.prospeccao_contatos_id_seq'::regclass);


--
-- Name: prospeccao_execucoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_execucoes ALTER COLUMN id SET DEFAULT nextval('public.prospeccao_execucoes_id_seq'::regclass);


--
-- Name: prospeccao_leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_leads ALTER COLUMN id SET DEFAULT nextval('public.prospeccao_leads_id_seq'::regclass);


--
-- Name: prospeccao_notas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_notas ALTER COLUMN id SET DEFAULT nextval('public.prospeccao_notas_id_seq'::regclass);


--
-- Name: workflow_execucao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execucao ALTER COLUMN id SET DEFAULT nextval('public.workflow_execucao_id_seq'::regclass);


--
-- Name: alertas_resolvidos alertas_resolvidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_resolvidos
    ADD CONSTRAINT alertas_resolvidos_pkey PRIMARY KEY (chave);


--
-- Name: app_auditoria app_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_auditoria
    ADD CONSTRAINT app_auditoria_pkey PRIMARY KEY (id);


--
-- Name: app_usuarios app_usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_usuarios
    ADD CONSTRAINT app_usuarios_pkey PRIMARY KEY (id);


--
-- Name: app_usuarios app_usuarios_usuario_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_usuarios
    ADD CONSTRAINT app_usuarios_usuario_unico UNIQUE (usuario);


--
-- Name: atendimento_logs atendimento_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_logs
    ADD CONSTRAINT atendimento_logs_pkey PRIMARY KEY (id);


--
-- Name: auditoria_candidatos auditoria_candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_candidatos
    ADD CONSTRAINT auditoria_candidatos_pkey PRIMARY KEY (id);


--
-- Name: auditoria_feedback auditoria_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_feedback
    ADD CONSTRAINT auditoria_feedback_pkey PRIMARY KEY (id);


--
-- Name: auditoria_problemas auditoria_problemas_fingerprint_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_problemas
    ADD CONSTRAINT auditoria_problemas_fingerprint_unico UNIQUE (fingerprint);


--
-- Name: auditoria_problemas auditoria_problemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_problemas
    ADD CONSTRAINT auditoria_problemas_pkey PRIMARY KEY (id);


--
-- Name: auditorias_conversas auditorias_conversas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditorias_conversas
    ADD CONSTRAINT auditorias_conversas_pkey PRIMARY KEY (id);


--
-- Name: candidato_estado candidato_estado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_estado
    ADD CONSTRAINT candidato_estado_pkey PRIMARY KEY (candidato_id);


--
-- Name: candidato_etapas_historico candidato_etapas_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_etapas_historico
    ADD CONSTRAINT candidato_etapas_historico_pkey PRIMARY KEY (id);


--
-- Name: candidato_etiquetas candidato_etiquetas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_etiquetas
    ADD CONSTRAINT candidato_etiquetas_pkey PRIMARY KEY (candidato_id, etiqueta_id);


--
-- Name: candidato_followups candidato_followups_candidato_id_etapa_tentativa_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_followups
    ADD CONSTRAINT candidato_followups_candidato_id_etapa_tentativa_key UNIQUE (candidato_id, etapa, tentativa);


--
-- Name: candidato_followups candidato_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_followups
    ADD CONSTRAINT candidato_followups_pkey PRIMARY KEY (id);


--
-- Name: candidato_notas candidato_notas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_notas
    ADD CONSTRAINT candidato_notas_pkey PRIMARY KEY (id);


--
-- Name: candidato_reprovacoes_historico candidato_reprovacoes_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_reprovacoes_historico
    ADD CONSTRAINT candidato_reprovacoes_historico_pkey PRIMARY KEY (id);


--
-- Name: candidato_resgates candidato_resgates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_resgates
    ADD CONSTRAINT candidato_resgates_pkey PRIMARY KEY (id);


--
-- Name: candidato_respostas_triagem candidato_respostas_pergunta_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_pergunta_unica UNIQUE (triagem_id, pergunta_id);


--
-- Name: candidato_respostas_triagem candidato_respostas_triagem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_triagem_pkey PRIMARY KEY (id);


--
-- Name: candidato_revisoes candidato_revisoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_revisoes
    ADD CONSTRAINT candidato_revisoes_pkey PRIMARY KEY (id);


--
-- Name: candidato_tarefas candidato_tarefas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_tarefas
    ADD CONSTRAINT candidato_tarefas_pkey PRIMARY KEY (id);


--
-- Name: candidato_triagens candidato_triagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_triagens
    ADD CONSTRAINT candidato_triagens_pkey PRIMARY KEY (id);


--
-- Name: candidatos candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_pkey PRIMARY KEY (id);


--
-- Name: candidatos candidatos_telefone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_telefone_key UNIQUE (telefone);


--
-- Name: configuracao_grupo_vagas configuracao_grupo_vagas_grupo_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracao_grupo_vagas
    ADD CONSTRAINT configuracao_grupo_vagas_grupo_id_key UNIQUE (grupo_id);


--
-- Name: configuracao_grupo_vagas configuracao_grupo_vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracao_grupo_vagas
    ADD CONSTRAINT configuracao_grupo_vagas_pkey PRIMARY KEY (id);


--
-- Name: divulgacao_vagas_envios divulgacao_vagas_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divulgacao_vagas_envios
    ADD CONSTRAINT divulgacao_vagas_envios_pkey PRIMARY KEY (id);


--
-- Name: documentos documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);


--
-- Name: empresa_marcas empresa_marcas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_marcas
    ADD CONSTRAINT empresa_marcas_pkey PRIMARY KEY (empresa_id);


--
-- Name: empresas empresas_nome_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_nome_unico UNIQUE (nome);


--
-- Name: empresas empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas
    ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);


--
-- Name: entrevista_opcoes entrevista_opcoes_candidato_id_lote_opcao_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevista_opcoes
    ADD CONSTRAINT entrevista_opcoes_candidato_id_lote_opcao_key UNIQUE (candidato_id, lote, opcao);


--
-- Name: entrevista_opcoes entrevista_opcoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevista_opcoes
    ADD CONSTRAINT entrevista_opcoes_pkey PRIMARY KEY (id);


--
-- Name: entrevistas entrevistas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas
    ADD CONSTRAINT entrevistas_pkey PRIMARY KEY (id);


--
-- Name: etiquetas etiquetas_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etiquetas
    ADD CONSTRAINT etiquetas_nome_key UNIQUE (nome);


--
-- Name: etiquetas etiquetas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etiquetas
    ADD CONSTRAINT etiquetas_pkey PRIMARY KEY (id);


--
-- Name: eventos eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos
    ADD CONSTRAINT eventos_pkey PRIMARY KEY (id);


--
-- Name: genesis_chatbot_config genesis_chatbot_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_chatbot_config
    ADD CONSTRAINT genesis_chatbot_config_pkey PRIMARY KEY (id);


--
-- Name: genesis_chatbot_entrada_buffer genesis_chatbot_entrada_buffer_pkey_v13; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_chatbot_entrada_buffer
    ADD CONSTRAINT genesis_chatbot_entrada_buffer_pkey_v13 PRIMARY KEY (session, telefone);


--
-- Name: genesis_chatbot_interpretacoes genesis_chatbot_interpretacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_chatbot_interpretacoes
    ADD CONSTRAINT genesis_chatbot_interpretacoes_pkey PRIMARY KEY (id);


--
-- Name: genesis_demo_contatos genesis_demo_contatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_contatos
    ADD CONSTRAINT genesis_demo_contatos_pkey PRIMARY KEY (id);


--
-- Name: genesis_demo_contatos genesis_demo_contatos_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_contatos
    ADD CONSTRAINT genesis_demo_contatos_unico UNIQUE (demo_id, telefone);


--
-- Name: genesis_demo_mensagens genesis_demo_mensagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_mensagens
    ADD CONSTRAINT genesis_demo_mensagens_pkey PRIMARY KEY (id);


--
-- Name: genesis_demo_perguntas genesis_demo_perguntas_ordem_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_perguntas
    ADD CONSTRAINT genesis_demo_perguntas_ordem_unica UNIQUE (demo_id, ordem);


--
-- Name: genesis_demo_perguntas genesis_demo_perguntas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_perguntas
    ADD CONSTRAINT genesis_demo_perguntas_pkey PRIMARY KEY (id);


--
-- Name: genesis_demo_respostas genesis_demo_resposta_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_respostas
    ADD CONSTRAINT genesis_demo_resposta_unica UNIQUE (contato_id, pergunta_id);


--
-- Name: genesis_demo_respostas genesis_demo_respostas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_respostas
    ADD CONSTRAINT genesis_demo_respostas_pkey PRIMARY KEY (id);


--
-- Name: genesis_demos genesis_demos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demos
    ADD CONSTRAINT genesis_demos_pkey PRIMARY KEY (id);


--
-- Name: genesis_demos genesis_demos_session_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demos
    ADD CONSTRAINT genesis_demos_session_name_key UNIQUE (session_name);


--
-- Name: genesis_demos genesis_demos_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demos
    ADD CONSTRAINT genesis_demos_token_hash_key UNIQUE (token_hash);


--
-- Name: genesis_leads_recrutadores genesis_leads_recrutadores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_leads_recrutadores
    ADD CONSTRAINT genesis_leads_recrutadores_pkey PRIMARY KEY (id);


--
-- Name: gg_group_clicks gg_group_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_clicks
    ADD CONSTRAINT gg_group_clicks_pkey PRIMARY KEY (id);


--
-- Name: gg_group_reports gg_group_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_reports
    ADD CONSTRAINT gg_group_reports_pkey PRIMARY KEY (id);


--
-- Name: gg_group_views gg_group_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_views
    ADD CONSTRAINT gg_group_views_pkey PRIMARY KEY (id);


--
-- Name: gg_groups gg_groups_category_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.gg_groups
    ADD CONSTRAINT gg_groups_category_check CHECK (((category)::text = ANY ((ARRAY['Vagas gerais'::character varying, 'Limpeza e facilities'::character varying, 'Portaria e segurança'::character varying, 'Logística'::character varying, 'Atendimento e vendas'::character varying, 'Construção e manutenção'::character varying, 'Administrativo'::character varying, 'Tecnologia'::character varying, 'Free lances'::character varying, 'PCD'::character varying, 'Trabalho temporário'::character varying, 'Networking'::character varying, 'Dicas de carreira'::character varying, 'Primeiro emprego'::character varying, 'Estágio e jovem aprendiz'::character varying])::text[]))) NOT VALID;


--
-- Name: gg_groups gg_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_groups
    ADD CONSTRAINT gg_groups_pkey PRIMARY KEY (id);


--
-- Name: gg_groups gg_groups_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.gg_groups
    ADD CONSTRAINT gg_groups_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'suspended'::character varying, 'expired'::character varying])::text[]))) NOT VALID;


--
-- Name: gg_jobs gg_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_jobs
    ADD CONSTRAINT gg_jobs_pkey PRIMARY KEY (id);


--
-- Name: grupo_convites_envios grupo_convites_envios_candidato_id_grupo_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupo_convites_envios
    ADD CONSTRAINT grupo_convites_envios_candidato_id_grupo_id_key UNIQUE (candidato_id, grupo_id);


--
-- Name: grupo_convites_envios grupo_convites_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupo_convites_envios
    ADD CONSTRAINT grupo_convites_envios_pkey PRIMARY KEY (id);


--
-- Name: mensagens_buffer mensagens_buffer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensagens_buffer
    ADD CONSTRAINT mensagens_buffer_pkey PRIMARY KEY (candidato_id);


--
-- Name: mensagens mensagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensagens
    ADD CONSTRAINT mensagens_pkey PRIMARY KEY (id);


--
-- Name: n8n_chat_histories n8n_chat_histories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.n8n_chat_histories
    ADD CONSTRAINT n8n_chat_histories_pkey PRIMARY KEY (id);


--
-- Name: painel_configuracoes painel_configuracoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.painel_configuracoes
    ADD CONSTRAINT painel_configuracoes_pkey PRIMARY KEY (chave);


--
-- Name: portal_contas portal_contas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_contas
    ADD CONSTRAINT portal_contas_pkey PRIMARY KEY (id);


--
-- Name: portal_eventos portal_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_eventos
    ADD CONSTRAINT portal_eventos_pkey PRIMARY KEY (id);


--
-- Name: portal_grupo_imagens portal_grupo_imagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_grupo_imagens
    ADD CONSTRAINT portal_grupo_imagens_pkey PRIMARY KEY (grupo_id);


--
-- Name: portal_leads_empresas portal_leads_empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_leads_empresas
    ADD CONSTRAINT portal_leads_empresas_pkey PRIMARY KEY (id);


--
-- Name: portal_sessoes portal_sessoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessoes
    ADD CONSTRAINT portal_sessoes_pkey PRIMARY KEY (token_hash);


--
-- Name: portal_vaga_grupos portal_vaga_grupos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vaga_grupos
    ADD CONSTRAINT portal_vaga_grupos_pkey PRIMARY KEY (vaga_id, grupo_id);


--
-- Name: portal_vagas_submissoes portal_vagas_submissoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vagas_submissoes
    ADD CONSTRAINT portal_vagas_submissoes_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_configuracao prospeccao_configuracao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_configuracao
    ADD CONSTRAINT prospeccao_configuracao_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_contatos prospeccao_contatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_contatos
    ADD CONSTRAINT prospeccao_contatos_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_envios prospeccao_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_envios
    ADD CONSTRAINT prospeccao_envios_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_execucoes prospeccao_execucoes_apify_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_execucoes
    ADD CONSTRAINT prospeccao_execucoes_apify_run_id_key UNIQUE (apify_run_id);


--
-- Name: prospeccao_execucoes prospeccao_execucoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_execucoes
    ADD CONSTRAINT prospeccao_execucoes_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_leads prospeccao_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_leads
    ADD CONSTRAINT prospeccao_leads_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_modelos_mensagem prospeccao_modelos_mensagem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_modelos_mensagem
    ADD CONSTRAINT prospeccao_modelos_mensagem_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_notas prospeccao_notas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_notas
    ADD CONSTRAINT prospeccao_notas_pkey PRIMARY KEY (id);


--
-- Name: prospeccao_respostas prospeccao_respostas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_respostas
    ADD CONSTRAINT prospeccao_respostas_pkey PRIMARY KEY (id);


--
-- Name: recrutador_agendas recrutador_agendas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recrutador_agendas
    ADD CONSTRAINT recrutador_agendas_pkey PRIMARY KEY (usuario_id);


--
-- Name: gg_group_views uq_gg_group_view_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_views
    ADD CONSTRAINT uq_gg_group_view_day UNIQUE (group_id, visitor_day_hash);


--
-- Name: vaga_artes_ia vaga_artes_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_artes_ia
    ADD CONSTRAINT vaga_artes_ia_pkey PRIMARY KEY (id);


--
-- Name: vaga_artes_ia vaga_artes_versao_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_artes_ia
    ADD CONSTRAINT vaga_artes_versao_unica UNIQUE (vaga_id, versao);


--
-- Name: vaga_perguntas vaga_perguntas_codigo_versao_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_perguntas
    ADD CONSTRAINT vaga_perguntas_codigo_versao_unico UNIQUE (versao_id, codigo);


--
-- Name: vaga_perguntas vaga_perguntas_ordem_versao_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_perguntas
    ADD CONSTRAINT vaga_perguntas_ordem_versao_unica UNIQUE (versao_id, ordem);


--
-- Name: vaga_perguntas vaga_perguntas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_perguntas
    ADD CONSTRAINT vaga_perguntas_pkey PRIMARY KEY (id);


--
-- Name: vaga_triagem_versoes vaga_triagem_versoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_triagem_versoes
    ADD CONSTRAINT vaga_triagem_versoes_pkey PRIMARY KEY (id);


--
-- Name: vaga_triagem_versoes vaga_triagem_versoes_unica; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_triagem_versoes
    ADD CONSTRAINT vaga_triagem_versoes_unica UNIQUE (vaga_id, numero);


--
-- Name: vagas vagas_codigo_por_empresa_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas
    ADD CONSTRAINT vagas_codigo_por_empresa_unico UNIQUE (empresa_id, codigo);


--
-- Name: vagas vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas
    ADD CONSTRAINT vagas_pkey PRIMARY KEY (id);


--
-- Name: vagas_templates vagas_templates_nome_unico; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas_templates
    ADD CONSTRAINT vagas_templates_nome_unico UNIQUE (nome);


--
-- Name: vagas_templates vagas_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas_templates
    ADD CONSTRAINT vagas_templates_pkey PRIMARY KEY (id);


--
-- Name: workflow_erros workflow_erros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_erros
    ADD CONSTRAINT workflow_erros_pkey PRIMARY KEY (id);


--
-- Name: workflow_execucao workflow_execucao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execucao
    ADD CONSTRAINT workflow_execucao_pkey PRIMARY KEY (id);


--
-- Name: idx_app_auditoria_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_auditoria_created_at ON public.app_auditoria USING btree (created_at DESC);


--
-- Name: idx_app_auditoria_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_auditoria_usuario ON public.app_auditoria USING btree (usuario_id, created_at DESC);


--
-- Name: idx_app_usuarios_ativo_perfil; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_usuarios_ativo_perfil ON public.app_usuarios USING btree (ativo, perfil, nome);


--
-- Name: idx_app_usuarios_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_usuarios_empresa ON public.app_usuarios USING btree (empresa_id, ativo, nome);


--
-- Name: idx_atendimento_logs_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atendimento_logs_candidato ON public.atendimento_logs USING btree (candidato_id, created_at DESC);


--
-- Name: idx_atendimento_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atendimento_logs_created_at ON public.atendimento_logs USING btree (created_at DESC);


--
-- Name: idx_atendimento_logs_sem_vinculo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_atendimento_logs_sem_vinculo ON public.atendimento_logs USING btree (created_at DESC) WHERE (candidato_id IS NULL);


--
-- Name: idx_auditoria_candidatos_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_candidatos_candidato ON public.auditoria_candidatos USING btree (candidato_id, created_at DESC);


--
-- Name: idx_auditoria_candidatos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_candidatos_created_at ON public.auditoria_candidatos USING btree (created_at DESC);


--
-- Name: idx_auditoria_feedback_problema; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_feedback_problema ON public.auditoria_feedback USING btree (problema_id, created_at DESC);


--
-- Name: idx_auditoria_problemas_auditoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_problemas_auditoria ON public.auditoria_problemas USING btree (auditoria_id, created_at DESC);


--
-- Name: idx_auditoria_problemas_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_problemas_candidato ON public.auditoria_problemas USING btree (candidato_id, created_at DESC);


--
-- Name: idx_auditoria_problemas_status_gravidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_problemas_status_gravidade ON public.auditoria_problemas USING btree (status_revisao, gravidade, created_at DESC);


--
-- Name: idx_auditorias_conversas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditorias_conversas_created_at ON public.auditorias_conversas USING btree (created_at DESC);


--
-- Name: idx_candidato_etapas_historico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_etapas_historico ON public.candidato_etapas_historico USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_notas_candidato_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_notas_candidato_data ON public.candidato_notas USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_reprovacoes_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_reprovacoes_candidato ON public.candidato_reprovacoes_historico USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_reprovacoes_realocavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_reprovacoes_realocavel ON public.candidato_reprovacoes_historico USING btree (realocavel, categoria, created_at DESC);


--
-- Name: idx_candidato_reprovacoes_vaga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_reprovacoes_vaga ON public.candidato_reprovacoes_historico USING btree (vaga_id, created_at DESC);


--
-- Name: idx_candidato_resgates_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_resgates_candidato ON public.candidato_resgates USING btree (candidato_id, solicitado_em DESC);


--
-- Name: idx_candidato_resgates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_resgates_status ON public.candidato_resgates USING btree (status, solicitado_em DESC);


--
-- Name: idx_candidato_respostas_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_respostas_candidato ON public.candidato_respostas_triagem USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_revisoes_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_revisoes_candidato ON public.candidato_revisoes USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_revisoes_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_revisoes_pendentes ON public.candidato_revisoes USING btree (status, created_at DESC) WHERE ((status)::text = 'PENDENTE'::text);


--
-- Name: idx_candidato_tarefas_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_tarefas_candidato ON public.candidato_tarefas USING btree (candidato_id, created_at DESC);


--
-- Name: idx_candidato_tarefas_status_vencimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_tarefas_status_vencimento ON public.candidato_tarefas USING btree (status, vencimento);


--
-- Name: idx_candidato_telefone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_telefone ON public.candidatos USING btree (telefone);


--
-- Name: idx_candidato_triagens_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidato_triagens_candidato ON public.candidato_triagens USING btree (candidato_id, iniciado_at DESC);


--
-- Name: idx_candidatos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_created_at ON public.candidatos USING btree (created_at DESC);


--
-- Name: idx_candidatos_em_admissao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_em_admissao ON public.candidatos USING btree (admissao_iniciada_at DESC) WHERE ((status)::text = 'EM_ADMISSAO'::text);


--
-- Name: idx_candidatos_ia_atendimento_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_ia_atendimento_ativo ON public.candidatos USING btree (ia_atendimento_ativo, updated_at DESC);


--
-- Name: idx_candidatos_idade_confirmacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_idade_confirmacao ON public.candidatos USING btree (idade_confirmada_documentalmente, idade_pre_validada, status, updated_at DESC);


--
-- Name: idx_candidatos_processamento_bloqueado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_processamento_bloqueado ON public.candidatos USING btree (processamento_bloqueado_ate) WHERE (processamento_bloqueado_ate IS NOT NULL);


--
-- Name: idx_candidatos_realocacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_realocacao ON public.candidatos USING btree (reprovacao_realocavel, status, updated_at DESC) WHERE (((status)::text = 'REPROVADO'::text) AND (reprovacao_realocavel IS TRUE));


--
-- Name: idx_candidatos_sexo_busca; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_sexo_busca ON public.candidatos USING btree (sexo, status, updated_at DESC);


--
-- Name: idx_candidatos_sexo_revisao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_sexo_revisao ON public.candidatos USING btree (sexo_revisao_necessaria, vaga_id, updated_at DESC) WHERE (sexo_revisao_necessaria IS TRUE);


--
-- Name: idx_candidatos_status_etapa_atualizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_status_etapa_atualizacao ON public.candidatos USING btree (status, etapa, updated_at DESC);


--
-- Name: idx_candidatos_status_etapa_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_status_etapa_updated ON public.candidatos USING btree (status, etapa, updated_at DESC);


--
-- Name: idx_candidatos_vaga_escolhida_periodo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vaga_escolhida_periodo ON public.candidatos USING btree (vaga_id, vaga_escolhida_at DESC);


--
-- Name: idx_candidatos_vaga_etapa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vaga_etapa_status ON public.candidatos USING btree (vaga_id, etapa, status);


--
-- Name: idx_candidatos_vaga_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vaga_id ON public.candidatos USING btree (vaga_id);


--
-- Name: idx_divulgacao_vagas_envios_rotacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_divulgacao_vagas_envios_rotacao ON public.divulgacao_vagas_envios USING btree (vaga_id, grupo_id, enviado_em DESC);


--
-- Name: idx_divulgacao_vagas_envios_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_divulgacao_vagas_envios_status ON public.divulgacao_vagas_envios USING btree (status, created_at DESC);


--
-- Name: idx_documentos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos ON public.documentos USING btree (candidato_id);


--
-- Name: idx_documentos_candidato_tipo_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_candidato_tipo_data ON public.documentos USING btree (candidato_id, tipo, created_at DESC);


--
-- Name: idx_documentos_candidato_tipo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_candidato_tipo_status ON public.documentos USING btree (candidato_id, tipo, status_processamento);


--
-- Name: idx_documentos_hash_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_hash_candidato ON public.documentos USING btree (candidato_id, hash_sha256) WHERE (hash_sha256 IS NOT NULL);


--
-- Name: idx_documentos_processamento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_processamento ON public.documentos USING btree (status_processamento, created_at DESC);


--
-- Name: idx_documentos_processamento_pendente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_processamento_pendente ON public.documentos USING btree (status_processamento, processando_at, candidato_id) WHERE ((status_processamento)::text = 'PROCESSANDO'::text);


--
-- Name: idx_documentos_processando; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_processando ON public.documentos USING btree (created_at DESC) WHERE (upper((COALESCE(tipo, ''::character varying))::text) = 'PENDENTE'::text);


--
-- Name: idx_empresas_exibir_portal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empresas_exibir_portal ON public.empresas USING btree (ativo, exibir_no_portal, nome);


--
-- Name: idx_entrevista_opcoes_candidato_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrevista_opcoes_candidato_status ON public.entrevista_opcoes USING btree (candidato_id, status, expira_em);


--
-- Name: idx_entrevistas_inicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrevistas_inicio ON public.entrevistas USING btree (inicio);


--
-- Name: idx_entrevistas_inicio_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrevistas_inicio_status ON public.entrevistas USING btree (inicio, status);


--
-- Name: idx_entrevistas_status_inicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrevistas_status_inicio ON public.entrevistas USING btree (status, inicio);


--
-- Name: idx_etapa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_etapa ON public.candidatos USING btree (etapa);


--
-- Name: idx_eventos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eventos ON public.eventos USING btree (candidato_id);


--
-- Name: idx_eventos_candidato_data_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eventos_candidato_data_desc ON public.eventos USING btree (candidato_id, created_at DESC);


--
-- Name: idx_followups_candidato_etapa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_followups_candidato_etapa ON public.candidato_followups USING btree (candidato_id, etapa, tentativa DESC);


--
-- Name: idx_followups_status_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_followups_status_data ON public.candidato_followups USING btree (status, enviado_em DESC);


--
-- Name: idx_genesis_demos_status_expiracao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genesis_demos_status_expiracao ON public.genesis_demos USING btree (status, expira_em);


--
-- Name: idx_genesis_interpretacoes_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genesis_interpretacoes_candidato ON public.genesis_chatbot_interpretacoes USING btree (candidato_id, created_at DESC);


--
-- Name: idx_genesis_leads_recrutadores_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_genesis_leads_recrutadores_status ON public.genesis_leads_recrutadores USING btree (status, created_at DESC);


--
-- Name: idx_gg_groups_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gg_groups_owner ON public.gg_groups USING btree (owner_account_id, status, created_at DESC);


--
-- Name: idx_grupo_convites_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grupo_convites_status ON public.grupo_convites_envios USING btree (status, created_at DESC);


--
-- Name: idx_mensagens_buffer_ultima_mensagem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensagens_buffer_ultima_mensagem ON public.mensagens_buffer USING btree (ultima_mensagem_em);


--
-- Name: idx_mensagens_candidato_data_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensagens_candidato_data_desc ON public.mensagens USING btree (candidato_id, created_at DESC);


--
-- Name: idx_mensagens_contexto_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensagens_contexto_snapshot ON public.mensagens USING gin (contexto_snapshot) WHERE (contexto_snapshot IS NOT NULL);


--
-- Name: idx_mensagens_quem_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensagens_quem_created_at ON public.mensagens USING btree (quem, created_at DESC);


--
-- Name: idx_msg_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_msg_candidato ON public.mensagens USING btree (candidato_id);


--
-- Name: idx_portal_contas_lead_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_contas_lead_status ON public.portal_contas USING btree (lead_status, created_at DESC);


--
-- Name: idx_portal_contas_tipo_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_contas_tipo_created ON public.portal_contas USING btree (tipo, created_at DESC);


--
-- Name: idx_portal_eventos_sessao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_eventos_sessao ON public.portal_eventos USING btree (sessao_id, created_at DESC) WHERE (sessao_id IS NOT NULL);


--
-- Name: idx_portal_eventos_tipo_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_eventos_tipo_created ON public.portal_eventos USING btree (evento, created_at DESC);


--
-- Name: idx_portal_eventos_tipo_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_eventos_tipo_data ON public.portal_eventos USING btree (evento, created_at DESC);


--
-- Name: idx_portal_eventos_vaga_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_eventos_vaga_created ON public.portal_eventos USING btree (vaga_id, created_at DESC);


--
-- Name: idx_portal_eventos_vaga_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_eventos_vaga_data ON public.portal_eventos USING btree (vaga_id, created_at DESC);


--
-- Name: idx_portal_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_leads_email ON public.portal_leads_empresas USING btree (lower((email)::text));


--
-- Name: idx_portal_leads_empresas_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_leads_empresas_status_created ON public.portal_leads_empresas USING btree (status, created_at DESC);


--
-- Name: idx_portal_leads_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_leads_status_created ON public.portal_leads_empresas USING btree (status, created_at DESC);


--
-- Name: idx_portal_leads_whatsapp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_leads_whatsapp ON public.portal_leads_empresas USING btree (whatsapp);


--
-- Name: idx_portal_sessoes_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_sessoes_conta ON public.portal_sessoes USING btree (conta_id, expires_at DESC);


--
-- Name: idx_portal_sessoes_expira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_sessoes_expira ON public.portal_sessoes USING btree (expires_at);


--
-- Name: idx_portal_vaga_grupos_grupo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_vaga_grupos_grupo ON public.portal_vaga_grupos USING btree (grupo_id, status, created_at DESC);


--
-- Name: idx_portal_vagas_submissoes_conta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_vagas_submissoes_conta ON public.portal_vagas_submissoes USING btree (conta_id, status, created_at DESC);


--
-- Name: idx_portal_vagas_submissoes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_vagas_submissoes_status ON public.portal_vagas_submissoes USING btree (status, created_at DESC);


--
-- Name: idx_prospeccao_contatos_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_contatos_lead ON public.prospeccao_contatos USING btree (lead_id, created_at DESC);


--
-- Name: idx_prospeccao_envios_fila; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_envios_fila ON public.prospeccao_envios USING btree (status, agendado_para, created_at) WHERE ((status)::text = 'AGENDADO'::text);


--
-- Name: idx_prospeccao_execucoes_mes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_execucoes_mes ON public.prospeccao_execucoes USING btree (iniciado_at DESC);


--
-- Name: idx_prospeccao_execucoes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_execucoes_status ON public.prospeccao_execucoes USING btree (status, iniciado_at DESC);


--
-- Name: idx_prospeccao_leads_filtros_v14; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_leads_filtros_v14 ON public.prospeccao_leads USING btree (prioridade, responsavel_id, score DESC, created_at DESC);


--
-- Name: idx_prospeccao_leads_local; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_leads_local ON public.prospeccao_leads USING btree (estado, cidade, categoria);


--
-- Name: idx_prospeccao_leads_resposta_v14; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_leads_resposta_v14 ON public.prospeccao_leads USING btree (resposta_tipo, resposta_ultima_at DESC);


--
-- Name: idx_prospeccao_leads_status_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_leads_status_score ON public.prospeccao_leads USING btree (status, score DESC, created_at DESC);


--
-- Name: idx_prospeccao_notas_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_notas_lead ON public.prospeccao_notas USING btree (lead_id, created_at DESC);


--
-- Name: idx_prospeccao_respostas_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospeccao_respostas_lead ON public.prospeccao_respostas USING btree (lead_id, created_at DESC);


--
-- Name: idx_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status ON public.candidatos USING btree (status);


--
-- Name: idx_vaga_artes_historico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vaga_artes_historico ON public.vaga_artes_ia USING btree (vaga_id, created_at DESC);


--
-- Name: idx_vaga_perguntas_vaga_versao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vaga_perguntas_vaga_versao ON public.vaga_perguntas USING btree (vaga_id, versao_id, ordem) WHERE (ativa IS TRUE);


--
-- Name: idx_vagas_chatbot_ativas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_chatbot_ativas ON public.vagas USING btree (status, atendimento_chatbot, updated_at DESC);


--
-- Name: idx_vagas_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_codigo ON public.vagas USING btree (codigo);


--
-- Name: idx_vagas_empresa_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_empresa_id ON public.vagas USING btree (empresa_id);


--
-- Name: idx_vagas_portal_ativas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_portal_ativas ON public.vagas USING btree (status, publicar_portal, data_encerramento, updated_at DESC);


--
-- Name: idx_vagas_recrutador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_recrutador ON public.vagas USING btree (recrutador_responsavel_id, status, updated_at DESC);


--
-- Name: idx_vagas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_status ON public.vagas USING btree (status);


--
-- Name: idx_vagas_templates_ativo_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_templates_ativo_nome ON public.vagas_templates USING btree (ativo, nome);


--
-- Name: idx_vagas_titulo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_titulo ON public.vagas USING btree (titulo);


--
-- Name: idx_workflow_erros_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_erros_pendentes ON public.workflow_erros USING btree (created_at DESC) WHERE (resolvido IS FALSE);


--
-- Name: ix_gg_group_clicks_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_group_clicks_group_id ON public.gg_group_clicks USING btree (group_id);


--
-- Name: ix_gg_group_clicks_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_group_clicks_job_id ON public.gg_group_clicks USING btree (job_id, created_at DESC);


--
-- Name: ix_gg_group_reports_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_group_reports_group_id ON public.gg_group_reports USING btree (group_id);


--
-- Name: ix_gg_group_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_group_reports_status ON public.gg_group_reports USING btree (status);


--
-- Name: ix_gg_group_views_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_group_views_group_id ON public.gg_group_views USING btree (group_id);


--
-- Name: ix_gg_groups_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_category ON public.gg_groups USING btree (category);


--
-- Name: ix_gg_groups_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_city ON public.gg_groups USING btree (city);


--
-- Name: ix_gg_groups_public_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_public_search ON public.gg_groups USING btree (status, city, category);


--
-- Name: ix_gg_groups_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_region ON public.gg_groups USING btree (region);


--
-- Name: ix_gg_groups_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_gg_groups_slug ON public.gg_groups USING btree (slug);


--
-- Name: ix_gg_groups_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_state ON public.gg_groups USING btree (state);


--
-- Name: ix_gg_groups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_groups_status ON public.gg_groups USING btree (status);


--
-- Name: ix_gg_jobs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_category ON public.gg_jobs USING btree (category);


--
-- Name: ix_gg_jobs_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_city ON public.gg_jobs USING btree (city);


--
-- Name: ix_gg_jobs_public_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_public_search ON public.gg_jobs USING btree (status, city, category);


--
-- Name: ix_gg_jobs_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_region ON public.gg_jobs USING btree (region);


--
-- Name: ix_gg_jobs_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_gg_jobs_slug ON public.gg_jobs USING btree (slug);


--
-- Name: ix_gg_jobs_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_state ON public.gg_jobs USING btree (state);


--
-- Name: ix_gg_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gg_jobs_status ON public.gg_jobs USING btree (status);


--
-- Name: uq_atendimento_logs_mensagem_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_atendimento_logs_mensagem_id ON public.atendimento_logs USING btree (mensagem_id) WHERE (mensagem_id IS NOT NULL);


--
-- Name: uq_candidato_resposta_mensagem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_candidato_resposta_mensagem ON public.candidato_respostas_triagem USING btree (mensagem_id) WHERE ((mensagem_id IS NOT NULL) AND (btrim(mensagem_id) <> ''::text));


--
-- Name: uq_candidato_revisao_pendente_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_candidato_revisao_pendente_tipo ON public.candidato_revisoes USING btree (candidato_id, tipo) WHERE ((status)::text = 'PENDENTE'::text);


--
-- Name: uq_candidato_triagem_ativa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_candidato_triagem_ativa ON public.candidato_triagens USING btree (candidato_id, vaga_id) WHERE ((status)::text = ANY ((ARRAY['EM_ANDAMENTO'::character varying, 'REVISAO'::character varying])::text[]));


--
-- Name: uq_documentos_mensagem_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_documentos_mensagem_id ON public.documentos USING btree (mensagem_id) WHERE ((mensagem_id IS NOT NULL) AND (btrim(mensagem_id) <> ''::text));


--
-- Name: uq_entrevista_candidato_agendada; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entrevista_candidato_agendada ON public.entrevistas USING btree (candidato_id) WHERE ((status)::text = 'AGENDADA'::text);


--
-- Name: uq_entrevista_google_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entrevista_google_event ON public.entrevistas USING btree (google_event_id);


--
-- Name: uq_entrevistas_uma_agendada_por_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entrevistas_uma_agendada_por_candidato ON public.entrevistas USING btree (candidato_id) WHERE ((status)::text = 'AGENDADA'::text);


--
-- Name: uq_entrevistas_uma_ativa_por_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_entrevistas_uma_ativa_por_candidato ON public.entrevistas USING btree (candidato_id) WHERE ((status)::text = 'AGENDADA'::text);


--
-- Name: uq_genesis_demo_mensagem_externa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_genesis_demo_mensagem_externa ON public.genesis_demo_mensagens USING btree (demo_id, mensagem_id) WHERE ((mensagem_id IS NOT NULL) AND (btrim(mensagem_id) <> ''::text));


--
-- Name: uq_genesis_interpretacao_mensagem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_genesis_interpretacao_mensagem ON public.genesis_chatbot_interpretacoes USING btree (session, mensagem_id) WHERE ((mensagem_id IS NOT NULL) AND (btrim(mensagem_id) <> ''::text));


--
-- Name: uq_gg_groups_invite_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gg_groups_invite_hash ON public.gg_groups USING btree (invite_code_hash) WHERE (invite_code_hash IS NOT NULL);


--
-- Name: uq_mensagens_ia_lote_resposta; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mensagens_ia_lote_resposta ON public.mensagens USING btree (candidato_id, lote_resposta_id) WHERE (((quem)::text = 'IA'::text) AND (lote_resposta_id IS NOT NULL));


--
-- Name: uq_portal_contas_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_portal_contas_email_lower ON public.portal_contas USING btree (lower((email)::text));


--
-- Name: uq_prospeccao_leads_dominio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospeccao_leads_dominio ON public.prospeccao_leads USING btree (dominio) WHERE ((dominio IS NOT NULL) AND (btrim(dominio) <> ''::text));


--
-- Name: uq_prospeccao_leads_place_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospeccao_leads_place_id ON public.prospeccao_leads USING btree (google_place_id) WHERE ((google_place_id IS NOT NULL) AND (btrim(google_place_id) <> ''::text));


--
-- Name: uq_prospeccao_leads_telefone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospeccao_leads_telefone ON public.prospeccao_leads USING btree (telefone_normalizado) WHERE ((telefone_normalizado IS NOT NULL) AND (btrim(telefone_normalizado) <> ''::text));


--
-- Name: uq_prospeccao_primeiro_contato_aberto; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospeccao_primeiro_contato_aberto ON public.prospeccao_envios USING btree (lead_id) WHERE ((status)::text = ANY ((ARRAY['AGENDADO'::character varying, 'PROCESSANDO'::character varying, 'ENVIADO'::character varying])::text[]));


--
-- Name: uq_prospeccao_resposta_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prospeccao_resposta_message_id ON public.prospeccao_respostas USING btree (session_name, message_id) WHERE ((message_id IS NOT NULL) AND (btrim(message_id) <> ''::text));


--
-- Name: uq_vaga_arte_ativa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vaga_arte_ativa ON public.vaga_artes_ia USING btree (vaga_id) WHERE (ativa IS TRUE);


--
-- Name: uq_vaga_triagem_versao_ativa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vaga_triagem_versao_ativa ON public.vaga_triagem_versoes USING btree (vaga_id) WHERE ((status)::text = 'ATIVA'::text);


--
-- Name: uq_workflow_erros_execution_node; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workflow_erros_execution_node ON public.workflow_erros USING btree (execution_id, node_nome);


--
-- Name: ux_mensagens_mensagem_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_mensagens_mensagem_id ON public.mensagens USING btree (mensagem_id);


--
-- Name: auditoria_problemas auditoria_problemas_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auditoria_problemas_atualizar_updated_at BEFORE UPDATE ON public.auditoria_problemas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: candidatos candidatos_atualizar_compatibilidade_sexo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidatos_atualizar_compatibilidade_sexo BEFORE INSERT OR UPDATE OF sexo, sexo_nao_informado, vaga_id ON public.candidatos FOR EACH ROW EXECUTE FUNCTION public.genesis_atualizar_compatibilidade_sexo_candidato();


--
-- Name: candidatos candidatos_normalizar_status_etapa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidatos_normalizar_status_etapa BEFORE INSERT OR UPDATE OF status, etapa, aprovado, motivo_reprovacao, motivo_reprovacao_codigo, motivo_reprovacao_categoria, motivo_reprovacao_detalhe, idade_validada, idade_confirmada_documentalmente, data_nascimento, data_nascimento_origem ON public.candidatos FOR EACH ROW EXECUTE FUNCTION public.genesis_normalizar_status_etapa_candidato();


--
-- Name: candidatos candidatos_registrar_mudanca_etapa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidatos_registrar_mudanca_etapa AFTER UPDATE OF etapa, status ON public.candidatos FOR EACH ROW EXECUTE FUNCTION public.genesis_registrar_mudanca_etapa();


--
-- Name: empresa_marcas empresa_marcas_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER empresa_marcas_atualizar_updated_at BEFORE UPDATE ON public.empresa_marcas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: empresas empresas_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER empresas_atualizar_updated_at BEFORE UPDATE ON public.empresas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: gg_groups gg_groups_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER gg_groups_atualizar_updated_at BEFORE UPDATE ON public.gg_groups FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: portal_contas portal_contas_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_contas_atualizar_updated_at BEFORE UPDATE ON public.portal_contas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: portal_grupo_imagens portal_grupo_imagens_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_grupo_imagens_atualizar_updated_at BEFORE UPDATE ON public.portal_grupo_imagens FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: portal_leads_empresas portal_leads_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_leads_atualizar_updated_at BEFORE UPDATE ON public.portal_leads_empresas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: portal_vaga_grupos portal_vaga_grupos_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_vaga_grupos_atualizar_updated_at BEFORE UPDATE ON public.portal_vaga_grupos FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: portal_vagas_submissoes portal_vagas_submissoes_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER portal_vagas_submissoes_atualizar_updated_at BEFORE UPDATE ON public.portal_vagas_submissoes FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: recrutador_agendas recrutador_agenda_propagar_vagas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER recrutador_agenda_propagar_vagas AFTER INSERT OR UPDATE ON public.recrutador_agendas FOR EACH ROW EXECUTE FUNCTION public.genesis_propagar_agenda_recrutador();


--
-- Name: candidatos trg_genesis_auditar_candidato; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_genesis_auditar_candidato AFTER INSERT OR DELETE OR UPDATE ON public.candidatos FOR EACH ROW EXECUTE FUNCTION public.genesis_auditar_candidato();


--
-- Name: mensagens trg_genesis_chatbot_v1_normalizar_mensagem; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_genesis_chatbot_v1_normalizar_mensagem BEFORE INSERT OR UPDATE OF mensagem ON public.mensagens FOR EACH ROW EXECUTE FUNCTION public.genesis_chatbot_v1_normalizar_mensagem_trigger();


--
-- Name: genesis_demo_mensagens trg_genesis_normalizar_quebras_demo_mensagens; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_genesis_normalizar_quebras_demo_mensagens BEFORE INSERT OR UPDATE OF mensagem ON public.genesis_demo_mensagens FOR EACH ROW EXECUTE FUNCTION public.genesis_v13_normalizar_mensagem_trigger();


--
-- Name: mensagens trg_genesis_normalizar_quebras_mensagens; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_genesis_normalizar_quebras_mensagens BEFORE INSERT OR UPDATE OF mensagem ON public.mensagens FOR EACH ROW EXECUTE FUNCTION public.genesis_v13_normalizar_mensagem_trigger();


--
-- Name: vagas vagas_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_atualizar_updated_at BEFORE UPDATE ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: vagas vagas_definir_portal_publicado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_definir_portal_publicado_em BEFORE INSERT OR UPDATE OF status, publicar_portal ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.definir_portal_publicado_em();


--
-- Name: vagas vagas_genesis_portal_proteger_externa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_genesis_portal_proteger_externa BEFORE INSERT OR UPDATE OF origem_vaga, canal_candidatura, atendimento_chatbot ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.genesis_portal_proteger_vaga_externa();


--
-- Name: vagas vagas_genesis_portal_publicacao; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_genesis_portal_publicacao BEFORE UPDATE ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.genesis_portal_marcar_publicacao();


--
-- Name: vagas vagas_recalcular_compatibilidade_sexo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_recalcular_compatibilidade_sexo AFTER UPDATE OF sexo ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.genesis_recalcular_candidatos_apos_sexo_vaga();


--
-- Name: vagas_templates vagas_templates_atualizar_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vagas_templates_atualizar_updated_at BEFORE UPDATE ON public.vagas_templates FOR EACH ROW EXECUTE FUNCTION public.atualizar_updated_at();


--
-- Name: app_auditoria app_auditoria_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_auditoria
    ADD CONSTRAINT app_auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: app_usuarios app_usuarios_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_usuarios
    ADD CONSTRAINT app_usuarios_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: app_usuarios app_usuarios_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_usuarios
    ADD CONSTRAINT app_usuarios_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;


--
-- Name: atendimento_logs atendimento_logs_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.atendimento_logs
    ADD CONSTRAINT atendimento_logs_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE SET NULL;


--
-- Name: auditoria_feedback auditoria_feedback_problema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_feedback
    ADD CONSTRAINT auditoria_feedback_problema_id_fkey FOREIGN KEY (problema_id) REFERENCES public.auditoria_problemas(id) ON DELETE CASCADE;


--
-- Name: auditoria_problemas auditoria_problemas_auditoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_problemas
    ADD CONSTRAINT auditoria_problemas_auditoria_id_fkey FOREIGN KEY (auditoria_id) REFERENCES public.auditorias_conversas(id) ON DELETE CASCADE;


--
-- Name: auditoria_problemas auditoria_problemas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_problemas
    ADD CONSTRAINT auditoria_problemas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: auditoria_problemas auditoria_problemas_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_problemas
    ADD CONSTRAINT auditoria_problemas_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: candidato_estado candidato_estado_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_estado
    ADD CONSTRAINT candidato_estado_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_etapas_historico candidato_etapas_historico_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_etapas_historico
    ADD CONSTRAINT candidato_etapas_historico_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_etiquetas candidato_etiquetas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_etiquetas
    ADD CONSTRAINT candidato_etiquetas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_etiquetas candidato_etiquetas_etiqueta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_etiquetas
    ADD CONSTRAINT candidato_etiquetas_etiqueta_id_fkey FOREIGN KEY (etiqueta_id) REFERENCES public.etiquetas(id) ON DELETE CASCADE;


--
-- Name: candidato_followups candidato_followups_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_followups
    ADD CONSTRAINT candidato_followups_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_notas candidato_notas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_notas
    ADD CONSTRAINT candidato_notas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_reprovacoes_historico candidato_reprovacoes_historico_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_reprovacoes_historico
    ADD CONSTRAINT candidato_reprovacoes_historico_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_reprovacoes_historico candidato_reprovacoes_historico_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_reprovacoes_historico
    ADD CONSTRAINT candidato_reprovacoes_historico_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: candidato_resgates candidato_resgates_auditoria_problema_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_resgates
    ADD CONSTRAINT candidato_resgates_auditoria_problema_id_fkey FOREIGN KEY (auditoria_problema_id) REFERENCES public.auditoria_problemas(id) ON DELETE SET NULL;


--
-- Name: candidato_resgates candidato_resgates_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_resgates
    ADD CONSTRAINT candidato_resgates_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_respostas_triagem candidato_respostas_triagem_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_triagem_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_respostas_triagem candidato_respostas_triagem_pergunta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_triagem_pergunta_id_fkey FOREIGN KEY (pergunta_id) REFERENCES public.vaga_perguntas(id) ON DELETE RESTRICT;


--
-- Name: candidato_respostas_triagem candidato_respostas_triagem_triagem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_triagem_triagem_id_fkey FOREIGN KEY (triagem_id) REFERENCES public.candidato_triagens(id) ON DELETE CASCADE;


--
-- Name: candidato_respostas_triagem candidato_respostas_triagem_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_respostas_triagem
    ADD CONSTRAINT candidato_respostas_triagem_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: candidato_revisoes candidato_revisoes_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_revisoes
    ADD CONSTRAINT candidato_revisoes_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_revisoes candidato_revisoes_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_revisoes
    ADD CONSTRAINT candidato_revisoes_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE SET NULL;


--
-- Name: candidato_revisoes candidato_revisoes_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_revisoes
    ADD CONSTRAINT candidato_revisoes_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: candidato_tarefas candidato_tarefas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_tarefas
    ADD CONSTRAINT candidato_tarefas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_triagens candidato_triagens_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_triagens
    ADD CONSTRAINT candidato_triagens_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidato_triagens candidato_triagens_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_triagens
    ADD CONSTRAINT candidato_triagens_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: candidato_triagens candidato_triagens_versao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidato_triagens
    ADD CONSTRAINT candidato_triagens_versao_id_fkey FOREIGN KEY (versao_id) REFERENCES public.vaga_triagem_versoes(id) ON DELETE RESTRICT;


--
-- Name: candidatos candidatos_reprovacao_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_reprovacao_vaga_id_fkey FOREIGN KEY (reprovacao_vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: candidatos candidatos_vaga_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_vaga_id_fk FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: divulgacao_vagas_envios divulgacao_vagas_envios_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.divulgacao_vagas_envios
    ADD CONSTRAINT divulgacao_vagas_envios_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: documentos documentos_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: empresa_marcas empresa_marcas_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_marcas
    ADD CONSTRAINT empresa_marcas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: empresa_marcas empresa_marcas_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresa_marcas
    ADD CONSTRAINT empresa_marcas_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: entrevista_opcoes entrevista_opcoes_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevista_opcoes
    ADD CONSTRAINT entrevista_opcoes_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: entrevistas entrevistas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas
    ADD CONSTRAINT entrevistas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: entrevistas entrevistas_opcao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas
    ADD CONSTRAINT entrevistas_opcao_id_fkey FOREIGN KEY (opcao_id) REFERENCES public.entrevista_opcoes(id) ON DELETE SET NULL;


--
-- Name: entrevistas entrevistas_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas
    ADD CONSTRAINT entrevistas_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: eventos eventos_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eventos
    ADD CONSTRAINT eventos_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: genesis_chatbot_interpretacoes genesis_chatbot_interpretacoes_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_chatbot_interpretacoes
    ADD CONSTRAINT genesis_chatbot_interpretacoes_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: genesis_chatbot_interpretacoes genesis_chatbot_interpretacoes_pergunta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_chatbot_interpretacoes
    ADD CONSTRAINT genesis_chatbot_interpretacoes_pergunta_id_fkey FOREIGN KEY (pergunta_id) REFERENCES public.vaga_perguntas(id) ON DELETE SET NULL;


--
-- Name: genesis_demo_contatos genesis_demo_contatos_demo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_contatos
    ADD CONSTRAINT genesis_demo_contatos_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.genesis_demos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_mensagens genesis_demo_mensagens_contato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_mensagens
    ADD CONSTRAINT genesis_demo_mensagens_contato_id_fkey FOREIGN KEY (contato_id) REFERENCES public.genesis_demo_contatos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_mensagens genesis_demo_mensagens_demo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_mensagens
    ADD CONSTRAINT genesis_demo_mensagens_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.genesis_demos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_perguntas genesis_demo_perguntas_demo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_perguntas
    ADD CONSTRAINT genesis_demo_perguntas_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.genesis_demos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_respostas genesis_demo_respostas_contato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_respostas
    ADD CONSTRAINT genesis_demo_respostas_contato_id_fkey FOREIGN KEY (contato_id) REFERENCES public.genesis_demo_contatos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_respostas genesis_demo_respostas_demo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_respostas
    ADD CONSTRAINT genesis_demo_respostas_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.genesis_demos(id) ON DELETE CASCADE;


--
-- Name: genesis_demo_respostas genesis_demo_respostas_pergunta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demo_respostas
    ADD CONSTRAINT genesis_demo_respostas_pergunta_id_fkey FOREIGN KEY (pergunta_id) REFERENCES public.genesis_demo_perguntas(id) ON DELETE CASCADE;


--
-- Name: genesis_demos genesis_demos_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demos
    ADD CONSTRAINT genesis_demos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: genesis_demos genesis_demos_vaga_origem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.genesis_demos
    ADD CONSTRAINT genesis_demos_vaga_origem_id_fkey FOREIGN KEY (vaga_origem_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: gg_group_clicks gg_group_clicks_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_clicks
    ADD CONSTRAINT gg_group_clicks_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.gg_groups(id) ON DELETE CASCADE;


--
-- Name: gg_group_reports gg_group_reports_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_reports
    ADD CONSTRAINT gg_group_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.gg_groups(id) ON DELETE CASCADE;


--
-- Name: gg_group_reports gg_group_reports_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_reports
    ADD CONSTRAINT gg_group_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: gg_group_views gg_group_views_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_group_views
    ADD CONSTRAINT gg_group_views_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.gg_groups(id) ON DELETE CASCADE;


--
-- Name: gg_groups gg_groups_owner_account_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gg_groups
    ADD CONSTRAINT gg_groups_owner_account_fk FOREIGN KEY (owner_account_id) REFERENCES public.portal_contas(id) ON DELETE SET NULL;


--
-- Name: grupo_convites_envios grupo_convites_envios_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grupo_convites_envios
    ADD CONSTRAINT grupo_convites_envios_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: mensagens_buffer mensagens_buffer_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensagens_buffer
    ADD CONSTRAINT mensagens_buffer_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: mensagens mensagens_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensagens
    ADD CONSTRAINT mensagens_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: portal_eventos portal_eventos_vaga_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_eventos
    ADD CONSTRAINT portal_eventos_vaga_fk FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: portal_grupo_imagens portal_grupo_imagens_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_grupo_imagens
    ADD CONSTRAINT portal_grupo_imagens_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.gg_groups(id) ON DELETE CASCADE;


--
-- Name: portal_sessoes portal_sessoes_conta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessoes
    ADD CONSTRAINT portal_sessoes_conta_id_fkey FOREIGN KEY (conta_id) REFERENCES public.portal_contas(id) ON DELETE CASCADE;


--
-- Name: portal_vaga_grupos portal_vaga_grupos_grupo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vaga_grupos
    ADD CONSTRAINT portal_vaga_grupos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES public.gg_groups(id) ON DELETE CASCADE;


--
-- Name: portal_vaga_grupos portal_vaga_grupos_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vaga_grupos
    ADD CONSTRAINT portal_vaga_grupos_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: portal_vagas_submissoes portal_vagas_submissoes_conta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vagas_submissoes
    ADD CONSTRAINT portal_vagas_submissoes_conta_id_fkey FOREIGN KEY (conta_id) REFERENCES public.portal_contas(id) ON DELETE CASCADE;


--
-- Name: portal_vagas_submissoes portal_vagas_submissoes_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_vagas_submissoes
    ADD CONSTRAINT portal_vagas_submissoes_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE SET NULL;


--
-- Name: prospeccao_configuracao prospeccao_configuracao_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_configuracao
    ADD CONSTRAINT prospeccao_configuracao_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_contatos prospeccao_contatos_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_contatos
    ADD CONSTRAINT prospeccao_contatos_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.prospeccao_leads(id) ON DELETE CASCADE;


--
-- Name: prospeccao_contatos prospeccao_contatos_realizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_contatos
    ADD CONSTRAINT prospeccao_contatos_realizado_por_fkey FOREIGN KEY (realizado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_envios prospeccao_envios_aprovado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_envios
    ADD CONSTRAINT prospeccao_envios_aprovado_por_fkey FOREIGN KEY (aprovado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_envios prospeccao_envios_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_envios
    ADD CONSTRAINT prospeccao_envios_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.prospeccao_leads(id) ON DELETE CASCADE;


--
-- Name: prospeccao_envios prospeccao_envios_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_envios
    ADD CONSTRAINT prospeccao_envios_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.prospeccao_modelos_mensagem(id) ON DELETE SET NULL;


--
-- Name: prospeccao_execucoes prospeccao_execucoes_iniciado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_execucoes
    ADD CONSTRAINT prospeccao_execucoes_iniciado_por_fkey FOREIGN KEY (iniciado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_leads prospeccao_leads_execucao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_leads
    ADD CONSTRAINT prospeccao_leads_execucao_id_fkey FOREIGN KEY (execucao_id) REFERENCES public.prospeccao_execucoes(id) ON DELETE SET NULL;


--
-- Name: prospeccao_leads prospeccao_leads_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_leads
    ADD CONSTRAINT prospeccao_leads_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_modelos_mensagem prospeccao_modelos_mensagem_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_modelos_mensagem
    ADD CONSTRAINT prospeccao_modelos_mensagem_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_notas prospeccao_notas_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_notas
    ADD CONSTRAINT prospeccao_notas_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: prospeccao_notas prospeccao_notas_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_notas
    ADD CONSTRAINT prospeccao_notas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.prospeccao_leads(id) ON DELETE CASCADE;


--
-- Name: prospeccao_respostas prospeccao_respostas_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospeccao_respostas
    ADD CONSTRAINT prospeccao_respostas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.prospeccao_leads(id) ON DELETE SET NULL;


--
-- Name: recrutador_agendas recrutador_agendas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recrutador_agendas
    ADD CONSTRAINT recrutador_agendas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.app_usuarios(id) ON DELETE CASCADE;


--
-- Name: vaga_artes_ia vaga_artes_ia_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_artes_ia
    ADD CONSTRAINT vaga_artes_ia_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: vaga_artes_ia vaga_artes_ia_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_artes_ia
    ADD CONSTRAINT vaga_artes_ia_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;


--
-- Name: vaga_artes_ia vaga_artes_ia_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_artes_ia
    ADD CONSTRAINT vaga_artes_ia_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: vaga_perguntas vaga_perguntas_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_perguntas
    ADD CONSTRAINT vaga_perguntas_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: vaga_perguntas vaga_perguntas_versao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_perguntas
    ADD CONSTRAINT vaga_perguntas_versao_id_fkey FOREIGN KEY (versao_id) REFERENCES public.vaga_triagem_versoes(id) ON DELETE CASCADE;


--
-- Name: vaga_triagem_versoes vaga_triagem_versoes_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_triagem_versoes
    ADD CONSTRAINT vaga_triagem_versoes_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: vaga_triagem_versoes vaga_triagem_versoes_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vaga_triagem_versoes
    ADD CONSTRAINT vaga_triagem_versoes_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: vagas vagas_empresa_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas
    ADD CONSTRAINT vagas_empresa_fk FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: vagas vagas_recrutador_responsavel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas
    ADD CONSTRAINT vagas_recrutador_responsavel_id_fkey FOREIGN KEY (recrutador_responsavel_id) REFERENCES public.app_usuarios(id) ON DELETE SET NULL;


--
-- Name: vagas_templates vagas_templates_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas_templates
    ADD CONSTRAINT vagas_templates_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;


--
-- Name: workflow_erros workflow_erros_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_erros
    ADD CONSTRAINT workflow_erros_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE SET NULL;


--
-- Name: workflow_execucao workflow_execucao_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execucao
    ADD CONSTRAINT workflow_execucao_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict m367uYlatp2rxOxsZsJLBgmJ8jwMY3rcxwrsQrK3peqMqTxdNKVaVL4Mdzjw1zM

