'use strict';

const BRASIL_API_BASE = 'https://brasilapi.com.br/api/cep/v2';
const NOMINATIM_BASE = process.env.GEO_NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSIENT_RETRY_AFTER_MS = 60 * 60 * 1000;

function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

function parseCoordinate(value, type) {
  // Number(null) e Number('') retornam 0 em JavaScript. Para geolocalização
  // isso é perigoso: uma resposta sem coordenadas poderia virar (0,0) e
  // produzir uma distância falsa de 0,0 km. Valores ausentes/vazios são nulos.
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  if (type === 'lat' && (number < -90 || number > 90)) return null;
  if (type === 'lon' && (number < -180 || number > 180)) return null;
  return number;
}

function isPlausibleBrazilCoordinatePair(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  // Limites deliberadamente folgados para abranger o território brasileiro e
  // ilhas oceânicas, mas rejeitar sentinelas como (0,0).
  return latitude >= -35.5 && latitude <= 6.5 && longitude >= -75.5 && longitude <= -28.0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePostcode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

function stateMatches(address, expectedState) {
  const expected = String(expectedState || '').trim().toUpperCase();
  if (!expected) return true;
  const iso = String(address?.['ISO3166-2-lvl4'] || address?.['ISO3166-2-lvl6'] || '').toUpperCase();
  if (iso === `BR-${expected}` || iso.endsWith(`-${expected}`)) return true;
  const state = normalizeText(address?.state);
  const stateMap = {
    AC:'acre',AL:'alagoas',AP:'amapa',AM:'amazonas',BA:'bahia',CE:'ceara',DF:'distrito federal',
    ES:'espirito santo',GO:'goias',MA:'maranhao',MT:'mato grosso',MS:'mato grosso do sul',
    MG:'minas gerais',PA:'para',PB:'paraiba',PR:'parana',PE:'pernambuco',PI:'piaui',
    RJ:'rio de janeiro',RN:'rio grande do norte',RS:'rio grande do sul',RO:'rondonia',
    RR:'roraima',SC:'santa catarina',SP:'sao paulo',SE:'sergipe',TO:'tocantins'
  };
  return !state || state === stateMap[expected];
}

function cityMatches(address, expectedCity) {
  const expected = normalizeText(expectedCity);
  if (!expected) return true;
  const candidates = [address?.city, address?.town, address?.village, address?.municipality, address?.county]
    .map(normalizeText)
    .filter(Boolean);
  return candidates.length === 0 || candidates.some((value) => value === expected || value.includes(expected) || expected.includes(value));
}

function hasStreetLevelAddress(address) {
  return Boolean(
    address?.road || address?.pedestrian || address?.residential || address?.footway ||
    address?.path || address?.neighbourhood || address?.suburb
  );
}

function scoreNominatimResult(item, context) {
  const lat = parseCoordinate(item?.lat, 'lat');
  const lon = parseCoordinate(item?.lon, 'lon');
  if (!isPlausibleBrazilCoordinatePair(lat, lon)) return { accepted: false, score: -999 };

  const address = item?.address || {};
  const resultCep = normalizePostcode(address.postcode);
  const exactCep = resultCep && resultCep === context.cep;
  const samePrefix = resultCep && resultCep.slice(0, 5) === context.cep.slice(0, 5);
  const sameCity = cityMatches(address, context.cidade);
  const sameState = stateMatches(address, context.estado);
  const streetLevel = hasStreetLevelAddress(address);

  let score = 0;
  if (exactCep) score += 120;
  else if (samePrefix) score += 70;
  if (sameCity) score += 20;
  else score -= 60;
  if (sameState) score += 15;
  else score -= 50;
  if (streetLevel) score += 15;

  // Nunca aceitar simplesmente o centro administrativo de uma cidade/estado.
  // Para CEP sem correspondência explícita, exigimos pelo menos um resultado
  // em nível de logradouro/bairro e coerência de cidade/UF.
  const accepted = exactCep || samePrefix || (streetLevel && sameCity && sameState);
  let precision = 'LOGRADOURO';
  if (exactCep) precision = 'CEP_EXATO';
  else if (samePrefix) precision = 'CEP_PREFIXO';

  return { accepted, score, lat, lon, precision, address };
}

async function scheduleNominatimRequest(task, minIntervalMs = NOMINATIM_MIN_INTERVAL_MS) {
  const run = async () => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    const remaining = Math.max(0, minIntervalMs - elapsed);
    if (remaining > 0) await wait(remaining);
    lastNominatimRequestAt = Date.now();
    return task();
  };
  const current = nominatimQueue.then(run, run);
  nominatimQueue = current.catch(() => {});
  return current;
}

async function queryNominatim(params, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = new URL(NOMINATIM_BASE);
  const all = {
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'br',
    ...params,
  };
  for (const [key, value] of Object.entries(all)) {
    if (value !== null && value !== undefined && String(value).trim()) url.searchParams.set(key, String(value));
  }

  return scheduleNominatimRequest(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'User-Agent': process.env.GEO_NOMINATIM_USER_AGENT || 'GenesisIA-Geo/1.2',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Nominatim retornou HTTP ${response.status}.`);
      const body = await response.json();
      return Array.isArray(body) ? body : [];
    } finally {
      clearTimeout(timer);
    }
  });
}

async function fetchNominatimCep(cep, addressData = {}, options = {}) {
  const context = {
    cep,
    cidade: addressData.cidade || null,
    estado: addressData.estado || null,
    logradouro: addressData.logradouro || null,
  };

  const attempts = [];
  if (context.logradouro) {
    attempts.push({
      postalcode: cep,
      street: context.logradouro,
      city: context.cidade,
      state: context.estado,
      country: 'Brasil',
    });
  }
  attempts.push({
    postalcode: cep,
    city: context.cidade,
    state: context.estado,
    country: 'Brasil',
  });

  let lastError = null;
  for (const params of attempts) {
    try {
      const results = await queryNominatim(params, options);
      const ranked = results
        .map((item) => ({ item, ...scoreNominatimResult(item, context) }))
        .filter((item) => item.accepted)
        .sort((a, b) => b.score - a.score);

      if (ranked.length) {
        const best = ranked[0];
        return {
          ok: true,
          status: 'OK',
          fonte: 'NOMINATIM',
          data: {
            ...addressData,
            cep,
            latitude: best.lat,
            longitude: best.lon,
            servico: `NOMINATIM_${best.precision}`,
          },
          error: null,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    status: lastError ? 'ERRO' : 'SEM_COORDENADAS',
    fonte: 'NOMINATIM',
    data: { ...addressData, cep, latitude: null, longitude: null, servico: 'NOMINATIM_SEM_MATCH' },
    error: lastError
      ? `Falha ao geocodificar CEP no OpenStreetMap/Nominatim: ${String(lastError.message || lastError).slice(0, 350)}`
      : 'CEP localizado, mas o OpenStreetMap/Nominatim não retornou uma coordenada suficientemente precisa.',
  };
}

async function fetchPreciseCep(cep, options = {}) {
  const brasil = await fetchBrasilApiCep(cep, options);
  if (brasil.status === 'NAO_ENCONTRADO' || brasil.status === 'ERRO') return brasil;

  const nominatim = await fetchNominatimCep(cep, brasil.data || {}, options);
  if (nominatim.ok) return nominatim;

  if (options.requireNominatim) {
    return {
      ...nominatim,
      status: nominatim.status === 'ERRO' ? 'ERRO' : 'SEM_COORDENADAS',
      data: { ...(brasil.data || {}), ...(nominatim.data || {}), cep, latitude: null, longitude: null },
    };
  }

  // Em uma consulta normal, se o Nominatim não responder mas a BrasilAPI tiver
  // uma coordenada plausível, mantemos o dado como fallback. Registros
  // identificados como baixa precisão usam requireNominatim=true e nunca
  // reaproveitam a coordenada genérica.
  return brasil.ok ? { ...brasil, fonte: 'BRASILAPI' } : nominatim;
}

async function fetchBrasilApiCep(cep, { fetchImpl = fetch, timeoutMs = 7000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${BRASIL_API_BASE}/${encodeURIComponent(cep)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'Genesis-IA-Geo/1.0' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) return { ok: false, status: 'NAO_ENCONTRADO', error: 'CEP não encontrado.' };
    if (!response.ok) {
      const message = body?.message || body?.errors?.[0]?.message || `BrasilAPI retornou HTTP ${response.status}.`;
      return { ok: false, status: 'ERRO', error: String(message).slice(0, 500) };
    }
    const parsedLatitude = parseCoordinate(body?.location?.coordinates?.latitude, 'lat');
    const parsedLongitude = parseCoordinate(body?.location?.coordinates?.longitude, 'lon');
    const hasCoordinates = isPlausibleBrazilCoordinatePair(parsedLatitude, parsedLongitude);
    const latitude = hasCoordinates ? parsedLatitude : null;
    const longitude = hasCoordinates ? parsedLongitude : null;
    return {
      ok: hasCoordinates,
      status: hasCoordinates ? 'OK' : 'SEM_COORDENADAS',
      data: {
        cep,
        estado: String(body?.state || '').trim().toUpperCase().slice(0, 2) || null,
        cidade: String(body?.city || '').trim().slice(0, 160) || null,
        bairro: String(body?.neighborhood || '').trim().slice(0, 180) || null,
        logradouro: String(body?.street || '').trim().slice(0, 500) || null,
        latitude,
        longitude,
        servico: String(body?.service || '').trim().slice(0, 80) || null,
      },
      error: hasCoordinates ? null : 'CEP localizado, mas sem coordenadas geográficas válidas disponíveis.',
    };
  } catch (error) {
    return { ok: false, status: 'ERRO', error: error?.name === 'AbortError' ? 'Tempo limite ao consultar a BrasilAPI.' : String(error.message || error).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

async function getCachedCep(pool, cep) {
  const result = await pool.query('SELECT * FROM geo_ceps WHERE cep=$1 LIMIT 1', [cep]);
  return result.rows[0] || null;
}

async function saveCepResult(pool, cep, result) {
  const data = result.data || {};
  const fonte = String(result.fonte || 'BRASILAPI').trim().slice(0, 40) || 'BRASILAPI';
  const saved = await pool.query(`
    INSERT INTO geo_ceps(
      cep,estado,cidade,bairro,logradouro,latitude,longitude,fonte,servico,status,ultimo_erro,tentativas,consultado_at,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,NOW(),NOW())
    ON CONFLICT(cep) DO UPDATE SET
      estado=EXCLUDED.estado,
      cidade=EXCLUDED.cidade,
      bairro=EXCLUDED.bairro,
      logradouro=EXCLUDED.logradouro,
      latitude=EXCLUDED.latitude,
      longitude=EXCLUDED.longitude,
      fonte=EXCLUDED.fonte,
      servico=EXCLUDED.servico,
      status=EXCLUDED.status,
      ultimo_erro=EXCLUDED.ultimo_erro,
      tentativas=geo_ceps.tentativas+1,
      consultado_at=NOW(),
      updated_at=NOW()
    RETURNING *
  `, [cep, data.estado || null, data.cidade || null, data.bairro || null, data.logradouro || null,
    data.latitude, data.longitude, fonte, data.servico || null, result.status, result.error || null]);
  return saved.rows[0];
}

async function resolveCep(pool, rawCep, options = {}) {
  const cep = normalizeCep(rawCep);
  if (!cep) {
    const error = new Error('CEP inválido. Informe 8 números.');
    error.statusCode = 400;
    throw error;
  }
  const cached = await getCachedCep(pool, cep);
  const cachedLatitude = parseCoordinate(cached?.latitude, 'lat');
  const cachedLongitude = parseCoordinate(cached?.longitude, 'lon');
  const cachedOkValido = cached?.status === 'OK' && isPlausibleBrazilCoordinatePair(cachedLatitude, cachedLongitude);
  const cachedOkInvalido = cached?.status === 'OK' && !cachedOkValido;
  if (cachedOkValido && !options.force) return { source: 'CACHE', cep: cached };
  const retryAfter = cached?.status === 'ERRO' ? TRANSIENT_RETRY_AFTER_MS : RETRY_AFTER_MS;
  // Registros antigos marcados como OK mas com coordenadas inválidas (ex.: 0,0)
  // são reconsultados imediatamente. O restante respeita o intervalo de retry.
  if (!options.force && !cachedOkInvalido && cached?.consultado_at && Date.now() - new Date(cached.consultado_at).getTime() < retryAfter) {
    return { source: 'CACHE', cep: cached };
  }
  const remote = await fetchPreciseCep(cep, options);
  const saved = await saveCepResult(pool, cep, remote);
  return { source: saved?.fonte || remote.fonte || 'BRASILAPI', cep: saved };
}

async function listMissingCeps(pool, limit = 20) {
  const result = await pool.query(`
    WITH usados AS (
      SELECT DISTINCT REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') AS cep, MAX(c.updated_at) AS prioridade
      FROM candidatos c
      WHERE LENGTH(REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g'))=8
      GROUP BY 1
      UNION
      SELECT DISTINCT gv.cep, MAX(gv.updated_at) AS prioridade
      FROM geo_vagas gv
      WHERE gv.cep ~ '^[0-9]{8}$'
      GROUP BY gv.cep
    )
    SELECT u.cep
    FROM usados u
    LEFT JOIN geo_ceps g ON g.cep=u.cep
    WHERE g.cep IS NULL
       OR (g.status = 'OK' AND (
            g.latitude IS NULL OR g.longitude IS NULL
            OR g.latitude < -35.5 OR g.latitude > 6.5
            OR g.longitude < -75.5 OR g.longitude > -28.0
          ))
       OR (g.status = 'ERRO' AND (g.consultado_at IS NULL OR g.consultado_at < NOW() - INTERVAL '1 hour'))
       OR (g.status IN ('SEM_COORDENADAS','NAO_ENCONTRADO','PENDENTE') AND (g.consultado_at IS NULL OR g.consultado_at < NOW() - INTERVAL '7 days'))
    ORDER BY u.prioridade DESC NULLS LAST, u.cep
    LIMIT $1
  `, [Math.max(1, Math.min(Number(limit) || 20, 200))]);
  return result.rows.map((row) => row.cep);
}



async function listLowPrecisionClusterCeps(pool, limit = 300, minCluster = 3) {
  const result = await pool.query(`
    WITH clusters AS (
      SELECT latitude,longitude,COUNT(DISTINCT cep)::INTEGER AS qtd
      FROM geo_ceps
      WHERE status='OK'
        AND fonte='BRASILAPI'
        AND latitude BETWEEN -35.5 AND 6.5
        AND longitude BETWEEN -75.5 AND -28.0
      GROUP BY latitude,longitude
      HAVING COUNT(DISTINCT cep) >= $2
    )
    SELECT g.cep,g.latitude,g.longitude,c.qtd
    FROM geo_ceps g
    JOIN clusters c ON c.latitude=g.latitude AND c.longitude=g.longitude
    WHERE g.fonte='BRASILAPI'
    ORDER BY c.qtd DESC,g.cep
    LIMIT $1
  `, [
    Math.max(1, Math.min(Number(limit) || 300, 1000)),
    Math.max(2, Math.min(Number(minCluster) || 3, 50)),
  ]);
  return result.rows;
}

async function refreshLowPrecisionClusters(pool, { limit = 300, delayMs = 1100, fetchImpl = fetch } = {}) {
  const rows = await listLowPrecisionClusterCeps(pool, limit);
  const summary = { solicitados: rows.length, processados: 0, sucesso: 0, sem_coordenadas: 0, falhas: 0 };
  for (const row of rows) {
    const resolved = await resolveCep(pool, row.cep, { force: true, requireNominatim: true, fetchImpl });
    summary.processados += 1;
    if (resolved.cep?.status === 'OK') summary.sucesso += 1;
    else if (resolved.cep?.status === 'SEM_COORDENADAS') summary.sem_coordenadas += 1;
    else summary.falhas += 1;
    if (delayMs > 0) await wait(Math.max(NOMINATIM_MIN_INTERVAL_MS, delayMs));
  }
  return summary;
}

async function listSuspiciousZeroDistanceCeps(pool, limit = 100) {
  const result = await pool.query(`
    WITH pares AS (
      SELECT DISTINCT
        REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') AS candidato_cep,
        gv.cep AS vaga_cep
      FROM candidatos c
      JOIN geo_vagas gv ON gv.vaga_id=c.vaga_id
      JOIN geo_ceps gc ON gc.cep=REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g')
      JOIN geo_ceps gvgeo ON gvgeo.cep=gv.cep
      WHERE LENGTH(REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g'))=8
        AND gv.cep ~ '^[0-9]{8}$'
        AND REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') <> gv.cep
        AND gc.status='OK' AND gvgeo.status='OK'
        AND gc.latitude BETWEEN -35.5 AND 6.5 AND gc.longitude BETWEEN -75.5 AND -28.0
        AND gvgeo.latitude BETWEEN -35.5 AND 6.5 AND gvgeo.longitude BETWEEN -75.5 AND -28.0
        AND gc.latitude = gvgeo.latitude
        AND gc.longitude = gvgeo.longitude
    ), ceps AS (
      SELECT candidato_cep AS cep FROM pares
      UNION
      SELECT vaga_cep AS cep FROM pares
    )
    SELECT cep FROM ceps ORDER BY cep LIMIT $1
  `, [Math.max(1, Math.min(Number(limit) || 100, 500))]);
  return result.rows.map((row) => row.cep);
}

async function refreshSuspiciousZeroDistanceCeps(pool, { limit = 100, delayMs = 650, fetchImpl = fetch } = {}) {
  const ceps = await listSuspiciousZeroDistanceCeps(pool, limit);
  const summary = { solicitados: ceps.length, processados: 0, sucesso: 0, sem_coordenadas: 0, falhas: 0 };
  for (const cep of ceps) {
    const resolved = await resolveCep(pool, cep, { force: true, requireNominatim: true, fetchImpl });
    summary.processados += 1;
    if (resolved.cep?.status === 'OK') summary.sucesso += 1;
    else if (resolved.cep?.status === 'SEM_COORDENADAS') summary.sem_coordenadas += 1;
    else summary.falhas += 1;
    if (delayMs > 0) await wait(delayMs);
  }
  return summary;
}

async function countSuspiciousZeroDistancePairs(pool) {
  const result = await pool.query(`
    SELECT COUNT(*)::INTEGER AS total
    FROM candidatos c
    JOIN geo_vagas gv ON gv.vaga_id=c.vaga_id
    JOIN geo_ceps gc ON gc.cep=REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g')
    JOIN geo_ceps gvgeo ON gvgeo.cep=gv.cep
    WHERE LENGTH(REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g'))=8
      AND REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') <> gv.cep
      AND gc.status='OK' AND gvgeo.status='OK'
      AND gc.latitude BETWEEN -35.5 AND 6.5 AND gc.longitude BETWEEN -75.5 AND -28.0
      AND gvgeo.latitude BETWEEN -35.5 AND 6.5 AND gvgeo.longitude BETWEEN -75.5 AND -28.0
      AND gc.latitude = gvgeo.latitude
      AND gc.longitude = gvgeo.longitude
  `);
  return Number(result.rows[0]?.total || 0);
}

async function enrichMissingCeps(pool, { limit = 10, delayMs = 250, fetchImpl = fetch } = {}) {
  const ceps = await listMissingCeps(pool, limit);
  const summary = { solicitados: ceps.length, processados: 0, sucesso: 0, sem_coordenadas: 0, falhas: 0 };
  for (const cep of ceps) {
    const resolved = await resolveCep(pool, cep, { force: true, requireNominatim: true, fetchImpl });
    summary.processados += 1;
    if (resolved.cep?.status === 'OK') summary.sucesso += 1;
    else if (resolved.cep?.status === 'SEM_COORDENADAS') summary.sem_coordenadas += 1;
    else summary.falhas += 1;
    if (delayMs > 0) await wait(delayMs);
  }
  return summary;
}

function registerGeoV1({ app, pool }) {
  app.get('/api/geo/cep/:cep', async (req, res, next) => {
    try {
      const result = await resolveCep(pool, req.params.cep);
      const item = result.cep || {};
      return res.json({
        sucesso: item.status === 'OK',
        fonte: result.source,
        geo: {
          cep: item.cep,
          estado: item.estado,
          cidade: item.cidade,
          bairro: item.bairro,
          logradouro: item.logradouro,
          latitude: item.latitude === null ? null : Number(item.latitude),
          longitude: item.longitude === null ? null : Number(item.longitude),
          status: item.status,
        },
        aviso: item.status === 'OK' ? null : item.ultimo_erro || 'Coordenadas indisponíveis para este CEP.',
      });
    } catch (error) { return next(error); }
  });

  app.get('/api/geo/vagas/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      const result = await pool.query(`
        SELECT gv.vaga_id,gv.cep,g.estado,g.cidade,g.bairro,g.logradouro,g.latitude,g.longitude,g.status
        FROM geo_vagas gv LEFT JOIN geo_ceps g ON g.cep=gv.cep WHERE gv.vaga_id=$1 LIMIT 1
      `, [id]);
      return res.json({ sucesso: true, geo: result.rows[0] || null });
    } catch (error) { return next(error); }
  });

  app.put('/api/geo/vagas/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const cep = normalizeCep(req.body?.cep);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      if (!cep) return res.status(400).json({ sucesso: false, erro: 'Informe um CEP válido com 8 números.' });
      const vacancy = await pool.query('SELECT id FROM vagas WHERE id=$1 LIMIT 1', [id]);
      if (!vacancy.rowCount) return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
      const resolved = await resolveCep(pool, cep);
      await pool.query(`
        INSERT INTO geo_vagas(vaga_id,cep,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(vaga_id) DO UPDATE SET cep=EXCLUDED.cep,updated_by=EXCLUDED.updated_by,updated_at=NOW()
      `, [id, cep, req.user?.id || null]);
      return res.json({ sucesso: true, geo: resolved.cep, mensagem: resolved.cep?.status === 'OK' ? 'Localização da vaga atualizada.' : 'CEP salvo; coordenadas ainda indisponíveis.' });
    } catch (error) { return next(error); }
  });

  app.delete('/api/geo/vagas/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
      await pool.query('DELETE FROM geo_vagas WHERE vaga_id=$1', [id]);
      return res.json({ sucesso: true, mensagem: 'CEP da vaga removido.' });
    } catch (error) { return next(error); }
  });

  app.get('/api/geo/candidatos/distancias', async (_req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT c.id AS candidato_id,c.vaga_id,c.cep AS candidato_cep,gv.cep AS vaga_cep,
          gc.cidade AS candidato_cidade,gc.bairro AS candidato_bairro,
          CASE
            WHEN gc.status='OK' AND gvgeo.status='OK'
              AND gc.latitude BETWEEN -35.5 AND 6.5 AND gc.longitude BETWEEN -75.5 AND -28.0
              AND gvgeo.latitude BETWEEN -35.5 AND 6.5 AND gvgeo.longitude BETWEEN -75.5 AND -28.0
              AND NOT (
                REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') <> gv.cep
                AND gc.latitude = gvgeo.latitude
                AND gc.longitude = gvgeo.longitude
              )
            THEN genesis_geo_distancia_km(gc.latitude,gc.longitude,gvgeo.latitude,gvgeo.longitude)
            ELSE NULL
          END AS distancia_km,
          CASE
            WHEN LENGTH(REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g'))<>8 THEN 'SEM_CEP_CANDIDATO'
            WHEN c.vaga_id IS NULL THEN 'SEM_VAGA'
            WHEN gv.cep IS NULL THEN 'SEM_CEP_VAGA'
            WHEN gc.status='OK' AND gvgeo.status='OK'
              AND gc.latitude BETWEEN -35.5 AND 6.5 AND gc.longitude BETWEEN -75.5 AND -28.0
              AND gvgeo.latitude BETWEEN -35.5 AND 6.5 AND gvgeo.longitude BETWEEN -75.5 AND -28.0
              AND REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g') <> gv.cep
              AND gc.latitude = gvgeo.latitude
              AND gc.longitude = gvgeo.longitude
            THEN 'COORDENADA_COMPARTILHADA'
            WHEN gc.status='OK' AND gvgeo.status='OK'
              AND gc.latitude BETWEEN -35.5 AND 6.5 AND gc.longitude BETWEEN -75.5 AND -28.0
              AND gvgeo.latitude BETWEEN -35.5 AND 6.5 AND gvgeo.longitude BETWEEN -75.5 AND -28.0
            THEN 'OK'
            WHEN gc.status IN ('SEM_COORDENADAS','NAO_ENCONTRADO')
              OR gvgeo.status IN ('SEM_COORDENADAS','NAO_ENCONTRADO')
            THEN 'INDISPONIVEL'
            ELSE 'PENDENTE'
          END AS geo_status
        FROM candidatos c
        LEFT JOIN geo_vagas gv ON gv.vaga_id=c.vaga_id
        LEFT JOIN geo_ceps gc ON gc.cep=REGEXP_REPLACE(COALESCE(c.cep,''),'\\D','','g')
        LEFT JOIN geo_ceps gvgeo ON gvgeo.cep=gv.cep
        ORDER BY c.id
      `);
      const pendentes = result.rows.filter((row) => row.geo_status === 'PENDENTE').length;
      return res.json({ sucesso: true, distancias: result.rows.map((row) => ({ ...row, distancia_km: row.distancia_km === null ? null : Number(row.distancia_km) })), pendentes });
    } catch (error) { return next(error); }
  });

  app.post('/api/geo/enriquecer', async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 10), 20));
      const resultado = await enrichMissingCeps(pool, { limit, delayMs: 300 });
      return res.json({ sucesso: true, resultado });
    } catch (error) { return next(error); }
  });

  app.get('/api/geo/status', async (_req, res, next) => {
    try {
      const [cache, candidates, vacancies] = await Promise.all([
        pool.query(`SELECT COUNT(*)::INTEGER AS total,
          COUNT(*) FILTER(WHERE status='OK' AND latitude BETWEEN -35.5 AND 6.5 AND longitude BETWEEN -75.5 AND -28.0)::INTEGER AS ok,
          COUNT(*) FILTER(WHERE status<>'OK' OR latitude IS NULL OR longitude IS NULL OR latitude NOT BETWEEN -35.5 AND 6.5 OR longitude NOT BETWEEN -75.5 AND -28.0)::INTEGER AS pendentes
          FROM geo_ceps`),
        pool.query(`SELECT COUNT(*)::INTEGER AS total,COUNT(*) FILTER(WHERE LENGTH(REGEXP_REPLACE(COALESCE(cep,''),'\\D','','g'))=8)::INTEGER AS com_cep FROM candidatos`),
        pool.query(`SELECT COUNT(*)::INTEGER AS total FROM geo_vagas`),
      ]);
      return res.json({ sucesso: true, cache: cache.rows[0], candidatos: candidates.rows[0], vagas_com_cep: Number(vacancies.rows[0]?.total || 0) });
    } catch (error) { return next(error); }
  });
}

module.exports = {
  registerGeoV1,
  normalizeCep,
  fetchBrasilApiCep,
  fetchNominatimCep,
  fetchPreciseCep,
  resolveCep,
  enrichMissingCeps,
  isPlausibleBrazilCoordinatePair,
  listLowPrecisionClusterCeps,
  refreshLowPrecisionClusters,
  listSuspiciousZeroDistanceCeps,
  refreshSuspiciousZeroDistanceCeps,
  countSuspiciousZeroDistancePairs,
  scoreNominatimResult,
};
