'use strict';

const crypto = require('node:crypto');

class AtendimentoV16Error extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AtendimentoV16Error';
    this.statusCode = statusCode;
  }
}

function registerAtendimentosV16({
  app,
  pool,
  requireLogin,
  currentUserName,
  triggerChatbotReprocess,
  triggerManualCandidateMessage,
  buildManualContinuationMessage,
  chatbotSession = 'whats_junior',
  handoffAnalysisWebhookUrl = '',
  handoffAnalysisWebhookToken = '',
  handoffAnalysisTimeoutMs = 20000,
}) {
  const session = String(chatbotSession || 'whats_junior').trim();
  const analysisUrl = String(handoffAnalysisWebhookUrl || '').trim();
  const analysisToken = String(handoffAnalysisWebhookToken || '').trim();
  const analysisTimeout = Math.min(Math.max(Number(handoffAnalysisTimeoutMs || 20000), 3000), 60000);

  const recruiterFields = ['nome','cep','cidade','estado','cargo','tempo_experiencia','apresentacao_profissional','observacao_triagem'];
  const adminFields = [...recruiterFields,'telefone','cpf','nome_mae','data_nascimento','sexo'];

  function isAdmin(req) { return String(req.user?.perfil || '').toUpperCase() === 'ADMIN'; }
  function parseId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
  function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
  function allowedFields(req) { return isAdmin(req) ? adminFields : recruiterFields; }
  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g,'');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits;
  }
  function humanOwnedBy(req, candidate) {
    return Boolean(candidate.atendimento_humano_ativo)
      && Number(candidate.atendimento_humano_usuario_id || 0) === Number(req.user?.id || 0);
  }

  async function candidateRow(id, lock = false, client = pool) {
    const result = await client.query(`
      SELECT c.*,COALESCE(v.titulo,c.vaga,'Vaga') vaga_nome,
        u.nome atendimento_responsavel_nome
      FROM candidatos c
      LEFT JOIN vagas v ON v.id=c.vaga_id
      LEFT JOIN app_usuarios u ON u.id=c.atendimento_humano_usuario_id
      WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}
    `,[id]);
    if (!result.rowCount) throw new AtendimentoV16Error('Candidato não encontrado.',404);
    return result.rows[0];
  }

  function inferWaitState(candidate, lastMessage) {
    if (!candidate.atendimento_humano_ativo) return 'AGUARDANDO_ATENDIMENTO';
    const who = String(lastMessage?.quem || '').toUpperCase();
    if (['USUARIO','CANDIDATO'].includes(who)) return 'AGUARDANDO_RECRUTADOR';
    if (['RECRUTADOR','IA'].includes(who)) return 'AGUARDANDO_CANDIDATO';
    return 'EM_CONVERSA';
  }

  function localSuggestions(messages, candidate) {
    const incoming = messages.filter((m) => ['USUARIO','CANDIDATO'].includes(String(m.quem || '').toUpperCase()));
    const joined = incoming.map((m) => String(m.mensagem || '')).join('\n');
    const suggestions = {};
    const cepMatches = [...joined.matchAll(/\b(\d{5})-?(\d{3})\b/g)];
    if (cepMatches.length) {
      const last = cepMatches.at(-1);
      const cep = `${last[1]}-${last[2]}`;
      if (String(candidate.cep || '') !== cep) suggestions.cep = { valor: cep, confianca: 0.92, origem: 'CONVERSA_HUMANA' };
    }
    return suggestions;
  }

  async function externalHandoffAnalysis(candidate, messages, documents, triagePending = null) {
    if (!analysisUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), analysisTimeout);
    try {
      const response = await fetch(analysisUrl, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          token:analysisToken,
          candidato:{
            id:candidate.id,nome:candidate.nome,cep:candidate.cep,cidade:candidate.cidade,estado:candidate.estado,
            cargo:candidate.cargo,tempo_experiencia:candidate.tempo_experiencia,etapa:candidate.etapa,status:candidate.status,
          },
          mensagens:messages.map((m)=>({quem:m.quem,mensagem:m.mensagem,created_at:m.created_at,autor_nome:m.autor_nome||null})),
          documentos:documents.map((d)=>({id:d.id,tipo:d.tipo,nome_arquivo:d.nome_arquivo,status_processamento:d.status_processamento,aplicacao_pendente:d.aplicacao_pendente})),
          triagem_pendente:triagePending?{pergunta_id:triagePending.pergunta_id,texto:triagePending.texto,tipo:triagePending.tipo,finalidade:triagePending.finalidade,opcoes:triagePending.opcoes}:null,
        }),
        signal:controller.signal,
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok || data.sucesso === false) throw new Error(data.erro || data.message || `HTTP ${response.status}`);
      return data;
    } catch (error) {
      console.warn('[V16] Análise externa do handoff indisponível:', error.message);
      return null;
    } finally { clearTimeout(timer); }
  }

  app.get('/api/atendimentos', requireLogin, async (req,res,next) => {
    try {
      const scope = String(req.query.escopo || 'TODOS').toUpperCase();
      const params = [];
      let extra = '';
      if (scope === 'MEUS') {
        params.push(Number(req.user?.id || 0));
        extra = ` AND c.atendimento_humano_usuario_id=$${params.length}`;
      }
      const result = await pool.query(`
        SELECT c.id,c.nome,c.telefone,c.status,c.etapa,c.vaga_id,COALESCE(v.titulo,c.vaga,'Vaga') vaga_nome,
          c.ia_atendimento_ativo,c.ia_pausada_em,c.ia_pausada_por,c.ia_pausa_motivo,
          c.atendimento_humano_solicitado,c.atendimento_humano_solicitado_em,
          c.revisao_pendente,c.revisao_tipo,c.revisao_motivo,
          c.atendimento_humano_ativo,c.atendimento_humano_usuario_id,c.atendimento_humano_nome,c.atendimento_humano_assumido_em,
          u.nome atendimento_responsavel_nome,
          lm.id ultima_mensagem_id,lm.quem ultima_mensagem_quem,lm.mensagem ultima_mensagem,lm.created_at ultima_mensagem_em,
          CASE
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('USUARIO','CANDIDATO') THEN 'AGUARDANDO_RECRUTADOR'
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('RECRUTADOR','IA') THEN 'AGUARDANDO_CANDIDATO'
            WHEN c.atendimento_humano_ativo IS TRUE THEN 'EM_CONVERSA'
            WHEN c.atendimento_humano_solicitado IS TRUE THEN 'AGUARDANDO_ATENDIMENTO'
            WHEN c.ia_atendimento_ativo IS FALSE THEN 'IA_PAUSADA'
            ELSE 'EM_CONVERSA'
          END atendimento_estado,
          EXTRACT(EPOCH FROM (NOW()-COALESCE(lm.created_at,c.atendimento_humano_assumido_em,c.ia_pausada_em,c.updated_at)))/60 tempo_espera_minutos,
          COALESCE(dp.pendentes,0)::INTEGER documentos_pendentes
        FROM candidatos c
        LEFT JOIN vagas v ON v.id=c.vaga_id
        LEFT JOIN app_usuarios u ON u.id=c.atendimento_humano_usuario_id
        LEFT JOIN LATERAL (
          SELECT id,quem,mensagem,created_at FROM mensagens WHERE candidato_id=c.id ORDER BY id DESC LIMIT 1
        ) lm ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) pendentes FROM documentos d WHERE d.candidato_id=c.id AND d.aplicacao_pendente IS TRUE
        ) dp ON TRUE
        WHERE c.ativo IS DISTINCT FROM FALSE
          AND (c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE)
          AND UPPER(COALESCE(c.status,'')) NOT IN ('CONTRATADO','ENCERRADO')
          ${extra}
        ORDER BY
          CASE
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('USUARIO','CANDIDATO') THEN 0
            WHEN c.atendimento_humano_solicitado IS TRUE THEN 1
            WHEN c.ia_atendimento_ativo IS FALSE THEN 2
            ELSE 3
          END,
          COALESCE(lm.created_at,c.ia_pausada_em,c.updated_at) ASC
      `,params);
      const items = result.rows;
      const resumo = items.reduce((acc,item)=>{
        const state = item.atendimento_estado;
        acc.total += 1;
        if (state === 'AGUARDANDO_ATENDIMENTO') acc.aguardando_atendimento += 1;
        if (state === 'AGUARDANDO_RECRUTADOR') acc.aguardando_recrutador += 1;
        if (state === 'AGUARDANDO_CANDIDATO') acc.aguardando_candidato += 1;
        if (['AGUARDANDO_ATENDIMENTO','AGUARDANDO_RECRUTADOR'].includes(state)) acc.precisam_acao += 1;
        return acc;
      },{total:0,aguardando_atendimento:0,aguardando_recrutador:0,aguardando_candidato:0,precisam_acao:0});
      res.json({sucesso:true,atendimentos:items,resumo});
    } catch (error) { next(error); }
  });

  app.get('/api/atendimentos/resumo', requireLogin, async (_req,res,next) => {
    try {
      const result = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE estado IN ('AGUARDANDO_ATENDIMENTO','AGUARDANDO_RECRUTADOR'))::INTEGER precisam_acao,
          COUNT(*)::INTEGER total
        FROM (
          SELECT CASE
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('USUARIO','CANDIDATO') THEN 'AGUARDANDO_RECRUTADOR'
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('RECRUTADOR','IA') THEN 'AGUARDANDO_CANDIDATO'
            WHEN c.atendimento_humano_ativo IS TRUE THEN 'EM_CONVERSA'
            WHEN c.atendimento_humano_solicitado IS TRUE THEN 'AGUARDANDO_ATENDIMENTO'
            WHEN c.ia_atendimento_ativo IS FALSE THEN 'IA_PAUSADA'
            ELSE 'EM_CONVERSA' END estado
          FROM candidatos c
          LEFT JOIN LATERAL (SELECT quem FROM mensagens WHERE candidato_id=c.id ORDER BY id DESC LIMIT 1) lm ON TRUE
          WHERE c.ativo IS DISTINCT FROM FALSE
            AND (c.ia_atendimento_ativo IS FALSE OR c.atendimento_humano_ativo IS TRUE)
            AND UPPER(COALESCE(c.status,'')) NOT IN ('CONTRATADO','ENCERRADO')
        ) x
      `);
      res.json({sucesso:true,resumo:result.rows[0]||{precisam_acao:0,total:0}});
    } catch (error) { next(error); }
  });

  // V16.4: central de conversas. Diferente de /api/atendimentos, esta rota lista
  // todos os chats que possuem mensagens, inclusive quando a IA continua ativa.
  // O envio continua protegido pelas rotas existentes: para responder é obrigatório assumir o atendimento.
  app.get('/api/conversas', requireLogin, async (req,res,next) => {
    try {
      const scope = String(req.query.escopo || 'TODOS').toUpperCase();
      const limit = Math.min(Math.max(Number(req.query.limite || 300), 20), 500);
      const params = [];
      let ownerFilter = '';
      if (scope === 'MEUS') {
        params.push(Number(req.user?.id || 0));
        ownerFilter = ` AND c.atendimento_humano_usuario_id=$${params.length}`;
      }
      params.push(limit);
      const result = await pool.query(`
        SELECT
          c.id,c.nome,c.telefone,c.status,c.etapa,c.vaga_id,
          COALESCE(v.titulo,c.vaga,'Sem vaga') AS vaga_nome,
          c.ia_atendimento_ativo,c.ia_pausada_em,c.ia_pausa_motivo,
          c.atendimento_humano_ativo,c.atendimento_humano_usuario_id,c.atendimento_humano_nome,c.atendimento_humano_assumido_em,
          u.nome AS atendimento_responsavel_nome,
          lm.id AS ultima_mensagem_id,lm.quem AS ultima_mensagem_quem,lm.mensagem AS ultima_mensagem,lm.created_at AS ultima_mensagem_em,
          CASE
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('USUARIO','CANDIDATO') THEN 'AGUARDANDO_RECRUTADOR'
            WHEN c.atendimento_humano_ativo IS TRUE AND UPPER(COALESCE(lm.quem,'')) IN ('RECRUTADOR','IA') THEN 'AGUARDANDO_CANDIDATO'
            WHEN c.atendimento_humano_ativo IS TRUE THEN 'EM_CONVERSA'
            WHEN c.ia_atendimento_ativo IS FALSE THEN 'AGUARDANDO_ATENDIMENTO'
            ELSE 'IA_ATIVA'
          END AS atendimento_estado
        FROM candidatos c
        LEFT JOIN vagas v ON v.id=c.vaga_id
        LEFT JOIN app_usuarios u ON u.id=c.atendimento_humano_usuario_id
        JOIN LATERAL (
          SELECT id,quem,mensagem,created_at
          FROM mensagens
          WHERE candidato_id=c.id
          ORDER BY id DESC
          LIMIT 1
        ) lm ON TRUE
        WHERE c.ativo IS DISTINCT FROM FALSE
          ${ownerFilter}
        ORDER BY lm.created_at DESC, lm.id DESC
        LIMIT $${params.length}
      `, params);
      return res.json({ sucesso:true, conversas:result.rows });
    } catch (error) { next(error); }
  });

  app.get('/api/atendimento/candidatos/:id/handoff-preview', requireLogin, async (req,res,next) => {
    try {
      const id=parseId(req.params.id); if(!id) throw new AtendimentoV16Error('Candidato inválido.');
      const candidate=await candidateRow(id);
      if (candidate.atendimento_humano_ativo && !humanOwnedBy(req,candidate) && !isAdmin(req)) {
        throw new AtendimentoV16Error('Somente o responsável atual pode finalizar este atendimento.',403);
      }
      const start=candidate.atendimento_humano_assumido_em || candidate.ia_pausada_em || new Date(Date.now()-24*3600*1000);
      const [messagesResult,docsResult,nextResult,triageResult] = await Promise.all([
        pool.query(`SELECT id,quem,mensagem,autor_nome,created_at FROM mensagens WHERE candidato_id=$1 AND created_at >= $2 ORDER BY id ASC LIMIT 250`,[id,start]),
        pool.query(`SELECT id,tipo,titulo,nome_arquivo,mime_type,status_processamento,aplicacao_pendente,aplicacao_pendente_em,resultado,created_at,origem_documento,recebido_durante_atendimento_humano FROM documentos WHERE candidato_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30`,[id]),
        pool.query(`SELECT genesis_v16_etapa_retomada_apos_suporte($1) etapa`,[id]),
        pool.query(`
          SELECT t.id triagem_id,q.id pergunta_id,q.ordem,q.texto,q.tipo,q.finalidade,q.obrigatoria,q.opcoes
          FROM candidato_triagens t
          JOIN vaga_perguntas q ON q.versao_id=t.versao_id AND q.ativa IS TRUE
          WHERE t.candidato_id=$1 AND t.status='EM_ANDAMENTO'
            AND t.id=(SELECT id FROM candidato_triagens WHERE candidato_id=$1 ORDER BY iniciado_at DESC,id DESC LIMIT 1)
            AND NOT EXISTS(SELECT 1 FROM candidato_respostas_triagem r WHERE r.triagem_id=t.id AND r.pergunta_id=q.id)
          ORDER BY q.ordem LIMIT 1
        `,[id]),
      ]);
      const messages=messagesResult.rows; const documents=docsResult.rows; const triagePending=triageResult.rows[0]||null;
      const localData=localSuggestions(messages,candidate);
      const external=await externalHandoffAnalysis(candidate,messages,documents,triagePending);
      const suggestions={...localData};
      if (external?.dados_sugeridos && typeof external.dados_sugeridos === 'object') {
        for (const [field,value] of Object.entries(external.dados_sugeridos)) {
          if (!allowedFields(req).includes(field)) continue;
          const normalized = value && typeof value === 'object' ? value : {valor:value,confianca:0.7,origem:'ANALISE_HANDOFF'};
          if (normalized.valor !== undefined && normalized.valor !== null && String(normalized.valor).trim()) suggestions[field]=normalized;
        }
      }
      const staged=documents.filter((d)=>d.aplicacao_pendente);
      const nextStage=staged.length ? candidate.etapa : (nextResult.rows[0]?.etapa || candidate.etapa);
      const projected={...candidate,etapa:nextStage};
      res.json({
        sucesso:true,
        candidato:{id:candidate.id,nome:candidate.nome,status:candidate.status,etapa:candidate.etapa,vaga_nome:candidate.vaga_nome},
        resumo:clean(external?.resumo || `Atendimento humano iniciado em ${new Date(start).toLocaleString('pt-BR')}.`,1500),
        sugestoes:suggestions,
        documentos:documents.map((d)=>({
          id:d.id,tipo:d.tipo,titulo:d.titulo,nome_arquivo:d.nome_arquivo,mime_type:d.mime_type,status_processamento:d.status_processamento,
          aplicacao_pendente:d.aplicacao_pendente,origem_documento:d.origem_documento,recebido_durante_atendimento_humano:d.recebido_durante_atendimento_humano,
          resultado_resumo:d.resultado && typeof d.resultado === 'object' ? {
            experiencia:d.resultado.maior_experiencia_compativel_texto || d.resultado.tempo_experiencia || null,
            cargo:d.resultado.cargo_vinculo_utilizado || null,
            inconclusivo:d.resultado.inconclusivo === true,
          } : null,
        })),
        triagem_pendente:triagePending?{
          pergunta_id:triagePending.pergunta_id,ordem:triagePending.ordem,texto:triagePending.texto,tipo:triagePending.tipo,
          finalidade:triagePending.finalidade,obrigatoria:triagePending.obrigatoria,opcoes:Array.isArray(triagePending.opcoes)?triagePending.opcoes:[],
          resposta_sugerida:external?.resposta_triagem_sugerida||null,
        }:null,
        proxima_etapa:nextStage,
        proxima_acao:staged.length ? 'Os documentos analisados serão aplicados automaticamente após a devolução para a IA.' : buildManualContinuationMessage(projected,''),
        analise_externa_configurada:Boolean(analysisUrl),
      });
    } catch(error){next(error);}
  });

  app.post('/api/atendimento/candidatos/:id/documentos', requireLogin, async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const id=parseId(req.params.id);if(!id)throw new AtendimentoV16Error('Candidato inválido.');
      const fileName=clean(req.body?.nome_arquivo,240)||'documento.pdf';
      const mime=clean(req.body?.mime_type,100).toLowerCase()||'application/pdf';
      const type=clean(req.body?.tipo,50).toUpperCase()||'PENDENTE';
      const base64=String(req.body?.arquivo_base64||'').replace(/^data:.*?;base64,/, '');
      if(!base64)throw new AtendimentoV16Error('Selecione um arquivo PDF.');
      if(mime!=='application/pdf'&&!fileName.toLowerCase().endsWith('.pdf'))throw new AtendimentoV16Error('Neste momento o upload manual aceita somente PDF.');
      let buffer;try{buffer=Buffer.from(base64,'base64');}catch{throw new AtendimentoV16Error('Arquivo inválido.');}
      if(!buffer.length||buffer.length>8*1024*1024)throw new AtendimentoV16Error('O PDF precisa ter até 8 MB.');
      if(buffer.subarray(0,4).toString('ascii')!=='%PDF')throw new AtendimentoV16Error('O arquivo enviado não parece ser um PDF válido.');
      const hash=crypto.createHash('sha256').update(buffer).digest('hex');
      await client.query('BEGIN');
      const candidate=await candidateRow(id,true,client);
      if(!candidate.atendimento_humano_ativo)throw new AtendimentoV16Error('Assuma o atendimento antes de adicionar um documento pelo chat.',409);
      if(!humanOwnedBy(req,candidate)&&!isAdmin(req))throw new AtendimentoV16Error('Somente o responsável atual pode adicionar documentos neste atendimento.',403);
      const duplicate=await client.query(`SELECT id,tipo,nome_arquivo,status_processamento,aplicacao_pendente FROM documentos WHERE candidato_id=$1 AND hash_sha256=$2 ORDER BY id ASC LIMIT 1`,[id,hash]);
      if(duplicate.rowCount){await client.query('COMMIT');return res.json({sucesso:true,duplicado:true,mensagem:'Este mesmo PDF já está preservado no cadastro.',documento:duplicate.rows[0]});}
      const origin=isAdmin(req)?'UPLOAD_ADMIN':'UPLOAD_RECRUTADOR';
      const title=type==='CTPS'?'Carteira de Trabalho Digital':type==='CURRICULO'?'Currículo':'Documento enviado pela equipe';
      const inserted=await client.query(`
        INSERT INTO documentos(candidato_id,tipo,titulo,arquivo,nome_arquivo,mime_type,tamanho_bytes,conteudo,resultado,hash_sha256,status_processamento,processando_at,
          origem_documento,recebido_durante_atendimento_humano,aplicacao_pendente,enviado_por_usuario_id,enviado_por_nome,created_at)
        VALUES($1,$2,$3,$4,$4,'application/pdf',$5,$6,JSONB_BUILD_OBJECT('origem','PAINEL','preservado',TRUE),$7,'ARMAZENADO',NOW(),$8,TRUE,FALSE,$9,$10,NOW()) RETURNING id,tipo,nome_arquivo,status_processamento
      `,[id,type==='CTPS'?'CTPS':type==='CURRICULO'?'CURRICULO':'PENDENTE',title,fileName,buffer.length,buffer,hash,origin,req.user?.id||null,currentUserName(req)]);
      await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,'DOCUMENTO_UPLOAD_ATENDIMENTO_HUMANO',$2,NOW())`,[id,`${fileName} adicionado por ${currentUserName(req)}.`]);
      await client.query('COMMIT');
      const doc=inserted.rows[0];
      let reprocess={acionado:false};
      try{
        reprocess=await triggerChatbotReprocess({candidatoId:id,documentoId:doc.id,telefone:candidate.telefone,nomeArquivo:fileName,mimeType:'application/pdf',session});
      }catch(error){
        await pool.query(`UPDATE documentos SET aplicacao_pendente=TRUE,aplicacao_pendente_em=NOW(),aplicacao_ultimo_erro=$2,aplicacao_proxima_tentativa_em=NOW(),status_processamento='AGUARDANDO_HUMANO' WHERE id=$1`,[doc.id,String(error.message).slice(0,1000)]).catch(()=>{});
        reprocess={acionado:false,erro:error.message};
      }
      res.status(201).json({sucesso:true,mensagem:reprocess.acionado?'Documento preservado e análise técnica iniciada.':'Documento preservado. A análise será tentada novamente automaticamente.',documento:doc,reprocessamento:reprocess});
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  app.post('/api/atendimento/candidatos/:id/finalizar-handoff', requireLogin, async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const id=parseId(req.params.id);if(!id)throw new AtendimentoV16Error('Candidato inválido.');
      const confirmed=req.body?.dados_confirmados&&typeof req.body.dados_confirmados==='object'?req.body.dados_confirmados:{};
      const summary=clean(req.body?.resumo,2000);
      const destination=clean(req.body?.destino,30).toUpperCase()||'IA';
      if(!['IA','HUMANO'].includes(destination))throw new AtendimentoV16Error('Destino do atendimento inválido.');
      const triageConfirmed=req.body?.triagem_confirmada&&typeof req.body.triagem_confirmada==='object'?req.body.triagem_confirmada:null;
      await client.query('BEGIN');
      const candidate=await candidateRow(id,true,client);
      if(!candidate.atendimento_humano_ativo)throw new AtendimentoV16Error('Assuma o atendimento antes de finalizá-lo.',409);
      if(!humanOwnedBy(req,candidate)&&!isAdmin(req))throw new AtendimentoV16Error('Somente o responsável atual ou um administrador pode finalizar o atendimento.',403);
      const fields=allowedFields(req);const changes=[];const sets=[];const values=[];
      for(const [field,raw] of Object.entries(confirmed)){
        if(!fields.includes(field))continue;
        let value=raw===null?null:clean(raw,['apresentacao_profissional','observacao_triagem'].includes(field)?5000:1000);
        if(field==='telefone'){value=normalizePhone(value);if(value&&!/^55\d{10,11}$/.test(value))throw new AtendimentoV16Error('Telefone inválido.');}
        if(field==='data_nascimento'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new AtendimentoV16Error('Data de nascimento inválida.');
        if(field==='sexo'&&value){value=value.toUpperCase();if(!['MASCULINO','FEMININO'].includes(value))throw new AtendimentoV16Error('Sexo inválido.');}
        const before=candidate[field]===null||candidate[field]===undefined?null:String(candidate[field]);
        const after=value===null?null:String(value);if(before===after)continue;
        values.push(value);sets.push(`${field}=$${values.length}`);changes.push({field,before,after});
      }
      if(sets.length){values.push(id);await client.query(`UPDATE candidatos SET ${sets.join(',')},dados_corrigidos_manualmente=TRUE,updated_at=NOW() WHERE id=$${values.length}`,values);}
      for(const ch of changes){await client.query(`INSERT INTO candidato_dados_historico(candidato_id,campo,valor_anterior,valor_novo,motivo,alterado_por_usuario_id,alterado_por_nome) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,ch.field,ch.before,ch.after,'Confirmado no handoff do atendimento humano',req.user?.id||null,currentUserName(req)]);}
      let triageApplied=null;
      if(destination==='IA'&&triageConfirmed){
        const perguntaId=parseId(triageConfirmed.pergunta_id);const respostaTriagem=clean(triageConfirmed.resposta,2000);
        if(perguntaId&&respostaTriagem){
          const tr=await client.query(`SELECT * FROM genesis_v16_aplicar_resposta_triagem_humana($1,$2,$3,$4)`,[id,perguntaId,respostaTriagem,currentUserName(req)]);
          if(tr.rows[0]?.aplicada)triageApplied=tr.rows[0];
        }
      }
      const stageResult=destination==='IA'?await client.query(`SELECT genesis_v16_etapa_retomada_apos_suporte($1) etapa`,[id]):{rows:[{etapa:candidate.etapa}]};
      const resumedStage=stageResult.rows[0]?.etapa||candidate.etapa;
      const docs=await client.query(`SELECT id FROM documentos WHERE candidato_id=$1 AND aplicacao_pendente IS TRUE ORDER BY created_at ASC,id ASC`,[id]);
      const docIds=docs.rows.map((r)=>Number(r.id));
      const name=currentUserName(req);
      if(destination==='IA')await client.query(`
        UPDATE candidatos SET etapa=CASE WHEN $3::BOOLEAN THEN etapa ELSE $2 END,
          ia_atendimento_ativo=TRUE,ia_retomada_em=NOW(),ia_retomada_por=$4,
          ia_ultima_acao_manual='HANDOFF_V16',ia_ultima_acao_manual_em=NOW(),ia_ultima_acao_manual_por=$4,
          atendimento_humano_ativo=FALSE,atendimento_humano_usuario_id=NULL,atendimento_humano_nome=NULL,atendimento_humano_finalizado_em=NOW(),
          atendimento_humano_solicitado=FALSE,revisao_pendente=FALSE,revisao_tipo=NULL,revisao_motivo=NULL,
          documento_processando=CASE WHEN $3::BOOLEAN THEN TRUE ELSE documento_processando END,
          processamento_bloqueado_ate=CASE WHEN $3::BOOLEAN THEN NOW()+INTERVAL '20 minutes' ELSE processamento_bloqueado_ate END,
          updated_at=NOW()
        WHERE id=$1
      `,[id,resumedStage,docIds.length>0,name]);
      else await client.query(`UPDATE candidatos SET ia_atendimento_ativo=FALSE,ia_pausada_em=COALESCE(ia_pausada_em,NOW()),ia_pausada_por=$2,ia_pausa_motivo='Aguardando atendimento humano',atendimento_humano_ativo=FALSE,atendimento_humano_usuario_id=NULL,atendimento_humano_nome=NULL,atendimento_humano_finalizado_em=NOW(),atendimento_humano_solicitado=TRUE,atendimento_humano_solicitado_em=COALESCE(atendimento_humano_solicitado_em,NOW()),updated_at=NOW() WHERE id=$1`,[id,name]);
      if(destination==='IA')await client.query(`UPDATE candidato_revisoes SET status='CONCLUIDO',decisao='ATENDIMENTO_REALIZADO',decisao_motivo=$2,decidido_por=$3,decidido_em=NOW(),updated_at=NOW() WHERE candidato_id=$1 AND tipo='SUPORTE_FLUXO' AND status='PENDENTE'`,[id,summary||'Atendimento humano concluído e devolvido para a IA.',name]);
      await client.query(`INSERT INTO atendimento_handoff_historico(candidato_id,usuario_id,usuario_nome,etapa_anterior,etapa_retomada,dados_aplicados,documentos_pendentes,resumo,triagem_aplicada,status) VALUES($1,$2,$3,$4,$5,$6::JSONB,$7::BIGINT[],$8,$9::JSONB,$10)`,[id,req.user?.id||null,name,candidate.etapa,destination==='IA'?(docIds.length?candidate.etapa:resumedStage):candidate.etapa,JSON.stringify(Object.fromEntries(changes.map((c)=>[c.field,c.after]))),docIds,summary||null,triageApplied?JSON.stringify(triageApplied):null,destination==='IA'?'CONCLUIDO':'SEM_CONTINUIDADE']);
      await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,$2,$3,NOW())`,[id,destination==='IA'?'ATENDIMENTO_HUMANO_FINALIZADO_V16':'ATENDIMENTO_HUMANO_LIBERADO_V16',destination==='IA'?`Atendimento finalizado por ${name}. ${changes.length} dado(s) aplicado(s); ${triageApplied?'1 resposta de triagem confirmada; ':''}${docIds.length} documento(s) aguardando aplicação automática.`:`Atendimento liberado por ${name}; IA mantida pausada e conversa sem responsável.`]);
      await client.query('COMMIT');
      res.json({sucesso:true,mensagem:destination==='HUMANO'?'Atendimento liberado para a equipe. A IA continua pausada.':docIds.length?'Atendimento finalizado. A IA foi liberada e os documentos serão aplicados automaticamente.':'Atendimento finalizado e devolvido para a IA.',destino:destination,dados_aplicados:changes.map((c)=>c.field),documentos_pendentes:docIds,triagem_aplicada:triageApplied,proxima_etapa:resumedStage,continuacao:null,mensagem_enviada:false});
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  // Worker de aplicação dos documentos estagiados. Ele só roda quando a IA já foi
  // liberada pelo handoff; em falhas recorrentes volta a pausar o candidato.
  let workerBusy=false;
  async function processPendingDocument(){
    if(workerBusy)return;workerBusy=true;
    let reserved=null;
    try{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const r=await client.query(`
          SELECT d.id documento_id,d.candidato_id,d.nome_arquivo,d.mime_type,d.aplicacao_tentativas,c.telefone
          FROM documentos d JOIN candidatos c ON c.id=d.candidato_id
          WHERE d.aplicacao_pendente IS TRUE AND d.conteudo IS NOT NULL
            AND c.ia_atendimento_ativo IS TRUE AND c.atendimento_humano_ativo IS NOT TRUE
            AND d.aplicacao_tentativas < 5 AND d.aplicacao_proxima_tentativa_em <= NOW()
          ORDER BY d.aplicacao_proxima_tentativa_em,d.id
          FOR UPDATE OF d SKIP LOCKED LIMIT 1
        `);
        reserved=r.rows[0]||null;
        if(reserved){
          await client.query(`UPDATE documentos SET aplicacao_tentativas=aplicacao_tentativas+1,aplicacao_proxima_tentativa_em=NOW()+INTERVAL '2 minutes',aplicacao_ultimo_erro=NULL WHERE id=$1`,[reserved.documento_id]);
        }
        await client.query('COMMIT');
      }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
      if(!reserved)return;
      try{
        await triggerChatbotReprocess({candidatoId:reserved.candidato_id,documentoId:reserved.documento_id,telefone:reserved.telefone,nomeArquivo:reserved.nome_arquivo,mimeType:reserved.mime_type||'application/pdf',session});
      }catch(error){
        const attempts=Number(reserved.aplicacao_tentativas||0)+1;
        await pool.query(`UPDATE documentos SET aplicacao_ultimo_erro=$2 WHERE id=$1`,[reserved.documento_id,String(error.message).slice(0,1000)]).catch(()=>{});
        if(attempts>=5){
          await pool.query(`UPDATE candidatos SET ia_atendimento_ativo=FALSE,ia_pausada_em=NOW(),ia_pausada_por='SISTEMA',ia_pausa_motivo='Falha ao aplicar documento preservado',atendimento_humano_solicitado=TRUE,atendimento_humano_solicitado_em=NOW(),updated_at=NOW() WHERE id=$1`,[reserved.candidato_id]).catch(()=>{});
          await pool.query(`INSERT INTO candidato_revisoes(candidato_id,vaga_id,documento_id,tipo,titulo,motivo,dados) SELECT c.id,c.vaga_id,$2,'SUPORTE_FLUXO','Documento precisa de atenção','Não foi possível aplicar automaticamente o documento preservado após 5 tentativas.',JSONB_BUILD_OBJECT('documento_id',$2) FROM candidatos c WHERE c.id=$1 ON CONFLICT DO NOTHING`,[reserved.candidato_id,reserved.documento_id]).catch(()=>{});
        }
      }
    }catch(error){if(error?.code!=='42P01'&&error?.code!=='42703')console.error('[V16] Worker de documento pendente:',error.message);}
    finally{workerBusy=false;}
  }
  const timer=setInterval(processPendingDocument,20000);timer.unref?.();setTimeout(processPendingDocument,7000).unref?.();
}

module.exports={registerAtendimentosV16,AtendimentoV16Error};
