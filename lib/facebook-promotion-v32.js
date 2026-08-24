'use strict';

const crypto = require('node:crypto');
const { z } = require('zod');

class PromotionError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'PromotionError'; this.statusCode = statusCode; }
}

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const safeId = (value) => /^\d+$/.test(String(value)) ? Number(value) : null;
const token = () => crypto.randomBytes(24).toString('base64url');
const digits = (value) => clean(value, 40).replace(/\D/g, '');

function facebookUrl(value) {
  try {
    const url = new URL(clean(value, 2000));
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/(^|\.)fb\.com$/i.test(url.hostname)) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    if (String(parts[0] || '').toLowerCase() !== 'groups' || !parts[1]) return '';
    return `https://www.facebook.com/groups/${parts[1]}`;
  } catch { return ''; }
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '';
}

function campaignText(vacancy, model = 'COMPLETO') {
  const title = clean(vacancy.titulo || vacancy.cargo, 160);
  const location = [vacancy.bairro, vacancy.cidade, vacancy.estado].filter(Boolean).join(' · ');
  const lines = [`OPORTUNIDADE: ${title}`, location ? `Local: ${location}` : ''];
  if (model !== 'CURTO') {
    if (vacancy.salario) lines.push(`Salário: ${money(vacancy.salario)}`);
    if (vacancy.escala || vacancy.horario) lines.push(`Horário: ${[vacancy.escala, vacancy.horario].filter(Boolean).join(' · ')}`);
    if (vacancy.beneficios) lines.push(`Benefícios: ${clean(vacancy.beneficios, 600)}`);
  }
  lines.push('', 'Veja os detalhes e candidate-se:', '{{link}}');
  return lines.filter((line, index, list) => line || (index && list[index - 1])).join('\n');
}

function registerFacebookPromotionV32({ app, pool, requireLogin, requireAdmin, currentUserName, publicBaseUrl, portalBaseUrl }) {
  let schemaPromise;
  const ensureSchema = () => {
    if (!schemaPromise) schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS divulgacao_grupos (
        id BIGSERIAL PRIMARY KEY,
        canal VARCHAR(20) NOT NULL DEFAULT 'FACEBOOK', nome VARCHAR(220) NOT NULL,
        url TEXT, url_normalizada TEXT, external_id VARCHAR(180), session_name VARCHAR(120),
        empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
        owner_user_id BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
        regiao VARCHAR(160), categorias TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], cargos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        regras TEXT, observacoes TEXT, origem VARCHAR(20) NOT NULL DEFAULT 'MANUAL', ativo BOOLEAN NOT NULL DEFAULT TRUE,
        autorizado_envio BOOLEAN NOT NULL DEFAULT TRUE, intervalo_minimo_horas INTEGER NOT NULL DEFAULT 24,
        ultima_publicacao_at TIMESTAMPTZ, metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS divulgacao_grupos_facebook_url_uidx
        ON divulgacao_grupos(url_normalizada, COALESCE(empresa_id, -owner_user_id))
        WHERE canal='FACEBOOK' AND url_normalizada IS NOT NULL;
      CREATE TABLE IF NOT EXISTS divulgacao_campanhas (
        id BIGSERIAL PRIMARY KEY, vaga_id BIGINT NOT NULL REFERENCES vagas(id) ON DELETE RESTRICT,
        canal VARCHAR(20) NOT NULL DEFAULT 'FACEBOOK', nome VARCHAR(240) NOT NULL, texto_modelo TEXT NOT NULL,
        modelo VARCHAR(30) NOT NULL DEFAULT 'COMPLETO', usar_imagem BOOLEAN NOT NULL DEFAULT TRUE,
        modo_envio VARCHAR(20) NOT NULL DEFAULT 'ASSISTIDO', status VARCHAR(30) NOT NULL DEFAULT 'EM_EXECUCAO',
        agendada_para TIMESTAMPTZ, intervalo_min_segundos INTEGER NOT NULL DEFAULT 180,
        intervalo_max_segundos INTEGER NOT NULL DEFAULT 300, limite_diario INTEGER NOT NULL DEFAULT 20,
        empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL,
        created_by BIGINT REFERENCES app_usuarios(id) ON DELETE SET NULL,
        iniciada_at TIMESTAMPTZ, concluida_at TIMESTAMPTZ, pausada_at TIMESTAMPTZ, erro TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS divulgacao_campanha_destinos (
        id BIGSERIAL PRIMARY KEY, campanha_id BIGINT NOT NULL REFERENCES divulgacao_campanhas(id) ON DELETE CASCADE,
        grupo_id BIGINT NOT NULL REFERENCES divulgacao_grupos(id) ON DELETE RESTRICT,
        tracking_token VARCHAR(80) NOT NULL UNIQUE, texto_override TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE', agendado_para TIMESTAMPTZ,
        enviado_at TIMESTAMPTZ, publicado_at TIMESTAMPTZ, tentativas INTEGER NOT NULL DEFAULT 0,
        waha_message_id TEXT, erro TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(campanha_id, grupo_id)
      );
      CREATE TABLE IF NOT EXISTS divulgacao_cliques (
        id BIGSERIAL PRIMARY KEY, destino_id BIGINT NOT NULL REFERENCES divulgacao_campanha_destinos(id) ON DELETE CASCADE,
        visitor_hash VARCHAR(128), referer TEXT, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch((error) => { schemaPromise = null; throw error; });
    return schemaPromise;
  };

  const campaignSchema = z.object({
    vaga_id: z.coerce.number().int().positive(),
    grupo_ids: z.array(z.coerce.number().int().positive()).min(1).max(250),
    modelo: z.enum(['CURTO', 'COMPLETO', 'PERSONALIZADO']).default('COMPLETO'),
    texto: z.string().max(12000).optional().default(''),
    usar_imagem: z.boolean().default(true),
  });

  const adminAccess = [requireLogin, requireAdmin];

  app.get('/api/admin/divulgacao-facebook/bootstrap', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema();
      const [vacancies, groups, campaigns, clicks] = await Promise.all([
        pool.query(`SELECT v.id,v.titulo,v.cargo,v.bairro,v.cidade,v.estado,v.salario,v.escala,v.horario,v.beneficios,
          v.candidatura_url,v.formulario_url,v.whatsapp_candidatura,v.status,e.nome AS empresa_nome
          FROM vagas v JOIN empresas e ON e.id=v.empresa_id WHERE v.status='ATIVA' ORDER BY v.updated_at DESC LIMIT 250`),
        pool.query(`SELECT g.id,g.nome,g.url,g.regiao,g.categorias,g.regras,g.intervalo_minimo_horas,g.ultima_publicacao_at,g.ativo,
          COUNT(d.id)::INTEGER AS publicacoes_total
          FROM divulgacao_grupos g LEFT JOIN divulgacao_campanha_destinos d ON d.grupo_id=g.id AND d.status='PUBLICADO'
          WHERE g.canal='FACEBOOK' GROUP BY g.id ORDER BY g.ativo DESC,g.nome LIMIT 1000`),
        pool.query(`SELECT c.id,c.vaga_id,c.nome,c.status,c.modelo,c.usar_imagem,c.created_at,c.updated_at,c.concluida_at,
          v.titulo AS vaga_titulo,e.nome AS empresa_nome,COUNT(d.id)::INTEGER AS destinos_total,
          COUNT(d.id) FILTER (WHERE d.status='PENDENTE')::INTEGER AS pendentes,
          COUNT(d.id) FILTER (WHERE d.status='ENVIADO')::INTEGER AS aguardando_aprovacao,
          COUNT(d.id) FILTER (WHERE d.status='PUBLICADO')::INTEGER AS publicados,
          COUNT(d.id) FILTER (WHERE d.status='FALHA')::INTEGER AS falhas
          FROM divulgacao_campanhas c JOIN vagas v ON v.id=c.vaga_id JOIN empresas e ON e.id=v.empresa_id
          LEFT JOIN divulgacao_campanha_destinos d ON d.campanha_id=c.id
          WHERE c.canal='FACEBOOK' GROUP BY c.id,v.titulo,e.nome ORDER BY c.updated_at DESC LIMIT 300`),
        pool.query(`SELECT COUNT(*)::INTEGER AS total FROM divulgacao_cliques x
          JOIN divulgacao_campanha_destinos d ON d.id=x.destino_id
          JOIN divulgacao_campanhas c ON c.id=d.campanha_id
          WHERE c.canal='FACEBOOK' AND x.created_at>=NOW()-INTERVAL '30 days'`),
      ]);
      const all = campaigns.rows;
      res.json({ sucesso: true, vagas: vacancies.rows, grupos: groups.rows, campanhas: all,
        resumo: { ativas: all.filter((item) => item.status === 'EM_EXECUCAO').length,
          pendentes: all.reduce((sum, item) => sum + Number(item.pendentes || 0), 0),
          aguardando: all.reduce((sum, item) => sum + Number(item.aguardando_aprovacao || 0), 0),
          publicadas: all.reduce((sum, item) => sum + Number(item.publicados || 0), 0),
          cliques: Number(clicks.rows[0]?.total || 0) } });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/divulgacao-facebook/grupos', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema();
      const nome = clean(req.body?.nome, 220); const url = facebookUrl(req.body?.url);
      if (!nome || !url) return res.status(400).json({ sucesso: false, erro: 'Informe o nome e uma URL válida de grupo do Facebook.' });
      const result = await pool.query(`INSERT INTO divulgacao_grupos(canal,nome,url,url_normalizada,empresa_id,owner_user_id,regiao,categorias,regras,origem,ativo,autorizado_envio,intervalo_minimo_horas)
        VALUES('FACEBOOK',$1,$2,$2,$3,$4,NULLIF($5::TEXT,''),$6::TEXT[],NULLIF($7::TEXT,''),'MANUAL',TRUE,TRUE,$8::INTEGER)
        ON CONFLICT(url_normalizada,COALESCE(empresa_id,-owner_user_id)) WHERE canal='FACEBOOK' AND url_normalizada IS NOT NULL
        DO UPDATE SET nome=EXCLUDED.nome,regiao=EXCLUDED.regiao,categorias=EXCLUDED.categorias,regras=EXCLUDED.regras,ativo=TRUE,updated_at=NOW() RETURNING *`,
      [nome, url, req.user?.empresa_id || null, req.user?.id || null, clean(req.body?.regiao, 160),
        Array.isArray(req.body?.categorias) ? req.body.categorias.map((item) => clean(item, 100)).filter(Boolean).slice(0, 30) : [],
        clean(req.body?.regras, 3000), Math.min(Math.max(Number(req.body?.intervalo_minimo_horas || 24), 0), 720)]);
      res.status(201).json({ sucesso: true, grupo: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/divulgacao-facebook/grupos/:id', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema(); const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'Grupo inválido.' });
      const result = await pool.query(`UPDATE divulgacao_grupos SET ativo=$2::BOOLEAN,updated_at=NOW() WHERE id=$1::BIGINT AND canal='FACEBOOK' RETURNING id,ativo`, [id, req.body?.ativo !== false]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Grupo não encontrado.' });
      res.json({ sucesso: true, grupo: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/divulgacao-facebook/campanhas', adminAccess, async (req, res, next) => {
    const client = await pool.connect();
    try {
      await ensureSchema(); const parsed = campaignSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Campanha inválida.' });
      const data = parsed.data;
      const vacancy = (await client.query(`SELECT v.*,e.nome AS empresa_nome FROM vagas v JOIN empresas e ON e.id=v.empresa_id WHERE v.id=$1::BIGINT AND v.status='ATIVA'`, [data.vaga_id])).rows[0];
      if (!vacancy) return res.status(404).json({ sucesso: false, erro: 'Vaga ativa não encontrada.' });
      const groupResult = await client.query(`SELECT id FROM divulgacao_grupos WHERE id=ANY($1::BIGINT[]) AND canal='FACEBOOK' AND ativo IS TRUE`, [data.grupo_ids]);
      if (groupResult.rowCount !== new Set(data.grupo_ids).size) return res.status(400).json({ sucesso: false, erro: 'Um ou mais grupos não estão disponíveis.' });
      const text = data.modelo === 'PERSONALIZADO' ? clean(data.texto, 12000) : campaignText(vacancy, data.modelo);
      if (!text.includes('{{link}}')) return res.status(400).json({ sucesso: false, erro: 'O texto personalizado precisa conter {{link}}.' });
      await client.query('BEGIN');
      const created = await client.query(`INSERT INTO divulgacao_campanhas(vaga_id,canal,nome,texto_modelo,modelo,usar_imagem,modo_envio,status,empresa_id,created_by,iniciada_at)
        VALUES($1::BIGINT,'FACEBOOK',$2,$3,$4,$5::BOOLEAN,'ASSISTIDO','EM_EXECUCAO',$6::BIGINT,$7::BIGINT,NOW()) RETURNING *`,
      [vacancy.id, `${vacancy.titulo} · Facebook`, text, data.modelo, data.usar_imagem, vacancy.empresa_id, req.user?.id || null]);
      for (const group of groupResult.rows) await client.query(`INSERT INTO divulgacao_campanha_destinos(campanha_id,grupo_id,tracking_token,status) VALUES($1::BIGINT,$2::BIGINT,$3,'PENDENTE')`, [created.rows[0].id, group.id, token()]);
      await client.query('COMMIT');
      res.status(201).json({ sucesso: true, campanha: created.rows[0] });
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} next(error); } finally { client.release(); }
  });

  app.get('/api/admin/divulgacao-facebook/campanhas/:id', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema(); const id = safeId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'Campanha inválida.' });
      const campaign = (await pool.query(`SELECT c.*,v.titulo AS vaga_titulo,v.bairro,v.cidade,v.estado,e.nome AS empresa_nome
        FROM divulgacao_campanhas c JOIN vagas v ON v.id=c.vaga_id JOIN empresas e ON e.id=v.empresa_id WHERE c.id=$1::BIGINT AND c.canal='FACEBOOK'`, [id])).rows[0];
      if (!campaign) return res.status(404).json({ sucesso: false, erro: 'Campanha não encontrada.' });
      const base = clean(publicBaseUrl || `${req.protocol}://${req.get('host')}`, 2000).replace(/\/$/, '');
      const destinations = (await pool.query(`SELECT d.id,d.status,d.tracking_token,d.texto_override,d.publicado_at,d.updated_at,d.erro,
        g.nome AS grupo_nome,g.url AS grupo_url,g.regiao,g.regras
        FROM divulgacao_campanha_destinos d JOIN divulgacao_grupos g ON g.id=d.grupo_id
        WHERE d.campanha_id=$1::BIGINT ORDER BY CASE d.status WHEN 'PENDENTE' THEN 1 WHEN 'ENVIADO' THEN 2 WHEN 'FALHA' THEN 3 ELSE 4 END,g.nome`, [id])).rows;
      res.json({ sucesso: true, campanha, imagem_url: campaign.usar_imagem ? `/api/vagas/${campaign.vaga_id}/divulgacao/principal.png` : null,
        destinos: destinations.map((item) => { const link = `${base}/r/div/${item.tracking_token}`; return { ...item, link_rastreavel: link, texto: String(item.texto_override || campaign.texto_modelo).replaceAll('{{link}}', link) }; }) });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/divulgacao-facebook/destinos/:id', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema(); const id = safeId(req.params.id); const status = clean(req.body?.status, 30).toUpperCase();
      if (!id || !['PENDENTE', 'ENVIADO', 'PUBLICADO', 'FALHA', 'PULADO'].includes(status)) return res.status(400).json({ sucesso: false, erro: 'Situação inválida.' });
      const result = await pool.query(`UPDATE divulgacao_campanha_destinos d SET status=$2,
        publicado_at=CASE WHEN $2='PUBLICADO' THEN COALESCE(publicado_at,NOW()) ELSE publicado_at END,
        enviado_at=CASE WHEN $2='ENVIADO' THEN COALESCE(enviado_at,NOW()) ELSE enviado_at END,
        erro=CASE WHEN $2='FALHA' THEN NULLIF($3::TEXT,'') ELSE NULL END,updated_at=NOW()
        FROM divulgacao_campanhas c WHERE d.id=$1::BIGINT AND c.id=d.campanha_id AND c.canal='FACEBOOK' RETURNING d.*,d.grupo_id`, [id, status, clean(req.body?.observacao, 1500)]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Destino não encontrado.' });
      if (status === 'PUBLICADO') await pool.query('UPDATE divulgacao_grupos SET ultima_publicacao_at=NOW(),updated_at=NOW() WHERE id=$1::BIGINT', [result.rows[0].grupo_id]);
      res.json({ sucesso: true, destino: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/divulgacao-facebook/campanhas/:id/concluir', adminAccess, async (req, res, next) => {
    try {
      await ensureSchema(); const id = safeId(req.params.id);
      const result = await pool.query(`UPDATE divulgacao_campanhas SET status='CONCLUIDA',concluida_at=NOW(),updated_at=NOW() WHERE id=$1::BIGINT AND canal='FACEBOOK' RETURNING id`, [id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Campanha não encontrada.' });
      res.json({ sucesso: true });
    } catch (error) { next(error); }
  });

  app.get('/r/div/:token', async (req, res, next) => {
    try {
      await ensureSchema(); const tracking = clean(req.params.token, 80);
      const result = await pool.query(`SELECT d.id,v.id AS vaga_id,v.titulo,v.candidatura_url,v.formulario_url,v.whatsapp_candidatura
        FROM divulgacao_campanha_destinos d JOIN divulgacao_campanhas c ON c.id=d.campanha_id JOIN vagas v ON v.id=c.vaga_id
        WHERE d.tracking_token=$1 AND c.canal='FACEBOOK' LIMIT 1`, [tracking]);
      if (!result.rowCount) return res.redirect(302, clean(portalBaseUrl || '/', 2000));
      const row = result.rows[0]; const hash = crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}`).digest('hex');
      await pool.query('INSERT INTO divulgacao_cliques(destino_id,visitor_hash,referer,user_agent) VALUES($1::BIGINT,$2,$3,$4)', [row.id, hash, clean(req.get('referer'), 2000), clean(req.get('user-agent'), 1000)]).catch(() => {});
      let destination = clean(row.candidatura_url || row.formulario_url, 2000);
      if (!/^https?:\/\//i.test(destination)) {
        const phone = digits(row.whatsapp_candidatura);
        destination = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Quero me candidatar à vaga ${row.titulo}.`)}` : clean(portalBaseUrl || '/', 2000);
      }
      res.redirect(302, destination || '/');
    } catch (error) { next(error); }
  });
}

module.exports = { registerFacebookPromotionV32, facebookUrl, campaignText };
