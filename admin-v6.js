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
  // Usuários
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
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inválidos.' });
      const usuario = normalizeUsername(parsed.data.usuario);
      if (usuario.length < 3) return res.status(400).json({ sucesso: false, erro: 'Informe um usuário válido com pelo menos 3 caracteres.' });
      const senhaHash = await hashPassword(parsed.data.senha);
      const result = await pool.query(`
        INSERT INTO app_usuarios (usuario, senha_hash, nome, perfil, empresa_id, ativo, criado_por, telefone_whatsapp, alerta_entrevista, alerta_revisao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8,''), $9, $10)
        RETURNING id, usuario, nome, perfil, empresa_id, ativo, telefone_whatsapp, alerta_entrevista, alerta_revisao, created_at
      `, [usuario, senhaHash, parsed.data.nome, parsed.data.perfil, parsed.data.empresa_id, parsed.data.ativo, req.user.id, parsed.data.telefone_whatsapp.replace(/\D/g,''), parsed.data.alerta_entrevista, parsed.data.alerta_revisao]);
      await audit(pool, req, 'USUARIO_CRIADO', 'app_usuarios', result.rows[0].id, { usuario, perfil: parsed.data.perfil });
      res.status(201).json({ sucesso: true, mensagem: 'Usuário criado com sucesso.', usuario: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.put('/api/admin/usuarios/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
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
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inválidos.' });
      if (id === Number(req.user.id) && !parsed.data.ativo) return res.status(400).json({ sucesso: false, erro: 'Você não pode desativar o próprio acesso.' });
      const current = await pool.query('SELECT perfil, ativo FROM app_usuarios WHERE id = $1', [id]);
      if (!current.rowCount) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      if (current.rows[0].perfil === 'ADMIN' && current.rows[0].ativo && (parsed.data.perfil !== 'ADMIN' || !parsed.data.ativo)) {
        const admins = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM app_usuarios WHERE perfil = 'ADMIN' AND ativo IS TRUE`);
        if (Number(admins.rows[0].total) <= 1) return res.status(400).json({ sucesso: false, erro: 'É obrigatório manter pelo menos um administrador ativo.' });
      }
      const result = await pool.query(`
        UPDATE app_usuarios
        SET nome = $1, perfil = $2, empresa_id=$3, ativo = $4, telefone_whatsapp=NULLIF($5,''), alerta_entrevista=$6, alerta_revisao=$7, updated_at = NOW()
        WHERE id = $8
        RETURNING id, usuario, nome, perfil, empresa_id, ativo, telefone_whatsapp, alerta_entrevista, alerta_revisao, updated_at
      `, [parsed.data.nome, parsed.data.perfil, parsed.data.empresa_id, parsed.data.ativo, parsed.data.telefone_whatsapp.replace(/\D/g,''), parsed.data.alerta_entrevista, parsed.data.alerta_revisao, id]);
      await audit(pool, req, 'USUARIO_ATUALIZADO', 'app_usuarios', id, parsed.data);
      res.json({ sucesso: true, mensagem: 'Usuário atualizado.', usuario: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/usuarios/:id/redefinir-senha', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const senha = String(req.body?.senha || '');
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
      if (senha.length < 8) return res.status(400).json({ sucesso: false, erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
      const senhaHash = await hashPassword(senha);
      const result = await pool.query(`
        UPDATE app_usuarios
        SET senha_hash = $1, deve_trocar_senha = FALSE, updated_at = NOW()
        WHERE id = $2
        RETURNING id, usuario, nome
      `, [senhaHash, id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
      await audit(pool, req, 'SENHA_REDEFINIDA', 'app_usuarios', id, { usuario: result.rows[0].usuario });
      res.json({ sucesso: true, mensagem: 'Senha redefinida com sucesso.' });
    } catch (error) { next(error); }
  });

  // ------------------------------------------------------------
  // Configuração e orçamento Apify
  // ------------------------------------------------------------
  app.get('/api/admin/prospeccao/configuracao', requireAdmin, async (req, res, next) => {
    try {
      const [config, usage] = await Promise.all([
        pool.query('SELECT * FROM prospeccao_configuracao WHERE id = 1'),
        monthlyUsage(pool),
      ]);
      const row = config.rows[0];
      const used = Number(usage.usado_usd || 0);
      const budget = Number(row.orcamento_mensal_usd || 0);
      res.json({
        sucesso: true,
        configuracao: {
          ...row,
          actor_id: APIFY_ACTOR_ID,
          token_configurado: Boolean(APIFY_API_TOKEN),
          limites_disponiveis: ALLOWED_LIMITS.filter((value) => value <= Number(row.limite_maximo_execucao || 100)),
          uso_mes_usd: used,
          saldo_estimado_usd: Math.max(0, budget - used),
          execucoes_mes: Number(usage.execucoes || 0),
          leads_importados_mes: Number(usage.leads_importados || 0),
        },
      });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/prospeccao/configuracao', requireAdmin, async (req, res, next) => {
    try {
      const schema = z.object({
        orcamento_mensal_usd: z.coerce.number().min(0).max(10000),
        custo_estimado_por_1000_usd: z.coerce.number().min(0).max(1000),
        limite_padrao: z.coerce.number().int().min(1).max(500),
        limite_maximo_execucao: z.coerce.number().int().min(1).max(1000),
        ativo: z.boolean(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Configuração inválida.' });
      if (parsed.data.limite_padrao > parsed.data.limite_maximo_execucao) return res.status(400).json({ sucesso: false, erro: 'O limite padrão não pode ser maior que o limite máximo.' });
      const result = await pool.query(`
        UPDATE prospeccao_configuracao
        SET orcamento_mensal_usd = $1,
            custo_estimado_por_1000_usd = $2,
            limite_padrao = $3,
            limite_maximo_execucao = $4,
            ativo = $5,
            updated_by = $6,
            updated_at = NOW()
        WHERE id = 1
        RETURNING *
      `, [parsed.data.orcamento_mensal_usd, parsed.data.custo_estimado_por_1000_usd, parsed.data.limite_padrao, parsed.data.limite_maximo_execucao, parsed.data.ativo, req.user.id]);
      await audit(pool, req, 'PROSPECCAO_CONFIG_ATUALIZADA', 'prospeccao_configuracao', 1, parsed.data);
      res.json({ sucesso: true, mensagem: 'Limites de prospecção atualizados.', configuracao: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/prospeccao/execucoes', requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT * FROM prospeccao_execucoes
        ORDER BY iniciado_at DESC
        LIMIT 100
      `);
      res.json({ sucesso: true, execucoes: result.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/prospeccao/execucoes', requireAdmin, async (req, res, next) => {
    try {
      if (!APIFY_API_TOKEN) return res.status(503).json({ sucesso: false, erro: 'APIFY_API_TOKEN ainda não foi configurado no EasyPanel.' });
      const schema = z.object({
        termo_busca: z.string().trim().min(2).max(200),
        localizacao: z.string().trim().min(2).max(250),
        quantidade: z.coerce.number().int().min(1).max(1000),
        confirmar_custo: z.boolean().optional().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inválidos.' });
      const configResult = await pool.query('SELECT * FROM prospeccao_configuracao WHERE id = 1');
      const config = configResult.rows[0];
      if (!config.ativo) return res.status(403).json({ sucesso: false, erro: 'A prospecção está pausada nas configurações administrativas.' });
      const quantity = parsed.data.quantidade;
      if (!ALLOWED_LIMITS.includes(quantity)) return res.status(400).json({ sucesso: false, erro: `Escolha uma quantidade permitida: ${ALLOWED_LIMITS.join(', ')}.` });
      if (quantity > Number(config.limite_maximo_execucao)) return res.status(400).json({ sucesso: false, erro: 'A quantidade supera o limite máximo definido pelo administrador.' });
      const usage = await monthlyUsage(pool);
      const estimated = Number(config.custo_estimado_inicio_usd || 0.007) + ((quantity / 1000) * Number(config.custo_estimado_por_1000_usd || 1.5));
      const projected = Number(usage.usado_usd || 0) + estimated;
      if (projected > Number(config.orcamento_mensal_usd || 0)) {
        return res.status(402).json({
          sucesso: false,
          erro: `A execução ultrapassaria o orçamento mensal local. Uso estimado: US$ ${Number(usage.usado_usd || 0).toFixed(2)}; nova busca: US$ ${estimated.toFixed(2)}; limite: US$ ${Number(config.orcamento_mensal_usd || 0).toFixed(2)}.`,
        });
      }
      if (!parsed.data.confirmar_custo) {
        return res.status(409).json({
          sucesso: false,
          requer_confirmacao: true,
          custo_estimado_usd: estimated,
          mensagem: `Esta busca está estimada em aproximadamente US$ ${estimated.toFixed(3)}. Confirme para iniciar.`,
        });
      }
      const input = {
        searchStringsArray: [parsed.data.termo_busca],
        locationQuery: parsed.data.localizacao,
        maxCrawledPlacesPerSearch: quantity,
        language: 'pt-BR',
        scrapeSocialMediaProfiles: {
          facebooks: false,
          instagrams: false,
          youtubes: false,
          tiktoks: false,
          twitters: false,
        },
        // Controles de custo: desativa recursos adicionais que podem elevar o consumo.
        maximumLeadsEnrichmentRecords: 0,
        maxReviews: 0,
        scrapePlaceDetailPage: false,
        scrapeReviewsPersonalData: false,
        maxCompetitorsToAnalyze: 0,
      };
      const draft = await pool.query(`
        INSERT INTO prospeccao_execucoes (
          actor_id, termo_busca, localizacao, quantidade_solicitada, status,
          custo_estimado_usd, input_json, iniciado_por, iniciado_por_nome
        ) VALUES ($1, $2, $3, $4, 'PREPARANDO', $5, $6::JSONB, $7, $8)
        RETURNING *
      `, [APIFY_ACTOR_ID, parsed.data.termo_busca, parsed.data.localizacao, quantity, estimated, JSON.stringify(input), req.user.id, currentUserName(req)]);
      try {
        const response = await apifyFetch(APIFY_API_TOKEN, `/acts/${actorApiId(APIFY_ACTOR_ID)}/runs`, {
          method: 'POST',
          body: JSON.stringify(input),
        });
        const run = response.data || response;
        const result = await pool.query(`
          UPDATE prospeccao_execucoes
          SET apify_run_id = $1, apify_dataset_id = $2, status = $3, retorno_json = $4::JSONB, updated_at = NOW()
          WHERE id = $5
          RETURNING *
        `, [run.id, run.defaultDatasetId || null, run.status || 'RUNNING', JSON.stringify(run), draft.rows[0].id]);
        await audit(pool, req, 'PROSPECCAO_INICIADA', 'prospeccao_execucoes', draft.rows[0].id, { termo: parsed.data.termo_busca, localizacao: parsed.data.localizacao, quantidade: quantity, estimado: estimated });
        res.status(201).json({ sucesso: true, mensagem: 'Busca iniciada na Apify.', execucao: result.rows[0] });
      } catch (error) {
        await pool.query(`UPDATE prospeccao_execucoes SET status = 'FAILED', erro = $1, updated_at = NOW(), concluido_at = NOW() WHERE id = $2`, [error.message, draft.rows[0].id]);
        throw error;
      }
    } catch (error) { next(error); }
  });

  app.post('/api/admin/prospeccao/execucoes/:id/sincronizar', requireAdmin, async (req, res, next) => {
    try {
      if (!APIFY_API_TOKEN) return res.status(503).json({ sucesso: false, erro: 'APIFY_API_TOKEN não configurado.' });
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
      const localResult = await pool.query('SELECT * FROM prospeccao_execucoes WHERE id = $1', [id]);
      if (!localResult.rowCount) return res.status(404).json({ sucesso: false, erro: 'Execução não encontrada.' });
      const execution = localResult.rows[0];
      if (!execution.apify_run_id) return res.status(400).json({ sucesso: false, erro: 'Execução sem ID da Apify.' });
      const response = await apifyFetch(APIFY_API_TOKEN, `/actor-runs/${encodeURIComponent(execution.apify_run_id)}`, { method: 'GET' });
      const run = response.data || response;
      const status = run.status || execution.status;
      let imported = Number(execution.quantidade_importada || 0);
      let duplicated = Number(execution.quantidade_duplicada || 0);
      let found = Number(execution.quantidade_encontrada || 0);
      const datasetId = run.defaultDatasetId || execution.apify_dataset_id;
      if (status === 'SUCCEEDED' && datasetId && !execution.concluido_at) {
        const datasetResponse = await apifyFetch(APIFY_API_TOKEN, `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=${Number(execution.quantidade_solicitada || 100)}`, { method: 'GET' });
        const items = Array.isArray(datasetResponse) ? datasetResponse : (datasetResponse.data?.items || datasetResponse.items || []);
        found = items.length;
        const importedResult = await importDataset(pool, execution, items);
        imported = importedResult.imported;
        duplicated = importedResult.duplicated;
      }
      const actualCost = extractRunCost(run, execution.custo_estimado_usd);
      const result = await pool.query(`
        UPDATE prospeccao_execucoes
        SET apify_dataset_id = $1,
            status = $2,
            custo_real_usd = $3,
            quantidade_encontrada = $4,
            quantidade_importada = $5,
            quantidade_duplicada = $6,
            retorno_json = $7::JSONB,
            erro = CASE
              WHEN $2::VARCHAR IN ('FAILED','ABORTED','TIMED-OUT')
                THEN COALESCE($8::TEXT, erro)
              ELSE NULL
            END,
            concluido_at = CASE WHEN $2::VARCHAR IN ('SUCCEEDED','FAILED','ABORTED','TIMED-OUT') THEN COALESCE(concluido_at, NOW()) ELSE concluido_at END,
            updated_at = NOW()
        WHERE id = $9
        RETURNING *
      `, [datasetId || null, status, actualCost, found, imported, duplicated, JSON.stringify(run), run.statusMessage || null, id]);
      res.json({ sucesso: true, mensagem: status === 'SUCCEEDED' ? 'Resultados sincronizados e importados.' : `Execução atualizada: ${status}.`, execucao: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/prospeccao/execucoes/:id/abortar', requireAdmin, async (req, res, next) => {
    try {
      if (!APIFY_API_TOKEN) return res.status(503).json({ sucesso: false, erro: 'APIFY_API_TOKEN não configurado.' });
      const id = parseId(req.params.id);
      const localResult = await pool.query('SELECT * FROM prospeccao_execucoes WHERE id = $1', [id]);
      if (!localResult.rowCount) return res.status(404).json({ sucesso: false, erro: 'Execução não encontrada.' });
      const execution = localResult.rows[0];
      await pool.query(`UPDATE prospeccao_execucoes SET status = 'ABORTING', updated_at = NOW() WHERE id = $1`, [id]);
      await apifyFetch(APIFY_API_TOKEN, `/actor-runs/${encodeURIComponent(execution.apify_run_id)}/abort`, { method: 'POST', body: '{}' });
      await audit(pool, req, 'PROSPECCAO_ABORTADA', 'prospeccao_execucoes', id, {});
      res.json({ sucesso: true, mensagem: 'Solicitação de interrupção enviada à Apify.' });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/prospeccao/leads', requireAdmin, async (req, res, next) => {
    try {
      const status = String(req.query.status || 'TODOS').toUpperCase();
      const q = String(req.query.q || '').trim();
      const limit = Math.min(Math.max(Number(req.query.limit || 300), 1), 1000);
      const params = [];
      const filters = [];
      if (status !== 'TODOS') { params.push(status); filters.push(`l.status = $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        filters.push(`(l.empresa_nome ILIKE $${params.length} OR l.cidade ILIKE $${params.length} OR l.telefone ILIKE $${params.length} OR l.website ILIKE $${params.length} OR l.categoria ILIKE $${params.length})`);
      }
      const categoria = String(req.query.categoria || '').trim();
      const estado = String(req.query.estado || '').trim().toUpperCase();
      const cidade = String(req.query.cidade || '').trim();
      const prioridade = String(req.query.prioridade || '').trim().toUpperCase();
      const resposta = String(req.query.resposta || '').trim().toUpperCase();
      const contato = String(req.query.contato || '').trim().toUpperCase();
      const ultimoContato = String(req.query.ultimo_contato || '').trim().toUpperCase();
      const responsavel = parseId(req.query.responsavel);
      const scoreMin = Number(req.query.score_min);
      if (categoria) { params.push(`%${categoria}%`); filters.push(`(l.categoria ILIKE $${params.length} OR l.categorias::TEXT ILIKE $${params.length})`); }
      if (estado) { params.push(estado); filters.push(`UPPER(COALESCE(l.estado,''))=$${params.length}`); }
      if (cidade) { params.push(`%${cidade}%`); filters.push(`l.cidade ILIKE $${params.length}`); }
      if (['BAIXA','MEDIA','ALTA'].includes(prioridade)) { params.push(prioridade); filters.push(`l.prioridade=$${params.length}`); }
      if (responsavel) { params.push(responsavel); filters.push(`l.responsavel_id=$${params.length}`); }
      if (Number.isFinite(scoreMin) && scoreMin > 0) { params.push(Math.min(scoreMin, 100)); filters.push(`l.score >= $${params.length}`); }
      if (['HUMANA','AUTOMATICA','DESCADASTRO','VAZIA'].includes(resposta)) { params.push(resposta); filters.push(`l.resposta_tipo=$${params.length}`); }
      if (contato === 'COM_WHATSAPP') filters.push(`COALESCE(l.telefone_normalizado,l.telefone) IS NOT NULL`);
      if (contato === 'SEM_WHATSAPP') filters.push(`COALESCE(l.telefone_normalizado,l.telefone) IS NULL`);
      if (contato === 'AUTORIZADO') filters.push(`l.contato_autorizado IS TRUE`);
      if (contato === 'NAO_AUTORIZADO') filters.push(`l.contato_autorizado IS FALSE`);
      if (String(req.query.nao_contatar || '').toLowerCase() === 'true') filters.push(`l.nao_contatar IS TRUE`);
      if (String(req.query.nao_contatar || '').toLowerCase() === 'false') filters.push(`l.nao_contatar IS FALSE`);
      if (ultimoContato === 'SEM_CONTATO') filters.push(`NOT EXISTS(SELECT 1 FROM prospeccao_contatos pc WHERE pc.lead_id=l.id)`);
      if (ultimoContato === '7D') filters.push(`EXISTS(SELECT 1 FROM prospeccao_contatos pc WHERE pc.lead_id=l.id AND pc.created_at>=NOW()-INTERVAL '7 days')`);
      if (ultimoContato === '30D') filters.push(`EXISTS(SELECT 1 FROM prospeccao_contatos pc WHERE pc.lead_id=l.id AND pc.created_at>=NOW()-INTERVAL '30 days')`);
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const filterParams = [...params];
      params.push(limit);
      const result = await pool.query(`
        SELECT l.*, u.nome AS responsavel_nome, COALESCE(co.etapa,'NOVO_LEAD') AS crm_etapa,
               (SELECT COUNT(*)::INTEGER FROM prospeccao_notas n WHERE n.lead_id = l.id) AS quantidade_notas,
               (SELECT MAX(created_at) FROM prospeccao_contatos c WHERE c.lead_id = l.id) AS ultimo_contato_at
        FROM prospeccao_leads l
        LEFT JOIN app_usuarios u ON u.id = l.responsavel_id
        LEFT JOIN LATERAL (SELECT etapa FROM crm_oportunidades WHERE prospeccao_lead_id=l.id ORDER BY id DESC LIMIT 1) co ON TRUE
        ${where}
        ORDER BY l.nao_contatar ASC, l.score DESC, l.created_at DESC
        LIMIT $${params.length}
      `, params);
      const summary = await pool.query(`
        SELECT COUNT(*)::INTEGER AS total,
               COUNT(*) FILTER (WHERE status = 'NOVO')::INTEGER AS novos,
               COUNT(*) FILTER (WHERE status = 'APROVADO_CONTATO')::INTEGER AS aprovados,
               COUNT(*) FILTER (WHERE status IN ('RESPONDEU','REUNIAO','PROPOSTA'))::INTEGER AS oportunidades,
               COUNT(*) FILTER (WHERE status = 'CLIENTE')::INTEGER AS clientes,
               COUNT(*) FILTER (WHERE nao_contatar IS TRUE)::INTEGER AS nao_contatar
        FROM prospeccao_leads l
        ${where}
      `, filterParams);
      const [categories, states, cities, users] = await Promise.all([
        pool.query(`SELECT DISTINCT categoria AS valor FROM prospeccao_leads WHERE categoria IS NOT NULL AND BTRIM(categoria)<>'' ORDER BY valor LIMIT 150`),
        pool.query(`SELECT DISTINCT UPPER(estado) AS valor FROM prospeccao_leads WHERE estado IS NOT NULL AND BTRIM(estado)<>'' ORDER BY valor`),
        pool.query(`SELECT DISTINCT cidade AS valor FROM prospeccao_leads WHERE cidade IS NOT NULL AND BTRIM(cidade)<>'' ORDER BY valor LIMIT 300`),
        pool.query(`SELECT id,nome FROM app_usuarios WHERE ativo IS TRUE ORDER BY nome`),
      ]);
      res.json({ sucesso: true, leads: result.rows, resumo: summary.rows[0], filtros: {
        categorias: categories.rows.map((row) => row.valor), estados: states.rows.map((row) => row.valor),
        cidades: cities.rows.map((row) => row.valor), responsaveis: users.rows,
      } });
    } catch (error) { next(error); }
  });

  app.patch('/api/admin/prospeccao/leads/:id', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
      const schema = z.object({
        status: z.enum(['NOVO','EM_ANALISE','APROVADO_CONTATO','PRIMEIRO_CONTATO','RESPONDEU','REUNIAO','PROPOSTA','CLIENTE','DESCARTADO','SEM_INTERESSE','CONTATO_INVALIDO','NAO_CONTATAR']),
        prioridade: z.enum(['BAIXA','MEDIA','ALTA']).default('MEDIA'),
        nao_contatar: z.boolean().default(false),
        motivo_descarte: z.string().max(1000).nullable().optional(),
        observacao: z.string().max(5000).nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Dados inválidos.' });
      const data = parsed.data;
      const finalStatus = data.nao_contatar ? 'NAO_CONTATAR' : data.status;
      const result = await pool.query(`
        UPDATE prospeccao_leads
        SET status = $1, prioridade = $2, nao_contatar = $3,
            motivo_descarte = $4, observacao = $5,
            responsavel_id = COALESCE(responsavel_id, $6), updated_at = NOW()
        WHERE id = $7
        RETURNING *
      `, [finalStatus, data.prioridade, data.nao_contatar, cleanText(data.motivo_descarte, 1000), cleanText(data.observacao, 5000), req.user.id, id]);
      if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Lead não encontrado.' });
      await audit(pool, req, 'LEAD_PROSPECCAO_ATUALIZADO', 'prospeccao_leads', id, { status: finalStatus, prioridade: data.prioridade, nao_contatar: data.nao_contatar });
      res.json({ sucesso: true, mensagem: 'Lead atualizado.', lead: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/prospeccao/leads/:id/notas', requireAdmin, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const nota = cleanText(req.body?.nota, 5000);
      if (!id || !nota) return res.status(400).json({ sucesso: false, erro: 'Informe uma nota válida.' });
      const result = await pool.query(`
        INSERT INTO prospeccao_notas (lead_id, nota, criado_por, criado_por_nome)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [id, nota, req.user.id, currentUserName(req)]);
      res.status(201).json({ sucesso: true, mensagem: 'Nota adicionada.', nota: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/prospeccao/exportar.csv', requireAdmin, async (req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT empresa_nome, categoria, telefone, email, website, endereco, bairro, cidade, estado,
               avaliacao, quantidade_avaliacoes, score, status, prioridade, nao_contatar, google_maps_url, created_at
        FROM prospeccao_leads
        ORDER BY score DESC, created_at DESC
      `);
      const headers = ['Empresa','Categoria','Telefone','E-mail','Website','Endereço','Bairro','Cidade','Estado','Avaliação','Qtd. avaliações','Score','Status','Prioridade','Não contatar','Google Maps','Coletado em'];
      const rows = result.rows.map((row) => [row.empresa_nome,row.categoria,row.telefone,row.email,row.website,row.endereco,row.bairro,row.cidade,row.estado,row.avaliacao,row.quantidade_avaliacoes,row.score,row.status,row.prioridade,row.nao_contatar ? 'Sim' : 'Não',row.google_maps_url,row.created_at]);
      const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="prospeccao-genesis-ia.csv"');
      res.send(csv);
    } catch (error) { next(error); }
  });
}

module.exports = { registerAdminV6 };
