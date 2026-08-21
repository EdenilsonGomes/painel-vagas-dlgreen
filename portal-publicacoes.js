'use strict';

const { z } = require('zod');

const groupModerationSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'suspended', 'expired']),
  verified: z.boolean().optional().default(false),
  featured: z.boolean().optional().default(false),
  official: z.boolean().optional().default(false),
  rejection_reason: z.string().trim().max(2000).optional().default(''),
  moderation_note: z.string().trim().max(3000).optional().default(''),
});
const accountUpdateSchema = z.object({
  lead_status: z.enum(['NOVO', 'CONTATADO', 'QUALIFICADO', 'CLIENTE', 'SEM_INTERESSE']),
  status: z.enum(['ATIVA', 'BLOQUEADA', 'EXCLUIDA']),
  observacao_interna: z.string().trim().max(4000).optional().default(''),
});
const jobModerationSchema = z.object({
  status: z.enum(['PENDENTE', 'EM_REVISAO', 'APROVADA', 'REJEITADA', 'CANCELADA']),
  rejection_reason: z.string().trim().max(2000).optional().default(''),
  moderation_note: z.string().trim().max(3000).optional().default(''),
});

function toInt(value, fallback, min = 1, max = 200) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function statusClause(value, allowed) {
  const status = String(value || '').trim();
  return allowed.includes(status) ? status : '';
}
function validationMessage(error) {
  return error?.issues?.map((item) => item.message).join(' ') || 'Dados inválidos.';
}

function registerPortalPublications({ app, pool, requireAdmin, currentUserName, portalBaseUrl = '', groupsEnabled = false }) {
  app.get('/api/portal-publicacoes/resumo', requireAdmin, async (_req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::INTEGER FROM portal_contas) AS contas_total,
          (SELECT COUNT(*)::INTEGER FROM portal_contas WHERE lead_status='NOVO') AS leads_novos,
          (SELECT COUNT(*)::INTEGER FROM gg_groups WHERE status='pending') AS grupos_pendentes,
          (SELECT COUNT(*)::INTEGER FROM gg_groups WHERE status='approved') AS grupos_publicados,
          (SELECT COUNT(*)::INTEGER FROM gg_group_reports WHERE status='pending') AS denuncias_pendentes,
          (SELECT COUNT(*)::INTEGER FROM portal_vagas_submissoes WHERE status IN ('PENDENTE','EM_REVISAO','APROVADA')) AS vagas_pendentes,
          (SELECT COALESCE(SUM(1),0)::INTEGER FROM gg_group_clicks WHERE created_at >= NOW() - INTERVAL '30 days') AS acessos_grupos_30d,
          (SELECT COALESCE(SUM(1),0)::INTEGER FROM gg_group_views WHERE created_at >= NOW() - INTERVAL '30 days') AS visualizacoes_grupos_30d
      `);
      return res.json({ sucesso: true, resumo: result.rows[0], portal_base_url: portalBaseUrl });
    } catch (error) { return next(error); }
  });

  if (groupsEnabled) app.get('/api/portal-publicacoes/grupos', requireAdmin, async (req, res, next) => {
    try {
      const page = toInt(req.query.pagina, 1, 1, 100000);
      const limit = toInt(req.query.limite, 30, 1, 100);
      const offset = (page - 1) * limit;
      const status = statusClause(req.query.status, ['pending', 'approved', 'rejected', 'suspended', 'expired']);
      const q = String(req.query.q || '').trim().slice(0, 150);
      const values = [];
      const clauses = [];
      if (status) { values.push(status); clauses.push(`g.status=$${values.length}`); }
      if (q) { values.push(`%${q}%`); clauses.push(`(g.name ILIKE $${values.length} OR g.city ILIKE $${values.length} OR g.category ILIKE $${values.length} OR c.nome ILIKE $${values.length} OR c.empresa_nome ILIKE $${values.length})`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const count = await pool.query(`SELECT COUNT(*)::INTEGER total FROM gg_groups g LEFT JOIN portal_contas c ON c.id=g.owner_account_id ${where}`, values);
      values.push(limit, offset);
      const rows = await pool.query(`
        SELECT g.*,
          c.tipo AS conta_tipo,c.nome AS conta_nome,c.email AS conta_email,c.whatsapp AS conta_whatsapp,c.empresa_nome AS conta_empresa,
          EXISTS(SELECT 1 FROM portal_grupo_imagens i WHERE i.grupo_id=g.id) AS has_image,
          (SELECT COUNT(*)::INTEGER FROM gg_group_views v WHERE v.group_id=g.id) AS view_count,
          (SELECT COUNT(*)::INTEGER FROM gg_group_clicks x WHERE x.group_id=g.id) AS click_count,
          (SELECT COUNT(*)::INTEGER FROM gg_group_reports r WHERE r.group_id=g.id AND r.status='pending') AS report_count
        FROM gg_groups g
        LEFT JOIN portal_contas c ON c.id=g.owner_account_id
        ${where}
        ORDER BY (g.status='pending') DESC, g.submitted_at DESC, g.id DESC
        LIMIT $${values.length-1} OFFSET $${values.length}
      `, values);
      return res.json({ sucesso: true, total: count.rows[0]?.total || 0, pagina: page, limite: limit, grupos: rows.rows });
    } catch (error) { return next(error); }
  });

  if (groupsEnabled) app.patch('/api/portal-publicacoes/grupos/:id', requireAdmin, async (req, res, next) => {
    try {
      const groupId = positiveId(req.params.id);
      if (!groupId) return res.status(400).json({ sucesso: false, erro: 'ID de grupo inválido.' });
      const parsed = groupModerationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: validationMessage(parsed.error) });
      if (parsed.data.status === 'rejected' && parsed.data.rejection_reason.length < 5) {
        return res.status(400).json({ sucesso: false, erro: 'Informe o motivo da rejeição para orientar o publicador.' });
      }
      const verified = parsed.data.status === 'approved' ? true : parsed.data.verified;
      const result = await pool.query(`
        UPDATE gg_groups SET
          status=$1::VARCHAR(30),verified=$2::BOOLEAN,featured=$3::BOOLEAN,official=$4::BOOLEAN,
          rejection_reason=CASE WHEN $1::VARCHAR(30)='rejected' THEN NULLIF($5::TEXT,'') ELSE NULL END,
          moderation_note=NULLIF($6,''),
          approved_at=CASE WHEN $1::VARCHAR(30)='approved' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,
          last_verified_at=CASE WHEN $2::BOOLEAN IS TRUE THEN NOW() ELSE last_verified_at END,
          updated_at=NOW()
        WHERE id=$7 RETURNING *
      `, [parsed.data.status, verified, parsed.data.featured, parsed.data.official, parsed.data.rejection_reason, parsed.data.moderation_note, groupId]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Grupo não encontrado.' });
      return res.json({ sucesso: true, grupo: result.rows[0], moderado_por: currentUserName(req) });
    } catch (error) { return next(error); }
  });

  app.patch('/api/portal-publicacoes/denuncias/:id/resolver', requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(`UPDATE gg_group_reports SET status='resolved',resolved_at=NOW(),resolved_by=$2 WHERE id=$1 RETURNING *`, [Number(req.params.id), req.user?.id || null]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Denúncia não encontrada.' });
      return res.json({ sucesso: true, denuncia: result.rows[0] });
    } catch (error) { return next(error); }
  });

  app.get('/api/portal-publicacoes/contas', requireAdmin, async (req, res, next) => {
    try {
      const page = toInt(req.query.pagina, 1, 1, 100000);
      const limit = toInt(req.query.limite, 30, 1, 100);
      const offset = (page - 1) * limit;
      const q = String(req.query.q || '').trim().slice(0, 150);
      const lead = statusClause(req.query.lead_status, ['NOVO', 'CONTATADO', 'QUALIFICADO', 'CLIENTE', 'SEM_INTERESSE']);
      const values = [];
      const clauses = [];
      if (lead) { values.push(lead); clauses.push(`c.lead_status=$${values.length}`); }
      if (q) { values.push(`%${q}%`); clauses.push(`(c.nome ILIKE $${values.length} OR c.email ILIKE $${values.length} OR c.empresa_nome ILIKE $${values.length} OR c.whatsapp ILIKE $${values.length})`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const count = await pool.query(`SELECT COUNT(*)::INTEGER total FROM portal_contas c ${where}`, values);
      values.push(limit, offset);
      const rows = await pool.query(`
        SELECT c.*,
          (SELECT COUNT(*)::INTEGER FROM gg_groups g WHERE g.owner_account_id=c.id) AS grupos_total,
          (SELECT COUNT(*)::INTEGER FROM portal_vagas_submissoes v WHERE v.conta_id=c.id) AS vagas_total
        FROM portal_contas c ${where}
        ORDER BY (c.lead_status='NOVO') DESC,c.created_at DESC
        LIMIT $${values.length-1} OFFSET $${values.length}
      `, values);
      return res.json({ sucesso: true, total: count.rows[0]?.total || 0, pagina: page, limite: limit, contas: rows.rows });
    } catch (error) { return next(error); }
  });

  app.patch('/api/portal-publicacoes/contas/:id', requireAdmin, async (req, res, next) => {
    try {
      const parsed = accountUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: validationMessage(parsed.error) });
      const result = await pool.query(`UPDATE portal_contas SET lead_status=$1,status=$2,observacao_interna=NULLIF($3,''),updated_at=NOW() WHERE id=$4 RETURNING id,tipo,nome,email,whatsapp,empresa_nome,lead_status,status,observacao_interna`, [parsed.data.lead_status, parsed.data.status, parsed.data.observacao_interna, Number(req.params.id)]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Conta não encontrada.' });
      return res.json({ sucesso: true, conta: result.rows[0] });
    } catch (error) { return next(error); }
  });

  app.get('/api/portal-publicacoes/vagas', requireAdmin, async (req, res, next) => {
    try {
      const page = toInt(req.query.pagina, 1, 1, 100000);
      const limit = toInt(req.query.limite, 30, 1, 100);
      const offset = (page - 1) * limit;
      const status = statusClause(req.query.status, ['PENDENTE', 'EM_REVISAO', 'APROVADA', 'REJEITADA', 'CONVERTIDA', 'CANCELADA']);
      const q = String(req.query.q || '').trim().slice(0, 150);
      const values = [];
      const clauses = [];
      if (status) { values.push(status); clauses.push(`v.status=$${values.length}`); }
      if (q) { values.push(`%${q}%`); clauses.push(`(v.titulo ILIKE $${values.length} OR v.cargo ILIKE $${values.length} OR v.empresa_nome ILIKE $${values.length} OR c.nome ILIKE $${values.length})`); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const count = await pool.query(`SELECT COUNT(*)::INTEGER total FROM portal_vagas_submissoes v JOIN portal_contas c ON c.id=v.conta_id ${where}`, values);
      values.push(limit, offset);
      const rows = await pool.query(`
        SELECT v.*,c.tipo AS conta_tipo,c.nome AS conta_nome,c.email AS conta_email,c.whatsapp AS conta_whatsapp,c.empresa_nome AS conta_empresa
        FROM portal_vagas_submissoes v JOIN portal_contas c ON c.id=v.conta_id
        ${where}
        ORDER BY (v.status IN ('PENDENTE','EM_REVISAO','APROVADA')) DESC,v.created_at DESC
        LIMIT $${values.length-1} OFFSET $${values.length}
      `, values);
      return res.json({ sucesso: true, total: count.rows[0]?.total || 0, pagina: page, limite: limit, vagas: rows.rows });
    } catch (error) { return next(error); }
  });

  app.patch('/api/portal-publicacoes/vagas/:id', requireAdmin, async (req, res, next) => {
    try {
      const parsed = jobModerationSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: validationMessage(parsed.error) });
      if (parsed.data.status === 'REJEITADA' && parsed.data.rejection_reason.length < 5) {
        return res.status(400).json({ sucesso: false, erro: 'Informe o motivo da rejeição.' });
      }
      const result = await pool.query(`UPDATE portal_vagas_submissoes SET status=$1::VARCHAR(30),rejection_reason=NULLIF($2::TEXT,''),moderation_note=NULLIF($3::TEXT,''),approved_at=CASE WHEN $1::VARCHAR(30)='APROVADA' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,updated_at=NOW() WHERE id=$4::BIGINT AND status<>'CONVERTIDA' RETURNING *`, [parsed.data.status, parsed.data.rejection_reason, parsed.data.moderation_note, Number(req.params.id)]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Submissão não encontrada ou já convertida.' });
      return res.json({ sucesso: true, vaga: result.rows[0] });
    } catch (error) { return next(error); }
  });

  app.post('/api/portal-publicacoes/vagas/:id/converter', requireAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const submissionResult = await client.query(`SELECT v.*,c.nome AS conta_nome,c.email AS conta_email,c.whatsapp AS conta_whatsapp FROM portal_vagas_submissoes v JOIN portal_contas c ON c.id=v.conta_id WHERE v.id=$1 FOR UPDATE`, [Number(req.params.id)]);
      if (!submissionResult.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ sucesso: false, erro: 'Submissão não encontrada.' }); }
      const submission = submissionResult.rows[0];
      if (submission.vaga_id) { await client.query('ROLLBACK'); return res.status(409).json({ sucesso: false, erro: 'Esta submissão já foi convertida.', vaga_id: submission.vaga_id }); }
      if (!['APROVADA', 'EM_REVISAO', 'PENDENTE'].includes(submission.status)) { await client.query('ROLLBACK'); return res.status(400).json({ sucesso: false, erro: 'A submissão não pode ser convertida neste status.' }); }

      let company = await client.query(`SELECT id,nome FROM empresas WHERE LOWER(nome)=LOWER($1) LIMIT 1`, [submission.empresa_nome]);
      if (!company.rowCount) company = await client.query(`INSERT INTO empresas(nome,ativo,nome_publico,exibir_no_portal) VALUES($1,TRUE,$1,TRUE) RETURNING id,nome`, [submission.empresa_nome]);
      const companyId = company.rows[0].id;
      let codeBase = `PORTAL-${submission.id}`.slice(0, 45);
      let code = codeBase;
      let counter = 1;
      while ((await client.query('SELECT 1 FROM vagas WHERE empresa_id=$1 AND codigo=$2 LIMIT 1', [companyId, code])).rowCount) code = `${codeBase}-${counter++}`.slice(0, 50);

      const inserted = await client.query(`
        INSERT INTO vagas(
          empresa_id,codigo,titulo,cargo,sexo,descricao,cidade,estado,bairro,tipo_contrato,modalidade,
          escala,horario,salario,beneficios,requisitos_obrigatorios,quantidade_vagas,status,
          publicar_portal,destaque_portal,canal_candidatura,whatsapp_candidatura
        ) VALUES($1,$2,$3,$4,'UNISSEX',$5,$6,$7,NULLIF($8,''),NULLIF($9,''),$10,NULLIF($11,''),NULLIF($12,''),$13,NULLIF($14,''),NULLIF($15,''),$16,'RASCUNHO',FALSE,FALSE,'WHATSAPP_GENESIS',NULLIF($17,''))
        RETURNING id,codigo,titulo,status
      `, [companyId, code, submission.titulo, submission.cargo, submission.descricao, submission.cidade, submission.estado, submission.bairro || '', submission.tipo_contrato || '', submission.modalidade || 'Presencial', submission.escala || '', submission.horario || '', submission.salario, submission.beneficios || '', submission.requisitos || '', submission.quantidade_vagas, submission.whatsapp_contato || '']);
      await client.query(`UPDATE portal_vagas_submissoes SET status='CONVERTIDA',vaga_id=$1,approved_at=COALESCE(approved_at,NOW()),moderation_note=CONCAT_WS(E'\n',moderation_note,$2),updated_at=NOW() WHERE id=$3`, [inserted.rows[0].id, `Convertida por ${currentUserName(req)} em ${new Date().toISOString()}`, submission.id]);
      await client.query('COMMIT');
      return res.json({ sucesso: true, vaga: inserted.rows[0], mensagem: 'Rascunho criado no painel. Revise e ative a vaga antes de publicá-la.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally { client.release(); }
  });
}

module.exports = { registerPortalPublications };
