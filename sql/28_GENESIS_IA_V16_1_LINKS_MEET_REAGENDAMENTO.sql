BEGIN;

ALTER TABLE entrevistas
  ADD COLUMN IF NOT EXISTS meet_access_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS meet_access_configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meet_access_error TEXT;

-- Links novos ficam mais curtos, mas os tokens/rotas V15 antigos continuam válidos.
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
  tok := ENCODE(GEN_RANDOM_BYTES(16),'hex');
  INSERT INTO entrevista_acao_tokens(entrevista_id,token,expira_em)
  VALUES(NEW.id,tok,NOW()+INTERVAL '7 days');

  SELECT COALESCE(NULLIF(c.nome,''),'Nome não informado'),COALESCE(NULLIF(v.titulo,''),c.vaga,'Vaga não informada')
  INTO nome_candidato,nome_vaga FROM candidatos c LEFT JOIN vagas v ON v.id=c.vaga_id WHERE c.id=NEW.candidato_id;
  horario := TO_CHAR(NEW.inicio AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY "às" HH24:MI');
  msg := '📅 Nova entrevista agendada'||E'\n\n'||'Candidato: '||nome_candidato||E'\n'||'Vaga: '||nome_vaga||E'\n'||'Horário: '||horario||E'\n\n'||'Confirme ou solicite reagendamento:'||E'\n'||'{{PANEL_URL}}/e/'||tok;

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

COMMIT;
