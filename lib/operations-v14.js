'use strict';

const crypto = require('node:crypto');
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

function digits(value) {
  let valueDigits = String(value || '').replace(/\D+/g, '');
  if (valueDigits.length === 10 || valueDigits.length === 11) valueDigits = `55${valueDigits}`;
  return /^55\d{10,11}$/.test(valueDigits) ? valueDigits : '';
}

function cleanText(value, max = 5000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyInboundReply(message) {
  const text = normalizedText(message);
  if (!text) return { type: 'VAZIA', rule: 'SEM_TEXTO' };

  const optOut = [
    /\bnao (?:me )?(?:mande|envie|contate|chame)\b/,
    /\bremov[ae] (?:meu )?(?:numero|contato)\b/,
    /\bpare de (?:mandar|enviar)\b/,
    /\bdescadastr/,
    /\bnao tenho interesse\b/,
  ];
  const optOutRule = optOut.find((rule) => rule.test(text));
  if (optOutRule) return { type: 'DESCADASTRO', rule: String(optOutRule) };

  const automaticRules = [
    /agradecemos (?:o|seu) contato/,
    /obrigad[oa] por entrar em contato/,
    /nosso horario de atendimento/,
    /fora do (?:nosso )?horario de atendimento/,
    /no momento (?:estamos|nao estamos) (?:ausentes|indisponiveis|disponiveis)/,
    /sua mensagem (?:ja )?(?:foi )?recebida/,
    /responderemos (?:assim que possivel|em breve)/,
    /retornaremos (?:assim que possivel|em breve)/,
    /digite\s+\d+\s+(?:para|se)/,
    /escolha uma (?:das )?opco(?:es|ao)/,
    /menu (?:de )?atendimento/,
    /assistente virtual/,
    /atendimento automatico/,
    /mensagem automatica/,
    /assim que (?:um|uma) de nossos? atendentes/,
    /sua mensagem (?:sera|vai ser) encaminhada/,
    /aguarde (?:um instante|para ser atendid[oa])/,
  ];
  const matches = automaticRules.filter((rule) => rule.test(text));
  const strong = matches.some((rule) => /digite|menu|assistente|automatic|horario|mensagem|atendentes|aguarde/.test(String(rule)));
  if (matches.length >= 2 || (strong && text.length <= 700)) {
    return { type: 'AUTOMATICA', rule: matches.map(String).slice(0, 3).join(' | ') };
  }
  return { type: 'HUMANA', rule: 'SEM_PADRAO_AUTOMATICO' };
}

function nextBusinessTime(value = new Date()) {
  const date = new Date(value);
  const local = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = local.getDay();
  const minutes = local.getHours() * 60 + local.getMinutes();
  if (day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 17 * 60 + 30) return date;

  local.setSeconds(0, 0);
  if (day === 0) local.setDate(local.getDate() + 1);
  else if (day === 6) local.setDate(local.getDate() + 2);
  else if (minutes > 17 * 60 + 30) {
    local.setDate(local.getDate() + (day === 5 ? 3 : 1));
  }
  local.setHours(9, 0, 0, 0);
  const offset = date.getTime() - new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getTime();
  return new Date(local.getTime() + offset);
}

function personalizeTemplate(template, lead, userName) {
  const replacements = {
    empresa: lead.empresa_nome || 'sua empresa',
    cidade: lead.cidade || 'sua região',
    segmento: lead.categoria || 'seu segmento',
    nome_sdr: userName || 'equipe comercial',
  };
  return String(template || '').replace(/\{(empresa|cidade|segmento|nome_sdr)\}/g, (_match, key) => replacements[key]).trim();
}

function registerOperationsV14({
  app,
  pool,
  requireLogin,
  requireAdmin,
  currentUserName,
  wahaBaseUrl,
  wahaApiKey,
  panelBaseUrl,
  legacyWahaEnabled = false,
}) {
  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const imageModel = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2').trim();
  const imageQuality = ['low', 'medium', 'high'].includes(String(process.env.OPENAI_IMAGE_QUALITY || '').toLowerCase())
    ? String(process.env.OPENAI_IMAGE_QUALITY).toLowerCase()
    : 'medium';
  const imageTimeoutMs = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 120000), 20000), 180000);
  const imageDailyLimit = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_DAILY_LIMIT || 3), 1), 20);
  const prospectingSession = String(process.env.PROSPECTING_WAHA_SESSION || 'genesis_prospeccao').trim();
  const prospectingWebhookToken = String(process.env.PROSPECTING_WEBHOOK_TOKEN || '').trim();
  const outreachEnabled = String(process.env.PROSPECTING_OUTREACH_ENABLED || 'false').toLowerCase() === 'true';
  const outreachIntervalSeconds = Math.min(Math.max(Number(process.env.PROSPECTING_MIN_INTERVAL_SECONDS || 120), 60), 3600);
  const outreachDailyLimit = Math.min(Math.max(Number(process.env.PROSPECTING_DAILY_LIMIT || 20), 1), 100);
  let queueBusy = false;

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

  async function wahaRequest(endpoint, { method = 'GET', body, allowNotFound = false, timeoutMs = 20000 } = {}) {
    if (!wahaBaseUrl || !wahaApiKey) throw new ExternalServiceError('Configure WAHA_BASE_URL e WAHA_API_KEY no EasyPanel.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${String(wahaBaseUrl).replace(/\/$/, '')}${endpoint}`, {
        method,
        headers: {
          'X-Api-Key': wahaApiKey,
          Accept: 'application/json, image/png, image/jpeg',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let json = null;
      if (contentType.includes('json') && buffer.length) {
        try { json = JSON.parse(buffer.toString('utf8')); } catch { json = null; }
      }
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) {
        const message = json?.message || json?.error || buffer.toString('utf8').slice(0, 500) || `HTTP ${response.status}`;
        throw new ExternalServiceError(`O WAHA recusou a operação: ${message}`, response.status >= 500 ? 502 : 409, json);
      }
      return { json, buffer, contentType, response };
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      if (error?.name === 'AbortError') throw new ExternalServiceError('O WAHA demorou para responder.', 504);
      throw new ExternalServiceError(`Não foi possível acessar o WAHA: ${error.message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async function prospectingSessionStatus() {
    const result = await wahaRequest(`/api/sessions/${encodeURIComponent(prospectingSession)}`, { allowNotFound: true });
    return result?.json || null;
  }

  async function startProspectingSession() {
    if (!prospectingWebhookToken || !panelBaseUrl) {
      throw new ExternalServiceError('Configure PANEL_URL e PROSPECTING_WEBHOOK_TOKEN antes de conectar o número dedicado.', 503);
    }
    const current = await prospectingSessionStatus();
    const currentStatus = String(current?.status || '').toUpperCase();
    if (['WORKING', 'CONNECTED', 'AUTHENTICATED', 'SCAN_QR_CODE', 'SCAN_QR', 'STARTING'].includes(currentStatus)) return current;
    const webhookUrl = `${String(panelBaseUrl).replace(/\/$/, '')}/api/public/prospeccao/waha?token=${encodeURIComponent(prospectingWebhookToken)}`;
    const config = {
      name: prospectingSession,
      start: true,
      config: { webhooks: [{ url: webhookUrl, events: ['message'], retries: { policy: 'constant', delaySeconds: 2, attempts: 5 } }] },
    };
    if (!current) {
      try {
        const created = await wahaRequest('/api/sessions', { method: 'POST', body: config });
        return created.json || { status: 'STARTING' };
      } catch (error) {
        const legacy = await wahaRequest('/api/sessions/start', { method: 'POST', body: config });
        return legacy.json || { status: 'STARTING' };
      }
    }
    try {
      const started = await wahaRequest(`/api/sessions/${encodeURIComponent(prospectingSession)}/start`, { method: 'POST', body: {} });
      return started.json || { status: 'STARTING' };
    } catch (error) {
      const restarted = await wahaRequest(`/api/sessions/${encodeURIComponent(prospectingSession)}/restart`, { method: 'POST', body: {} });
      return restarted.json || { status: 'STARTING' };
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

  if (legacyWahaEnabled) app.get('/api/admin/prospeccao/contato/config', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      let session = null;
      let sessionError = null;
      try { session = await prospectingSessionStatus(); } catch (error) { sessionError = error.message; }
      const [queue, today, models] = await Promise.all([
        pool.query(`SELECT COUNT(*) FILTER(WHERE status='AGENDADO')::INTEGER AS agendados,COUNT(*) FILTER(WHERE status='FALHA')::INTEGER AS falhas FROM prospeccao_envios`),
        pool.query(`SELECT COUNT(*)::INTEGER AS enviados FROM prospeccao_envios WHERE enviado_em >= DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AND status='ENVIADO'`),
        pool.query('SELECT id,nome,mensagem,ativo FROM prospeccao_modelos_mensagem WHERE ativo IS TRUE ORDER BY id'),
      ]);
      res.json({ sucesso: true, configuracao: {
        habilitado: outreachEnabled, session_name: prospectingSession, waha_configurado: Boolean(wahaBaseUrl && wahaApiKey),
        webhook_configurado: Boolean(prospectingWebhookToken && panelBaseUrl), status: session?.status || 'STOPPED',
        telefone_conectado: String(session?.me?.id || session?.me?.user || '').replace(/\D/g, '') || null,
        erro_sessao: sessionError, intervalo_segundos: outreachIntervalSeconds, limite_diario: outreachDailyLimit,
        enviados_hoje: Number(today.rows[0]?.enviados || 0), agendados: Number(queue.rows[0]?.agendados || 0), falhas: Number(queue.rows[0]?.falhas || 0),
      }, modelos: models.rows });
    } catch (error) { next(error); }
  });

  if (legacyWahaEnabled) app.post('/api/admin/prospeccao/contato/session/start', requireLogin, requireAdmin, async (_req, res, next) => {
    try {
      const session = await startProspectingSession();
      res.json({ sucesso: true, mensagem: 'Sessão dedicada iniciada. Leia o QR Code para conectar o número.', status: session?.status || 'STARTING' });
    } catch (error) { next(error); }
  });

  if (legacyWahaEnabled) app.get('/api/admin/prospeccao/contato/session/qr', requireLogin, requireAdmin, async (_req, res, next) => {
    try {
      const result = await wahaRequest(`/api/${encodeURIComponent(prospectingSession)}/auth/qr`);
      let imageBuffer = result.buffer;
      let imageType = result.contentType.includes('jpeg') ? 'image/jpeg' : 'image/png';
      if (result.json) {
        const dataUrl = String(result.json.data || result.json.value || result.json.qr || '');
        const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
        const raw = !match && /^[A-Za-z0-9+/=]{100,}$/.test(dataUrl) ? dataUrl : null;
        if (!match && !raw) return res.status(409).json({ sucesso: false, erro: 'O QR Code ainda não está disponível.' });
        imageType = match?.[1] || 'image/png';
        imageBuffer = Buffer.from(match?.[2] || raw, 'base64');
      }
      res.setHeader('Content-Type', imageType);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(imageBuffer);
    } catch (error) { return next(error); }
  });

  if (legacyWahaEnabled) app.post('/api/admin/prospeccao/leads/:id/agendar-contato', requireLogin, requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const modelId = parseId(req.body?.modelo_id);
      const authorizationSource = cleanText(req.body?.autorizacao_origem, 200);
      if (!id || !modelId) return res.status(400).json({ sucesso: false, erro: 'Lead ou modelo inválido.' });
      if (req.body?.confirmar_autorizacao !== true || !authorizationSource) {
        return res.status(400).json({ sucesso: false, erro: 'Confirme a autorização e informe sua origem antes de agendar.' });
      }
      const [leadResult, modelResult] = await Promise.all([
        pool.query('SELECT * FROM prospeccao_leads WHERE id=$1', [id]),
        pool.query('SELECT * FROM prospeccao_modelos_mensagem WHERE id=$1 AND ativo IS TRUE', [modelId]),
      ]);
      const lead = leadResult.rows[0];
      const model = modelResult.rows[0];
      if (!lead || !model) return res.status(404).json({ sucesso: false, erro: 'Lead ou modelo não encontrado.' });
      if (lead.nao_contatar) return res.status(409).json({ sucesso: false, erro: 'Este lead está marcado como não contatar.' });
      if (String(lead.status || '').toUpperCase() !== 'APROVADO_CONTATO') return res.status(409).json({ sucesso: false, erro: 'Mova o lead para “Aprovado para contato” e salve antes de preparar a mensagem.' });
      const phone = digits(lead.telefone_normalizado || lead.telefone);
      if (!phone) return res.status(409).json({ sucesso: false, erro: 'O lead não possui um WhatsApp válido.' });
      const existing = await pool.query(`SELECT status FROM prospeccao_envios WHERE lead_id=$1 AND status IN ('AGENDADO','PROCESSANDO','ENVIADO') ORDER BY id DESC LIMIT 1`, [id]);
      if (existing.rowCount) return res.status(409).json({ sucesso: false, erro: existing.rows[0].status === 'ENVIADO' ? 'O primeiro contato deste lead já foi enviado. O SDR deve continuar a conversa.' : 'Este lead já está na fila de contato.' });
      const message = personalizeTemplate(model.mensagem, lead, currentUserName(req));
      const requestedDate = new Date(req.body?.agendado_para || Date.now());
      if (Number.isNaN(requestedDate.getTime())) return res.status(400).json({ sucesso: false, erro: 'Data de envio inválida.' });
      const scheduled = nextBusinessTime(requestedDate);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE prospeccao_leads SET contato_autorizado=TRUE,contato_autorizado_origem=$2,contato_autorizado_em=NOW(),responsavel_id=COALESCE(responsavel_id,$3),updated_at=NOW() WHERE id=$1`, [id, authorizationSource, req.user.id]);
        const saved = await client.query(`
          INSERT INTO prospeccao_envios(lead_id,modelo_id,session_name,telefone,mensagem,status,agendado_para,aprovado_por)
          VALUES($1,$2,$3,$4,$5,'AGENDADO',$6,$7) RETURNING *
        `, [id, modelId, prospectingSession, phone, message, scheduled.toISOString(), req.user.id]);
        await client.query('COMMIT');
        await audit(req, 'CONTATO_PROSPECCAO_AGENDADO', 'prospeccao_envios', saved.rows[0].id, { lead_id: id, autorizado_por: authorizationSource });
        res.status(201).json({ sucesso: true, mensagem: outreachEnabled ? 'Contato autorizado adicionado à fila segura.' : 'Contato salvo na fila. Ative PROSPECTING_OUTREACH_ENABLED para liberar os envios.', envio: saved.rows[0] });
      } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });

  if (legacyWahaEnabled) app.post('/api/public/prospeccao/waha', async (req, res, next) => {
    try {
      const token = String(req.query.token || req.headers['x-prospecting-token'] || '');
      if (!prospectingWebhookToken || !safeEqual(token, prospectingWebhookToken)) return res.status(401).json({ sucesso: false, erro: 'Token inválido.' });
      const body = req.body?.body && typeof req.body.body === 'object' ? req.body.body : req.body;
      const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
      const session = String(body?.session || payload?.session || '');
      if (session !== prospectingSession || payload?.fromMe === true || payload?._data?.Info?.IsFromMe === true) return res.json({ sucesso: true, ignorado: true });
      const from = String(payload?.from || payload?._data?.Info?.SenderAlt || payload?._data?.Info?.Sender || '');
      if (/@g\.us$|@lid$/i.test(from)) return res.json({ sucesso: true, ignorado: true });
      const phone = digits(from.replace(/@.+$/, ''));
      const message = String(payload?.body || '').trim();
      const messageId = String(payload?.id || payload?._data?.Info?.ID || '');
      if (!phone) return res.json({ sucesso: true, ignorado: true });
      const classification = classifyInboundReply(message);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const leadResult = await client.query(`
          SELECT * FROM prospeccao_leads
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(telefone_normalizado,telefone,''),'\\D','','g'),11)=RIGHT($1,11)
          ORDER BY id DESC LIMIT 1 FOR UPDATE
        `, [phone]);
        const lead = leadResult.rows[0] || null;
        const stored = await client.query(`
          INSERT INTO prospeccao_respostas(lead_id,session_name,telefone,message_id,mensagem,classificacao,regra_detectada,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::JSONB)
          ON CONFLICT(session_name,message_id) WHERE message_id IS NOT NULL AND BTRIM(message_id)<>'' DO NOTHING
          RETURNING id
        `, [lead?.id || null, session, phone, messageId || null, cleanText(message, 8000), classification.type, classification.rule, JSON.stringify(body || {})]);
        if (!stored.rowCount) {
          await client.query('COMMIT');
          return res.json({ sucesso: true, ignorado: true, motivo: 'MENSAGEM_DUPLICADA' });
        }
        if (lead) {
          if (classification.type === 'DESCADASTRO') {
            await client.query(`UPDATE prospeccao_leads SET status='NAO_CONTATAR',nao_contatar=TRUE,resposta_tipo='DESCADASTRO',resposta_ultima_at=NOW(),updated_at=NOW() WHERE id=$1`, [lead.id]);
            await client.query(`UPDATE prospeccao_envios SET status='CANCELADO',updated_at=NOW() WHERE lead_id=$1 AND status='AGENDADO'`, [lead.id]);
          } else if (classification.type === 'HUMANA') {
            await client.query(`UPDATE prospeccao_leads SET status='RESPONDEU',resposta_tipo='HUMANA',resposta_ultima_at=NOW(),updated_at=NOW() WHERE id=$1`, [lead.id]);
            await client.query(`INSERT INTO prospeccao_notas(lead_id,nota,criado_por_nome) VALUES($1,$2,'Detecção automática V14')`, [lead.id, `Resposta humana detectada no número dedicado: ${message.slice(0, 500)}`]);
          } else {
            await client.query(`UPDATE prospeccao_leads SET resposta_tipo=$2,resposta_ultima_at=NOW(),updated_at=NOW() WHERE id=$1`, [lead.id, classification.type]);
          }
        }
        await client.query('COMMIT');
      } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
      res.json({ sucesso: true, classificacao: classification.type });
    } catch (error) { next(error); }
  });

  async function processOutreachQueue() {
    if (!outreachEnabled || queueBusy || !wahaBaseUrl || !wahaApiKey) return;
    queueBusy = true;
    const client = await pool.connect();
    let item = null;
    let outboundAccepted = false;
    let outboundMessageId = null;
    try {
      const now = new Date();
      const allowed = nextBusinessTime(now).getTime() <= now.getTime() + 1000;
      if (!allowed) return;
      const daily = await client.query(`SELECT COUNT(*)::INTEGER AS total FROM prospeccao_envios WHERE status='ENVIADO' AND enviado_em>=DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`);
      if (Number(daily.rows[0]?.total || 0) >= outreachDailyLimit) return;
      const last = await client.query(`SELECT enviado_em FROM prospeccao_envios WHERE status='ENVIADO' ORDER BY enviado_em DESC LIMIT 1`);
      if (last.rows[0]?.enviado_em && Date.now() - new Date(last.rows[0].enviado_em).getTime() < outreachIntervalSeconds * 1000) return;
      await client.query('BEGIN');
      const selected = await client.query(`
        SELECT e.* FROM prospeccao_envios e JOIN prospeccao_leads l ON l.id=e.lead_id
        WHERE e.status='AGENDADO' AND e.agendado_para<=NOW() AND l.contato_autorizado IS TRUE AND l.nao_contatar IS FALSE
        ORDER BY e.agendado_para,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1
      `);
      item = selected.rows[0];
      if (!item) { await client.query('ROLLBACK'); return; }
      await client.query(`UPDATE prospeccao_envios SET status='PROCESSANDO',tentativas=tentativas+1,updated_at=NOW() WHERE id=$1`, [item.id]);
      await client.query('COMMIT');
      const sent = await wahaRequest('/api/sendText', { method: 'POST', body: { session: prospectingSession, chatId: `${item.telefone}@c.us`, text: item.mensagem, linkPreview: false } });
      outboundAccepted = true;
      outboundMessageId = String(sent.json?.id || sent.json?.key?.id || sent.json?.message?.id || '');
      const finish = await pool.connect();
      try {
        await finish.query('BEGIN');
        await finish.query(`UPDATE prospeccao_envios SET status='ENVIADO',enviado_em=NOW(),waha_message_id=$2,erro=NULL,updated_at=NOW() WHERE id=$1`, [item.id, outboundMessageId || null]);
        await finish.query(`UPDATE prospeccao_leads SET status='PRIMEIRO_CONTATO',primeiro_contato_at=COALESCE(primeiro_contato_at,NOW()),updated_at=NOW() WHERE id=$1`, [item.lead_id]);
        await finish.query(`INSERT INTO prospeccao_contatos(lead_id,canal,resultado,mensagem,realizado_por_nome) VALUES($1,'WHATSAPP','ENVIADO',$2,'Fila assistida V14')`, [item.lead_id, item.mensagem]);
        await finish.query('COMMIT');
      } catch (error) {
        try { await finish.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        finish.release();
      }
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (item?.id && outboundAccepted) {
        // O WAHA já aceitou a mensagem. Evita um segundo contato caso apenas
        // uma gravação auxiliar tenha falhado após o envio.
        await pool.query(`
          UPDATE prospeccao_envios SET status='ENVIADO',enviado_em=COALESCE(enviado_em,NOW()),
            waha_message_id=COALESCE(waha_message_id,$2),erro=$3,updated_at=NOW()
          WHERE id=$1
        `, [item.id, outboundMessageId || null, `Envio aceito; pós-processamento pendente: ${String(error.message || error).slice(0, 1200)}`]).catch(() => {});
      } else if (item?.id) {
        const attempt = Number(item.tentativas || 0) + 1;
        const retry = attempt < 3;
        await pool.query(`
          UPDATE prospeccao_envios SET status=$2,
            agendado_para=CASE WHEN $2='AGENDADO' THEN NOW()+INTERVAL '15 minutes' ELSE agendado_para END,
            erro=$3,updated_at=NOW()
          WHERE id=$1
        `, [item.id, retry ? 'AGENDADO' : 'FALHA', String(error.message || error).slice(0, 1500)]).catch(() => {});
      }
      console.error('[PROSPECÇÃO V14] Falha no envio assistido:', error.message);
    } finally {
      client.release();
      queueBusy = false;
    }
  }

  if (legacyWahaEnabled) {
    const timer = setInterval(() => processOutreachQueue().catch((error) => console.error('[PROSPECÇÃO V14]', error.message)), Math.max(60000, outreachIntervalSeconds * 1000));
    timer.unref?.();
    setTimeout(() => processOutreachQueue().catch(() => {}), 5000).unref?.();
  }

  return {
    classifyInboundReply,
    processOutreachQueue,
    config: { imageModel, imageQuality, imageDailyLimit, openAiConfigured: Boolean(openAiApiKey), prospectingSession, outreachEnabled },
  };
}

module.exports = { registerOperationsV14, classifyInboundReply, personalizeTemplate, nextBusinessTime };
