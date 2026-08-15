'use strict';

const crypto = require('node:crypto');

class AtendimentoV15Error extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AtendimentoV15Error';
    this.statusCode = statusCode;
  }
}

function registerAtendimentoV15({
  app,
  pool,
  requireLogin,
  requireAdmin,
  currentUserName,
  wahaBaseUrl,
  wahaApiKey,
  chatbotSession,
  panelBaseUrl,
  triggerManualCandidateMessage,
  buildManualContinuationMessage,
  entrevistaGestaoWebhookUrl,
  entrevistaGestaoWebhookToken,
  alertasAdminEnabled = false,
}) {
  const baseUrl = String(wahaBaseUrl || '').replace(/\/$/, '');
  const session = String(chatbotSession || 'whats_junior').trim();
  function normalizePanelUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw || /^(undefined|null|false)$/i.test(raw)) return '';
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
      return parsed.toString().replace(/\/$/, '');
    } catch { return ''; }
  }
  const panelUrl = normalizePanelUrl(panelBaseUrl);
  const managementUrl = String(entrevistaGestaoWebhookUrl || '').trim();
  const managementToken = String(entrevistaGestaoWebhookToken || '').trim();

  function parseId(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
  function phone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits;
  }
  function isAdmin(req) { return String(req.user?.perfil || '').toUpperCase() === 'ADMIN'; }
  function safeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new AtendimentoV15Error('Data e horário inválidos.');
    return date;
  }
  function formatPt(value) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }
  async function wahaRequest(endpoint, { method = 'GET', body, timeoutMs = 30000 } = {}) {
    if (!baseUrl || !wahaApiKey || !session) throw new AtendimentoV15Error('WAHA não configurado para o atendimento pelo painel.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaApiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) throw new AtendimentoV15Error(data.message || data.error || `WAHA retornou HTTP ${response.status}.`, response.status >= 400 && response.status < 500 ? 400 : 502);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function callInterviewManagement(payload) {
    if (!managementUrl || !managementToken) throw new AtendimentoV15Error('Configure ENTREVISTA_GESTAO_WEBHOOK_URL e ENTREVISTA_GESTAO_WEBHOOK_TOKEN.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(managementUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: managementToken, ...payload }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.sucesso === false) throw new AtendimentoV15Error(data.erro || data.message || `Gestão de entrevista retornou HTTP ${response.status}.`, 502);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function candidateRow(id, lock = false, client = pool) {
    const result = await client.query(`
      SELECT c.*,COALESCE(v.titulo,c.vaga,'vaga atual') AS vaga_nome,
        u.nome AS atendimento_responsavel_nome
      FROM candidatos c
      LEFT JOIN vagas v ON v.id=c.vaga_id
      LEFT JOIN app_usuarios u ON u.id=c.atendimento_humano_usuario_id
      WHERE c.id=$1 ${lock ? 'FOR UPDATE OF c' : ''}
    `, [id]);
    if (!result.rowCount) throw new AtendimentoV15Error('Candidato não encontrado.', 404);
    return result.rows[0];
  }

  async function reconcileStaleManualMessages(candidateId) {
    // Nunca reenviar automaticamente: o WAHA pode ter recebido a requisição antes
    // de uma interrupção. Apenas encerra o estado visual travado e exige uma nova
    // ação humana consciente para qualquer tentativa posterior.
    await pool.query(`
      UPDATE mensagens
      SET status_envio='FALHA',
        contexto_snapshot=COALESCE(contexto_snapshot,'{}'::JSONB)
          || JSONB_BUILD_OBJECT(
            'erro_envio','O envio não foi confirmado pelo WAHA dentro do tempo esperado.',
            'reenvio_automatico',FALSE,
            'reconciliado_em',NOW()
          )
      WHERE candidato_id=$1
        AND origem='PAINEL_HUMANO'
        AND UPPER(COALESCE(status_envio,'')) IN ('PENDENTE','ENVIANDO')
        AND created_at < NOW()-INTERVAL '90 seconds'
    `, [candidateId]);
  }

  let notificationWorkerBusy = false;
  let notificationMissingTableLogged = false;
  async function reserveNotification() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        WITH escolhido AS (
          SELECT id FROM notificacoes_operacionais
          WHERE status IN ('PENDENTE','FALHA') AND tentativas < 5 AND proxima_tentativa_em <= NOW()
          ORDER BY proxima_tentativa_em,id
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE notificacoes_operacionais n
        SET status='PROCESSANDO',tentativas=n.tentativas+1,updated_at=NOW()
        FROM escolhido e WHERE n.id=e.id
        RETURNING n.*
      `);
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(); }
  }
  async function processOperationalNotification() {
    if (!alertasAdminEnabled || notificationWorkerBusy) return;
    notificationWorkerBusy = true;
    let item = null;
    try {
      item = await reserveNotification();
      if (!item) return;
      const target = phone(item.telefone);
      if (!/^55\d{10,11}$/.test(target)) throw new AtendimentoV15Error('Telefone de alerta inválido.', 400);
      const originalText = String(item.mensagem || '');
      if (originalText.includes('{{PANEL_URL}}') && !panelUrl) {
        throw new AtendimentoV15Error('PANEL_URL inválido ou ausente. O alerta foi retido para não enviar link quebrado.', 503);
      }
      const text = originalText.replaceAll('{{PANEL_URL}}', panelUrl);
      if (/(^|\s)(undefined|null)\/(?:entrevistas|\?candidato)/i.test(text) || /https?:\/\/(?:undefined|null)(?:\/|$)/i.test(text)) {
        throw new AtendimentoV15Error('Link operacional inválido detectado. Corrija PANEL_URL antes do envio.', 503);
      }
      try {
        await wahaRequest('/api/sendText', { method:'POST', body:{ session, chatId:`${target}@c.us`, text, linkPreview:true } });
        await pool.query(`UPDATE notificacoes_operacionais SET status='ENVIADA',enviada_em=NOW(),erro=NULL,updated_at=NOW() WHERE id=$1`, [item.id]);
      } catch (sendError) {
        await pool.query(`UPDATE notificacoes_operacionais SET status='FALHA',erro=$2,proxima_tentativa_em=NOW() + (INTERVAL '2 minutes' * GREATEST(1,tentativas)),updated_at=NOW() WHERE id=$1`, [item.id,String(sendError.message).slice(0,1000)]).catch(()=>{});
        throw sendError;
      }
    } catch (error) {
      if (error?.code === '42P01') {
        if (!notificationMissingTableLogged) console.warn('[V15] Fila de alertas aguardando a migration 26.');
        notificationMissingTableLogged = true;
      } else {
        console.error('[V15] Falha ao processar alerta operacional:', error.message);
        if (item?.id) {
          await pool.query(`UPDATE notificacoes_operacionais SET status='FALHA',erro=$2,proxima_tentativa_em=NOW() + (INTERVAL '2 minutes' * GREATEST(1,tentativas)),updated_at=NOW() WHERE id=$1`, [item.id, String(error.message).slice(0,1000)]).catch(()=>{});
        } else {
          // Recupera registros presos por falha inesperada sem conhecer o ID.
          await pool.query(`UPDATE notificacoes_operacionais SET status='FALHA',erro=COALESCE(erro,'Falha de envio'),proxima_tentativa_em=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE status='PROCESSANDO' AND updated_at < NOW()-INTERVAL '90 seconds'`).catch(()=>{});
        }
      }
    } finally { notificationWorkerBusy = false; }
  }
  if (alertasAdminEnabled) {
    const timer = setInterval(processOperationalNotification, 15000);
    timer.unref?.();
    setTimeout(processOperationalNotification, 5000).unref?.();
  }

  // Página pública por token: o token é individual, expira e pode ser revogado.
  async function findPublicInterviewByToken(token) {
    const result = await pool.query(`
      SELECT t.token,t.expira_em,t.usado_em,e.id entrevista_id,e.inicio,e.fim,e.meet_link,e.google_event_url,
        e.confirmacao_recrutador_status,c.nome candidato_nome,COALESCE(v.titulo,c.vaga,'Vaga') vaga_nome
      FROM entrevista_acao_tokens t JOIN entrevistas e ON e.id=t.entrevista_id
      JOIN candidatos c ON c.id=e.candidato_id LEFT JOIN vagas v ON v.id=e.vaga_id
      WHERE t.token=$1 LIMIT 1
    `, [token]);
    if (!result.rowCount || new Date(result.rows[0].expira_em) < new Date()) return null;
    return result.rows[0];
  }

  async function listAvailableRescheduleOptions(interviewId) {
    const result = await callInterviewManagement({ action:'LISTAR_OPCOES_REAGENDAMENTO', entrevista_id:interviewId });
    const options = Array.isArray(result?.opcoes) ? result.opcoes : [];
    return options
      .map((option) => ({ inicio:String(option.inicio || ''), fim:String(option.fim || ''), texto:String(option.texto || '') }))
      .filter((option) => option.inicio && option.fim)
      .slice(0, 3);
  }

  async function renderPublicInterviewAction(req, res, next) {
    try {
      const token = clean(req.params.token, 96);
      const d = await findPublicInterviewByToken(token);
      if (!d) return res.status(404).send('<!doctype html><meta charset="utf-8"><title>Link indisponível</title><p>Este link expirou ou não existe.</p>');
      const escaped = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
      let options = [];
      let optionsError = '';
      try { options = await listAvailableRescheduleOptions(d.entrevista_id); }
      catch (error) { optionsError = String(error.message || error).slice(0, 250); }
      const slots = options.map((option, index) => `<label class="slot"><input type="radio" name="slot" value="${escaped(`${option.inicio}|${option.fim}`)}" ${index===0?'checked':''}><span><strong>${escaped(option.texto || formatPt(option.inicio))}</strong><small>Disponível no Google Calendar</small></span></label>`).join('');
      const optionsSection = options.length
        ? `<div class="slots">${slots}</div><label>Motivo<textarea name="motivo" maxlength="500" placeholder="Opcional"></textarea></label><button class="btn primary" type="submit">Propor horário selecionado</button>`
        : `<div class="notice warn"><strong>Não foi possível carregar horários livres agora.</strong><span>${escaped(optionsError || 'Tente novamente em alguns instantes.')}</span></div>`;
      return res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gerenciar entrevista</title><style>body{font-family:system-ui;background:#f4f7fb;margin:0;color:#152033}.box{max-width:660px;margin:36px auto;background:#fff;border:1px solid #dde5ef;border-radius:20px;padding:28px;box-shadow:0 18px 60px #17203314}h1{margin:0 0 8px}.meta,.notice{background:#f7fafc;border-radius:14px;padding:16px;margin:20px 0}.actions{display:grid;gap:12px}.btn{display:block;width:100%;border:0;border-radius:12px;padding:14px;font-weight:700;cursor:pointer}.primary{background:#0f766e;color:#fff}.ghost{background:#e8eef5;color:#152033}label{display:grid;gap:6px;margin:10px 0}textarea{font:inherit;padding:12px;border:1px solid #ccd6e2;border-radius:10px}.slots{display:grid;gap:10px;margin:14px 0}.slot{display:flex;grid-template-columns:auto 1fr;align-items:center;gap:12px;padding:13px;border:1px solid #d8e2ec;border-radius:12px;cursor:pointer}.slot:has(input:checked){border-color:#0f766e;background:#f0fdfa}.slot span{display:grid;gap:2px}.slot small,small{color:#607086}.warn{background:#fff7ed;color:#9a3412}.notice span{display:block;margin-top:5px}@media(max-width:700px){.box{margin:0;min-height:100vh;border-radius:0;border:0;padding:22px}}</style></head><body><main class="box"><small>GÊNESIS IA · ENTREVISTA</small><h1>${escaped(d.candidato_nome)}</h1><p>${escaped(d.vaga_nome)}</p><div class="meta"><strong>Horário atual</strong><p>${escaped(formatPt(d.inicio))}</p></div><div class="actions"><form method="post" action="/api/public/entrevistas/acao/${encodeURIComponent(token)}/confirmar"><button class="btn primary" type="submit">Confirmar horário</button></form><details><summary class="btn ghost">Reagendar entrevista</summary><form method="post" action="/api/public/entrevistas/acao/${encodeURIComponent(token)}/reagendar">${optionsSection}</form></details></div></main></body></html>`);
    } catch (error) { next(error); }
  }

  app.get('/entrevistas/acao/:token', renderPublicInterviewAction);
  app.get('/e/:token', renderPublicInterviewAction);

  app.use('/api/public/entrevistas/acao', require('express').urlencoded({ extended: false, limit: '20kb' }));

  app.post('/api/public/entrevistas/acao/:token/confirmar', async (req, res, next) => {
    try {
      const token = clean(req.params.token, 96);
      const result = await pool.query(`
        UPDATE entrevistas e SET confirmacao_recrutador_status='CONFIRMADA',confirmada_recrutador_em=NOW(),confirmada_recrutador_por='LINK_WHATSAPP',updated_at=NOW()
        FROM entrevista_acao_tokens t
        WHERE t.entrevista_id=e.id AND t.token=$1 AND t.expira_em>NOW()
        RETURNING e.id,e.candidato_id
      `, [token]);
      if (!result.rowCount) throw new AtendimentoV15Error('Link inválido ou expirado.', 404);
      await pool.query(`UPDATE entrevista_acao_tokens SET usado_em=COALESCE(usado_em,NOW()) WHERE token=$1`, [token]);
      await pool.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,'ENTREVISTA_CONFIRMADA_RECRUTADOR','Horário confirmado pelo link enviado no WhatsApp.',NOW())`, [result.rows[0].candidato_id]);
      return res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;text-align:center;padding:60px;background:#f4f7fb}main{max-width:520px;margin:auto;background:white;padding:32px;border-radius:18px}</style><main><h1>Horário confirmado ✅</h1><p>A entrevista permanece no horário agendado.</p></main>');
    } catch (error) { next(error); }
  });

  app.post('/api/public/entrevistas/acao/:token/reagendar', async (req, res, next) => {
    try {
      const token = clean(req.params.token, 96);
      const d = await findPublicInterviewByToken(token);
      if (!d) throw new AtendimentoV15Error('Link inválido ou expirado.', 404);
      const [rawStart, rawEnd] = String(req.body?.slot || '').split('|');
      const start = safeDate(rawStart);
      const end = safeDate(rawEnd);
      const options = await listAvailableRescheduleOptions(d.entrevista_id);
      const selected = options.find((option) => option.inicio === start.toISOString() && option.fim === end.toISOString());
      if (!selected) throw new AtendimentoV15Error('Esse horário não está mais disponível. Abra o link novamente para consultar opções atualizadas.', 409);
      await callInterviewManagement({ action:'PROPOR_REAGENDAMENTO', entrevista_id:d.entrevista_id, inicio_proposto:selected.inicio, fim_proposto:selected.fim, motivo:clean(req.body?.motivo,500), solicitado_por:'Recrutador pelo WhatsApp' });
      return res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;text-align:center;padding:60px;background:#f4f7fb}main{max-width:520px;margin:auto;background:white;padding:32px;border-radius:18px}</style><main><h1>Proposta enviada ✅</h1><p>O horário atual permanece reservado até o candidato confirmar a alteração.</p></main>');
    } catch (error) { next(error); }
  });

  // Todas as rotas abaixo exigem sessão do painel.
  app.get('/api/atendimento/candidatos/:id/conversa', requireLogin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id); if (!id) throw new AtendimentoV15Error('Candidato inválido.');
      const after = Math.max(0, Number(req.query.after || 0));
      await reconcileStaleManualMessages(id);
      const [candidate, messages] = await Promise.all([
        candidateRow(id),
        pool.query(`SELECT id,quem,mensagem,mensagem_id,origem,autor_usuario_id,autor_nome,status_envio,created_at FROM mensagens WHERE candidato_id=$1 AND id>$2 ORDER BY id ASC LIMIT 300`, [id, after]),
      ]);
      return res.json({ sucesso: true, candidato: { id:candidate.id, ia_atendimento_ativo:candidate.ia_atendimento_ativo, ia_pausada_em:candidate.ia_pausada_em, ia_pausa_motivo:candidate.ia_pausa_motivo, atendimento_humano_ativo:candidate.atendimento_humano_ativo, atendimento_humano_usuario_id:candidate.atendimento_humano_usuario_id, atendimento_humano_nome:candidate.atendimento_humano_nome, atendimento_humano_assumido_em:candidate.atendimento_humano_assumido_em, atendimento_responsavel_nome:candidate.atendimento_responsavel_nome, etapa:candidate.etapa, status:candidate.status, proxima_acao:buildManualContinuationMessage(candidate,'') }, mensagens: messages.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/atendimento/candidatos/:id/assumir', requireLogin, async (req, res, next) => {
    const client = await pool.connect();
    try {
      const id = parseId(req.params.id); if (!id) throw new AtendimentoV15Error('Candidato inválido.');
      await client.query('BEGIN');
      const candidate = await candidateRow(id, true, client);
      if (candidate.atendimento_humano_ativo && Number(candidate.atendimento_humano_usuario_id) !== Number(req.user.id) && !isAdmin(req)) throw new AtendimentoV15Error(`Atendimento já assumido por ${candidate.atendimento_responsavel_nome || candidate.atendimento_humano_nome || 'outro recrutador'}.`, 409);
      const name = currentUserName(req);
      await client.query(`UPDATE candidatos SET ia_atendimento_ativo=FALSE,ia_pausada_em=NOW(),ia_pausada_por=$2,ia_pausa_motivo='Atendimento assumido no Chat UI',atendimento_humano_ativo=TRUE,atendimento_humano_usuario_id=$3,atendimento_humano_nome=$2,atendimento_humano_assumido_em=NOW(),atendimento_humano_finalizado_em=NULL,updated_at=NOW() WHERE id=$1`, [id,name,req.user.id||null]);
      await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,'ATENDIMENTO_HUMANO_ASSUMIDO',$2,NOW())`, [id,`Atendimento assumido por ${name}; IA pausada automaticamente.`]);
      await client.query('COMMIT');
      res.json({ sucesso:true,mensagem:`Atendimento assumido por ${name}. A IA está pausada.` });
    } catch(error){try{await client.query('ROLLBACK');}catch{} next(error);} finally{client.release();}
  });

  app.post('/api/atendimento/candidatos/:id/devolver', requireLogin, async (_req, res) => {
    // V16: impedir que cliente/JS antigo contorne a passagem de bastão estruturada.
    return res.status(409).json({
      sucesso: false,
      erro: 'Use “Finalizar atendimento” para revisar dados e documentos antes de devolver a conversa para a IA.',
      codigo: 'HANDOFF_V16_OBRIGATORIO',
    });
  });

  app.post('/api/atendimento/candidatos/:id/mensagens', requireLogin, async (req,res,next)=>{
    const client=await pool.connect();
    try{
      const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Candidato inválido.');
      const content=clean(req.body?.mensagem,4000);if(!content)throw new AtendimentoV15Error('Digite uma mensagem.');
      const clientId=clean(req.body?.client_message_id,80);const uuid=/^[0-9a-f-]{36}$/i.test(clientId)?clientId:crypto.randomUUID();
      await client.query('BEGIN');const candidate=await candidateRow(id,true,client);
      if(!candidate.atendimento_humano_ativo)throw new AtendimentoV15Error('Assuma o atendimento antes de enviar mensagens.',409);
      if(Number(candidate.atendimento_humano_usuario_id)!==Number(req.user.id))throw new AtendimentoV15Error(`Conversa assumida por ${candidate.atendimento_responsavel_nome||candidate.atendimento_humano_nome||'outro recrutador'}. Assuma o atendimento antes de responder.`,409);
      const author=currentUserName(req);const finalMessage=`#${author}: ${content}`;
      const inserted=await client.query(`INSERT INTO mensagens(candidato_id,quem,mensagem,origem,autor_usuario_id,autor_nome,status_envio,client_message_id,created_at) VALUES($1,'RECRUTADOR',$2,'PAINEL_HUMANO',$3,$4,'ENVIANDO',$5,NOW()) ON CONFLICT(client_message_id) DO NOTHING RETURNING *`,[id,finalMessage,req.user.id||null,author,uuid]);
      if(!inserted.rowCount){
        const existing=await client.query(`SELECT * FROM mensagens WHERE client_message_id=$1 LIMIT 1`,[uuid]);
        await client.query('COMMIT');
        return res.status(200).json({sucesso:true,mensagem:'Envio já registrado; nenhuma mensagem duplicada foi criada.',registro:existing.rows[0]||null,duplicada:true});
      }
      await client.query('COMMIT');
      try{
        const target=phone(candidate.telefone);if(!/^55\d{10,11}$/.test(target))throw new AtendimentoV15Error('Telefone do candidato inválido para envio.',400);
        const response=await wahaRequest('/api/sendText',{method:'POST',body:{session,chatId:`${target}@c.us`,text:finalMessage,linkPreview:true}});
        const wahaMessageId=typeof response?.id==='string'?response.id:(typeof response?.key?.id==='string'?response.key.id:'');
        const updated=await pool.query(`UPDATE mensagens SET status_envio='ENVIADA',mensagem_id=COALESCE(NULLIF($2,''),mensagem_id) WHERE id=$1 RETURNING *`,[inserted.rows[0].id,wahaMessageId]);
        return res.status(201).json({sucesso:true,mensagem:'Mensagem enviada.',registro:updated.rows[0]});
      }catch(sendError){await pool.query(`UPDATE mensagens SET status_envio='FALHA',contexto_snapshot=COALESCE(contexto_snapshot,'{}'::jsonb)||JSONB_BUILD_OBJECT('erro_envio',$2,'reenvio_automatico',FALSE) WHERE id=$1`,[inserted.rows[0].id,sendError.message]);throw sendError;}
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  app.patch('/api/atendimento/candidatos/:id/dados', requireLogin, async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Candidato inválido.');
      const reason=clean(req.body?.motivo,1000);if(reason.length<3)throw new AtendimentoV15Error('Informe o motivo da correção.');
      const recruiterFields=['nome','cep','cidade','estado','cargo','tempo_experiencia','apresentacao_profissional','observacao_triagem'];
      const adminFields=[...recruiterFields,'telefone','cpf','nome_mae','data_nascimento','sexo'];
      const allowed=isAdmin(req)?adminFields:recruiterFields;const payload=req.body?.dados||{};const entries=Object.entries(payload).filter(([field])=>allowed.includes(field));
      if(!entries.length)throw new AtendimentoV15Error('Nenhum campo permitido foi informado.');
      await client.query('BEGIN');const current=await candidateRow(id,true,client);const changed=[];const sets=[];const values=[];
      for(const [field,raw] of entries){const maxLength=['apresentacao_profissional','observacao_triagem'].includes(field)?5000:(field==='tempo_experiencia'?1000:200);let value=raw===null?null:clean(raw,maxLength);if(field==='telefone'){value=phone(value);if(!/^55\d{10,11}$/.test(value))throw new AtendimentoV15Error('Telefone inválido.');}if(field==='data_nascimento'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new AtendimentoV15Error('Data de nascimento inválida.');if(field==='sexo'&&value&&!['MASCULINO','FEMININO'].includes(String(value).toUpperCase()))throw new AtendimentoV15Error('Sexo inválido.');if(field==='sexo'&&value)value=String(value).toUpperCase();const previous=current[field]===null?null:String(current[field]);const next=value===null?null:String(value);if(previous===next)continue;values.push(value);sets.push(`${field}=$${values.length}`);changed.push({field,previous,next});}
      if(!changed.length){await client.query('ROLLBACK');return res.json({sucesso:true,mensagem:'Nenhuma alteração foi necessária.'});}
      values.push(id);await client.query(`UPDATE candidatos SET ${sets.join(',')},dados_corrigidos_manualmente=TRUE,${payload.data_nascimento!==undefined?'data_nascimento_origem=\'MANUAL\',data_nascimento_atualizada_em=NOW(),':''}${payload.sexo!==undefined?'sexo_origem=\'MANUAL\',sexo_atualizado_em=NOW(),':''}updated_at=NOW() WHERE id=$${values.length}`,values);
      for(const item of changed)await client.query(`INSERT INTO candidato_dados_historico(candidato_id,campo,valor_anterior,valor_novo,motivo,alterado_por_usuario_id,alterado_por_nome) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,item.field,item.previous,item.next,reason,req.user.id||null,currentUserName(req)]);
      await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,'DADOS_CANDIDATO_CORRIGIDOS',$2,NOW())`,[id,`${changed.length} campo(s) corrigido(s) por ${currentUserName(req)}. Motivo: ${reason}`]);
      await client.query('COMMIT');res.json({sucesso:true,mensagem:'Dados atualizados e registrados no histórico.',campos:changed.map(x=>x.field)});
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  app.get('/api/atendimento/candidatos/:id/correcao/preview', requireLogin, requireAdmin, async(req,res,next)=>{
    try{const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Candidato inválido.');const candidate=await candidateRow(id);const status=clean(req.query.status,50).toUpperCase()||candidate.status;const etapa=clean(req.query.etapa,100).toUpperCase()||candidate.etapa;const projected={...candidate,status,etapa};res.json({sucesso:true,anterior:{status:candidate.status,etapa:candidate.etapa},novo:{status,etapa},mensagem_prevista:buildManualContinuationMessage(projected,'')});}catch(error){next(error);}
  });

  app.post('/api/atendimento/candidatos/:id/correcao', requireLogin, requireAdmin, async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Candidato inválido.');const mode=clean(req.body?.modo,40).toUpperCase();if(!['SOMENTE_CORRECAO','CORRIGIR_E_CONTINUAR'].includes(mode))throw new AtendimentoV15Error('Modo de correção inválido.');const status=clean(req.body?.status,50).toUpperCase();const etapa=clean(req.body?.etapa,100).toUpperCase();const allowedStatuses=['NOVO','EM_PROCESSO','APROVADO','EM_ADMISSAO','REPROVADO','CONTRATADO','ENCERRADO'];if(!allowedStatuses.includes(status)||!/^[A-Z0-9_]{3,100}$/.test(etapa))throw new AtendimentoV15Error('Status ou etapa inválidos.');const reason=clean(req.body?.motivo,1000);if(reason.length<3)throw new AtendimentoV15Error('Informe o motivo da correção.');
      await client.query('BEGIN');const current=await candidateRow(id,true,client);const projected={...current,status,etapa};const message=clean(req.body?.mensagem,4000)||buildManualContinuationMessage(projected,'');const activate=mode==='CORRIGIR_E_CONTINUAR';
      await client.query(`UPDATE candidatos SET
        status=$2,
        etapa=$3,
        ia_atendimento_ativo=CASE WHEN $4 THEN TRUE ELSE ia_atendimento_ativo END,
        ia_retomada_em=CASE WHEN $4 THEN NOW() ELSE ia_retomada_em END,
        ia_retomada_por=CASE WHEN $4 THEN $5 ELSE ia_retomada_por END,
        atendimento_humano_ativo=CASE WHEN $4 THEN FALSE ELSE atendimento_humano_ativo END,
        atendimento_humano_usuario_id=CASE WHEN $4 THEN NULL ELSE atendimento_humano_usuario_id END,
        atendimento_humano_nome=CASE WHEN $4 THEN NULL ELSE atendimento_humano_nome END,
        atendimento_humano_finalizado_em=CASE WHEN $4 THEN NOW() ELSE atendimento_humano_finalizado_em END,
        ia_ultima_acao_manual=$6,
        ia_ultima_acao_manual_em=NOW(),
        ia_ultima_acao_manual_por=$5,
        updated_at=NOW()
      WHERE id=$1`,[id,status,etapa,activate,currentUserName(req),mode]);
      const hist=await client.query(`INSERT INTO candidato_estado_historico(candidato_id,status_anterior,etapa_anterior,status_novo,etapa_nova,modo,mensagem_prevista,motivo,alterado_por_usuario_id,alterado_por_nome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[id,current.status,current.etapa,status,etapa,mode,message,reason,req.user.id||null,currentUserName(req)]);
      await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,$2,$3,NOW())`,[id,mode==='CORRIGIR_E_CONTINUAR'?'CORRECAO_TECNICA_E_CONTINUACAO':'CORRECAO_TECNICA',`De ${current.status}/${current.etapa} para ${status}/${etapa}. Alterado por ${currentUserName(req)}. Motivo: ${reason}`]);
      await client.query('COMMIT');let delivery=null;
      if(activate){
        try{
          delivery=await triggerManualCandidateMessage({candidatoId:id,mensagem:message,evento:'CORRECAO_CONTINUADA_V15',solicitadoPor:currentUserName(req),session});
          if(delivery?.enviado)await pool.query(`UPDATE candidato_estado_historico SET mensagem_enviada=TRUE WHERE id=$1`,[hist.rows[0].id]);
        }catch(sendError){
          delivery={configurado:true,enviado:false,erro:String(sendError.message||sendError).slice(0,1000)};
        }
      }
      res.json({sucesso:true,mensagem:activate?(delivery?.enviado?'Correção aplicada e atendimento continuado.':'Correção aplicada, mas o envio não foi confirmado. Verifique o webhook antes de tentar novamente.'):'Correção aplicada sem enviar mensagem.',mensagem_prevista:message,envio:delivery,aviso:activate&&!delivery?.enviado?(delivery?.erro||delivery?.aviso||'Envio não confirmado.'):null});
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  app.post('/api/atendimento/entrevistas/:id/confirmar', requireLogin, async(req,res,next)=>{
    try{const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Entrevista inválida.');const result=await pool.query(`UPDATE entrevistas SET confirmacao_recrutador_status='CONFIRMADA',confirmada_recrutador_em=NOW(),confirmada_recrutador_por=$2,updated_at=NOW() WHERE id=$1 RETURNING candidato_id`,[id,currentUserName(req)]);if(!result.rowCount)throw new AtendimentoV15Error('Entrevista não encontrada.',404);await pool.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,'ENTREVISTA_CONFIRMADA_RECRUTADOR',$2,NOW())`,[result.rows[0].candidato_id,`Entrevista confirmada por ${currentUserName(req)}.`]);res.json({sucesso:true,mensagem:'Horário da entrevista confirmado.'});}catch(error){next(error);}
  });

  app.get('/api/atendimento/entrevistas/:id/opcoes-reagendamento', requireLogin, async(req,res,next)=>{
    try{const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Entrevista inválida.');const opcoes=await listAvailableRescheduleOptions(id);res.json({sucesso:true,opcoes});}catch(error){next(error);}
  });

  app.post('/api/atendimento/entrevistas/:id/reagendar', requireLogin, async(req,res,next)=>{
    try{const id=parseId(req.params.id);if(!id)throw new AtendimentoV15Error('Entrevista inválida.');const start=safeDate(req.body?.inicio);const end=safeDate(req.body?.fim);const opcoes=await listAvailableRescheduleOptions(id);const selected=opcoes.find(o=>o.inicio===start.toISOString()&&o.fim===end.toISOString());if(!selected)throw new AtendimentoV15Error('Esse horário não está mais disponível. Atualize as opções e tente novamente.',409);const result=await callInterviewManagement({action:'PROPOR_REAGENDAMENTO',entrevista_id:id,inicio_proposto:selected.inicio,fim_proposto:selected.fim,motivo:clean(req.body?.motivo,500),solicitado_por:currentUserName(req),solicitado_por_usuario_id:req.user.id||null});res.json({sucesso:true,mensagem:result.mensagem||'Proposta enviada. O horário atual permanece reservado.',resultado:result});}catch(error){next(error);}
  });
}

module.exports = { registerAtendimentoV15, AtendimentoV15Error };
