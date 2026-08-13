'use strict';

const { z } = require('zod');
const { hashPassword, normalizeUsername } = require('./lib/security');

const DEFAULT_ACTOR = 'compass/crawler-google-places';
const APIFY_API_BASE = 'https://api.apify.com/v2';
const ALLOWED_LIMITS = [10, 25, 50, 100];

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value, max = 5000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function domainFromWebsite(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function actorApiId(actorId) {
  return String(actorId || DEFAULT_ACTOR).trim().replace('/', '~');
}

function firstValue(source, keys, fallback = null) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function normalizeCategories(item) {
  const raw = firstValue(item, ['categories', 'categoryName', 'category', 'subTitle'], []);
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter(Boolean).slice(0, 50);
  return String(raw || '').split(/[,;|]/).map((value) => value.trim()).filter(Boolean).slice(0, 50);
}

function normalizeCoordinates(item) {
  const location = item.location || item.coordinates || {};
  const lat = Number(firstValue(location, ['lat', 'latitude'], firstValue(item, ['latitude', 'lat'])));
  const lng = Number(firstValue(location, ['lng', 'lon', 'longitude'], firstValue(item, ['longitude', 'lng', 'lon'])));
  return {
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

function scoreLead(lead) {
  let score = 0;
  if (lead.telefone_normalizado) score += 25;
  if (lead.website) score += 20;
  if (lead.email) score += 15;
  const segment = `${lead.categoria || ''} ${(lead.categorias || []).join(' ')}`.toLowerCase();
  if (/(facilities|limpeza|conserva|manuten|terceiriza|predial|condom)/.test(segment)) score += 15;
  if (Number(lead.quantidade_avaliacoes) >= 20) score += 10;
  if (Number(lead.avaliacao) >= 4) score += 10;
  if (String(lead.estado || '').toUpperCase() === 'SP') score += 5;
  return Math.max(0, Math.min(100, score));
}

function normalizeApifyLead(item) {
  const website = cleanText(firstValue(item, ['website', 'websiteUrl', 'companyWebsite']), 2000);
  const phone = cleanText(firstValue(item, ['phone', 'phoneNumber', 'companyPhoneNumber']), 100);
  const categories = normalizeCategories(item);
  const address = item.address || {};
  const coords = normalizeCoordinates(item);
  const lead = {
    empresa_nome: cleanText(firstValue(item, ['title', 'name', 'companyName', 'placeName'], 'Empresa sem nome'), 300),
    categoria: cleanText(firstValue(item, ['categoryName', 'category', 'subTitle'], categories[0]), 250),
    categorias: categories,
    telefone: phone,
    telefone_normalizado: digits(phone) || null,
    website,
    dominio: domainFromWebsite(website),
    email: cleanText(firstValue(item, ['email', 'companyEmail']), 320),
    endereco: cleanText(firstValue(item, ['address', 'street', 'fullAddress'], typeof address === 'string' ? address : address.full), 1000),
    bairro: cleanText(firstValue(item, ['neighborhood', 'district'], address.neighborhood), 200),
    cidade: cleanText(firstValue(item, ['city'], address.city), 200),
    estado: cleanText(firstValue(item, ['state', 'stateCode'], address.state), 100),
    cep: cleanText(firstValue(item, ['postalCode', 'zip'], address.postalCode), 30),
    pais: cleanText(firstValue(item, ['countryCode', 'country'], address.country), 100),
    google_place_id: cleanText(firstValue(item, ['placeId', 'place_id', 'googlePlaceId', 'cid']), 300),
    google_maps_url: cleanText(firstValue(item, ['url', 'googleMapsUrl', 'mapsUrl']), 2000),
    latitude: coords.latitude,
    longitude: coords.longitude,
    avaliacao: Number(firstValue(item, ['totalScore', 'rating', 'stars'])) || null,
    quantidade_avaliacoes: Number(firstValue(item, ['reviewsCount', 'reviewCount', 'totalReviews'])) || null,
    dados_brutos: item,
  };
  lead.score = scoreLead(lead);
  return lead;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function extractRunCost(runData, fallback = 0) {
  const candidates = [
    runData?.usageTotalUsd,
    runData?.usageUsd,
    runData?.usage?.USD,
    runData?.pricingInfo?.totalPriceUsd,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return Number(fallback) || 0;
}

async function apifyFetch(token, path, options = {}) {
  const response = await fetch(`${APIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || body?.raw || `Apify retornou HTTP ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function audit(pool, req, acao, entidade, entidadeId, detalhes = {}) {
  try {
    await pool.query(`
      INSERT INTO app_auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes)
      VALUES ($1, $2, $3, $4, $5, $6::JSONB)
    `, [req.user?.id || null, req.user?.nome || req.user?.usuario || null, acao, entidade || null, entidadeId ? String(entidadeId) : null, JSON.stringify(detalhes || {})]);
  } catch (error) {
    console.error('Falha ao registrar auditoria V6:', error.message);
  }
}

async function monthlyUsage(pool) {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(COALESCE(custo_real_usd, custo_estimado_usd)), 0)::NUMERIC AS usado_usd,
      COUNT(*)::INTEGER AS execucoes,
      COALESCE(SUM(quantidade_importada), 0)::INTEGER AS leads_importados
    FROM prospeccao_execucoes
    WHERE iniciado_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
  `);
  return result.rows[0];
}

async function importDataset(pool, execution, items) {
  let imported = 0;
  let duplicated = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const lead = normalizeApifyLead(item);
      if (!lead.empresa_nome) continue;
      const result = await client.query(`
        INSERT INTO prospeccao_leads (
          execucao_id, empresa_nome, categoria, categorias, telefone, telefone_normalizado,
          website, dominio, email, endereco, bairro, cidade, estado, cep, pais,
          google_place_id, google_maps_url, latitude, longitude, avaliacao,
          quantidade_avaliacoes, score, dados_brutos
        ) VALUES (
          $1, $2, $3, $4::JSONB, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23::JSONB
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        execution.id, lead.empresa_nome, lead.categoria, JSON.stringify(lead.categorias), lead.telefone,
        lead.telefone_normalizado, lead.website, lead.dominio, lead.email, lead.endereco, lead.bairro,
        lead.cidade, lead.estado, lead.cep, lead.pais, lead.google_place_id, lead.google_maps_url,
        lead.latitude, lead.longitude, lead.avaliacao, lead.quantidade_avaliacoes, lead.score,
        JSON.stringify(lead.dados_brutos || {}),
      ]);
      if (result.rowCount) imported += 1;
      else duplicated += 1;
    }
    await client.query('COMMIT');
    return { imported, duplicated };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function registerAdminV6({ app, pool, requireAdmin, currentUserName }) {
  const APIFY_API_TOKEN = String(process.env.APIFY_API_TOKEN || '').trim();
  const APIFY_ACTOR_ID = String(process.env.APIFY_DEFAULT_ACTOR_ID || DEFAULT_ACTOR).trim();

  // ------------------------------------------------------------
  // Usu√°rios
  // ------------------------------------------------------------
  app.get('/api/admin/usuarios', requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT u.id,u.usuario,u.nome,u.perfil,u.ativo,u.empresa_id,e.nome AS empresa_nome,
          u.deve_trocar_senha,u.ultimo_login_at,u.created_at,u.updated_at,u.telefone_whatsapp,u.alerta_entrevista,u.alerta_revisao
        FROM app_usuarios u LEFT JOIN empresas e ON e.id=u.empresa_id
        ORDER BY u.ativo DESC,u.perfil ASC,u.nome ASC
      `);
      res.json({ sucesso: true, usuarios: result.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/usuarios', requireAdmin, async (req, res, next) => {
    try {
      const schema = z.object({
        usuario: z.string().min(3).max(60),
        nome: z.string().trim().min(2).max(150),
        senha: z.string().min(8).max(200),
        perfil: z.enum(['ADMIN', 'RECRUTADOR']),
        empresa_id: z.preprocess((value) => (value === null || value === undefined || String(value).trim() === '' ? null : Number(value)), z.number().int().positive().nullable()).default(null),
        ativo: z.boolean().optional().default(true),
        telefone_whatsapp: z.string().trim().max(30).optional().default(''),
        alerta_entrevista: z.boolean().optional().default(true),
        alerta_revisao: z.boolean().optional().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inv√°lidos.' });
      const usuario = normalizeUsername(parsed.data.usuario);
      if (usuario.length < 3) return res.status(400).json({ sucesso: false, erro: 'Informe um usu√°rio v√°lido com pelo menos 3 caracteres.' });
      const senhaHash = await hashPassword(parsed.data.senha);
      const result = await pool.query(`
        INSERT INTO app_usuarios (usuario, senha_hash, nome, perfil, empresa_id, ativo, criado_por, telefone_whatsapp, alerta_entrevista, alerta_revisao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8,''), $9, $10)
        RETURNING id, usuario, nome, perfil, empresa_id, ativo, telefone_whatsapp, alerta_entrevista, alerta_revisao, created_at
      `, [usuario, senhaHash, parsed.data.nome, parsed.data.perfil, parsed.data.empresa_id, parsed.data.ativo, req.user.id, parsed.data.telefone_whatsapp.replace(/\D/g,''), parsed.data.alerta_entrevista, parsed.data.alerta_revisao]);
      await audit(pool, req, 'USUARIO_CRIADO', 'app_usuarios', result.rows[0].id, { usuario, perfil: parsed.data.perfil });
      res.status(201).json({ sucesso: true, mensagem: 'Usu√°rio criado com sucesso.', usuario: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.put('/api/admin/usuarios/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inv√°lido.' });
      const schema = z.object({
        nome: z.string().trim().min(2).max(150),
        perfil: z.enum(['ADMIN', 'RECRUTADOR']),
        empresa_id: z.preprocess((value) => (value === null || value === undefined || String(value).trim() === '' ? null : Number(value)), z.number().int().positive().nullable()).default(null),
        ativo: z.boolean(),
        telefone_whatsapp: z.string().trim().max(30).optional().default(''),
        alerta_entrevista: z.boolean().optional().default(true),
        alerta_revisao: z.boolean().optional().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inv√°lidos.' });
      if (id === Number(req.user.id) && !parsed.data.ativo) return res.status(400).json({ sucesso: false, erro: 'Voc√™ n√£o pode desativar o pr√≥prio acesso.' });
      const current = await pool.query('SELECT perfil, ativo FROM app_usuarios WHERE id = $1', [id]);
      if (!current.rowCount) return res.status(404).json({ sucesso: false, erro: 'Usu√°rio n√£o encontrado.' });
      if (current.rows[0].perfil === 'ADMIN' && current.rows[0].ativo && (parsed.data.perfil !== 'ADMIN' || !parsed.data.ativo)) {
        const admins = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM app_usuarios WHERE perfil = 'ADMIN' AND ativo IS TRUE`);
        if (Number(admins.rows[0].total) <= 1) return res.status(400).json({ sucesso: false, erro: '√â obrigat√≥rio manter pelo menos um administrador ativo.' });
      }
      const result = await pool.query(`
        UPDATE app_usuarios
        SET nome = $1, perfil = $2, empresa_id=$3, ativo = $4, telefone_whatsapp=NULLIF($5,''), alerta_entrevista=$6, alerta_revisao=$7, updated_at = NOW()
        WHERE id = $8
        RETURNING id, usuario, nome, perfil, empresa_id, ativo, telefone_whatsapp, alerta_entrevista, alerta_revisao, updated_at
      `, [parsed.data.nome, parsed.data.perfil, parsed.data.empresa_id, parsed.data.ativo, parsed.data.telefone_whatsapp.replace(/\D/g,''), parsed.data.alerta_entrevista, parsed.data.alerta_revisao, id]);
      await audit(pool, req, 'USUARIO_ATUALIZADO', 'app_usuarios', id, parsed.data);
      res.json({ sucesso: true, mensagem: 'Usu√°rio atualizado.', usuario: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/usuarios/:id/redefinir-senha', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const senha = String(req.body?.senha || '');
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inv√°lido.' });
      if (senha.length < 8) return res.status(400).json({ sucesso: false, erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
      const senhaHash = await hashPassword(senha);
      const result = await pool.query(`
        UPDATE app_usuarios
        SET senha_hash = $1, deve_trocar_senha = FALSE, updated_at = NOW()
        WHERE id = $2
        RETURNING id, usuario, nome
      `, [senhaHash, id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Usu√°rio n√£o encontrado.' });
      a€~º∂âûÀk∫wµÁMQ=I}%•ÙΩ…’πÕÄ∞ÅÏ4(ÄÄÄÄÄÄÄÄÄÅµï—°ΩêËÄùA=MPú∞4(ÄÄÄÄÄÄÄÄÄÅâΩë‰ËÅ)M=8πÕ—…•πù•ô‰°•π¡’–§∞4(ÄÄÄÄÄÄÄÅÙ§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å…’∏ÄÙÅ…ïÕ¡ΩπÕîπëÖ—ÑÅÒÅ…ïÕ¡ΩπÕîÏ4(ÄÄÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÄÄÅUAQÅ¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃ4(ÄÄÄÄÄÄÄÄÄÅMPÅÖ¡•ôÂ}…’π}•êÄÙÄêƒ∞ÅÖ¡•ôÂ}ëÖ—ÖÕï—}•êÄÙÄê»∞ÅÕ—Ö—’ÃÄÙÄêÃ∞Å…ï—Ω…πΩ}©ÕΩ∏ÄÙÄê–ËÈ)M=9∞Å’¡ëÖ—ïë}Ö–ÄÙÅ9=\†§4(ÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄê‘4(ÄÄÄÄÄÄÄÄÄÅIQUI9%9Ä®4(ÄÄÄÄÄÄÄÅÄ∞Åm…’∏π•ê∞Å…’∏πëïôÖ’±—Ö—ÖÕï—%êÅÒÅπ’±∞∞Å…’∏πÕ—Ö—’ÃÅÒÄùIU99%9ú∞Å)M=8πÕ—…•πù•ô‰°…’∏§∞Åë…Öô–π…Ω›Õl¡tπ•ët§Ï4(ÄÄÄÄÄÄÄÅÖ›Ö•–ÅÖ’ë•–°¡ΩΩ∞∞Å…ïƒ∞ÄùAI=MA=}%9%%ú∞Äù¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃú∞Åë…Öô–π…Ω›Õl¡tπ•ê∞ÅÏÅ—ï…µºËÅ¡Ö…ÕïêπëÖ—Ñπ—ï…µΩ}â’ÕçÑ∞Å±ΩçÖ±•ÈÖçÖºËÅ¡Ö…ÕïêπëÖ—Ñπ±ΩçÖ±•ÈÖçÖº∞Å≈’Öπ—•ëÖëîËÅ≈’Öπ—•—‰∞ÅïÕ—•µÖëºËÅïÕ—•µÖ—ïêÅÙ§Ï4(ÄÄÄÄÄÄÄÅ…ïÃπÕ—Ö—’Ã†»¿ƒ§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞ÅµïπÕÖùï¥ËÄù	’ÕçÑÅ•π•ç•ÖëÑÅπÑÅ¡•ô‰∏ú∞Åï·ïç’çÖºËÅ…ïÕ’±–π…Ω›Õl¡tÅÙ§Ï4(ÄÄÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏ4(ÄÄÄÄÄÄÄÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°ÅUAQÅ¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃÅMPÅÕ—Ö—’ÃÄÙÄù%1ú∞Åï……ºÄÙÄêƒ∞Å’¡ëÖ—ïë}Ö–ÄÙÅ9=\†§∞ÅçΩπç±’•ëΩ}Ö–ÄÙÅ9=\†§Å]!IÅ•êÄÙÄê…Ä∞Åmï……Ω»πµïÕÕÖùî∞Åë…Öô–π…Ω›Õl¡tπ•ët§Ï4(ÄÄÄÄÄÄÄÅ—°…Ω‹Åï……Ω»Ï4(ÄÄÄÄÄÅÙ4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿π¡ΩÕ–†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩï·ïç’çΩïÃºÈ•êΩÕ•πç…Ωπ•ÈÖ»ú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅ•òÄ†ÖA%e}A%}Q=-8§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†‘¿Ã§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄùA%e}A%}Q=-8ÅªçºÅçΩπô•ù’…Öëº∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å•êÄÙÅ¡Ö…Õï%ê°…ïƒπ¡Ö…ÖµÃπ•ê§Ï4(ÄÄÄÄÄÅ•òÄ†Ö•ê§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿¿§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù%Å•π€Ö±•ëº∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å±ΩçÖ±IïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰†ùM1PÄ®ÅI=4Å¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃÅ]!IÅ•êÄÙÄêƒú∞Åm•ët§Ï4(ÄÄÄÄÄÅ•òÄ†Ö±ΩçÖ±IïÕ’±–π…Ω›Ω’π–§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿–§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù·ïç◊üçºÅªçºÅïπçΩπ—…ÖëÑ∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Åï·ïç’—•Ω∏ÄÙÅ±ΩçÖ±IïÕ’±–π…Ω›Õl¡tÏ4(ÄÄÄÄÄÅ•òÄ†Öï·ïç’—•Ω∏πÖ¡•ôÂ}…’π}•ê§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿¿§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù·ïç◊üçºÅÕï¥Å%ÅëÑÅ¡•ô‰∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ¡ΩπÕîÄÙÅÖ›Ö•–ÅÖ¡•ôÂï—ç†°A%e}A%}Q=-8∞ÅÄΩÖç—Ω»µ…’πÃºëÌïπçΩëïUI%Ωµ¡Ωπïπ–°ï·ïç’—•Ω∏πÖ¡•ôÂ}…’π}•ê•ıÄ∞ÅÏÅµï—°ΩêËÄùPúÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…’∏ÄÙÅ…ïÕ¡ΩπÕîπëÖ—ÑÅÒÅ…ïÕ¡ΩπÕîÏ4(ÄÄÄÄÄÅçΩπÕ–ÅÕ—Ö—’ÃÄÙÅ…’∏πÕ—Ö—’ÃÅÒÅï·ïç’—•Ω∏πÕ—Ö—’ÃÏ4(ÄÄÄÄÄÅ±ï–Å•µ¡Ω…—ïêÄÙÅ9’µâï»°ï·ïç’—•Ω∏π≈’Öπ—•ëÖëï}•µ¡Ω…—ÖëÑÅÒÄ¿§Ï4(ÄÄÄÄÄÅ±ï–Åë’¡±•çÖ—ïêÄÙÅ9’µâï»°ï·ïç’—•Ω∏π≈’Öπ—•ëÖëï}ë’¡±•çÖëÑÅÒÄ¿§Ï4(ÄÄÄÄÄÅ±ï–ÅôΩ’πêÄÙÅ9’µâï»°ï·ïç’—•Ω∏π≈’Öπ—•ëÖëï}ïπçΩπ—…ÖëÑÅÒÄ¿§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅëÖ—ÖÕï—%êÄÙÅ…’∏πëïôÖ’±—Ö—ÖÕï—%êÅÒÅï·ïç’—•Ω∏πÖ¡•ôÂ}ëÖ—ÖÕï—}•êÏ4(ÄÄÄÄÄÅ•òÄ°Õ—Ö—’ÃÄÙÙÙÄùMUúÄòòÅëÖ—ÖÕï—%êÄòòÄÖï·ïç’—•Ω∏πçΩπç±’•ëΩ}Ö–§ÅÏ4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅëÖ—ÖÕï—IïÕ¡ΩπÕîÄÙÅÖ›Ö•–ÅÖ¡•ôÂï—ç†°A%e}A%}Q=-8∞ÅÄΩëÖ—ÖÕï—ÃºëÌïπçΩëïUI%Ωµ¡Ωπïπ–°ëÖ—ÖÕï—%ê•ÙΩ•—ïµÃ˝ç±ïÖ∏ı—…’îô±•µ•–ÙëÌ9’µâï»°ï·ïç’—•Ω∏π≈’Öπ—•ëÖëï}ÕΩ±•ç•—ÖëÑÅÒÄƒ¿¿•ıÄ∞ÅÏÅµï—°ΩêËÄùPúÅÙ§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å•—ïµÃÄÙÅ……Ö‰π•Õ……Ö‰°ëÖ—ÖÕï—IïÕ¡ΩπÕî§Ä¸ÅëÖ—ÖÕï—IïÕ¡ΩπÕîÄËÄ°ëÖ—ÖÕï—IïÕ¡ΩπÕîπëÖ—Ñ¸π•—ïµÃÅÒÅëÖ—ÖÕï—IïÕ¡ΩπÕîπ•—ïµÃÅÒÅmt§Ï4(ÄÄÄÄÄÄÄÅôΩ’πêÄÙÅ•—ïµÃπ±ïπù—†Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å•µ¡Ω…—ïëIïÕ’±–ÄÙÅÖ›Ö•–Å•µ¡Ω…—Ö—ÖÕï–°¡ΩΩ∞∞Åï·ïç’—•Ω∏∞Å•—ïµÃ§Ï4(ÄÄÄÄÄÄÄÅ•µ¡Ω…—ïêÄÙÅ•µ¡Ω…—ïëIïÕ’±–π•µ¡Ω…—ïêÏ4(ÄÄÄÄÄÄÄÅë’¡±•çÖ—ïêÄÙÅ•µ¡Ω…—ïëIïÕ’±–πë’¡±•çÖ—ïêÏ4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅçΩπÕ–ÅÖç—’Ö±ΩÕ–ÄÙÅï·—…Öç—I’πΩÕ–°…’∏∞Åï·ïç’—•Ω∏πç’Õ—Ω}ïÕ—•µÖëΩ}’Õê§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅUAQÅ¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃ4(ÄÄÄÄÄÄÄÅMPÅÖ¡•ôÂ}ëÖ—ÖÕï—}•êÄÙÄêƒ∞4(ÄÄÄÄÄÄÄÄÄÄÄÅÕ—Ö—’ÃÄÙÄê»∞4(ÄÄÄÄÄÄÄÄÄÄÄÅç’Õ—Ω}…ïÖ±}’ÕêÄÙÄêÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ≈’Öπ—•ëÖëï}ïπçΩπ—…ÖëÑÄÙÄê–∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ≈’Öπ—•ëÖëï}•µ¡Ω…—ÖëÑÄÙÄê‘∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ≈’Öπ—•ëÖëï}ë’¡±•çÖëÑÄÙÄêÿ∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ…ï—Ω…πΩ}©ÕΩ∏ÄÙÄê‹ËÈ)M=9∞4(ÄÄÄÄÄÄÄÄÄÄÄÅï……ºÄÙÅM4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!8Äê»ËÈYI!HÅ%8Ä†ù%1ú∞ù	=IQú∞ùQ%5µ=UPú§4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅQ!8Å=1M†ê‡ËÈQaP∞Åï……º§4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÅ1MÅ9U104(ÄÄÄÄÄÄÄÄÄÄÄÅ9∞4(ÄÄÄÄÄÄÄÄÄÄÄÅçΩπç±’•ëΩ}Ö–ÄÙÅMÅ]!8Äê»ËÈYI!HÅ%8Ä†ùMUú∞ù%1ú∞ù	=IQú∞ùQ%5µ=UPú§ÅQ!8Å=1M°çΩπç±’•ëΩ}Ö–∞Å9=\†§§Å1MÅçΩπç±’•ëΩ}Ö–Å9∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ’¡ëÖ—ïë}Ö–ÄÙÅ9=\†§4(ÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄê‰4(ÄÄÄÄÄÄÄÅIQUI9%9Ä®4(ÄÄÄÄÄÅÄ∞ÅmëÖ—ÖÕï—%êÅÒÅπ’±∞∞ÅÕ—Ö—’Ã∞ÅÖç—’Ö±ΩÕ–∞ÅôΩ’πê∞Å•µ¡Ω…—ïê∞Åë’¡±•çÖ—ïê∞Å)M=8πÕ—…•πù•ô‰°…’∏§∞Å…’∏πÕ—Ö—’Õ5ïÕÕÖùîÅÒÅπ’±∞∞Å•ët§Ï4(ÄÄÄÄÄÅ…ïÃπ©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞ÅµïπÕÖùï¥ËÅÕ—Ö—’ÃÄÙÙÙÄùMUúÄ¸ÄùIïÕ’±—ÖëΩÃÅÕ•πç…Ωπ•ÈÖëΩÃÅîÅ•µ¡Ω…—ÖëΩÃ∏úÄËÅÅ·ïç◊üçºÅÖ—’Ö±•ÈÖëÑËÄëÌÕ—Ö—’ÕÙπÄ∞Åï·ïç’çÖºËÅ…ïÕ’±–π…Ω›Õl¡tÅÙ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿π¡ΩÕ–†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩï·ïç’çΩïÃºÈ•êΩÖâΩ…—Ö»ú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅ•òÄ†ÖA%e}A%}Q=-8§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†‘¿Ã§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄùA%e}A%}Q=-8ÅªçºÅçΩπô•ù’…Öëº∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å•êÄÙÅ¡Ö…Õï%ê°…ïƒπ¡Ö…ÖµÃπ•ê§Ï4(ÄÄÄÄÄÅçΩπÕ–Å±ΩçÖ±IïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰†ùM1PÄ®ÅI=4Å¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃÅ]!IÅ•êÄÙÄêƒú∞Åm•ët§Ï4(ÄÄÄÄÄÅ•òÄ†Ö±ΩçÖ±IïÕ’±–π…Ω›Ω’π–§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿–§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù·ïç◊üçºÅªçºÅïπçΩπ—…ÖëÑ∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Åï·ïç’—•Ω∏ÄÙÅ±ΩçÖ±IïÕ’±–π…Ω›Õl¡tÏ4(ÄÄÄÄÄÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°ÅUAQÅ¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃÅMPÅÕ—Ö—’ÃÄÙÄù	=IQ%9ú∞Å’¡ëÖ—ïë}Ö–ÄÙÅ9=\†§Å]!IÅ•êÄÙÄê≈Ä∞Åm•ët§Ï4(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡•ôÂï—ç†°A%e}A%}Q=-8∞ÅÄΩÖç—Ω»µ…’πÃºëÌïπçΩëïUI%Ωµ¡Ωπïπ–°ï·ïç’—•Ω∏πÖ¡•ôÂ}…’π}•ê•ÙΩÖâΩ…—Ä∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÄùÌÙúÅÙ§Ï4(ÄÄÄÄÄÅÖ›Ö•–ÅÖ’ë•–°¡ΩΩ∞∞Å…ïƒ∞ÄùAI=MA=}	=IQú∞Äù¡…ΩÕ¡ïççÖΩ}ï·ïç’çΩïÃú∞Å•ê∞ÅÌÙ§Ï4(ÄÄÄÄÄÅ…ïÃπ©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞ÅµïπÕÖùï¥ËÄùMΩ±•ç•—áüçºÅëîÅ•π—ï……’√üçºÅïπŸ•ÖëÑÉÄÅ¡•ô‰∏úÅÙ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿πùï–†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩ±ïÖëÃú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅçΩπÕ–ÅÕ—Ö—’ÃÄÙÅM—…•πú°…ïƒπ≈’ï…‰πÕ—Ö—’ÃÅÒÄùQ==Lú§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅƒÄÙÅM—…•πú°…ïƒπ≈’ï…‰πƒÅÒÄúú§π—…•¥†§Ï4(ÄÄÄÄÄÅçΩπÕ–Å±•µ•–ÄÙÅ5Ö—†πµ•∏°5Ö—†πµÖ‡°9’µâï»°…ïƒπ≈’ï…‰π±•µ•–ÅÒÄÃ¿¿§∞Äƒ§∞Äƒ¿¿¿§Ï4(ÄÄÄÄÄÅçΩπÕ–Å¡Ö…ÖµÃÄÙÅmtÏ4(ÄÄÄÄÄÅçΩπÕ–Åô•±—ï…ÃÄÙÅmtÏ4(ÄÄÄÄÄÅ•òÄ°Õ—Ö—’ÃÄÑÙÙÄùQ==Lú§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°Õ—Ö—’Ã§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞πÕ—Ö—’ÃÄÙÄêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°ƒ§ÅÏ4(ÄÄÄÄÄÄÄÅ¡Ö…ÖµÃπ¡’Õ†°ÄîëÌ≈ÙïÄ§Ï4(ÄÄÄÄÄÄÄÅô•±—ï…Ãπ¡’Õ†°Ä°∞πïµ¡…ïÕÖ}πΩµîÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ÙÅ=HÅ∞πç•ëÖëîÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ÙÅ=HÅ∞π—ï±ïôΩπîÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ÙÅ=HÅ∞π›ïâÕ•—îÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ÙÅ=HÅ∞πçÖ—ïùΩ…•ÑÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°Ù•Ä§Ï4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅçΩπÕ–ÅçÖ—ïùΩ…•ÑÄÙÅM—…•πú°…ïƒπ≈’ï…‰πçÖ—ïùΩ…•ÑÅÒÄúú§π—…•¥†§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅïÕ—ÖëºÄÙÅM—…•πú°…ïƒπ≈’ï…‰πïÕ—ÖëºÅÒÄúú§π—…•¥†§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–Åç•ëÖëîÄÙÅM—…•πú°…ïƒπ≈’ï…‰πç•ëÖëîÅÒÄúú§π—…•¥†§Ï4(ÄÄÄÄÄÅçΩπÕ–Å¡…•Ω…•ëÖëîÄÙÅM—…•πú°…ïƒπ≈’ï…‰π¡…•Ω…•ëÖëîÅÒÄúú§π—…•¥†§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ¡ΩÕ—ÑÄÙÅM—…•πú°…ïƒπ≈’ï…‰π…ïÕ¡ΩÕ—ÑÅÒÄúú§π—…•¥†§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅçΩπ—Ö—ºÄÙÅM—…•πú°…ïƒπ≈’ï…‰πçΩπ—Ö—ºÅÒÄúú§π—…•¥†§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–Å’±—•µΩΩπ—Ö—ºÄÙÅM—…•πú°…ïƒπ≈’ï…‰π’±—•µΩ}çΩπ—Ö—ºÅÒÄúú§π—…•¥†§π—ΩU¡¡ï…ÖÕî†§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ¡ΩπÕÖŸï∞ÄÙÅ¡Ö…Õï%ê°…ïƒπ≈’ï…‰π…ïÕ¡ΩπÕÖŸï∞§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅÕçΩ…ï5•∏ÄÙÅ9’µâï»°…ïƒπ≈’ï…‰πÕçΩ…ï}µ•∏§Ï4(ÄÄÄÄÄÅ•òÄ°çÖ—ïùΩ…•Ñ§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°ÄîëÌçÖ—ïùΩ…•ÖÙïÄ§ÏÅô•±—ï…Ãπ¡’Õ†°Ä°∞πçÖ—ïùΩ…•ÑÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ÙÅ=HÅ∞πçÖ—ïùΩ…•ÖÃËÈQaPÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°Ù•Ä§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°ïÕ—Öëº§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°ïÕ—Öëº§ÏÅô•±—ï…Ãπ¡’Õ†°ÅUAAH°=1M°∞πïÕ—Öëº∞úú§§ÙêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°ç•ëÖëî§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°ÄîëÌç•ëÖëïÙïÄ§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞πç•ëÖëîÅ%1%-ÄêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°lù	%aú∞ù5%ú∞ù1Qùtπ•πç±’ëïÃ°¡…•Ω…•ëÖëî§§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°¡…•Ω…•ëÖëî§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞π¡…•Ω…•ëÖëîÙêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°…ïÕ¡ΩπÕÖŸï∞§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°…ïÕ¡ΩπÕÖŸï∞§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞π…ïÕ¡ΩπÕÖŸï±}•êÙêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°9’µâï»π•Õ•π•—î°ÕçΩ…ï5•∏§ÄòòÅÕçΩ…ï5•∏Ä¯Ä¿§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°5Ö—†πµ•∏°ÕçΩ…ï5•∏∞Äƒ¿¿§§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞πÕçΩ…îÄ¯ÙÄêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°lù!U59ú∞ùUQ=5Q%ú∞ùMMQI<ú∞ùYi%ùtπ•πç±’ëïÃ°…ïÕ¡ΩÕ—Ñ§§ÅÏÅ¡Ö…ÖµÃπ¡’Õ†°…ïÕ¡ΩÕ—Ñ§ÏÅô•±—ï…Ãπ¡’Õ†°Å∞π…ïÕ¡ΩÕ—Ö}—•¡ºÙêëÌ¡Ö…ÖµÃπ±ïπù—°ıÄ§ÏÅÙ4(ÄÄÄÄÄÅ•òÄ°çΩπ—Ö—ºÄÙÙÙÄù=5}]!QMA@ú§Åô•±—ï…Ãπ¡’Õ†°Å=1M°∞π—ï±ïôΩπï}πΩ…µÖ±•ÈÖëº±∞π—ï±ïôΩπî§Å%LÅ9=PÅ9U11Ä§Ï4(ÄÄÄÄÄÅ•òÄ°çΩπ—Ö—ºÄÙÙÙÄùM5}]!QMA@ú§Åô•±—ï…Ãπ¡’Õ†°Å=1M°∞π—ï±ïôΩπï}πΩ…µÖ±•ÈÖëº±∞π—ï±ïôΩπî§Å%LÅ9U11Ä§Ï4(ÄÄÄÄÄÅ•òÄ°çΩπ—Ö—ºÄÙÙÙÄùUQ=I%i<ú§Åô•±—ï…Ãπ¡’Õ†°Å∞πçΩπ—Ö—Ω}Ö’—Ω…•ÈÖëºÅ%LÅQIUÄ§Ï4(ÄÄÄÄÄÅ•òÄ°çΩπ—Ö—ºÄÙÙÙÄù9=}UQ=I%i<ú§Åô•±—ï…Ãπ¡’Õ†°Å∞πçΩπ—Ö—Ω}Ö’—Ω…•ÈÖëºÅ%LÅ1MÄ§Ï4(ÄÄÄÄÄÅ•òÄ°M—…•πú°…ïƒπ≈’ï…‰ππÖΩ}çΩπ—Ö—Ö»ÅÒÄúú§π—Ω1Ω›ï…ÖÕî†§ÄÙÙÙÄù—…’îú§Åô•±—ï…Ãπ¡’Õ†°Å∞ππÖΩ}çΩπ—Ö—Ö»Å%LÅQIUÄ§Ï4(ÄÄÄÄÄÅ•òÄ°M—…•πú°…ïƒπ≈’ï…‰ππÖΩ}çΩπ—Ö—Ö»ÅÒÄúú§π—Ω1Ω›ï…ÖÕî†§ÄÙÙÙÄùôÖ±Õîú§Åô•±—ï…Ãπ¡’Õ†°Å∞ππÖΩ}çΩπ—Ö—Ö»Å%LÅ1MÄ§Ï4(ÄÄÄÄÄÅ•òÄ°’±—•µΩΩπ—Ö—ºÄÙÙÙÄùM5}=9QQ<ú§Åô•±—ï…Ãπ¡’Õ†°Å9=PÅa%MQL°M1PÄƒÅI=4Å¡…ΩÕ¡ïççÖΩ}çΩπ—Ö—ΩÃÅ¡åÅ]!IÅ¡åπ±ïÖë}•êı∞π•ê•Ä§Ï4(ÄÄÄÄÄÅ•òÄ°’±—•µΩΩπ—Ö—ºÄÙÙÙÄú›ú§Åô•±—ï…Ãπ¡’Õ†°Åa%MQL°M1PÄƒÅI=4Å¡…ΩÕ¡ïççÖΩ}çΩπ—Ö—ΩÃÅ¡åÅ]!IÅ¡åπ±ïÖë}•êı∞π•êÅ9Å¡åπç…ïÖ—ïë}Ö–¯ı9=\†§µ%9QIY0Äú‹ÅëÖÂÃú•Ä§Ï4(ÄÄÄÄÄÅ•òÄ°’±—•µΩΩπ—Ö—ºÄÙÙÙÄúÃ¡ú§Åô•±—ï…Ãπ¡’Õ†°Åa%MQL°M1PÄƒÅI=4Å¡…ΩÕ¡ïççÖΩ}çΩπ—Ö—ΩÃÅ¡åÅ]!IÅ¡åπ±ïÖë}•êı∞π•êÅ9Å¡åπç…ïÖ—ïë}Ö–¯ı9=\†§µ%9QIY0ÄúÃ¿ÅëÖÂÃú•Ä§Ï4(ÄÄÄÄÄÅçΩπÕ–Å›°ï…îÄÙÅô•±—ï…Ãπ±ïπù—†Ä¸ÅÅ]!IÄëÌô•±—ï…Ãπ©Ω•∏†úÅ9Äú•ıÄÄËÄúúÏ4(ÄÄÄÄÄÅçΩπÕ–Åô•±—ï…AÖ…ÖµÃÄÙÅl∏∏π¡Ö…ÖµÕtÏ4(ÄÄÄÄÄÅ¡Ö…ÖµÃπ¡’Õ†°±•µ•–§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅM1PÅ∞∏®∞Å‘ππΩµîÅLÅ…ïÕ¡ΩπÕÖŸï±}πΩµî∞Å=1M°çºπï—Ö¡Ñ∞ù9=Y=}1ú§ÅLÅç…µ}ï—Ö¡Ñ∞(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ°M1PÅ=U9P†®§ËÈ%9QHÅI=4Å¡…ΩÕ¡ïççÖΩ}πΩ—ÖÃÅ∏Å]!IÅ∏π±ïÖë}•êÄÙÅ∞π•ê§ÅLÅ≈’Öπ—•ëÖëï}πΩ—ÖÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ°M1PÅ5`°ç…ïÖ—ïë}Ö–§ÅI=4Å¡…ΩÕ¡ïççÖΩ}çΩπ—Ö—ΩÃÅåÅ]!IÅåπ±ïÖë}•êÄÙÅ∞π•ê§ÅLÅ’±—•µΩ}çΩπ—Ö—Ω}Ö–4(ÄÄÄÄÄÄÄÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃÅ∞(ÄÄÄÄÄÄÄÅ1PÅ)=%8ÅÖ¡¡}’Õ’Ö…•ΩÃÅ‘Å=8Å‘π•êÄÙÅ∞π…ïÕ¡ΩπÕÖŸï±}•ê(ÄÄÄÄÄÄÄÅ1PÅ)=%8Å1QI0Ä°M1PÅï—Ö¡ÑÅI=4Åç…µ}Ω¡Ω…—’π•ëÖëïÃÅ]!IÅ¡…ΩÕ¡ïççÖΩ}±ïÖë}•êı∞π•êÅ=IHÅ	dÅ•êÅMÅ1%5%PÄƒ§ÅçºÅ=8ÅQIU(ÄÄÄÄÄÄÄÄëÌ›°ï…ïÙ4(ÄÄÄÄÄÄÄÅ=IHÅ	dÅ∞ππÖΩ}çΩπ—Ö—Ö»ÅM∞Å∞πÕçΩ…îÅM∞Å∞πç…ïÖ—ïë}Ö–ÅM4(ÄÄÄÄÄÄÄÅ1%5%PÄêëÌ¡Ö…ÖµÃπ±ïπù—°Ù4(ÄÄÄÄÄÅÄ∞Å¡Ö…ÖµÃ§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅÕ’µµÖ…‰ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅM1PÅ=U9P†®§ËÈ%9QHÅLÅ—Ω—Ö∞∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ=U9P†®§Å%1QHÄ°]!IÅÕ—Ö—’ÃÄÙÄù9=Y<ú§ËÈ%9QHÅLÅπΩŸΩÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ=U9P†®§Å%1QHÄ°]!IÅÕ—Ö—’ÃÄÙÄùAI=Y=}=9QQ<ú§ËÈ%9QHÅLÅÖ¡…ΩŸÖëΩÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ=U9P†®§Å%1QHÄ°]!IÅÕ—Ö—’ÃÅ%8Ä†ùIMA=9Tú∞ùIU9%<ú∞ùAI=A=MQú§§ËÈ%9QHÅLÅΩ¡Ω…—’π•ëÖëïÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ=U9P†®§Å%1QHÄ°]!IÅÕ—Ö—’ÃÄÙÄù1%9Qú§ËÈ%9QHÅLÅç±•ïπ—ïÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ=U9P†®§Å%1QHÄ°]!IÅπÖΩ}çΩπ—Ö—Ö»Å%LÅQIU§ËÈ%9QHÅLÅπÖΩ}çΩπ—Ö—Ö»4(ÄÄÄÄÄÄÄÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃÅ∞4(ÄÄÄÄÄÄÄÄëÌ›°ï…ïÙ4(ÄÄÄÄÄÅÄ∞Åô•±—ï…AÖ…ÖµÃ§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅmçÖ—ïùΩ…•ïÃ∞ÅÕ—Ö—ïÃ∞Åç•—•ïÃ∞Å’Õï…ÕtÄÙÅÖ›Ö•–ÅA…Ωµ•ÕîπÖ±∞°l4(ÄÄÄÄÄÄÄÅ¡ΩΩ∞π≈’ï…‰°ÅM1PÅ%MQ%9PÅçÖ—ïùΩ…•ÑÅLÅŸÖ±Ω»ÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃÅ]!IÅçÖ—ïùΩ…•ÑÅ%LÅ9=PÅ9U10Å9Å	QI%4°çÖ—ïùΩ…•Ñ§¯úúÅ=IHÅ	dÅŸÖ±Ω»Å1%5%PÄƒ‘¡Ä§∞4(ÄÄÄÄÄÄÄÅ¡ΩΩ∞π≈’ï…‰°ÅM1PÅ%MQ%9PÅUAAH°ïÕ—Öëº§ÅLÅŸÖ±Ω»ÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃÅ]!IÅïÕ—ÖëºÅ%LÅ9=PÅ9U10Å9Å	QI%4°ïÕ—Öëº§¯úúÅ=IHÅ	dÅŸÖ±Ω…Ä§∞4(ÄÄÄÄÄÄÄÅ¡ΩΩ∞π≈’ï…‰°ÅM1PÅ%MQ%9PÅç•ëÖëîÅLÅŸÖ±Ω»ÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃÅ]!IÅç•ëÖëîÅ%LÅ9=PÅ9U10Å9Å	QI%4°ç•ëÖëî§¯úúÅ=IHÅ	dÅŸÖ±Ω»Å1%5%PÄÃ¿¡Ä§∞4(ÄÄÄÄÄÄÄÅ¡ΩΩ∞π≈’ï…‰°ÅM1PÅ•ê±πΩµîÅI=4ÅÖ¡¡}’Õ’Ö…•ΩÃÅ]!IÅÖ—•ŸºÅ%LÅQIUÅ=IHÅ	dÅπΩµïÄ§∞4(ÄÄÄÄÄÅt§Ï4(ÄÄÄÄÄÅ…ïÃπ©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞Å±ïÖëÃËÅ…ïÕ’±–π…Ω›Ã∞Å…ïÕ’µºËÅÕ’µµÖ…‰π…Ω›Õl¡t∞Åô•±—…ΩÃËÅÏ4(ÄÄÄÄÄÄÄÅçÖ—ïùΩ…•ÖÃËÅçÖ—ïùΩ…•ïÃπ…Ω›ÃπµÖ¿†°…Ω‹§ÄÙ¯Å…Ω‹πŸÖ±Ω»§∞ÅïÕ—ÖëΩÃËÅÕ—Ö—ïÃπ…Ω›ÃπµÖ¿†°…Ω‹§ÄÙ¯Å…Ω‹πŸÖ±Ω»§∞4(ÄÄÄÄÄÄÄÅç•ëÖëïÃËÅç•—•ïÃπ…Ω›ÃπµÖ¿†°…Ω‹§ÄÙ¯Å…Ω‹πŸÖ±Ω»§∞Å…ïÕ¡ΩπÕÖŸï•ÃËÅ’Õï…Ãπ…Ω›Ã∞4(ÄÄÄÄÄÅÙÅÙ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿π¡Ö—ç††úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩ±ïÖëÃºÈ•êú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅçΩπÕ–Å•êÄÙÅ¡Ö…Õï%ê°…ïƒπ¡Ö…ÖµÃπ•ê§Ï4(ÄÄÄÄÄÅ•òÄ†Ö•ê§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿¿§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù%Å•π€Ö±•ëº∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅÕç°ïµÑÄÙÅËπΩâ©ïç–°Ï4(ÄÄÄÄÄÄÄÅÕ—Ö—’ÃËÅËπïπ’¥°lù9=Y<ú∞ù5}91%Mú∞ùAI=Y=}=9QQ<ú∞ùAI%5%I=}=9QQ<ú∞ùIMA=9Tú∞ùIU9%<ú∞ùAI=A=MQú∞ù1%9Qú∞ùMIQ<ú∞ùM5}%9QIMMú∞ù=9QQ=}%9Y1%<ú∞ù9=}=9QQHùt§∞4(ÄÄÄÄÄÄÄÅ¡…•Ω…•ëÖëîËÅËπïπ’¥°lù	%aú∞ù5%ú∞ù1Qùt§πëïôÖ’±–†ù5%ú§∞4(ÄÄÄÄÄÄÄÅπÖΩ}çΩπ—Ö—Ö»ËÅËπâΩΩ±ïÖ∏†§πëïôÖ’±–°ôÖ±Õî§∞4(ÄÄÄÄÄÄÄÅµΩ—•ŸΩ}ëïÕçÖ…—îËÅËπÕ—…•πú†§πµÖ‡†ƒ¿¿¿§ππ’±±Öâ±î†§πΩ¡—•ΩπÖ∞†§∞4(ÄÄÄÄÄÄÄÅΩâÕï…ŸÖçÖºËÅËπÕ—…•πú†§πµÖ‡†‘¿¿¿§ππ’±±Öâ±î†§πΩ¡—•ΩπÖ∞†§∞4(ÄÄÄÄÄÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å¡Ö…ÕïêÄÙÅÕç°ïµÑπÕÖôïAÖ…Õî°…ïƒπâΩë‰§Ï4(ÄÄÄÄÄÅ•òÄ†Ö¡Ö…ÕïêπÕ’ççïÕÃ§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿¿§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÅ¡Ö…Õïêπï……Ω»π•ÕÕ’ïÕl¡t¸πµïÕÕÖùîÅÒÄùÖëΩÃÅ•π€Ö±•ëΩÃ∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅëÖ—ÑÄÙÅ¡Ö…ÕïêπëÖ—ÑÏ4(ÄÄÄÄÄÅçΩπÕ–Åô•πÖ±M—Ö—’ÃÄÙÅëÖ—ÑππÖΩ}çΩπ—Ö—Ö»Ä¸Äù9=}=9QQHúÄËÅëÖ—ÑπÕ—Ö—’ÃÏ4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅUAQÅ¡…ΩÕ¡ïççÖΩ}±ïÖëÃ4(ÄÄÄÄÄÄÄÅMPÅÕ—Ö—’ÃÄÙÄêƒ∞Å¡…•Ω…•ëÖëîÄÙÄê»∞ÅπÖΩ}çΩπ—Ö—Ö»ÄÙÄêÃ∞4(ÄÄÄÄÄÄÄÄÄÄÄÅµΩ—•ŸΩ}ëïÕçÖ…—îÄÙÄê–∞ÅΩâÕï…ŸÖçÖºÄÙÄê‘∞4(ÄÄÄÄÄÄÄÄÄÄÄÅ…ïÕ¡ΩπÕÖŸï±}•êÄÙÅ=1M°…ïÕ¡ΩπÕÖŸï±}•ê∞Äêÿ§∞Å’¡ëÖ—ïë}Ö–ÄÙÅ9=\†§4(ÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄê‹4(ÄÄÄÄÄÄÄÅIQUI9%9Ä®4(ÄÄÄÄÄÅÄ∞Åmô•πÖ±M—Ö—’Ã∞ÅëÖ—Ñπ¡…•Ω…•ëÖëî∞ÅëÖ—ÑππÖΩ}çΩπ—Ö—Ö»∞Åç±ïÖπQï·–°ëÖ—ÑπµΩ—•ŸΩ}ëïÕçÖ…—î∞Äƒ¿¿¿§∞Åç±ïÖπQï·–°ëÖ—ÑπΩâÕï…ŸÖçÖº∞Ä‘¿¿¿§∞Å…ïƒπ’Õï»π•ê∞Å•ët§Ï4(ÄÄÄÄÄÅ•òÄ†Ö…ïÕ’±–π…Ω›Ω’π–§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿–§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù1ïÖêÅªçºÅïπçΩπ—…Öëº∏úÅÙ§Ï4(ÄÄÄÄÄÅÖ›Ö•–ÅÖ’ë•–°¡ΩΩ∞∞Å…ïƒ∞Äù1}AI=MA=}QU1%i<ú∞Äù¡…ΩÕ¡ïççÖΩ}±ïÖëÃú∞Å•ê∞ÅÏÅÕ—Ö—’ÃËÅô•πÖ±M—Ö—’Ã∞Å¡…•Ω…•ëÖëîËÅëÖ—Ñπ¡…•Ω…•ëÖëî∞ÅπÖΩ}çΩπ—Ö—Ö»ËÅëÖ—ÑππÖΩ}çΩπ—Ö—Ö»ÅÙ§Ï4(ÄÄÄÄÄÅ…ïÃπ©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞ÅµïπÕÖùï¥ËÄù1ïÖêÅÖ—’Ö±•ÈÖëº∏ú∞Å±ïÖêËÅ…ïÕ’±–π…Ω›Õl¡tÅÙ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿π¡ΩÕ–†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩ±ïÖëÃºÈ•êΩπΩ—ÖÃú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅçΩπÕ–Å•êÄÙÅ¡Ö…Õï%ê°…ïƒπ¡Ö…ÖµÃπ•ê§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅπΩ—ÑÄÙÅç±ïÖπQï·–°…ïƒπâΩë‰¸ππΩ—Ñ∞Ä‘¿¿¿§Ï4(ÄÄÄÄÄÅ•òÄ†Ö•êÅÒÄÖπΩ—Ñ§Å…ï—’…∏Å…ïÃπÕ—Ö—’Ã†–¿¿§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅôÖ±Õî∞Åï……ºËÄù%πôΩ…µîÅ’µÑÅπΩ—ÑÅ€Ö±•ëÑ∏úÅÙ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅ%9MIPÅ%9Q<Å¡…ΩÕ¡ïççÖΩ}πΩ—ÖÃÄ°±ïÖë}•ê∞ÅπΩ—Ñ∞Åç…•ÖëΩ}¡Ω»∞Åç…•ÖëΩ}¡Ω…}πΩµî§4(ÄÄÄÄÄÄÄÅY1ULÄ†êƒ∞Äê»∞ÄêÃ∞Äê–§4(ÄÄÄÄÄÄÄÅIQUI9%9Ä®4(ÄÄÄÄÄÅÄ∞Åm•ê∞ÅπΩ—Ñ∞Å…ïƒπ’Õï»π•ê∞Åç’……ïπ—UÕï…9Öµî°…ïƒ•t§Ï4(ÄÄÄÄÄÅ…ïÃπÕ—Ö—’Ã†»¿ƒ§π©ÕΩ∏°ÏÅÕ’çïÕÕºËÅ—…’î∞ÅµïπÕÖùï¥ËÄù9Ω—ÑÅÖë•ç•ΩπÖëÑ∏ú∞ÅπΩ—ÑËÅ…ïÕ’±–π…Ω›Õl¡tÅÙ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4(4(ÄÅÖ¡¿πùï–†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩÕ¡ïççÖºΩï·¡Ω…—Ö»πçÕÿú∞Å…ï≈’•…ïëµ•∏∞ÅÖÕÂπåÄ°…ïƒ∞Å…ïÃ∞Åπï·–§ÄÙ¯ÅÏ4(ÄÄÄÅ—…‰ÅÏ4(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–Å¡ΩΩ∞π≈’ï…‰°Ä4(ÄÄÄÄÄÄÄÅM1PÅïµ¡…ïÕÖ}πΩµî∞ÅçÖ—ïùΩ…•Ñ∞Å—ï±ïôΩπî∞ÅïµÖ•∞∞Å›ïâÕ•—î∞Åïπëï…ïçº∞ÅâÖ•……º∞Åç•ëÖëî∞ÅïÕ—Öëº∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÖŸÖ±•ÖçÖº∞Å≈’Öπ—•ëÖëï}ÖŸÖ±•ÖçΩïÃ∞ÅÕçΩ…î∞ÅÕ—Ö—’Ã∞Å¡…•Ω…•ëÖëî∞ÅπÖΩ}çΩπ—Ö—Ö»∞ÅùΩΩù±ï}µÖ¡Õ}’…∞∞Åç…ïÖ—ïë}Ö–4(ÄÄÄÄÄÄÄÅI=4Å¡…ΩÕ¡ïççÖΩ}±ïÖëÃ4(ÄÄÄÄÄÄÄÅ=IHÅ	dÅÕçΩ…îÅM∞Åç…ïÖ—ïë}Ö–ÅM4(ÄÄÄÄÄÅÄ§Ï4(ÄÄÄÄÄÅçΩπÕ–Å°ïÖëï…ÃÄÙÅlùµ¡…ïÕÑú∞ùÖ—ïùΩ…•Ñú∞ùQï±ïôΩπîú∞ùµµÖ•∞ú∞ù]ïâÕ•—îú∞ùπëï…óùºú∞ù	Ö•……ºú∞ù•ëÖëîú∞ùÕ—Öëºú∞ùŸÖ±•áüçºú∞ùE—ê∏ÅÖŸÖ±•áü’ïÃú∞ùMçΩ…îú∞ùM—Ö—’Ãú∞ùA…•Ω…•ëÖëîú∞ù;çºÅçΩπ—Ö—Ö»ú∞ùΩΩù±îÅ5Ö¡Ãú∞ùΩ±ï—ÖëºÅï¥ùtÏ4(ÄÄÄÄÄÅçΩπÕ–Å…Ω›ÃÄÙÅ…ïÕ’±–π…Ω›ÃπµÖ¿†°…Ω‹§ÄÙ¯Åm…Ω‹πïµ¡…ïÕÖ}πΩµî±…Ω‹πçÖ—ïùΩ…•Ñ±…Ω‹π—ï±ïôΩπî±…Ω‹πïµÖ•∞±…Ω‹π›ïâÕ•—î±…Ω‹πïπëï…ïçº±…Ω‹πâÖ•……º±…Ω‹πç•ëÖëî±…Ω‹πïÕ—Öëº±…Ω‹πÖŸÖ±•ÖçÖº±…Ω‹π≈’Öπ—•ëÖëï}ÖŸÖ±•ÖçΩïÃ±…Ω‹πÕçΩ…î±…Ω‹πÕ—Ö—’Ã±…Ω‹π¡…•Ω…•ëÖëî±…Ω‹ππÖΩ}çΩπ—Ö—Ö»Ä¸ÄùM•¥úÄËÄù;çºú±…Ω‹πùΩΩù±ï}µÖ¡Õ}’…∞±…Ω‹πç…ïÖ—ïë}Ö—t§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅçÕÿÄÙÄùq’ôïôòúÄ¨Åm°ïÖëï…Ã∞Ä∏∏π…Ω›ÕtπµÖ¿†°…Ω‹§ÄÙ¯Å…Ω‹πµÖ¿°çÕŸÕçÖ¡î§π©Ω•∏†úÏú§§π©Ω•∏†ùq∏ú§Ï4(ÄÄÄÄÄÅ…ïÃπÕï—!ïÖëï»†ùΩπ—ïπ–µQÂ¡îú∞Äù—ï·–ΩçÕÿÏÅç°Ö…Õï–ı’—ò¥‡ú§Ï4(ÄÄÄÄÄÅ…ïÃπÕï—!ïÖëï»†ùΩπ—ïπ–µ•Õ¡ΩÕ•—•Ω∏ú∞ÄùÖ——Öç°µïπ–ÏÅô•±ïπÖµîÙâ¡…ΩÕ¡ïççÖºµùïπïÕ•Ãµ•ÑπçÕÿàú§Ï4(ÄÄÄÄÄÅ…ïÃπÕïπê°çÕÿ§Ï4(ÄÄÄÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅπï·–°ï……Ω»§ÏÅÙ4(ÄÅÙ§Ï4)Ù4(4)µΩë’±îπï·¡Ω…—ÃÄÙÅÏÅ…ïù•Õ—ï…ëµ•πXÿÅÙÏ4