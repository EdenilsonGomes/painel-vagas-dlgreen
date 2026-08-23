'use strict';

const express = require('express');
const sharp = require('sharp');
const { z } = require('zod');

class ExternalServiceError extends Error {
  constructor(message, statusCode = 502, details = null) {
    super(message);
    this.name = 'ExternalServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value, max = 5000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function registerOperationsV14({
  app,
  pool,
  requireLogin,
  requireAdmin,
  currentUserName,
}) {
  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const imageModel = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2').trim();
  const imageQuality = ['low', 'medium', 'high'].includes(String(process.env.OPENAI_IMAGE_QUALITY || '').toLowerCase())
    ? String(process.env.OPENAI_IMAGE_QUALITY).toLowerCase()
    : 'medium';
  const imageTimeoutMs = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 120000), 20000), 180000);
  const imageDailyLimit = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_DAILY_LIMIT || 3), 1), 20);
  const brandSchema = z.object({
    slogan: z.string().trim().max(180).nullable().optional(),
    cor_primaria: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    cor_secundaria: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    cor_destaque: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    estilo_visual: z.enum(['CORPORATIVO', 'HUMANO', 'MODERNO', 'MINIMALISTA', 'VIBRANTE']),
    tom_comunicacao: z.enum(['PROFISSIONAL', 'PROXIMO', 'DIRETO', 'INSPIRADOR']),
    whatsapp: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().max(180).nullable().optional(),
    website: z.string().trim().max(2000).nullable().optional(),
  });

  const agendaSchema = z.object({
    dias_semana: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
    horarios: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(48),
    duracao_minutos: z.coerce.number().int().min(10).max(180),
    busca_dias: z.coerce.number().int().min(1).max(60),
    evitar_feriados: z.boolean(),
    timezone: z.string().trim().min(3).max(80).default('America/Sao_Paulo'),
    google_calendar_id: z.string().trim().max(500).nullable().optional(),
    whatsapp_alerta: z.string().trim().max(30).nullable().optional(),
    ativa: z.boolean().default(true),
  });

  function canManageCompany(req, companyId) {
    if (String(req.user?.perfil || '').toUpperCase() === 'ADMIN') return true;
    return Number(req.user?.empresa_id) === Number(companyId);
  }

  async function audit(req, action, entity, entityId, details = {}) {
    try {
      await pool.query(`
        INSERT INTO app_auditoria(usuario_id,usuario_nome,acao,entidade,entidade_id,detalhes)
        VALUES($1,$2,$3,$4,$5,$6::JSONB)
      `, [req.user?.id || null, currentUserName(req), action, entity, String(entityId || ''), JSON.stringify(details)]);
    } catch (error) {
      console.error('[V14] Falha ao registrar auditoria:', error.message);
    }
  }

  async function generateVacancyPhoto(vacancy, instruction = '') {
    if (!openAiApiKey) throw new ExternalServiceError('Configure OPENAI_API_KEY no EasyPanel para gerar fotografias com IA.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), imageTimeoutMs);
    const visualStyle = String(vacancy.estilo_visual || 'CORPORATIVO').toLowerCase();
    const prompt = [
      'Create a photorealistic vertical recruitment campaign background for a Brazilian company.',
      `Job context: ${cleanText(vacancy.titulo || vacancy.cargo, 150) || 'professional opportunity'}.`,
      `Work environment: ${cleanText([vacancy.modalidade, vacancy.bairro, vacancy.cidade].filter(Boolean).join(', '), 250) || 'professional workplace in Brazil'}.`,
      `Visual direction: ${visualStyle}, credible, welcoming, contemporary, premium corporate photography, natural light.`,
      'Show a realistic work scene related to the role, with respectful professional presentation and diverse Brazilian context.',
      'Leave generous negative space on the left side for a designed text overlay.',
      cleanText(instruction, 600) ? `Additional art direction from the recruiter: ${cleanText(instruction, 600)}.` : '',
      'Do not include any words, letters, numbers, logos, watermarks, badges, posters, signs, uniforms with brands, or UI elements. The exact company logo and recruitment text will be composited after generation.',
    ].filter(Boolean).join(' ');
    try {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: imageModel,
          prompt,
          size: '1024x1536',
          quality: imageQuality,
          output_format: 'jpeg',
          output_compression: 88,
          n: 1,
        }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = body?.error?.code;
        const message = code === 'moderation_blocked'
          ? 'A geração foi bloqueada pela moderação. Ajuste o título ou a descrição da vaga e tente novamente.'
          : body?.error?.message || `A geração de imagem retornou HTTP ${response.status}.`;
        throw new ExternalServiceError(message, response.status >= 500 ? 502 : 409, { code });
      }
      const encoded = body?.data?.[0]?.b64_json;
      if (!encoded) throw new ExternalServiceError('A API não devolveu uma imagem válida.', 502);
      const original = Buffer.from(encoded, 'base64');
      const image = await sharp(original).rotate().resize(1024, 1536, { fit: 'cover', position: 'attention' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      return { image, prompt, model: imageModel };
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      if (error?.name === 'AbortError') throw new ExternalServiceError('A geração demorou além do limite. Tente novamente em alguns instantes.', 504);
      throw new ExternalServiceError(`Não foi possível gerar a fotografia: ${error.message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  app.get('/api/empresas/marcas', requireLogin, async (req, res, next) => {
    try {
      const params = [];
      const where = String(req.user?.perfil || '').toUpperCase() === 'ADMIN' || !req.user?.empresa_id
        ? ''
        : 'WHERE e.id=$1';
      if (where) params.push(req.user.empresa_id);
      const result = await pool.query(`
        SELECT e.id,e.nome,e.ativo,m.slogan,m.cor_primaria,m.cor_secundaria,m.cor_destaque,
          m.estilo_visual,m.tom_comunicacao,m.whatsapp,m.email,m.website,m.configurada,
          (m.logo_png IS NOT NULL) AS possui_logo,m.logo_atualizada_em,m.updated_at
        FROM empresas e
        LEFT JOIN empresa_marcas m ON m.empresa_id=e.id
        ${where}
        ORDER BY e.ativo DESC,e.nome
      `, params);
      res.json({ sucesso: true, empresas: result.rows });
    } catch (error) { next(error); }
  });

  app.get('/api/empresas/:id/marca/logo', requireLogin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'Empresa inválida.' });
      if (!canManageCompany(req, id)) return res.status(403).json({ sucesso: false, erro: 'Você não pode acessar esta empresa.' });
      const result = await pool.query('SELECT logo_png,logo_mime FROM empresa_marcas WHERE empresa_id=$1', [id]);
      if (!result.rows[0]?.logo_png) return res.status(404).json({ sucesso: false, erro: 'Logo ainda não configurada.' });
      res.setHeader('Content-Type', result.rows[0].logo_mime || 'image/png');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(result.rows[0].logo_png);
    } catch (error) { return next(error); }
  });

  app.put('/api/empresas/:id/marca', requireLogin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id || !canManageCompany(req, id)) return res.status(403).json({ sucesso: false, erro: 'Você não pode editar esta empresa.' });
      const parsed = brandSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados da marca inválidos.' });
      const data = parsed.data;
      const result = await pool.query(`
        INSERT INTO empresa_marcas(empresa_id,slogan,cor_primaria,cor_secundaria,cor_destaque,estilo_visual,tom_comunicacao,whatsapp,email,website,configurada,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11)
        ON CONFLICT(empresa_id) DO UPDATE SET
          slogan=EXCLUDED.slogan,cor_primaria=EXCLUDED.cor_primaria,cor_secundaria=EXCLUDED.cor_secundaria,
          cor_destaque=EXCLUDED.cor_destaque,estilo_visual=EXCLUDED.estilo_visual,tom_comunicacao=EXCLUDED.tom_comunicacao,
          whatsapp=EXCLUDED.whatsapp,email=EXCLUDED.email,website=EXCLUDED.website,configurada=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW()
        RETURNING empresa_id,slogan,cor_primaria,cor_secundaria,cor_destaque,estilo_visual,tom_comunicacao,whatsapp,email,website,configurada,updated_at
      `, [id, cleanText(data.slogan, 180), data.cor_primaria.toUpperCase(), data.cor_secundaria.toUpperCase(), data.cor_destaque.toUpperCase(), data.estilo_visual, data.tom_comunicacao, cleanText(data.whatsapp, 30), cleanText(data.email, 180), cleanText(data.website, 2000), req.user?.id || null]);
      await audit(req, 'MARCA_EMPRESA_ATUALIZADA', 'empresa_marcas', id, { estilo: data.estilo_visual });
      res.json({ sucesso: true, mensagem: 'Identidade visual salva.', marca: result.rows[0] });
    } catch (error) { next(error); }
  });

  const logoUpload = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'], limit: '3mb' });
  app.put('/api/empresas/:id/marca/logo', requireLogin, logoUpload, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id || !canManageCompany(req, id)) return res.status(403).json({ sucesso: false, erro: 'Você não pode editar esta empresa.' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ sucesso: false, erro: 'Selecione uma imagem de logo.' });
      const metadata = await sharp(req.body, { limitInputPixels: 20_000_000 }).metadata();
      if (!['png', 'jpeg', 'webp', 'svg'].includes(String(metadata.format || ''))) return res.status(415).json({ sucesso: false, erro: 'Envie a logo em PNG, JPG, WebP ou SVG.' });
      const logo = await sharp(req.body, { density: 240, limitInputPixels: 20_000_000 })
        .rotate().resize(1200, 500, { fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
      await pool.query(`
        INSERT INTO empresa_marcas(empresa_id,logo_png,logo_mime,logo_nome,logo_atualizada_em,configurada,updated_by)
        VALUES($1,$2,'image/png',$3,NOW(),TRUE,$4)
        ON CONFLICT(empresa_id) DO UPDATE SET logo_png=EXCLUDED.logo_png,logo_mime='image/png',logo_nome=EXCLUDED.logo_nome,
          logo_atualizada_em=NOW(),configurada=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW()
      `, [id, logo, cleanText(req.headers['x-file-name'], 180) || 'logo.png', req.user?.id || null]);
      await audit(req, 'LOGO_EMPRESA_ATUALIZADA', 'empresa_marcas', id, { bytes: logo.length });
      res.json({ sucesso: true, mensagem: 'Logo validada e salva.', logo_url: `/api/empresas/${id}/marca/logo?v=${Date.now()}` });
    } catch (error) {
      if (/Input buffer contains unsupported image format/i.test(error.message)) return res.status(415).json({ sucesso: false, erro: 'O arquivo não é uma imagem válida.' });
      return next(error);
    }
  });

  app.delete('/api/empresas/:id/marca/logo', requireLogin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id || !canManageCompany(req, id)) return res.status(403).json({ sucesso: false, erro: 'Você não pode editar esta empresa.' });
      await pool.query('UPDATE empresa_marcas SET logo_png=NULL,logo_mime=NULL,logo_nome=NULL,logo_atualizada_em=NOW(),updated_at=NOW() WHERE empresa_id=$1', [id]);
      await audit(req, 'LOGO_EMPRESA_REMOVIDA', 'empresa_marcas', id);
      res.json({ sucesso: true, mensagem: 'Logo removida.' });
    } catch (error) { next(error); }
  });

  app.get('/api/recrutadores', requireLogin, async (req, res, next) => {
    try {
      const admin = String(req.user?.perfil || '').toUpperCase() === 'ADMIN';
      const params = [];
      let where = `WHERE u.ativo IS TRUE`;
      if (!admin && req.user?.empresa_id) { params.push(req.user.empresa_id); where += ` AND u.empresa_id=$${params.length}`; }
      const result = await pool.query(`
        SELECT u.id,u.nome,u.usuario,u.empresa_id,e.nome AS empresa_nome,
          COALESCE(a.dias_semana,ARRAY[1,2,3,4,5]::SMALLINT[]) AS dias_semana,
          COALESCE(a.horarios,'["09:00","10:00","14:00","15:00"]'::JSONB) AS horarios,
          COALESCE(a.duracao_minutos,30) AS duracao_minutos,
          COALESCE(a.busca_dias,7) AS busca_dias,COALESCE(a.ativa,TRUE) AS agenda_ativa
        FROM app_usuarios u LEFT JOIN empresas e ON e.id=u.empresa_id
        LEFT JOIN recrutador_agendas a ON a.usuario_id=u.id
        ${where}
        ORDER BY CASE WHEN u.id=$${params.length + 1} THEN 0 ELSE 1 END,u.nome
      `, [...params, req.user?.id || 0]);
      res.json({ sucesso: true, recrutadores: result.rows });
    } catch (error) { next(error); }
  });

  app.get('/api/minha-agenda', requireLogin, async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(409).json({ sucesso: false, erro: 'Cadastre um usuário individual para configurar a agenda.' });
      const result = await pool.query(`
        SELECT u.id AS usuario_id,u.nome,u.empresa_id,e.nome AS empresa_nome,
          COALESCE(a.dias_semana,ARRAY[1,2,3,4,5]::SMALLINT[]) AS dias_semana,
          COALESCE(a.horarios,'["09:00","10:00","14:00","15:00"]'::JSONB) AS horarios,
          COALESCE(a.duracao_minutos,30) AS duracao_minutos,COALESCE(a.busca_dias,7) AS busca_dias,
          COALESCE(a.evitar_feriados,TRUE) AS evitar_feriados,COALESCE(a.timezone,'America/Sao_Paulo') AS timezone,
          a.google_calendar_id,a.whatsapp_alerta,COALESCE(a.ativa,TRUE) AS ativa,a.updated_at
        FROM app_usuarios u LEFT JOIN empresas e ON e.id=u.empresa_id
        LEFT JOIN recrutador_agendas a ON a.usuario_id=u.id WHERE u.id=$1
      `, [req.user.id]);
      res.json({ sucesso: true, agenda: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.put('/api/minha-agenda', requireLogin, async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(409).json({ sucesso: false, erro: 'Cadastre um usuário individual para configurar a agenda.' });
      const parsed = agendaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Disponibilidade inválida.' });
      const data = parsed.data;
      const days = [...new Set(data.dias_semana)].sort((a, b) => a - b);
      const times = [...new Set(data.horarios)].sort();
      const result = await pool.query(`
        INSERT INTO recrutador_agendas(usuario_id,dias_semana,horarios,duracao_minutos,busca_dias,evitar_feriados,timezone,google_calendar_id,whatsapp_alerta,ativa)
        VALUES($1,$2::SMALLINT[],$3::JSONB,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(usuario_id) DO UPDATE SET dias_semana=EXCLUDED.dias_semana,horarios=EXCLUDED.horarios,
          duracao_minutos=EXCLUDED.duracao_minutos,busca_dias=EXCLUDED.busca_dias,evitar_feriados=EXCLUDED.evitar_feriados,
          timezone=EXCLUDED.timezone,google_calendar_id=EXCLUDED.google_calendar_id,whatsapp_alerta=EXCLUDED.whatsapp_alerta,
          ativa=EXCLUDED.ativa,updated_at=NOW()
        RETURNING *
      `, [req.user.id, days, JSON.stringify(times), data.duracao_minutos, data.busca_dias, data.evitar_feriados, data.timezone, cleanText(data.google_calendar_id, 500), cleanText(data.whatsapp_alerta, 30), data.ativa]);
      await audit(req, 'AGENDA_RECRUTADOR_ATUALIZADA', 'recrutador_agendas', req.user.id, { dias: days, horarios: times.length });
      res.json({ sucesso: true, mensagem: 'Sua disponibilidade foi salva e aplicada às vagas vinculadas.', agenda: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/vagas/:id/divulgacao/gerar-ia', requireLogin, async (req, res, next) => {
    let client = null;
    let companyLockHeld = false;
    let companyIdForLock = null;
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      const result = await pool.query(`
        SELECT v.*,e.nome AS empresa_nome,m.estilo_visual,m.cor_primaria,m.cor_secundaria,m.cor_destaque,m.logo_png
        FROM vagas v JOIN empresas e ON e.id=v.empresa_id LEFT JOIN empresa_marcas m ON m.empresa_id=e.id
        WHERE v.id=$1 LIMIT 1
      `, [id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
      if (!canManageCompany(req, result.rows[0].empresa_id)) return res.status(403).json({ sucesso: false, erro: 'Você não pode gerar artes para esta empresa.' });
      if (!result.rows[0].logo_png) return res.status(409).json({ sucesso: false, erro: 'Configure a logo da empresa em Empresas e marcas antes de gerar a arte com IA.' });
      companyIdForLock = Number(result.rows[0].empresa_id);
      client = await pool.connect();
      const lock = await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', [17021, companyIdForLock]);
      companyLockHeld = lock.rows[0]?.locked === true;
      if (!companyLockHeld) return res.status(409).json({ sucesso: false, erro: 'Já existe uma geração de arte em andamento para esta empresa. Aguarde terminar e tente novamente.' });
      const recent = await client.query(`
        SELECT COUNT(*)::INTEGER AS total
        FROM vaga_artes_ia
        WHERE empresa_id=$1
          AND created_at >= (DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
      `, [result.rows[0].empresa_id]);
      const usedToday = Number(recent.rows[0]?.total || 0);
      if (usedToday >= imageDailyLimit) return res.status(429).json({
        sucesso: false,
        erro: `Limite de ${imageDailyLimit} gerações de arte por dia atingido para esta empresa.`
      });
      const generated = await generateVacancyPhoto(result.rows[0], req.body?.instrucao);
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [id]);
      const version = await client.query('SELECT COALESCE(MAX(versao),0)+1 AS proxima FROM vaga_artes_ia WHERE vaga_id=$1', [id]);
      await client.query('UPDATE vaga_artes_ia SET ativa=FALSE,status=\'ARQUIVADA\' WHERE vaga_id=$1 AND ativa IS TRUE', [id]);
      const saved = await client.query(`
        INSERT INTO vaga_artes_ia(vaga_id,empresa_id,versao,status,modelo,prompt,imagem,mime_type,largura,altura,ativa,criado_por)
        VALUES($1,$2,$3,'PRONTA',$4,$5,$6,'image/jpeg',1024,1536,TRUE,$7) RETURNING id,versao,modelo,created_at
      `, [id, result.rows[0].empresa_id, Number(version.rows[0].proxima), generated.model, generated.prompt, generated.image, req.user?.id || null]);
      await client.query('COMMIT');
      await audit(req, 'ARTE_VAGA_IA_GERADA', 'vaga_artes_ia', saved.rows[0].id, { vaga_id: id, modelo: generated.model });
      res.status(201).json({ sucesso: true, mensagem: 'Nova arte criada com IA. A logo real e os textos da vaga foram aplicados separadamente para preservar a marca.', arte: saved.rows[0], limite_diario: imageDailyLimit, geracoes_hoje: usedToday + 1, restantes_hoje: Math.max(0, imageDailyLimit - usedToday - 1), imagem_png_url: `/api/vagas/${id}/divulgacao/principal.png?arte=${saved.rows[0].id}&v=${Date.now()}` });
    } catch (error) {
      if (client) { try { await client.query('ROLLBACK'); } catch {} }
      next(error);
    } finally {
      if (client && companyLockHeld && companyIdForLock) { try { await client.query('SELECT pg_advisory_unlock($1,$2)', [17021, companyIdForLock]); } catch {} }
      client?.release();
    }
  });

  return {
    config: { imageModel, imageQuality, imageDailyLimit, openAiConfigured: Boolean(openAiApiKey) },
  };
}

module.exports = { registerOperationsV14 };
