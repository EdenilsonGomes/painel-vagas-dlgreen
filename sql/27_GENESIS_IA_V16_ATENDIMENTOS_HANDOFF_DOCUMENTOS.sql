BEGIN;

-- Gênesis IA V16
-- Atendimento humano monitorado, handoff seguro e preservação de documentos.
-- Migration aditiva: não remove tabelas/colunas existentes.

ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS origem_documento VARCHAR(40) NOT NULL DEFAULT 'WHATSAPP_CANDIDATO',
  ADD COLUMN IF NOT EXISTS recebido_durante_atendimento_humano BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aplicacao_pendente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS aplicacao_pendente_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enviado_por_usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enviado_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS aplicacao_tentativas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aplicacao_proxima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS aplicacao_ultimo_erro TEXT;

CREATE INDEX IF NOT EXISTS idx_documentos_v16_aplicacao_pendente
  ON documentos(candidato_id, aplicacao_pendente, created_at DESC)
  WHERE aplicacao_pendente IS TRUE;
CREATE INDEX IF NOT EXISTS idx_documentos_v16_hash_candidato
  ON documentos(candidato_id, hash_sha256)
  WHERE NULLIF(hash_sha256,'') IS NOT NULL;

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS atendimento_humano_solicitado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS atendimento_handoff_historico (
  id BIGSERIAL PRIMARY KEY,
  candidato_id BIGINT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE,
  usuario_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
  usuario_nome TEXT NOT NULL,
  etapa_anterior VARCHAR(100),
  etapa_retomada VARCHAR(100),
  dados_aplicados JSONB NOT NULL DEFAULT '{}'::JSONB,
  documentos_pendentes BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
  resumo TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'CONCLUIDO'
    CHECK (status IN ('CONCLUIDO','FALHA','SEM_CONTINUIDADE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_handoff_candidato_data
  ON atendimento_handoff_historico(candidato_id, created_at DESC);

ALTER TABLE atendimento_handoff_historico
  ADD COLUMN IF NOT EXISTS triagem_aplicada JSONB;

-- Quando o pipeline normal finalmente concluir/aplicar um documento que estava
-- estagiado, limpa automaticamente a pendência V16. O estágio V16 usa
-- AGUARDANDO_HUMANO, portanto não dispara esta limpeza antes da hora.
CREATE OR REPLACE FUNCTION genesis_v16_limpar_pendencia_documento_aplicado()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ia_ativa BOOLEAN;
BEGIN
  IF NEW.aplicacao_pendente IS TRUE
     AND UPPER(COALESCE(NEW.status_processamento,'')) IN ('CONCLUIDO','REVISAO') THEN
    SELECT ia_atendimento_ativo INTO ia_ativa FROM candidatos WHERE id=NEW.candidato_id;
    IF ia_ativa IS TRUE THEN
      UPDATE documentos SET aplicacao_pendente=FALSE,aplicacao_ultimo_erro=NULL
      WHERE id=NEW.id AND aplicacao_pendente IS TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_genesis_v16_documento_aplicado ON documentos;
CREATE TRIGGER trg_genesis_v16_documento_aplicado
AFTER UPDATE OF status_processamento ON documentos
FOR EACH ROW EXECUTE FUNCTION genesis_v16_limpar_pendencia_documento_aplicado();

-- Pausa real automática quando o fluxo gera/atualiza uma solicitação de suporte.
-- O trigger de alerta da V15 continua sendo AFTER INSERT apenas, portanto a deduplicação
-- de notificações permanece como está: uma revisão PENDENTE = um conjunto de alertas.
CREATE OR REPLACE FUNCTION genesis_v16_pausar_ia_em_suporte()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo='SUPORTE_FLUXO' AND NEW.status='PENDENTE' THEN
    UPDATE candidatos
    SET ia_atendimento_ativo=FALSE,
        ia_pausada_em=COALESCE(ia_pausada_em,NOW()),
        ia_pausada_por=COALESCE(NULLIF(ia_pausada_por,''),'SISTEMA'),
        ia_pausa_motivo=COALESCE(NULLIF(NEW.motivo,''),NULLIF(NEW.titulo,''),'Atendimento humano solicitado'),
        atendimento_humano_solicitado=TRUE,
        atendimento_humano_solicitado_em=COALESCE(atendimento_humano_solicitado_em,NOW()),
        revisao_pendente=TRUE,
        revisao_tipo='SUPORTE_FLUXO',
        revisao_motivo=COALESCE(NULLIF(NEW.motivo,''),NULLIF(NEW.titulo,''),'Atendimento humano solicitado'),
        updated_at=NOW()
    WHERE id=NEW.candidato_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_genesis_v16_pausar_ia_suporte ON candidato_revisoes;
CREATE TRIGGER trg_genesis_v16_pausar_ia_suporte
AFTER INSERT OR UPDATE OF status, motivo, titulo ON candidato_revisoes
FOR EACH ROW EXECUTE FUNCTION genesis_v16_pausar_ia_em_suporte();

-- Calcula a etapa real para a qual a Evelyn deve voltar ignorando apenas a
-- revisão operacional SUPORTE_FLUXO. Outras revisões (documental/experiência) continuam
-- bloqueando exatamente como no motor atual.
CREATE OR REPLACE FUNCTION genesis_v16_etapa_retomada_apos_suporte(p_candidato_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  c candidatos%ROWTYPE;
  v_vaga_status TEXT;
  v_experiencia_minima_meses INTEGER := 0;
  v_documento_status TEXT;
  triagem_status TEXT;
BEGIN
  SELECT c0.* INTO c FROM candidatos c0 WHERE c0.id=p_candidato_id;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_INTENCAO'; END IF;

  IF EXISTS(SELECT 1 FROM entrevistas e WHERE e.candidato_id=c.id AND UPPER(COALESCE(e.status,''))='AGENDADA') THEN
    RETURN 'ENTREVISTA_AGENDADA';
  END IF;

  IF c.revisao_pendente IS TRUE AND COALESCE(c.revisao_tipo,'')<>'SUPORTE_FLUXO' THEN
    IF c.revisao_tipo='EXCECAO_EXPERIENCIA' THEN RETURN 'PENDENTE_APROVACAO_RECRUTADOR'; END IF;
    RETURN 'REVISAO_DOCUMENTAL';
  END IF;

  IF c.vaga_id IS NULL THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  SELECT vg.status::TEXT,COALESCE(vg.experiencia_minima_meses,0)
  INTO v_vaga_status,v_experiencia_minima_meses FROM vagas vg WHERE vg.id=c.vaga_id LIMIT 1;
  IF NOT FOUND OR COALESCE(v_vaga_status,'')<>'ATIVA' THEN RETURN 'ESCOLHENDO_VAGA'; END IF;
  IF NULLIF(BTRIM(COALESCE(c.nome,'')),'') IS NULL THEN RETURN 'AGUARDANDO_NOME'; END IF;

  triagem_status:=genesis_triagem_v13_garantir(c.id,c.vaga_id);
  IF triagem_status='EM_ANDAMENTO' THEN RETURN 'PERGUNTAS_VAGA'; END IF;
  IF triagem_status='ELIMINADO' THEN RETURN 'NAO_APTO_NESTA_VAGA'; END IF;
  IF triagem_status='REVISAO' THEN RETURN 'PENDENTE_APROVACAO_RECRUTADOR'; END IF;

  IF COALESCE(v_experiencia_minima_meses,0)>0 AND c.experiencia_declarada IS NULL THEN RETURN 'AGUARDANDO_EXPERIENCIA'; END IF;
  IF c.deslocamento_faixa IS NULL THEN RETURN 'AGUARDANDO_TEMPO_DESLOCAMENTO'; END IF;
  IF c.deslocamento_chegada IS NULL THEN RETURN 'AGUARDANDO_CONFIRMACAO_CHEGADA'; END IF;
  IF REGEXP_REPLACE(COALESCE(c.cep,''),'\D','','g') !~ '^\d{8}$' THEN RETURN 'AGUARDANDO_CEP'; END IF;

  SELECT d.status_processamento::TEXT INTO v_documento_status
  FROM documentos d WHERE d.candidato_id=c.id
    AND (UPPER(COALESCE(d.tipo,''))='CTPS' OR UPPER(COALESCE(d.titulo,'')) LIKE '%CTPS%')
  ORDER BY d.created_at DESC,d.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN 'AGUARDANDO_CTPS'; END IF;
  IF UPPER(COALESCE(v_documento_status,'')) IN ('RECEBIDO','ARMAZENADO','PROCESSANDO','REPROCESSAMENTO_SOLICITADO','AGUARDANDO_HUMANO') THEN RETURN 'PROCESSANDO_CTPS'; END IF;
  IF UPPER(COALESCE(v_documento_status,'')) IN ('REVISAO','INCONCLUSIVO','ERRO_PROCESSAMENTO') THEN RETURN 'REVISAO_DOCUMENTAL'; END IF;
  IF c.aprovado IS TRUE OR UPPER(COALESCE(c.status,''))='APROVADO' THEN RETURN 'AGUARDANDO_ESCOLHA_HORARIO'; END IF;
  IF c.etapa='NAO_APTO_NESTA_VAGA' THEN RETURN c.etapa; END IF;
  RETURN COALESCE(NULLIF(c.etapa,''),'AGUARDANDO_CTPS');
END;
$$;

-- Porta operacional V16. A diferença crítica para a V15 é que, com IA pausada,
-- um PDF NÃO é registrado como simples placeholder e descartado. Ele é sinalizado
-- para o workflow continuar somente pelo pipeline técnico de download/persistência/OCR.
CREATE OR REPLACE FUNCTION genesis_v16_controle_entrada(
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
    RETURN QUERY SELECT FALSE,NULL::TEXT,NULL::BIGINT,NULL::BIGINT,
      genesis_v15_normalizar_telefone(p_telefone),COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,NULL::TEXT;
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
      RETURN QUERY SELECT TRUE,'REAGENDAMENTO_CONFIRMAR',c.id,proposta.id,c.telefone::TEXT,
        COALESCE(NULLIF(p_session,''),'whats_junior'),'CONFIRMAR','Resposta vinculada à proposta de reagendamento';
      RETURN;
    ELSIF normalizada ~ '^\s*(2|NAO|NÃO|NAO CONSIGO|NÃO CONSIGO)\s*[!.]*\s*$' OR normalizada ~ '^(2 ).*' THEN
      INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,origem,created_at)
      VALUES(c.id,'USUARIO',msg,NULLIF(p_mensagem_id,''),'WHATSAPP',NOW())
      ON CONFLICT (mensagem_id) DO NOTHING;
      RETURN QUERY SELECT TRUE,'REAGENDAMENTO_RECUSAR',c.id,proposta.id,c.telefone::TEXT,
        COALESCE(NULLIF(p_session,''),'whats_junior'),'RECUSAR','Resposta vinculada à proposta de reagendamento';
      RETURN;
    END IF;
  END IF;

  IF c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE THEN
    IF UPPER(COALESCE(p_tipo_entrada,''))='PDF' THEN
      -- Não insere mensagem aqui. genesis_chatbot_v1_registrar_pdf fará a persistência
      -- idempotente junto com os bytes, evitando depender do link temporário do WAHA.
      RETURN QUERY SELECT TRUE,'IA_PAUSADA_PDF',c.id,NULL::BIGINT,c.telefone::TEXT,
        COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,
        COALESCE(c.ia_pausa_motivo,'Atendimento humano em andamento');
      RETURN;
    END IF;

    descricao := CASE
      WHEN UPPER(COALESCE(p_tipo_entrada,''))='TEXTO' THEN msg
      ELSE '[MÍDIA RECEBIDA DURANTE ATENDIMENTO HUMANO] '||COALESCE(NULLIF(p_nome_arquivo,''),COALESCE(NULLIF(p_mime_type,''),'arquivo'))
    END;
    INSERT INTO mensagens(candidato_id,quem,mensagem,mensagem_id,origem,contexto_snapshot,created_at)
    VALUES(c.id,'USUARIO',descricao,NULLIF(p_mensagem_id,''),'WHATSAPP',
      JSONB_BUILD_OBJECT('ia_pausada',TRUE,'tipo_entrada',p_tipo_entrada),NOW())
    ON CONFLICT (mensagem_id) DO NOTHING;
    RETURN QUERY SELECT TRUE,'IA_PAUSADA',c.id,NULL::BIGINT,c.telefone::TEXT,
      COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,
      COALESCE(c.ia_pausa_motivo,'Atendimento humano em andamento');
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE,NULL::TEXT,c.id,NULL::BIGINT,c.telefone::TEXT,
    COALESCE(NULLIF(p_session,''),'whats_junior'),NULL::TEXT,NULL::TEXT;
END;
$$;

-- Armazena o resultado técnico do documento sem aplicar consequências ao candidato.
CREATE OR REPLACE FUNCTION genesis_v16_estagiar_documento(
  p_candidato_id BIGINT,
  p_documento_id BIGINT,
  p_tipo TEXT,
  p_resultado JSONB,
  p_confianca TEXT DEFAULT NULL
) RETURNS TABLE(
  candidato_id BIGINT,
  documento_id BIGINT,
  tipo TEXT,
  aplicacao_pendente BOOLEAN,
  deve_enviar BOOLEAN,
  action TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  tipo_norm TEXT := UPPER(COALESCE(NULLIF(BTRIM(p_tipo),''),'OUTRO'));
  titulo_doc TEXT;
BEGIN
  IF tipo_norm NOT IN ('CTPS','CURRICULO','PENDENTE_REVISAO','OUTRO') THEN tipo_norm := 'OUTRO'; END IF;
  titulo_doc := CASE tipo_norm
    WHEN 'CTPS' THEN 'Carteira de Trabalho Digital'
    WHEN 'CURRICULO' THEN 'Currículo'
    WHEN 'PENDENTE_REVISAO' THEN 'Documento aguardando identificação'
    ELSE 'Outro documento'
  END;

  UPDATE documentos
  SET tipo=tipo_norm,
      titulo=titulo_doc,
      resultado=COALESCE(resultado,'{}'::JSONB)||COALESCE(p_resultado,'{}'::JSONB)||
        JSONB_BUILD_OBJECT('v16_atendimento_humano',TRUE,'aplicacao_pendente',TRUE),
      status_processamento='AGUARDANDO_HUMANO',
      classificacao_confianca=COALESCE(NULLIF(p_confianca,''),classificacao_confianca),
      processado_at=NOW(),
      recebido_durante_atendimento_humano=TRUE,
      aplicacao_pendente=TRUE,
      aplicacao_pendente_em=NOW()
  WHERE id=p_documento_id AND documentos.candidato_id=p_candidato_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Documento % do candidato % não encontrado.',p_documento_id,p_candidato_id; END IF;

  UPDATE candidatos
  SET documento_processando=FALSE,processamento_bloqueado_ate=NULL,updated_at=NOW()
  WHERE id=p_candidato_id;

  INSERT INTO eventos(candidato_id,evento,descricao,created_at)
  VALUES(p_candidato_id,'DOCUMENTO_ANALISADO_DURANTE_ATENDIMENTO_HUMANO',
    'Documento '||p_documento_id||' analisado tecnicamente como '||tipo_norm||'. Aplicação aguardando finalização humana.',NOW());

  RETURN QUERY SELECT p_candidato_id,p_documento_id,tipo_norm,TRUE,FALSE,'DOCUMENTO_ESTAGIADO'::TEXT;
END;
$$;


-- Wrapper V16 de persistência: baixa primeiro, salva bytes no PostgreSQL e informa ao
-- workflow se a IA está pausada. Deduplica o mesmo PDF pelo SHA-256 por candidato.
CREATE OR REPLACE FUNCTION genesis_v16_registrar_pdf(
  p_telefone TEXT,
  p_mensagem_id TEXT,
  p_nome_arquivo TEXT,
  p_mime_type TEXT,
  p_tamanho_bytes BIGINT,
  p_arquivo_base64 TEXT,
  p_hash_sha256 TEXT,
  p_session TEXT DEFAULT 'whats_junior'
) RETURNS TABLE(
  candidato_id BIGINT,
  documento_id BIGINT,
  telefone TEXT,
  session TEXT,
  etapa TEXT,
  status TEXT,
  ia_pausada BOOLEAN,
  documento_duplicado BOOLEAN
) LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  c candidatos%ROWTYPE;
  existente_id BIGINT;
BEGIN
  SELECT * INTO r FROM genesis_chatbot_v1_registrar_pdf(
    p_telefone,p_mensagem_id,p_nome_arquivo,p_mime_type,p_tamanho_bytes,p_arquivo_base64,p_hash_sha256,p_session
  );
  SELECT * INTO c FROM candidatos WHERE id=r.candidato_id;

  IF NULLIF(p_hash_sha256,'') IS NOT NULL THEN
    SELECT d.id INTO existente_id
    FROM documentos d
    WHERE d.candidato_id=r.candidato_id
      AND d.hash_sha256=p_hash_sha256
      AND d.id<>r.documento_id
    ORDER BY d.created_at ASC,d.id ASC LIMIT 1;
  END IF;

  IF existente_id IS NOT NULL THEN
    DELETE FROM documentos WHERE id=r.documento_id;
    r.documento_id := existente_id;
    -- O registrador legado marca documento_processando=TRUE antes da deduplicação.
    -- Se o arquivo existente já terminou, não podemos deixar o candidato preso em processamento.
    IF EXISTS (
      SELECT 1 FROM documentos d
      WHERE d.id=existente_id
        AND UPPER(COALESCE(d.status_processamento,'')) IN ('CONCLUIDO','REVISAO','AGUARDANDO_HUMANO')
    ) THEN
      UPDATE candidatos SET documento_processando=FALSE,processamento_bloqueado_ate=NULL,updated_at=NOW()
      WHERE id=r.candidato_id;
    END IF;
  END IF;

  UPDATE documentos
  SET origem_documento=COALESCE(NULLIF(origem_documento,''),'WHATSAPP_CANDIDATO'),
      recebido_durante_atendimento_humano=(c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE),
      resultado=COALESCE(resultado,'{}'::JSONB)||JSONB_BUILD_OBJECT(
        'v16_preservado_imediatamente',TRUE,
        'recebido_durante_atendimento_humano',(c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE),
        'documento_duplicado',(existente_id IS NOT NULL)
      )
  WHERE id=r.documento_id;

  RETURN QUERY SELECT r.candidato_id,r.documento_id,r.telefone::TEXT,r.session::TEXT,r.etapa::TEXT,r.status::TEXT,
    (c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE),
    (existente_id IS NOT NULL);
END;
$$;

-- Reconcilia, somente após confirmação humana, a pergunta atualmente pendente da
-- triagem. A avaliação continua usando as regras determinísticas configuradas na vaga;
-- nenhum score é inventado pelo modelo de handoff.
CREATE OR REPLACE FUNCTION genesis_v16_aplicar_resposta_triagem_humana(
  p_candidato_id BIGINT,
  p_pergunta_id BIGINT,
  p_resposta TEXT,
  p_usuario_nome TEXT
) RETURNS TABLE(
  aplicada BOOLEAN,
  pergunta_id BIGINT,
  resposta_normalizada JSONB,
  atendida BOOLEAN,
  pontos INTEGER,
  etapa_resultante TEXT,
  status_resultante TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  c candidatos%ROWTYPE;
  t candidato_triagens%ROWTYPE;
  p vaga_perguntas%ROWTYPE;
  ev RECORD;
  proxima TEXT;
  nova_etapa TEXT;
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado.',p_candidato_id; END IF;
  IF c.vaga_id IS NULL THEN RAISE EXCEPTION 'Candidato não possui vaga vinculada.'; END IF;
  IF NULLIF(BTRIM(COALESCE(p_resposta,'')),'') IS NULL THEN RAISE EXCEPTION 'Informe a resposta confirmada da triagem.'; END IF;

  SELECT * INTO t FROM candidato_triagens
  WHERE candidato_id=c.id AND vaga_id=c.vaga_id
  ORDER BY iniciado_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR t.status<>'EM_ANDAMENTO' THEN
    RETURN QUERY SELECT FALSE,NULL::BIGINT,NULL::JSONB,NULL::BOOLEAN,0,c.etapa::TEXT,c.status::TEXT;
    RETURN;
  END IF;

  SELECT q.* INTO p FROM vaga_perguntas q
  WHERE q.versao_id=t.versao_id AND q.ativa IS TRUE
    AND NOT EXISTS(SELECT 1 FROM candidato_respostas_triagem r WHERE r.triagem_id=t.id AND r.pergunta_id=q.id)
  ORDER BY q.ordem LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE,NULL::BIGINT,NULL::JSONB,NULL::BOOLEAN,0,c.etapa::TEXT,c.status::TEXT;
    RETURN;
  END IF;
  IF p.id<>p_pergunta_id THEN RAISE EXCEPTION 'A pergunta pendente mudou. Atualize a prévia antes de finalizar.'; END IF;

  SELECT * INTO ev FROM genesis_v13_avaliar_resposta(
    p.tipo,p.finalidade,p.opcoes,p.regra_operador,p.regra_valor,p.pontos,p_resposta,'{}'::JSONB
  );
  IF p.obrigatoria AND ev.resposta_normalizada IS NULL THEN
    RAISE EXCEPTION 'A resposta confirmada não pôde ser interpretada pela regra objetiva da pergunta.';
  END IF;

  INSERT INTO candidato_respostas_triagem(
    triagem_id,candidato_id,vaga_id,pergunta_id,mensagem_id,resposta_bruta,resposta_normalizada,
    resumo_ia,origem,confianca,atendida,pontos,precisa_revisao
  ) VALUES(
    t.id,c.id,c.vaga_id,p.id,NULL,p_resposta,ev.resposta_normalizada,
    'Resposta confirmada no handoff humano por '||COALESCE(NULLIF(p_usuario_nome,''),'equipe'),
    'PAINEL',1.0,ev.atendida,ev.pontos,ev.precisa_revisao
  ) ON CONFLICT(triagem_id,pergunta_id) DO NOTHING;

  IF NOT FOUND THEN RAISE EXCEPTION 'Esta pergunta já foi respondida. Atualize a prévia antes de finalizar.'; END IF;

  UPDATE candidato_triagens
  SET score=score+COALESCE(ev.pontos,0),pergunta_atual_ordem=p.ordem+1,updated_at=NOW()
  WHERE id=t.id;

  IF p.finalidade='ELIMINATORIA' AND ev.atendida IS FALSE THEN
    UPDATE candidato_triagens SET status='ELIMINADO',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
    UPDATE candidatos SET aprovado=FALSE,etapa='NAO_APTO_NESTA_VAGA',status='EM_PROCESSO',situacao_candidatura='NAO_APTO',
      motivo_reprovacao_codigo='PERGUNTA_ELIMINATORIA',motivo_reprovacao_categoria='REQUISITO',
      motivo_reprovacao_detalhe='Resposta confirmada pelo atendimento humano não atendeu a requisito objetivo configurado para a vaga.',
      reprovacao_realocavel=TRUE,pendencia_atual='NAO_APTO_NESTA_VAGA',proxima_acao='NAO_APTO_NESTA_VAGA',tentativas_etapa=0,updated_at=NOW()
    WHERE id=c.id RETURNING * INTO c;
  ELSE
    proxima:=genesis_triagem_v13_pergunta_atual(c.id,c.vaga_id);
    IF COALESCE(proxima,'')='' THEN
      UPDATE candidato_triagens SET status='CONCLUIDA',concluido_at=NOW(),updated_at=NOW() WHERE id=t.id;
      nova_etapa:=genesis_chatbot_v1_etapa_retomada(c.id);
    ELSE
      nova_etapa:='PERGUNTAS_VAGA';
    END IF;
    UPDATE candidatos SET etapa=nova_etapa,
      pendencia_atual=CASE WHEN nova_etapa='PERGUNTAS_VAGA' THEN 'PERGUNTAS_VAGA' ELSE nova_etapa END,
      proxima_acao=nova_etapa,tentativas_etapa=0,updated_at=NOW()
    WHERE id=c.id RETURNING * INTO c;
  END IF;

  INSERT INTO eventos(candidato_id,evento,descricao,created_at)
  VALUES(c.id,'TRIAGEM_RESPONDIDA_NO_HANDOFF_V16',
    FORMAT('Pergunta %s respondida e confirmada por %s durante atendimento humano.',p.id,COALESCE(NULLIF(p_usuario_nome,''),'equipe')),NOW());

  RETURN QUERY SELECT TRUE,p.id,ev.resposta_normalizada,ev.atendida,COALESCE(ev.pontos,0),c.etapa::TEXT,c.status::TEXT;
END;
$$;

-- Ação manual V16 carrega também o estado de pausa e aceita um documento exato.
CREATE OR REPLACE FUNCTION genesis_v16_acao_manual(
  p_candidato_id BIGINT,
  p_action TEXT,
  p_resgate_id BIGINT DEFAULT NULL,
  p_session TEXT DEFAULT 'whats_junior',
  p_documento_id BIGINT DEFAULT NULL
) RETURNS TABLE(
  candidato_id BIGINT, telefone TEXT, session TEXT, mensagem_whatsapp TEXT, action TEXT,
  opcao_numero INTEGER, etapa TEXT, status TEXT, deve_enviar BOOLEAN, documento_id BIGINT,
  arquivo_base64 TEXT, nome_arquivo TEXT, mime_type TEXT, hash_sha256 TEXT, resgate_id BIGINT,
  ia_pausada BOOLEAN
) LANGUAGE plpgsql AS $$
DECLARE
  c candidatos%ROWTYPE;
  d documentos%ROWTYPE;
  a RECORD;
  acao TEXT := UPPER(COALESCE(p_action,'RESGATAR'));
BEGIN
  SELECT * INTO c FROM candidatos WHERE id=p_candidato_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidato % não encontrado',p_candidato_id; END IF;

  IF acao='REPROCESSAR_DOCUMENTO' AND p_documento_id IS NOT NULL THEN
    SELECT * INTO d FROM documentos
    WHERE id=p_documento_id AND documentos.candidato_id=p_candidato_id AND conteudo IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Documento % não encontrado ou sem conteúdo preservado.',p_documento_id; END IF;
    RETURN QUERY SELECT c.id,c.telefone::TEXT,COALESCE(NULLIF(p_session,''),'whats_junior'),''::TEXT,
      'REPROCESSAR_DOCUMENTO'::TEXT,NULL::INTEGER,c.etapa::TEXT,c.status::TEXT,FALSE,
      d.id,ENCODE(d.conteudo,'base64'),d.nome_arquivo::TEXT,d.mime_type::TEXT,d.hash_sha256::TEXT,p_resgate_id,
      (c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE);
    RETURN;
  END IF;

  SELECT * INTO a FROM genesis_chatbot_v1_acao_manual(p_candidato_id,p_action,p_resgate_id,p_session);
  RETURN QUERY SELECT a.candidato_id,a.telefone,a.session,a.mensagem_whatsapp,a.action,a.opcao_numero,a.etapa,a.status,a.deve_enviar,
    a.documento_id,a.arquivo_base64,a.nome_arquivo,a.mime_type,a.hash_sha256,a.resgate_id,
    (c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE);
END;
$$;

COMMIT;
