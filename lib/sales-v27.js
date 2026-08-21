'use strict';
const { analyzeLeadSite } = require('./prospecting-v20');
const STATUSES = ['NOVO','CONTATADO','RESPONDEU','INTERESSADO','DEMO','PROPOSTA','CLIENTE','PERDIDO'];
const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const id = (value) => /^\d+$/.test(String(value)) ? Number(value) : null;
function suggestedMessage(lead, userName) {
  const company=clean(lead.empresa_nome,180)||'sua empresa';
  const segment=clean(lead.categoria,120);const city=clean(lead.cidade,120);
  const context=lead.motivo_abordagem||(segment?`A Gênesis ajuda empresas de ${segment.toLowerCase()} a organizar o recrutamento e atrair candidatos com menos trabalho manual.`:'A Gênesis ajuda empresas a organizar o recrutamento e atrair candidatos com menos trabalho manual.');
  return `Olá! Tudo bem? Sou ${clean(userName,100)||'da equipe Gênesis'}. Conheci a ${company}${city?` em ${city}`:''} e acredito que podemos ajudar na contratação de pessoas. ${context} Posso te mostrar rapidamente como funciona?`;
}
function suggestedEmail(lead, userName) {
  const company=clean(lead.empresa_nome,180)||'sua empresa';
  return {
    assunto:`Uma ideia para o recrutamento da ${company}`,
    mensagem:`Olá! Tudo bem? Sou ${clean(userName,100)||'da equipe Gênesis'}. Conheci a ${company} e acredito que a Gênesis pode ajudar a organizar as contratações e reduzir o trabalho manual. Posso te mostrar rapidamente como funciona?`,
  };
}
function decorateLead(lead, userName) {
  const email=suggestedEmail(lead,userName);
  return {...lead,mensagem_sugerida:suggestedMessage(lead,userName),email_assunto_sugerido:email.assunto,email_mensagem_sugerida:email.mensagem};
}

function registerSalesV27({ app, pool, requireAdmin, currentUserName }) {
  app.get('/api/admin/sales/leads', requireAdmin, async (req, res, next) => {
    try {
      const term = clean(req.query.q, 100); const status = clean(req.query.status, 20).toUpperCase();
      const params = []; let where = 'WHERE TRUE';
      if (term) { params.push(`%${term}%`); where += ` AND (l.empresa_nome ILIKE $${params.length} OR COALESCE(l.contato_nome,'') ILIKE $${params.length} OR COALESCE(l.telefone,'') ILIKE $${params.length})`; }
      if (STATUSES.includes(status)) { params.push(status); where += ` AND COALESCE(l.sales_status,'NOVO')=$${params.length}`; }
      const result = await pool.query(`SELECT l.id,l.empresa_nome,l.contato_nome,l.telefone,l.email,l.website,l.origem_sales,l.categoria,l.cidade,
        l.enriquecimento_status,l.enriquecido_at,l.oferta_sugerida,l.motivo_abordagem,l.ats_detectado,l.vagas_abertas_estimadas,
        COALESCE(l.sales_status,'NOVO') AS sales_status,l.primeiro_contato_at,l.resposta_ultima_at,l.proxima_acao,l.proxima_acao_em,
        l.responsavel_id,u.nome AS responsavel_nome,l.updated_at,COALESCE(c.tentativas_contato,0)::INTEGER AS tentativas_contato,
        c.ultimo_contato_at,c.ultimo_canal,
        (SELECT nota FROM prospeccao_notas n WHERE n.lead_id=l.id ORDER BY n.created_at DESC LIMIT 1) AS ultima_nota
        FROM prospeccao_leads l LEFT JOIN app_usuarios u ON u.id=l.responsavel_id
        LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE resultado='TENTATIVA_REGISTRADA') AS tentativas_contato,MAX(created_at) FILTER (WHERE resultado IN ('TENTATIVA_REGISTRADA','WHATSAPP_ABERTO')) AS ultimo_contato_at,(ARRAY_AGG(canal ORDER BY created_at DESC) FILTER (WHERE resultado IN ('TENTATIVA_REGISTRADA','WHATSAPP_ABERTO')))[1] AS ultimo_canal FROM prospeccao_contatos pc WHERE pc.lead_id=l.id) c ON TRUE ${where}
        ORDER BY CASE WHEN l.proxima_acao_em IS NULL THEN 1 ELSE 0 END,l.proxima_acao_em ASC,l.updated_at DESC LIMIT 500`, params);
      const userName=currentUserName(req);
      res.json({ sucesso:true, leads:result.rows.map((lead)=>decorateLead(lead,userName)), statuses:STATUSES });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/sales/leads/:id', requireAdmin, async (req, res, next) => {
    try {
      const leadId=id(req.params.id); if(!leadId) return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      const lead=(await pool.query(`SELECT l.*,COALESCE(l.sales_status,'NOVO') AS sales_status,u.nome AS responsavel_nome FROM prospeccao_leads l LEFT JOIN app_usuarios u ON u.id=l.responsavel_id WHERE l.id=$1`,[leadId])).rows[0];
      if(!lead) return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});
      const history=(await pool.query(`SELECT 'NOTA' AS tipo,nota AS descricao,criado_por_nome AS autor,created_at FROM prospeccao_notas WHERE lead_id=$1 UNION ALL SELECT CASE resultado WHEN 'WHATSAPP_ABERTO' THEN 'WHATSAPP_ABERTO' WHEN 'TENTATIVA_REGISTRADA' THEN 'TENTATIVA_REGISTRADA' ELSE 'CONTATO' END AS tipo,COALESCE(mensagem,resultado),realizado_por_nome,created_at FROM prospeccao_contatos WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 100`,[leadId])).rows;
      res.json({sucesso:true,lead:decorateLead(lead,currentUserName(req)),historico:history});
    } catch(error){next(error);}
  });

  app.patch('/api/admin/sales/leads/:id', requireAdmin, async (req,res,next)=>{
    try{
      const leadId=id(req.params.id); const status=clean(req.body?.status,20).toUpperCase();
      if(!leadId) return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      if(status && !STATUSES.includes(status)) return res.status(400).json({sucesso:false,erro:'Status inválido.'});
      const result=await pool.query(`UPDATE prospeccao_leads SET sales_status=COALESCE(NULLIF($1,''),sales_status),proxima_acao=CASE WHEN $2::BOOLEAN THEN NULLIF($3,'') ELSE proxima_acao END,proxima_acao_em=CASE WHEN $2::BOOLEAN THEN $4::TIMESTAMPTZ ELSE proxima_acao_em END,primeiro_contato_at=CASE WHEN $1='CONTATADO' THEN COALESCE(primeiro_contato_at,NOW()) ELSE primeiro_contato_at END,updated_at=NOW() WHERE id=$5 RETURNING *`,[status,req.body?.proxima_acao!==undefined,clean(req.body?.proxima_acao),req.body?.proxima_acao_em||null,leadId]);
      if(!result.rowCount)return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});
      res.json({sucesso:true,lead:result.rows[0]});
    }catch(error){next(error);}
  });

  app.post('/api/admin/sales/leads/:id/notas', requireAdmin, async(req,res,next)=>{
    try{const leadId=id(req.params.id);const note=clean(req.body?.nota,2000);if(!leadId||!note)return res.status(400).json({sucesso:false,erro:'Informe uma nota válida.'});
      const result=await pool.query(`INSERT INTO prospeccao_notas(lead_id,nota,criado_por,criado_por_nome) VALUES($1,$2,$3,$4) RETURNING *`,[leadId,note,req.user?.id||null,currentUserName(req)]);
      res.json({sucesso:true,nota:result.rows[0]});}catch(error){next(error);}
  });

  app.post('/api/admin/sales/leads/:id/whatsapp-aberto',requireAdmin,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const leadId=id(req.params.id);if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      await client.query('BEGIN');
      const lead=(await client.query("SELECT id,COALESCE(sales_status,'NOVO') AS sales_status FROM prospeccao_leads WHERE id=$1 FOR UPDATE",[leadId])).rows[0];
      if(!lead){await client.query('ROLLBACK');return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});}
      await client.query(`INSERT INTO prospeccao_contatos(lead_id,canal,resultado,mensagem,realizado_por,realizado_por_nome)
        SELECT $1,'WHATSAPP','WHATSAPP_ABERTO','Conversa aberta para envio manual.',$2,$3
        WHERE NOT EXISTS(SELECT 1 FROM prospeccao_contatos WHERE lead_id=$1 AND resultado='WHATSAPP_ABERTO' AND created_at>NOW()-INTERVAL '20 seconds')`,[leadId,req.user?.id||null,currentUserName(req)]);
      const moved=lead.sales_status==='NOVO';
      if(moved)await client.query("UPDATE prospeccao_leads SET sales_status='CONTATADO',primeiro_contato_at=COALESCE(primeiro_contato_at,NOW()),updated_at=NOW() WHERE id=$1",[leadId]);
      await client.query('COMMIT');
      res.json({sucesso:true,movido:moved,status:moved?'CONTATADO':lead.sales_status,status_anterior:lead.sales_status});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error);}finally{client.release();}
  });

  app.post('/api/admin/sales/leads/:id/tentativas',requireAdmin,async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const leadId=id(req.params.id);const canal=clean(req.body?.canal,20).toUpperCase();const observacao=clean(req.body?.observacao,2000);
      if(!leadId||!['WHATSAPP','EMAIL'].includes(canal))return res.status(400).json({sucesso:false,erro:'Informe um canal válido.'});
      await client.query('BEGIN');
      const lead=(await client.query("SELECT id,COALESCE(sales_status,'NOVO') AS sales_status FROM prospeccao_leads WHERE id=$1 FOR UPDATE",[leadId])).rows[0];
      if(!lead){await client.query('ROLLBACK');return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});}
      await client.query(`INSERT INTO prospeccao_contatos(lead_id,canal,resultado,mensagem,realizado_por,realizado_por_nome) VALUES($1,$2,'TENTATIVA_REGISTRADA',$3,$4,$5)`,[leadId,canal,observacao||'Tentativa de contato registrada manualmente.',req.user?.id||null,currentUserName(req)]);
      const hasAction=req.body?.proxima_acao!==undefined;
      await client.query(`UPDATE prospeccao_leads SET sales_status=CASE WHEN COALESCE(sales_status,'NOVO')='NOVO' THEN 'CONTATADO' ELSE sales_status END,primeiro_contato_at=COALESCE(primeiro_contato_at,NOW()),proxima_acao=CASE WHEN $2::BOOLEAN THEN NULLIF($3::TEXT,'') ELSE proxima_acao END,proxima_acao_em=CASE WHEN $2::BOOLEAN THEN $4::TIMESTAMPTZ ELSE proxima_acao_em END,updated_at=NOW() WHERE id=$1`,[leadId,hasAction,clean(req.body?.proxima_acao),req.body?.proxima_acao_em||null]);
      await client.query('COMMIT');
      res.status(201).json({sucesso:true,status:lead.sales_status==='NOVO'?'CONTATADO':lead.sales_status});
    }catch(error){await client.query('ROLLBACK').catch(()=>{});next(error);}finally{client.release();}
  });

  app.post('/api/admin/sales/leads/:id/desfazer-whatsapp',requireAdmin,async(req,res,next)=>{
    try{
      const leadId=id(req.params.id);if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      const result=await pool.query(`UPDATE prospeccao_leads l SET sales_status='NOVO',primeiro_contato_at=NULL,updated_at=NOW() WHERE l.id=$1 AND COALESCE(l.sales_status,'NOVO')='CONTATADO' AND l.primeiro_contato_at>NOW()-INTERVAL '30 seconds' AND EXISTS(SELECT 1 FROM prospeccao_contatos c WHERE c.lead_id=l.id AND c.resultado='WHATSAPP_ABERTO' AND c.created_at>NOW()-INTERVAL '30 seconds') AND NOT EXISTS(SELECT 1 FROM prospeccao_contatos c WHERE c.lead_id=l.id AND c.resultado='TENTATIVA_REGISTRADA') RETURNING l.id`,[leadId]);
      if(!result.rowCount)return res.status(409).json({sucesso:false,erro:'Não foi possível desfazer com segurança.'});
      await pool.query("DELETE FROM prospeccao_contatos WHERE id=(SELECT id FROM prospeccao_contatos WHERE lead_id=$1 AND resultado='WHATSAPP_ABERTO' ORDER BY created_at DESC LIMIT 1)",[leadId]);
      res.json({sucesso:true,status:'NOVO'});
    }catch(error){next(error);}
  });

  app.post('/api/admin/sales/leads/:id/enriquecer',requireAdmin,async(req,res,next)=>{
    const leadId=id(req.params.id);
    try{
      if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      const lead=(await pool.query('SELECT * FROM prospeccao_leads WHERE id=$1',[leadId])).rows[0];
      if(!lead)return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});
      await pool.query("UPDATE prospeccao_leads SET enriquecimento_status='PROCESSANDO',updated_at=NOW() WHERE id=$1",[leadId]);
      const e=await analyzeLeadSite(lead);
      const result=await pool.query(`UPDATE prospeccao_leads SET cnpj=COALESCE($2,cnpj),razao_social=COALESCE($3,razao_social),porte_cadastral=COALESCE($4,porte_cadastral),capital_social=COALESCE($5,capital_social),data_abertura=COALESCE($6::DATE,data_abertura),funcionarios_estimados=COALESCE($7,funcionarios_estimados),porte_estimado=COALESCE($8,porte_estimado),linkedin_url=COALESCE($9,linkedin_url),instagram_url=COALESCE($10,instagram_url),facebook_url=COALESCE($11,facebook_url),tem_trabalhe_conosco=$12,portal_vagas_url=COALESCE($13,portal_vagas_url),ats_detectado=COALESCE($14,ats_detectado),vagas_abertas_estimadas=COALESCE($15,vagas_abertas_estimadas),cargos_detectados=$16::JSONB,oferta_sugerida=$17,motivo_abordagem=$18,enriquecimento_status='CONCLUIDO',enriquecido_at=NOW(),site_analisado_at=NOW(),score=$19,updated_at=NOW() WHERE id=$1 RETURNING *`,[lead.id,e.cnpj,e.razao_social,e.porte_cadastral,e.capital_social,e.data_abertura,e.funcionarios_estimados,e.porte_estimado,e.linkedin_url,e.instagram_url,e.facebook_url,e.tem_trabalhe_conosco,e.portal_vagas_url,e.ats_detectado,e.vagas_abertas_estimadas,JSON.stringify(e.cargos_detectados),e.oferta_sugerida,e.motivo_abordagem,e.score]);
      res.json({sucesso:true,lead:decorateLead({...lead,...result.rows[0]},currentUserName(req))});
    }catch(error){if(leadId)await pool.query("UPDATE prospeccao_leads SET enriquecimento_status='FALHA',updated_at=NOW() WHERE id=$1",[leadId]).catch(()=>{});next(error);}
  });
}
module.exports={registerSalesV27,STATUSES,suggestedMessage,suggestedEmail};
