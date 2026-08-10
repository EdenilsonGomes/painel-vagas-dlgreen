'use strict';

const STAGES = ['NOVO_LEAD','CONTATADO','RESPONDEU','QUALIFICADO','DEMONSTRACAO','PROPOSTA','NEGOCIACAO','GANHO','PERDIDO'];
const STAGE_INDEX = Object.fromEntries(STAGES.map((stage, index) => [stage, index]));

function clean(value, max = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.slice(0, 30) : null;
}

function leadStage(lead) {
  const status = String(lead?.status || '').toUpperCase();
  if (['CLIENTE'].includes(status)) return 'GANHO';
  if (['DESCARTADO','SEM_INTERESSE','CONTATO_INVALIDO','NAO_CONTATAR'].includes(status)) return 'PERDIDO';
  if (status === 'PROPOSTA') return 'PROPOSTA';
  if (status === 'REUNIAO') return 'DEMONSTRACAO';
  if (status === 'RESPONDEU') return 'RESPONDEU';
  if (status === 'PRIMEIRO_CONTATO' || lead?.primeiro_contato_at) return 'CONTATADO';
  return 'NOVO_LEAD';
}

function stageCanAdvance(current, next) {
  if (!STAGE_INDEX.hasOwnProperty(current)) return true;
  if (!STAGE_INDEX.hasOwnProperty(next)) return false;
  if (['GANHO','PERDIDO'].includes(current)) return false;
  return STAGE_INDEX[next] > STAGE_INDEX[current];
}

async function ensureCompanyFromLead(client, lead) {
  const existing = await client.query('SELECT * FROM crm_empresas WHERE prospeccao_lead_id=$1 LIMIT 1', [lead.id]);
  if (existing.rowCount) {
    await client.query(`UPDATE crm_empresas SET nome=$2,segmento=$3,cidade=$4,estado=$5,website=$6,updated_at=NOW() WHERE id=$1`, [
      existing.rows[0].id, clean(lead.empresa_nome, 180), clean(lead.categoria, 160), clean(lead.cidade, 160), clean(lead.estado, 2)?.toUpperCase(), clean(lead.website, 1000),
    ]);
    return existing.rows[0].id;
  }
  const inserted = await client.query(`
    INSERT INTO crm_empresas(nome,segmento,cidade,estado,website,origem,prospeccao_lead_id)
    VALUES($1,$2,$3,$4,$5,'PROSPECCAO',$6) RETURNING id
  `, [clean(lead.empresa_nome, 180) || `Lead #${lead.id}`, clean(lead.categoria, 160), clean(lead.cidade, 160), clean(lead.estado, 2)?.toUpperCase(), clean(lead.website, 1000), lead.id]);
  return inserted.rows[0].id;
}

async function ensurePrimaryContact(client, companyId, data, origin) {
  const whatsapp = phone(data.whatsapp || data.telefone);
  const email = clean(data.email, 254)?.toLowerCase();
  if (!whatsapp && !email && !clean(data.nome, 160)) return null;
  const existing = await client.query(`
    SELECT id FROM crm_contatos WHERE crm_empresa_id=$1
      AND (($2::TEXT IS NOT NULL AND whatsapp=$2) OR ($3::TEXT IS NOT NULL AND LOWER(email)=LOWER($3)))
    ORDER BY principal DESC,id LIMIT 1
  `, [companyId, whatsapp, email]);
  if (existing.rowCount) {
    await client.query(`UPDATE crm_contatos SET nome=COALESCE($2,nome),cargo=COALESCE($3,cargo),email=COALESCE($4,email),whatsapp=COALESCE($5,whatsapp),principal=TRUE,updated_at=NOW() WHERE id=$1`, [
      existing.rows[0].id, clean(data.nome,160), clean(data.cargo,160), email, whatsapp,
    ]);
    return existing.rows[0].id;
  }
  const result = await client.query(`
    INSERT INTO crm_contatos(crm_empresa_id,nome,cargo,email,whatsapp,principal,origem)
    VALUES($1,$2,$3,$4,$5,TRUE,$6) RETURNING id
  `, [companyId, clean(data.nome,160), clean(data.cargo,160), email, whatsapp, origin]);
  return result.rows[0].id;
}

async function syncProspecting(client) {
  const leads = await client.query(`SELECT * FROM prospeccao_leads WHERE COALESCE(nao_contatar,FALSE)=FALSE OR status IN ('NAO_CONTATAR','SEM_INTERESSE','DESCARTADO') ORDER BY id`);
  let created = 0;
  let updated = 0;
  for (const lead of leads.rows) {
    const companyId = await ensureCompanyFromLead(client, lead);
    await ensurePrimaryContact(client, companyId, { nome: null, telefone: lead.telefone_normalizado || lead.telefone, email: lead.email }, 'PROSPECCAO');
    const existing = await client.query('SELECT * FROM crm_oportunidades WHERE prospeccao_lead_id=$1 LIMIT 1', [lead.id]);
    const targetStage = leadStage(lead);
    if (!existing.rowCount) {
      await client.query(`
        INSERT INTO crm_oportunidades(crm_empresa_id,titulo,etapa,responsavel_id,origem,prospeccao_lead_id,ganho_em,perdido_em,motivo_perda)
        VALUES($1,$2,$3,$4,'PROSPECCAO',$5,CASE WHEN $3='GANHO' THEN NOW() END,CASE WHEN $3='PERDIDO' THEN NOW() END,$6)
      `, [companyId, `Oportunidade · ${clean(lead.empresa_nome,180) || 'Empresa'}`, targetStage, lead.responsavel_id || null, lead.id, targetStage === 'PERDIDO' ? clean(lead.motivo_descarte || lead.status,500) : null]);
      created += 1;
    } else {
      const current = existing.rows[0];
      if (stageCanAdvance(String(current.etapa), targetStage)) {
        await client.query(`UPDATE crm_oportunidades SET etapa=$2,responsavel_id=COALESCE(responsavel_id,$3),ganho_em=CASE WHEN $2='GANHO' THEN COALESCE(ganho_em,NOW()) ELSE ganho_em END,perdido_em=CASE WHEN $2='PERDIDO' THEN COALESCE(perdido_em,NOW()) ELSE perdido_em END,motivo_perda=CASE WHEN $2='PERDIDO' THEN COALESCE(motivo_perda,$4) ELSE motivo_perda END,updated_at=NOW() WHERE id=$1`, [current.id, targetStage, lead.responsavel_id || null, clean(lead.motivo_descarte || lead.status,500)]);
        updated += 1;
      }
    }
  }
  return { created, updated };
}

async function findCompanyForDemo(client, demo) {
  const byDemo = await client.query(`
    SELECT ce.id FROM crm_oportunidades co JOIN crm_empresas ce ON ce.id=co.crm_empresa_id WHERE co.demo_id=$1 LIMIT 1
  `, [demo.id]);
  if (byDemo.rowCount) return byDemo.rows[0].id;
  const byName = await client.query(`SELECT id FROM crm_empresas WHERE LOWER(nome)=LOWER($1) ORDER BY id LIMIT 1`, [demo.empresa_nome]);
  if (byName.rowCount) return byName.rows[0].id;
  const created = await client.query(`INSERT INTO crm_empresas(nome,origem) VALUES($1,'DEMONSTRACAO') RETURNING id`, [clean(demo.empresa_nome,180)]);
  return created.rows[0].id;
}

async function syncDemos(client) {
  const demos = await client.query('SELECT * FROM genesis_demos ORDER BY id');
  let linked = 0;
  for (const demo of demos.rows) {
    const companyId = await findCompanyForDemo(client, demo);
    await ensurePrimaryContact(client, companyId, { nome: demo.contato_nome, whatsapp: demo.contato_whatsapp, email: demo.contato_email }, 'DEMONSTRACAO');
    const byDemo = await client.query('SELECT * FROM crm_oportunidades WHERE demo_id=$1 LIMIT 1', [demo.id]);
    if (byDemo.rowCount) continue;
    const open = await client.query(`SELECT * FROM crm_oportunidades WHERE crm_empresa_id=$1 AND etapa NOT IN ('GANHO','PERDIDO') AND demo_id IS NULL ORDER BY updated_at DESC,id DESC LIMIT 1`, [companyId]);
    if (open.rowCount) {
      const row = open.rows[0];
      const nextStage = stageCanAdvance(String(row.etapa), 'DEMONSTRACAO') ? 'DEMONSTRACAO' : row.etapa;
      await client.query(`UPDATE crm_oportunidades SET demo_id=$2,etapa=$3,updated_at=NOW() WHERE id=$1`, [row.id, demo.id, nextStage]);
    } else {
      await client.query(`INSERT INTO crm_oportunidades(crm_empresa_id,titulo,etapa,responsavel_id,origem,demo_id) VALUES($1,$2,'DEMONSTRACAO',$3,'DEMONSTRACAO',$4)`, [companyId, `Demonstração · ${clean(demo.empresa_nome,180)}`, demo.criado_por || null, demo.id]);
    }
    linked += 1;
  }
  return { linked };
}

async function syncSources(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(19001900)');
    const prospection = await syncProspecting(client);
    const demos = await syncDemos(client);
    await client.query('COMMIT');
    return { prospection, demos };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function opportunityDetails(pool, id) {
  const [opportunity, contacts, interactions, followups] = await Promise.all([
    pool.query(`
      SELECT co.*,ce.nome AS empresa_nome,ce.segmento,ce.cidade,ce.estado,ce.website,ce.empresa_operacional_id,
        u.nome AS responsavel_nome,gd.status AS demo_status,gd.expira_em AS demo_expira_em,pl.status AS prospeccao_status
      FROM crm_oportunidades co
      JOIN crm_empresas ce ON ce.id=co.crm_empresa_id
      LEFT JOIN app_usuarios u ON u.id=co.responsavel_id
      LEFT JOIN genesis_demos gd ON gd.id=co.demo_id
      LEFT JOIN prospeccao_leads pl ON pl.id=co.prospeccao_lead_id
      WHERE co.id=$1 LIMIT 1
    `, [id]),
    pool.query(`SELECT * FROM crm_contatos WHERE crm_empresa_id=(SELECT crm_empresa_id FROM crm_oportunidades WHERE id=$1) ORDER BY principal DESC,id`, [id]),
    pool.query(`SELECT * FROM crm_interacoes WHERE oportunidade_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [id]),
    pool.query(`SELECT f.*,u.nome AS responsavel_nome FROM crm_followups f LEFT JOIN app_usuarios u ON u.id=f.responsavel_id WHERE oportunidade_id=$1 ORDER BY CASE WHEN f.status='PENDENTE' THEN 0 ELSE 1 END,f.vencimento NULLS LAST,f.id DESC`, [id]),
  ]);
  if (!opportunity.rowCount) return null;
  return { oportunidade: opportunity.rows[0], contatos: contacts.rows, interacoes: interactions.rows, followups: followups.rows };
}

function registerCrmV1({ app, pool, requireAdmin, currentUserName }) {
  app.post('/api/admin/crm/sincronizar', requireAdmin, async (_req, res, next) => {
    try { return res.json({ sucesso: true, sincronizacao: await syncSources(pool) }); }
    catch (error) { return next(error); }
  });

  app.get('/api/admin/crm/dashboard', requireAdmin, async (_req, res, next) => {
    try {
      const [metrics, stages, followups, recent] = await Promise.all([
        pool.query(`SELECT COUNT(*) FILTER(WHERE etapa NOT IN ('GANHO','PERDIDO'))::INTEGER AS abertas,COUNT(*) FILTER(WHERE etapa='DEMONSTRACAO')::INTEGER AS demos,COUNT(*) FILTER(WHERE etapa IN ('PROPOSTA','NEGOCIACAO'))::INTEGER AS propostas,COUNT(*) FILTER(WHERE etapa='GANHO')::INTEGER AS ganhos,COALESCE(SUM(valor_estimado) FILTER(WHERE etapa NOT IN ('GANHO','PERDIDO')),0)::NUMERIC AS pipeline_valor FROM crm_oportunidades`),
        pool.query(`SELECT etapa,COUNT(*)::INTEGER AS total,COALESCE(SUM(valor_estimado),0)::NUMERIC AS valor FROM crm_oportunidades GROUP BY etapa`),
        pool.query(`SELECT f.*,ce.nome AS empresa_nome,co.etapa,u.nome AS responsavel_nome FROM crm_followups f JOIN crm_oportunidades co ON co.id=f.oportunidade_id JOIN crm_empresas ce ON ce.id=co.crm_empresa_id LEFT JOIN app_usuarios u ON u.id=f.responsavel_id WHERE f.status='PENDENTE' ORDER BY f.vencimento NULLS LAST LIMIT 100`),
        pool.query(`SELECT co.id,co.etapa,co.updated_at,co.origem,ce.nome AS empresa_nome,u.nome AS responsavel_nome FROM crm_oportunidades co JOIN crm_empresas ce ON ce.id=co.crm_empresa_id LEFT JOIN app_usuarios u ON u.id=co.responsavel_id ORDER BY co.updated_at DESC LIMIT 8`),
      ]);
      return res.json({ sucesso: true, metricas: metrics.rows[0], etapas: stages.rows, followups: followups.rows, recentes: recent.rows });
    } catch (error) { return next(error); }
  });

  app.get('/api/admin/crm/oportunidades', requireAdmin, async (req, res, next) => {
    try {
      const q = clean(req.query.q, 120);
      const params = [];
      let where = '';
      if (q) { params.push(`%${q}%`); where = `WHERE ce.nome ILIKE $1 OR COALESCE(co.titulo,'') ILIKE $1`; }
      const result = await pool.query(`
        SELECT co.*,ce.nome AS empresa_nome,ce.segmento,ce.cidade,ce.estado,ce.empresa_operacional_id,u.nome AS responsavel_nome,
          (SELECT COUNT(*)::INTEGER FROM crm_followups f WHERE f.oportunidade_id=co.id AND f.status='PENDENTE') AS followups_pendentes,
          (SELECT MAX(created_at) FROM crm_interacoes ci WHERE ci.oportunidade_id=co.id) AS ultima_interacao
        FROM crm_oportunidades co JOIN crm_empresas ce ON ce.id=co.crm_empresa_id LEFT JOIN app_usuarios u ON u.id=co.responsavel_id
        ${where} ORDER BY co.updated_at DESC,co.id DESC
      `, params);
      return res.json({ sucesso: true, oportunidades: result.rows });
    } catch (error) { return next(error); }
  });

  app.get('/api/admin/crm/oportunidades/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ sucesso: false, erro: 'Oportunidade inválida.' });
      const details = await opportunityDetails(pool, id);
      if (!details) return res.status(404).json({ sucesso: false, erro: 'Oportunidade não encontrada.' });
      return res.json({ sucesso: true, ...details });
    } catch (error) { return next(error); }
  });

  app.post('/api/admin/crm/oportunidades', requireAdmin, async (req, res, next) => {
    try {
      const companyName = clean(req.body?.empresa_nome, 180);
      if (!companyName) return res.status(400).json({ sucesso: false, erro: 'Informe a empresa.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let company = await client.query(`SELECT id FROM crm_empresas WHERE LOWER(nome)=LOWER($1) ORDER BY id LIMIT 1`, [companyName]);
        if (!company.rowCount) company = await client.query(`INSERT INTO crm_empresas(nome,segmento,cidade,estado,website,origem) VALUES($1,$2,$3,$4,$5,'MANUAL') RETURNING id`, [companyName,clean(req.body?.segmento,160),clean(req.body?.cidade,160),clean(req.body?.estado,2)?.toUpperCase(),clean(req.body?.website,1000)]);
        const created = await client.query(`INSERT INTO crm_oportunidades(crm_empresa_id,titulo,etapa,valor_estimado,responsavel_id,origem,proxima_acao,proxima_acao_em) VALUES($1,$2,$3,$4,$5,'MANUAL',$6,$7) RETURNING *`, [company.rows[0].id,clean(req.body?.titulo,220)||`Oportunidade · ${companyName}`,STAGES.includes(req.body?.etapa)?req.body.etapa:'NOVO_LEAD',req.body?.valor_estimado===''||req.body?.valor_estimado==null?null:Number(req.body.valor_estimado),req.user?.id||null,clean(req.body?.proxima_acao,240),req.body?.proxima_acao_em||null]);
        await ensurePrimaryContact(client, company.rows[0].id, { nome:req.body?.contato_nome,cargo:req.body?.contato_cargo,email:req.body?.contato_email,whatsapp:req.body?.contato_whatsapp }, 'MANUAL');
        await client.query('COMMIT');
        return res.status(201).json({ sucesso:true,oportunidade:created.rows[0],mensagem:'Oportunidade criada.' });
      } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
    } catch (error) { return next(error); }
  });

  app.patch('/api/admin/crm/oportunidades/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const etapa = clean(req.body?.etapa,30)?.toUpperCase();
      if (!Number.isInteger(id) || id<=0) return res.status(400).json({ sucesso:false,erro:'Oportunidade inválida.' });
      if (etapa && !STAGES.includes(etapa)) return res.status(400).json({ sucesso:false,erro:'Etapa inválida.' });
      const current = await pool.query('SELECT * FROM crm_oportunidades WHERE id=$1 LIMIT 1',[id]);
      if (!current.rowCount) return res.status(404).json({ sucesso:false,erro:'Oportunidade não encontrada.' });
      const row=current.rows[0];
      const next=await pool.query(`UPDATE crm_oportunidades SET etapa=$2,titulo=COALESCE($3,titulo),valor_estimado=$4,responsavel_id=COALESCE($5,responsavel_id),proxima_acao=$6,proxima_acao_em=$7,motivo_perda=CASE WHEN $2='PERDIDO' THEN $8 ELSE motivo_perda END,ganho_em=CASE WHEN $2='GANHO' THEN COALESCE(ganho_em,NOW()) ELSE ganho_em END,perdido_em=CASE WHEN $2='PERDIDO' THEN COALESCE(perdido_em,NOW()) ELSE perdido_em END,updated_at=NOW() WHERE id=$1 RETURNING *`,[
        id,etapa||row.etapa,clean(req.body?.titulo,220),req.body?.valor_estimado===undefined?row.valor_estimado:(req.body.valor_estimado===''?null:Number(req.body.valor_estimado)),req.body?.responsavel_id?Number(req.body.responsavel_id):null,req.body?.proxima_acao===undefined?row.proxima_acao:clean(req.body.proxima_acao,240),req.body?.proxima_acao_em===undefined?row.proxima_acao_em:(req.body.proxima_acao_em||null),clean(req.body?.motivo_perda,1000)
      ]);
      if (etapa && etapa!==row.etapa) await pool.query(`INSERT INTO crm_interacoes(oportunidade_id,tipo,descricao,criado_por,criado_por_nome) VALUES($1,'MUDANCA_ETAPA',$2,$3,$4)`,[id,`Etapa alterada de ${row.etapa} para ${etapa}.`,req.user?.id||null,currentUserName(req)]);
      return res.json({ sucesso:true,oportunidade:next.rows[0],mensagem:'Oportunidade atualizada.' });
    } catch (error) { return next(error); }
  });

  app.post('/api/admin/crm/oportunidades/:id/interacoes', requireAdmin, async (req,res,next)=>{
    try {
      const id=Number(req.params.id); const description=clean(req.body?.descricao,5000); if(!Number.isInteger(id)||id<=0||!description)return res.status(400).json({sucesso:false,erro:'Informe uma interação válida.'});
      const result=await pool.query(`INSERT INTO crm_interacoes(oportunidade_id,tipo,descricao,criado_por,criado_por_nome) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,clean(req.body?.tipo,40)?.toUpperCase()||'NOTA',description,req.user?.id||null,currentUserName(req)]);
      await pool.query('UPDATE crm_oportunidades SET updated_at=NOW() WHERE id=$1',[id]);
      return res.status(201).json({sucesso:true,interacao:result.rows[0],mensagem:'Interação registrada.'});
    } catch(error){return next(error);}
  });

  app.post('/api/admin/crm/oportunidades/:id/followups', requireAdmin, async (req,res,next)=>{
    try {
      const id=Number(req.params.id); const title=clean(req.body?.titulo,240); if(!Number.isInteger(id)||id<=0||!title)return res.status(400).json({sucesso:false,erro:'Informe o follow-up.'});
      const result=await pool.query(`INSERT INTO crm_followups(oportunidade_id,titulo,vencimento,responsavel_id) VALUES($1,$2,$3,$4) RETURNING *`,[id,title,req.body?.vencimento||null,req.body?.responsavel_id?Number(req.body.responsavel_id):(req.user?.id||null)]);
      await pool.query(`UPDATE crm_oportunidades SET proxima_acao=$2,proxima_acao_em=$3,updated_at=NOW() WHERE id=$1`,[id,title,req.body?.vencimento||null]);
      return res.status(201).json({sucesso:true,followup:result.rows[0],mensagem:'Follow-up criado.'});
    } catch(error){return next(error);}
  });

  app.patch('/api/admin/crm/followups/:id', requireAdmin, async (req,res,next)=>{
    try {
      const id=Number(req.params.id); const status=String(req.body?.status||'').toUpperCase(); if(!Number.isInteger(id)||!['PENDENTE','CONCLUIDO','CANCELADO'].includes(status))return res.status(400).json({sucesso:false,erro:'Follow-up inválido.'});
      const result=await pool.query(`UPDATE crm_followups SET status=$2,concluido_em=CASE WHEN $2='CONCLUIDO' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,status]);
      if(!result.rowCount)return res.status(404).json({sucesso:false,erro:'Follow-up não encontrado.'});
      return res.json({sucesso:true,followup:result.rows[0],mensagem:'Follow-up atualizado.'});
    } catch(error){return next(error);}
  });

  app.post('/api/admin/crm/oportunidades/:id/converter-cliente', requireAdmin, async (req,res,next)=>{
    const client=await pool.connect();
    try {
      const id=Number(req.params.id); if(!Number.isInteger(id)||id<=0)return res.status(400).json({sucesso:false,erro:'Oportunidade inválida.'});
      await client.query('BEGIN');
      const data=await client.query(`SELECT co.id AS oportunidade_id,co.crm_empresa_id,co.etapa,ce.nome,ce.website,ce.cidade,ce.estado,ce.empresa_operacional_id FROM crm_oportunidades co JOIN crm_empresas ce ON ce.id=co.crm_empresa_id WHERE co.id=$1 FOR UPDATE`,[id]);
      if(!data.rowCount){await client.query('ROLLBACK');return res.status(404).json({sucesso:false,erro:'Oportunidade não encontrada.'});}
      const item=data.rows[0];
      let companyId=item.empresa_operacional_id;
      if(!companyId){
        const existing=await client.query(`SELECT id FROM empresas WHERE LOWER(nome)=LOWER($1) ORDER BY id LIMIT 1`,[item.nome]);
        if(existing.rowCount) companyId=existing.rows[0].id;
        else {
          const created=await client.query(`INSERT INTO empresas(nome,nome_publico,site_url,cidade,estado,ativo,exibir_no_portal) VALUES($1,$1,$2,$3,$4,TRUE,FALSE) RETURNING id`,[item.nome,item.website||null,item.cidade||null,item.estado||null]);
          companyId=created.rows[0].id;
        }
        await client.query(`UPDATE crm_empresas SET empresa_operacional_id=$2,updated_at=NOW() WHERE id=$1`,[item.crm_empresa_id,companyId]);
      }
      await client.query(`UPDATE crm_oportunidades SET etapa='GANHO',ganho_em=COALESCE(ganho_em,NOW()),updated_at=NOW() WHERE id=$1`,[id]);
      await client.query(`INSERT INTO crm_interacoes(oportunidade_id,tipo,descricao,criado_por,criado_por_nome) VALUES($1,'CONVERSAO_CLIENTE',$2,$3,$4)`,[id,`Convertida/vinculada à empresa operacional #${companyId}.`,req.user?.id||null,currentUserName(req)]);
      await client.query('COMMIT');
      return res.json({sucesso:true,empresa_id:companyId,mensagem:'Empresa convertida em cliente e vinculada à operação.'});
    } catch(error){try{await client.query('ROLLBACK');}catch{} return next(error);} finally{client.release();}
  });
}

module.exports = { registerCrmV1, syncSources, STAGES, leadStage, stageCanAdvance };
