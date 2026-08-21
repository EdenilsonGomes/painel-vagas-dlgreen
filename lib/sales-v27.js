'use strict';
const STATUSES = ['NOVO','CONTATADO','RESPONDEU','INTERESSADO','DEMO','PROPOSTA','CLIENTE','PERDIDO'];
const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const id = (value) => /^\d+$/.test(String(value)) ? Number(value) : null;

function registerSalesV27({ app, pool, requireAdmin, currentUserName }) {
  app.get('/api/admin/sales/leads', requireAdmin, async (req, res, next) => {
    try {
      const term = clean(req.query.q, 100); const status = clean(req.query.status, 20).toUpperCase();
      const params = []; let where = 'WHERE TRUE';
      if (term) { params.push(`%${term}%`); where += ` AND (l.empresa_nome ILIKE $${params.length} OR COALESCE(l.contato_nome,'') ILIKE $${params.length} OR COALESCE(l.telefone,'') ILIKE $${params.length})`; }
      if (STATUSES.includes(status)) { params.push(status); where += ` AND COALESCE(l.sales_status,'NOVO')=$${params.length}`; }
      const result = await pool.query(`SELECT l.id,l.empresa_nome,l.contato_nome,l.telefone,l.email,l.website,l.origem_sales,
        COALESCE(l.sales_status,'NOVO') AS sales_status,l.primeiro_contato_at,l.resposta_ultima_at,l.proxima_acao,l.proxima_acao_em,
        l.responsavel_id,u.nome AS responsavel_nome,l.updated_at,
        (SELECT nota FROM prospeccao_notas n WHERE n.lead_id=l.id ORDER BY n.created_at DESC LIMIT 1) AS ultima_nota
        FROM prospeccao_leads l LEFT JOIN app_usuarios u ON u.id=l.responsavel_id ${where}
        ORDER BY COALESCE(l.proxima_acao_em,l.updated_at) DESC NULLS LAST LIMIT 500`, params);
      res.json({ sucesso:true, leads:result.rows, statuses:STATUSES });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/sales/leads/:id', requireAdmin, async (req, res, next) => {
    try {
      const leadId=id(req.params.id); if(!leadId) return res.status(400).json({sucesso:false,erro:'Lead inválido.'});
      const lead=(await pool.query(`SELECT l.*,COALESCE(l.sales_status,'NOVO') AS sales_status,u.nome AS responsavel_nome FROM prospeccao_leads l LEFT JOIN app_usuarios u ON u.id=l.responsavel_id WHERE l.id=$1`,[leadId])).rows[0];
      if(!lead) return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});
      const history=(await pool.query(`SELECT 'NOTA' AS tipo,nota AS descricao,criado_por_nome AS autor,created_at FROM prospeccao_notas WHERE lead_id=$1 UNION ALL SELECT 'CONTATO',COALESCE(mensagem,resultado),realizado_por_nome,created_at FROM prospeccao_contatos WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 100`,[leadId])).rows;
      res.json({sucesso:true,lead,historico:history});
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
}
module.exports={registerSalesV27,STATUSES};
