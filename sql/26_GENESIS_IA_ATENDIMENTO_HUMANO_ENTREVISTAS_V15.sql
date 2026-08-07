-- Genesis IA V15 — Atendimento humano, pausa real, correções auditadas e gestão de entrevistas
-- Migração incremental e aditiva. Não remove dados nem altera as regras de triagem existentes.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE app_usuarios
  ADD COLUMN IF NOT EXISTS telefone_whatsapp VARCHAR(30),
  ADD COLUMN IF NOT EXISTS alerta_entrevista BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS alerta_revisao BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS atendimento_humano_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS atendimento_humano_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atendimento_humano_nome TEXT,
  ADD COLUMN IF NOT EXISTS atendimento_humano_assumido_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS atendimento_humano_finalizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dados_corrigidos_manualmente BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS origem VARCHAR(30),
  ADD COLUMN IF NOT EXISTS autor_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autor_nome TEXT,
  ADD COLUMN IF NOT EXISTS status_envio VARCHAR(20),
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

DROP INDEX IF EXISTS mensagens_client_message_id_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS mensagens_client_message_id_uidx
  ON mensagens(client_message_id);
CREATE INDEX IF NOT EXISTS mensagens_candidato_id_id_idx ON mensagens(candidato_id,id);

ALTER TABLE entrevistas
  ADD COLUMN IF NOT EXISTS confirmacao_recrutador_status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS confirmada_recrutador_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmada_recrutador_por TEXT;

DO $$ BEGIN
  ALTER TABLE entrevistas ADD CONSTRAINT entrevistas_confirmacao_recrutador_check
    CHECK (confirmacao_recrutador_status IN ('PENDENTE','CONFIRMADA','REAGENDAMENTO_SOLICITADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS candidato_dados_historico (
  id BIGSERIAL PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  campo VARCHAR(80) NOT NULL,
  valor_anterior TEXT,
  valor_novo TEXT,
  motivo TEXT NOT NULL,
  alterado_por_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  alterado_por_nome TEXT NOT NULL,
  origem VARCHAR(40) NOT NULL DEFAULT 'PAINEL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS candidato_dados_historico_candidato_idx ON candidato_dados_historico(candidato_id,created_at DESC);

CREATE TABLE IF NOT EXISTS candidato_estado_historico (
  id BIGSERIAL PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  status_anterior TEXT,
  etapa_anterior TEXT,
  status_novo TEXT,
  etapa_nova TEXT,
  modo VARCHAR(30) NOT NULL CHECK (modo IN ('SOMENTE_CORRECAO','CORRIGIR_E_CONTINUAR')),
  mensagem_prevista TEXT,
  mensagem_enviada BOOLEAN NOT NULL DEFAULT FALSE,
  motivo TEXT NOT NULL,
  alterado_por_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  alterado_por_nome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS candidato_estado_historico_candidato_idx ON candidato_estado_historico(candidato_id,created_at DESC);

CREATE TABLE IF NOT EXISTS entrevista_reagendamentos (
  id BIGSERIAL PRIMARY KEY,
  entrevista_id BIGINT NOT NULL REFERENCES entrevistas(id) ON DELETE CASCADE,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  inicio_atual TIMESTAMPTZ NOT NULL,
  fim_atual TIMESTAMPTZ NOT NULL,
  inicio_proposto TIMESTAMPTZ NOT NULL,
  fim_proposto TIMESTAMPTZ NOT NULL,
  motivo TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'AGUARDANDO_CANDIDATO'
    CHECK (status IN ('AGUARDANDO_CANDIDATO','CONFIRMADO','RECUSADO','CANCELADO','FALHA_CALENDAR')),
  solicitado_por_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  solicitado_por_nome TEXT NOT NULL,
  respondido_em TIMESTAMPTZ,
  resposta_candidato VARCHAR(20),
  google_event_id_anterior TEXT,
  google_event_id_novo TEXT,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entrevista_reagendamentos_periodo_check CHECK (fim_proposto > inicio_proposto)
);
CREATE UNIQUE INDEX IF NOT EXISTS entrevista_reagendamento_pendente_uidx
  ON entrevista_reagendamentos(entrevista_id) WHERE status='AGUARDANDO_CANDIDATO';
CREATE INDEX IF NOT EXISTS entrevista_reagendamentos_candidato_idx ON entrevista_reagendamentos(candidato_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS entrevista_acao_tokens (
  id BIGSERIAL PRIMARY KEY,
  entrevista_id BIGINT NOT NULL REFERENCES entrevistas(id) ON DELETE CASCADE,
  token VARCHAR(96) NOT NULL UNIQUE,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS entrevista_acao_tokens_entrevista_idx ON entrevista_acao_tokens(entrevista_id,expira_em DESC);

CREATE TABLE IF NOT EXISTS notificacoes_operacionais (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(50) NOT NULL,
  candidato_id BIGINT REFERENCES candidatos(id) ON DELETE CASCADE,
  entrevista_id BIGINT REFERENCES entrevistas(id) ON DELETE CASCADE,
  revisao_id BIGINT REFERENCES candidato_revisoes(id) ON DELETE CASCADE,
  destinatario_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  telefone VARCHAR(30) NOT NULL,
  mensagem TEXT NOT NULL,
  dedupe_key VARCHAR(240) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','PROCESSANDO','ENVIADA','FALHA','CANCELADA')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviada_em TIMESTAMPTZ,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notificacoes_operacionais_fila_idx ON notificacoes_operacionais(status,proxima_tentativa_em,id);

CREATE OR REPLACE FUNCTION genesis_v15_normalizar_telefone(p_telefone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT REGEXP_REPLACE(COALESCE(p_telefone,''),'\D','','g');
$$;

-- Porta única antes do processamento do chatbot. Registra a entrada e encerra sem resposta
-- quando a IA está pausada. Também reconhece respostas de reagendamento sem passar pelo prompt.
CREATE OR REPLACE FUNCTION genesis_v15_controle_entrada(
  p_telefone TEXT,
  p_mensagem TEXT,
  p_mensagem_id TEXT,
  p_session TEXT,
  p_tipo_entrada TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_nome_arquivo TEXT DEFAULT NULL
) RETURNS TABLE(
  bloquear BOOLEAN,
  controle_acao TEXT,
  candidato_id BIGINT,
  proposta_id BIGINT,
  telefone TEXT,
  session TEXT,
  resposta_canonica TEXT,
  motivo TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  c candidatos%ROWTYPE;
  proposta entrevista_reagendamentos%ROWTYPE;
  msg TEXT := BTRIM(COALESCE(p_mensagem,''));
  normalizada TEXT := UPPER(TRANSLATE(msg,'ÁÀÃÂÉÈÊÍÌÎÓÒÕÔÚÙÛÇ','AAAAEEEIIIOOOOUUUC'));
  descricao TEXT;
BEGIN
  SELECT * INTO c FROM candidatos
  WHERE candidatos.telefone=genesis_v15_normalizar_telefone(p_telefone)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE,NULL::TEXT,NULL::BIGINT,NULL::BIGINT,genesis_v15_normalizar_telefone(p_telefone),COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO proposta FROM entrevista_reagendamentos r
  WHERE r.candidato_id=c.id AND r.status='AGUARDANDO_CANDIDATO'
  ORDER BY r.created_at DESC LIMIT 1;

  IF FOUND AND UPPER(COALESCE(p_tipo_entrada,''))='TEXTO' THEN
    IF normalizada ~ '^\s*(1|SIM|CONFIRMO|PODE|OK)\s*[!.]*\s*$' OR normalizada ~ '^(1 ).*' THEN
      INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,origem,created_at)
      VALUES(c.id,'USUARIO',msg,NULLIF(p_mensagem_id,''),'WHATSAPP',NOW())
      ON CONFLICT (mensagem_id) DO NOTHING;
      RETURN QUERY SELECT TRUE,'REAGENDAMENTO_CONFIRMAR',c.id,proposta.id,c.telefone::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),'CONFIRMAR','Resposta vinculada à proposta de reagendamento';
      RETURN;
    ELSIF normalizada ~ '^\s*(2|NAO|NÃO|NAO CONSIGO|NÃO CONSIGO)\s*[!.]*\s*$' OR normalizada ~ '^(2 ).*' THEN
      INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,origem,created_at)
      VALUES(c.id,'USUARIO',msg,NULLIF(p_mensagem_id,''),'WHATSAPP',NOW())
      ON CONFLICT (mensagem_id) DO NOTHING;
      RETURN QUERY SELECT TRUE,'REAGENDAMENTO_RECUSAR',c.id,proposta.id,c.telefone::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),'RECUSAR','Resposta vinculada à proposta de reagendamento';
      RETURN;
    END IF;
  END IF;

  IF c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE THEN
    descricao := CASE
      WHEN UPPER(COALESCE(p_tipo_entrada,''))='TEXTO' THEN msg
      WHEN UPPER(COALESCE(p_tipo_entrada,''))='PDF' THEN '[DOCUMENTO RECEBIDO DURANTE ATENDIMENTO HUMANO] '||COALESCE(NULLIF(p_nome_arquivo,''),'documento.pdf')
      ELSE '[MÍDIA RECEBIDA DURANTE ATENDIMENTO HUMANO] '||COALESCE(NULLIF(p_nome_arquivo,''),COALESCE(NULLIF(p_mime_type,''),'arquivo'))
    END;
    INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,origem,contexto_snapshot,created_at)
    VALUES(c.id,'USUARIO',descricao,NULLIF(p_mensagem_id,''),'WHATSAPP',JSONB_BUILD_OBJECT('ia_pausada',TRUE,'tipo_entrada',p_tipo_entrada),NOW())
    ON CONFLICT (mensagem_id) DO NOTHING;
    RETURN QUERY SELECT TRUE,'IA_PAUSADA',c.id,NULL::BIGINT,c.telefone::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,COALESCE(c.ia_pausa_motivo,'Atendimento humano em andamento');
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE,NULL::TEXT,c.id,NULL::BIGINT,c.telefone::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v15_enfileirar_entrevista()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  tok TEXT;
  rec RECORD;
  nome_candidato TEXT;
  nome_vaga TEXT;
  horario TEXT;
  msg TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  tok := ENCODE(GEN_RANDOM_BYTES(30),'hex');
  INSERT INTO entrevista_acao_tokens(entrevista_id,token,expira_em)
  VALUES(NEW.id,tok,NOW()+INTERVAL '7 days');

  SELECT COALESCE(NULLIF(c.nome,''),'Nome não informado'),COALESCE(NULLIF(v.titulo,''),c.vaga,'Vaga não informada')
  INTO nome_candidato,nome_vaga FROM candidatos c LEFT JOIN vagas v ON v.id=c.vaga_id WHERE c.id=NEW.candidato_id;
  horario := TO_CHAR(NEW.inicio AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY "às" HH24:MI');
  msg := '📅 Nova entrevista agendada'||E'\n\n'||'Candidato: '||nome_candidato||E'\n'||'Vaga: '||nome_vaga||E'\n'||'Horário: '||horario||E'\n\n'||'Confirme ou solicite reagendamento:'||E'\n'||'{{PANEL_URL}}/entrevistas/acao/'||tok;

  FOR rec IN
    SELECT DISTINCT u.id,u.telefone_whatsapp telefone
    FROM app_usuarios u
    LEFT JOIN candidatos c_resp ON c_resp.id=NEW.candidato_id
    LEFT JOIN vagas v ON v.id=COALESCE(NEW.vaga_id,c_resp.vaga_id)
    WHERE u.ativo IS TRUE AND NULLIF(genesis_v15_normalizar_telefone(u.telefone_whatsapp),'') IS NOT NULL
      AND u.alerta_entrevista IS TRUE
      AND (u.perfil='ADMIN' OR u.id=v.recrutador_responsavel_id)
    UNION
    SELECT NULL::BIGINT,NEW.recrutadora_telefone
    WHERE NULLIF(genesis_v15_normalizar_telefone(NEW.recrutadora_telefone),'') IS NOT NULL
  LOOP
    INSERT INTO notificacoes_operacionais(tipo,candidato_id,entrevista_id,destinatario_usuario_id,telefone,mensagem,dedupe_key)
    VALUES('ENTREVISTA_AGENDADA',NEW.candidato_id,NEW.id,rec.id,genesis_v15_normalizar_telefone(rec.telefone),msg,
      'ENTREVISTA:'||NEW.id||':'||genesis_v15_normalizar_telefone(rec.telefone))
    ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_genesis_v15_entrevista_alerta ON entrevistas;
CREATE TRIGGER trg_genesis_v15_entrevista_alerta AFTER INSERT ON entrevistas
FOR EACH ROW EXECUTE FUNCTION genesis_v15_enfileirar_entrevista();

CREATE OR REPLACE FUNCTION genesis_v15_enfileirar_revisao()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE rec RECORD; nome_candidato TEXT; nome_vaga TEXT; msg TEXT;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.status <> 'PENDENTE' THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(c.nome,''),'Nome não informado'),COALESCE(NULLIF(v.titulo,''),c.vaga,'Vaga não informada')
  INTO nome_candidato,nome_vaga FROM candidatos c LEFT JOIN vagas v ON v.id=c.vaga_id WHERE c.id=NEW.candidato_id;
  msg := '⚠️ Revisão humana necessária'||E'\n\n'||'Candidato: '||nome_candidato||E'\n'||'Vaga: '||nome_vaga||E'\n'||'Tipo: '||COALESCE(NEW.titulo,NEW.tipo)||E'\n'||'Motivo: '||COALESCE(NULLIF(NEW.motivo,''),'Não informado')||E'\n\n'||'Abrir no painel:'||E'\n'||'{{PANEL_URL}}/?candidato='||NEW.candidato_id||'&aba=conversation';
  FOR rec IN
    SELECT DISTINCT u.id,u.telefone_whatsapp telefone
    FROM app_usuarios u
    LEFT JOIN candidatos c_resp ON c_resp.id=NEW.candidato_id
    LEFT JOIN vagas v ON v.id=COALESCE(NEW.vaga_id,c_resp.vaga_id)
    WHERE u.ativo IS TRUE AND NULLIF(genesis_v15_normalizar_telefone(u.telefone_whatsapp),'') IS NOT NULL
      AND u.alerta_revisao IS TRUE
      AND (u.perfil='ADMIN' OR u.id=v.recrutador_responsavel_id)
  LOOP
    INSERT INTO notificacoes_operacionais(tipo,candidato_id,revisao_id,destinatario_usuario_id,telefone,mensagem,dedupe_key)
    VALUES('REVISAO_HUMANA',NEW.candidato_id,NEW.id,rec.id,genesis_v15_normalizar_telefone(rec.telefone),msg,
      'REVISAO:'||NEW.id||':'||genesis_v15_normalizar_telefone(rec.telefone))
    ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_genesis_v15_revisao_alerta ON candidato_revisoes;
CREATE TRIGGER trg_genesis_v15_revisao_alerta AFTER INSERT ON candidato_revisoes
FOR EACH ROW EXECUTE FUNCTION genesis_v15_enfileirar_revisao();


-- Funções isoladas consumidas pelo workflow de gestão de reagendamento.
CREATE OR REPLACE FUNCTION genesis_v15_propor_reagendamento(
  p_entrevista_id BIGINT,
  p_inicio TIMESTAMPTZ,
  p_fim TIMESTAMPTZ,
  p_motivo TEXT,
  p_usuario_id BIGINT,
  p_usuario_nome TEXT
) RETURNS TABLE(
  sucesso BOOLEAN, proposta_id BIGINT, candidato_id BIGINT, telefone TEXT, session TEXT,
  calendar_id TEXT, google_event_id TEXT, inicio_atual TIMESTAMPTZ, fim_atual TIMESTAMPTZ,
  inicio_proposto TIMESTAMPTZ, fim_proposto TIMESTAMPTZ, mensagem_whatsapp TEXT
) LANGUAGE plpgsql AS $$
DECLARE e entrevistas%ROWTYPE; c candidatos%ROWTYPE; rid BIGINT; msg TEXT;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim <= p_inicio OR p_inicio <= NOW() THEN
    RAISE EXCEPTION 'Novo horário inválido ou já passado.';
  END IF;
  SELECT * INTO e FROM entrevistas WHERE id=p_entrevista_id AND status IN ('AGENDADA','REAGENDADA') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrevista ativa não encontrada.'; END IF;
  SELECT * INTO c FROM candidatos WHERE id=e.candidato_id;
  UPDATE entrevista_reagendamentos SET status='CANCELADO',updated_at=NOW()
    WHERE entrevista_id=e.id AND status='AGUARDANDO_CANDIDATO';
  INSERT INTO entrevista_reagendamentos(
    entrevista_id,candidato_id,inicio_atual,fim_atual,inicio_proposto,fim_proposto,motivo,
    solicitado_por_usuario_id,solicitado_por_nome,google_event_id_anterior
  ) VALUES(e.id,e.candidato_id,e.inicio,e.fim,p_inicio,p_fim,NULLIF(BTRIM(p_motivo),''),p_usuario_id,COALESCE(NULLIF(BTRIM(p_usuario_nome),''),'Recrutador'),e.google_event_id)
  RETURNING id INTO rid;
  UPDATE entrevistas SET confirmacao_recrutador_status='REAGENDAMENTO_SOLICITADO',updated_at=NOW() WHERE id=e.id;
  msg := 'Olá, '||COALESCE(NULLIF(c.nome,''),'tudo bem')||'!'||E'\n\n'||
    'A recrutadora solicitou alterar sua entrevista para:'||E'\n\n'||
    '📅 '||TO_CHAR(p_inicio AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||E'\n'||
    '🕐 '||TO_CHAR(p_inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI')||E'\n\n'||
    'Você consegue comparecer nesse novo horário?'||E'\n\n'||
    '1️⃣ Sim, confirmo'||E'\n'||'2️⃣ Não consigo nesse horário';
  INSERT INTO eventos(candidato_id,evento,descricao,created_at)
    VALUES(e.candidato_id,'REAGENDAMENTO_PROPOSTO','Novo horário proposto por '||COALESCE(NULLIF(BTRIM(p_usuario_nome),''),'recrutador')||'. O evento atual permanece reservado.',NOW());
  RETURN QUERY SELECT TRUE,rid,e.candidato_id,c.telefone::TEXT,'whats_junior'::TEXT,e.calendar_id,e.google_event_id,e.inicio,e.fim,p_inicio,p_fim,msg;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v15_preparar_resposta_reagendamento(
  p_proposta_id BIGINT,
  p_resposta TEXT
) RETURNS TABLE(
  sucesso BOOLEAN, acao TEXT, proposta_id BIGINT, entrevista_id BIGINT, candidato_id BIGINT,
  telefone TEXT, session TEXT, calendar_id TEXT, google_event_id TEXT,
  inicio_atual TIMESTAMPTZ, fim_atual TIMESTAMPTZ, inicio_proposto TIMESTAMPTZ, fim_proposto TIMESTAMPTZ,
  mensagem_whatsapp TEXT
) LANGUAGE plpgsql AS $$
DECLARE r entrevista_reagendamentos%ROWTYPE; e entrevistas%ROWTYPE; c candidatos%ROWTYPE; resp TEXT; msg TEXT; rec RECORD;
BEGIN
  resp := UPPER(BTRIM(COALESCE(p_resposta,'')));
  SELECT * INTO r FROM entrevista_reagendamentos WHERE id=p_proposta_id AND status='AGUARDANDO_CANDIDATO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta de reagendamento não está mais pendente.'; END IF;
  SELECT * INTO e FROM entrevistas WHERE id=r.entrevista_id FOR UPDATE;
  SELECT * INTO c FROM candidatos WHERE id=r.candidato_id;
  IF resp='RECUSAR' THEN
    UPDATE entrevista_reagendamentos SET status='RECUSADO',respondido_em=NOW(),resposta_candidato='RECUSAR',updated_at=NOW() WHERE id=r.id;
    UPDATE entrevistas SET confirmacao_recrutador_status='PENDENTE',updated_at=NOW() WHERE id=e.id;
    msg := 'Sem problemas! O horário original da entrevista continua reservado por enquanto. A recrutadora foi avisada e poderá enviar outra opção para você.';
    INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES(c.id,'REAGENDAMENTO_RECUSADO','O candidato não aceitou o novo horário; o evento original foi mantido.',NOW());
    FOR rec IN SELECT DISTINCT u.id,u.telefone_whatsapp FROM app_usuarios u LEFT JOIN vagas v ON v.id=e.vaga_id
      WHERE u.ativo IS TRUE AND u.alerta_entrevista IS TRUE AND NULLIF(genesis_v15_normalizar_telefone(u.telefone_whatsapp),'') IS NOT NULL
        AND (u.perfil='ADMIN' OR u.id=v.recrutador_responsavel_id)
    LOOP
      INSERT INTO notificacoes_operacionais(tipo,candidato_id,entrevista_id,destinatario_usuario_id,telefone,mensagem,dedupe_key)
      VALUES('REAGENDAMENTO_RECUSADO',c.id,e.id,rec.id,genesis_v15_normalizar_telefone(rec.telefone_whatsapp),
        '⚠️ Reagendamento recusado'||E'\n\n'||'Candidato: '||COALESCE(c.nome,'Não informado')||E'\n'||'O horário original permanece reservado.'||E'\n\n'||'Abrir no painel:'||E'\n'||'{{PANEL_URL}}/?candidato='||c.id||'&aba=conversation',
        'REAGENDAMENTO_RECUSADO:'||r.id||':'||genesis_v15_normalizar_telefone(rec.telefone_whatsapp)) ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN QUERY SELECT TRUE,'RECUSAR',r.id,e.id,c.id,c.telefone::TEXT,'whats_junior'::TEXT,e.calendar_id,e.google_event_id,e.inicio,e.fim,r.inicio_proposto,r.fim_proposto,msg;
    RETURN;
  END IF;
  IF resp<>'CONFIRMAR' THEN RAISE EXCEPTION 'Resposta de reagendamento inválida.'; END IF;
  RETURN QUERY SELECT TRUE,'CONFIRMAR',r.id,e.id,c.id,c.telefone::TEXT,'whats_junior'::TEXT,e.calendar_id,e.google_event_id,e.inicio,e.fim,r.inicio_proposto,r.fim_proposto,NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION genesis_v15_concluir_reagendamento(
  p_proposta_id BIGINT,
  p_google_event_url TEXT,
  p_meet_link TEXT
) RETURNS TABLE(sucesso BOOLEAN,candidato_id BIGINT,telefone TEXT,session TEXT,mensagem_whatsapp TEXT) LANGUAGE plpgsql AS $$
DECLARE r entrevista_reagendamentos%ROWTYPE; e entrevistas%ROWTYPE; c candidatos%ROWTYPE; msg TEXT; rec RECORD;
BEGIN
  SELECT * INTO r FROM entrevista_reagendamentos WHERE id=p_proposta_id AND status='AGUARDANDO_CANDIDATO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta de reagendamento não está mais pendente.'; END IF;
  SELECT * INTO e FROM entrevistas WHERE id=r.entrevista_id FOR UPDATE;
  SELECT * INTO c FROM candidatos WHERE id=r.candidato_id;
  UPDATE entrevistas SET inicio=r.inicio_proposto,fim=r.fim_proposto,status='AGENDADA',
    google_event_url=COALESCE(NULLIF(p_google_event_url,''),google_event_url),meet_link=COALESCE(NULLIF(p_meet_link,''),meet_link),
    confirmacao_recrutador_status='CONFIRMADA',confirmada_recrutador_em=NOW(),confirmada_recrutador_por='CANDIDATO_WHATSAPP',updated_at=NOW() WHERE id=e.id;
  UPDATE entrevista_reagendamentos SET status='CONFIRMADO',respondido_em=NOW(),resposta_candidato='CONFIRMAR',updated_at=NOW() WHERE id=r.id;
  msg := '✅ Reagendamento confirmado'||E'\n\n'||'Sua entrevista foi atualizada para:'||E'\n'||
    '📅 '||TO_CHAR(r.inicio_proposto AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||E'\n'||
    '🕐 '||TO_CHAR(r.inicio_proposto AT TIME ZONE 'America/Sao_Paulo','HH24:MI')||
    CASE WHEN NULLIF(COALESCE(p_meet_link,e.meet_link),'') IS NOT NULL THEN E'\n\nGoogle Meet:\n'||COALESCE(NULLIF(p_meet_link,''),e.meet_link) ELSE '' END;
  INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES(c.id,'ENTREVISTA_REAGENDADA',msg,NOW());
  FOR rec IN SELECT DISTINCT u.id,u.telefone_whatsapp FROM app_usuarios u LEFT JOIN vagas v ON v.id=e.vaga_id
    WHERE u.ativo IS TRUE AND u.alerta_entrevista IS TRUE AND NULLIF(genesis_v15_normalizar_telefone(u.telefone_whatsapp),'') IS NOT NULL
      AND (u.perfil='ADMIN' OR u.id=v.recrutador_responsavel_id)
  LOOP
    INSERT INTO notificacoes_operacionais(tipo,candidato_id,entrevista_id,destinatario_usuario_id,telefone,mensagem,dedupe_key)
    VALUES('ENTREVISTA_REAGENDADA',c.id,e.id,rec.id,genesis_v15_normalizar_telefone(rec.telefone_whatsapp),
      '✅ Reagendamento confirmado'||E'\n\n'||'Candidato: '||COALESCE(c.nome,'Não informado')||E'\n'||
      'Novo horário: '||TO_CHAR(r.inicio_proposto AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY "às" HH24:MI'),
      'ENTREVISTA_REAGENDADA:'||r.id||':'||genesis_v15_normalizar_telefone(rec.telefone_whatsapp)) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN QUERY SELECT TRUE,c.id,c.telefone::TEXT,'whats_junior'::TEXT,msg;
END;
$$;

COMMIT;
