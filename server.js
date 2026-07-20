'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const { z } = require('zod');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const PGHOST = process.env.PGHOST;
const PGPORT = Number(process.env.PGPORT || 5432);
const PGDATABASE = process.env.PGDATABASE;
const PGUSER = process.env.PGUSER;
const PGPASSWORD = process.env.PGPASSWORD;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DB_SSL = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
const AI_VAGAS_WEBHOOK_URL = String(process.env.AI_VAGAS_WEBHOOK_URL || '').trim();
const AI_VAGAS_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.AI_VAGAS_TIMEOUT_MS || 60_000), 5_000),
  120_000,
);
const PROMO_WHATSAPP_NUMBER = String(process.env.PROMO_WHATSAPP_NUMBER || '(11) 91302-2278').trim();

if (!DATABASE_URL && (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD)) {
  console.error('ERRO: configure DATABASE_URL ou as variáveis PGHOST, PGDATABASE, PGUSER e PGPASSWORD.');
  process.exit(1);
}

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) {
  console.error('ERRO: configure ADMIN_PASSWORD com pelo menos 10 caracteres.');
  process.exit(1);
}

const pool = new Pool({
  ...(DATABASE_URL
    ? { connectionString: DATABASE_URL }
    : {
        host: PGHOST,
        port: PGPORT,
        database: PGDATABASE,
        user: PGUSER,
        password: PGPASSWORD,
      }),
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  console.error('Erro inesperado no pool do PostgreSQL:', error);
});

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
}));

app.use(express.json({ limit: '1mb' }));

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function basicAuth(req, res, next) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Genesis IA", charset="UTF-8"');
    return res.status(401).send('Autenticação necessária.');
  }

  let decoded = '';
  try {
    decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="Genesis IA", charset="UTF-8"');
    return res.status(401).send('Credenciais inválidas.');
  }

  const separatorIndex = decoded.indexOf(':');
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
    res.set('WWW-Authenticate', 'Basic realm="Genesis IA", charset="UTF-8"');
    return res.status(401).send('Usuário ou senha incorretos.');
  }

  return next();
}

const nullableText = z.union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });

const nullableDate = z.union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Data inválida. Use AAAA-MM-DD.' });
      return z.NEVER;
    }
    return value;
  });

const nullableMoney = z.union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    let normalized = value;
    if (typeof normalized === 'string') {
      normalized = normalized.trim();
      if (normalized.includes(',')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      }
    }
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0) {
      ctx.addIssue({ code: 'custom', message: 'Salário inválido.' });
      return z.NEVER;
    }
    return Math.round(number * 100) / 100;
  });

const vacancySchema = z.object({
  empresa_id: z.coerce.number().int().positive(),
  titulo: z.string().trim().min(2).max(150),
  cargo: z.string().trim().min(2).max(150),
  descricao: nullableText,
  cidade: nullableText,
  estado: z.union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      const state = String(value || 'SP').trim().toUpperCase();
      return state || 'SP';
    })
    .pipe(z.string().length(2)),
  bairro: nullableText,
  endereco_referencia: nullableText,
  tipo_contrato: nullableText,
  modalidade: z.union([z.string(), z.null(), z.undefined()])
    .transform((value) => String(value || 'Presencial').trim() || 'Presencial')
    .pipe(z.string().max(30)),
  escala: nullableText,
  horario: nullableText,
  salario: nullableMoney,
  beneficios: nullableText,
  escolaridade_minima: nullableText,
  experiencia_minima_meses: z.coerce.number().int().min(0).max(600).default(0),
  aceita_sem_experiencia: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(false),
  exigir_experiencia_compativel: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(true),
  cargos_compativeis: nullableText,
  cbos_compativeis: nullableText,
  requisitos_obrigatorios: nullableText,
  requisitos_desejaveis: nullableText,
  quantidade_vagas: z.coerce.number().int().min(1).max(10000).default(1),
  formulario_url: z.union([z.string(), z.null(), z.undefined()])
    .transform((value, ctx) => {
      if (value === null || value === undefined || value.trim() === '') return null;
      try {
        return new URL(value.trim()).toString();
      } catch {
        ctx.addIssue({ code: 'custom', message: 'URL do formulário inválida.' });
        return z.NEVER;
      }
    }),
  status: z.enum(['RASCUNHO', 'ATIVA', 'PAUSADA', 'ENCERRADA']).default('RASCUNHO'),
  data_inicio: nullableDate,
  data_encerramento: nullableDate,
});

const statusSchema = z.object({
  status: z.enum(['RASCUNHO', 'ATIVA', 'PAUSADA', 'ENCERRADA']),
});

const aiVacancyActionValues = [
  'GERAR_TODOS',
  'GERAR_DESCRICAO',
  'SUGERIR_CARGOS',
  'SUGERIR_CBOS',
  'GERAR_REQUISITOS_OBRIGATORIOS',
  'GERAR_REQUISITOS_DESEJAVEIS',
];

const aiVacancyRequestSchema = z.object({
  acao: z.enum(aiVacancyActionValues),
  vaga: z.object({
    titulo: nullableText,
    cargo: nullableText,
    descricao: nullableText,
    cidade: nullableText,
    estado: nullableText,
    bairro: nullableText,
    tipo_contrato: nullableText,
    modalidade: nullableText,
    escala: nullableText,
    horario: nullableText,
    salario: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    beneficios: nullableText,
    escolaridade_minima: nullableText,
    experiencia_minima_meses: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    aceita_sem_experiencia: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).optional(),
    exigir_experiencia_compativel: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).optional(),
    cargos_compativeis: nullableText,
    cbos_compativeis: nullableText,
    requisitos_obrigatorios: nullableText,
    requisitos_desejaveis: nullableText,
  }).passthrough(),
});

function normalizeSuggestionText(value, maxLength = 12_000) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    )].join('\n').slice(0, maxLength);
  }

  if (value === null || value === undefined) return '';

  const text = String(value).trim();
  if (!text) return '';

  return text
    .split(/\r?\n|;|\|/)
    .map((item) => item.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .join('\n')
    .slice(0, maxLength);
}

function normalizeAiVacancySuggestions(payload) {
  const source = payload?.sugestoes
    ?? payload?.suggestions
    ?? payload?.output?.sugestoes
    ?? payload?.output
    ?? payload
    ?? {};

  return {
    descricao: String(source.descricao ?? '').trim().slice(0, 12_000),
    cargos_compativeis: normalizeSuggestionText(source.cargos_compativeis),
    cbos_compativeis: normalizeSuggestionText(source.cbos_compativeis, 4_000),
    requisitos_obrigatorios: normalizeSuggestionText(source.requisitos_obrigatorios),
    requisitos_desejaveis: normalizeSuggestionText(source.requisitos_desejaveis),
  };
}

const candidateStageValues = [
  'PRIMEIRO_CONTATO', 'PERGUNTANDO_EXPERIENCIA', 'ESCOLHENDO_VAGA',
  'AGUARDANDO_CTPS_CEP', 'AGUARDANDO_CTPS', 'AGUARDANDO_CEP',
  'ANALISANDO_DOCUMENTOS', 'APROVADO_TRIAGEM', 'REPROVADO_PRE_TRIAGEM',
  'REPROVADO_TRIAGEM', 'AGUARDANDO_APRESENTACAO', 'GERANDO_OPCOES_ENTREVISTA',
  'ESCOLHENDO_HORARIO', 'AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA',
  'CONTRATADO', 'ENCERRADO'
];

const candidateCreateSchema = z.object({
  nome: nullableText,
  telefone: z.string().transform((value, ctx) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDI, DDD e número.' });
      return z.NEVER;
    }
    return digits;
  }),
  cep: z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length !== 8) {
      ctx.addIssue({ code: 'custom', message: 'CEP deve possuir 8 números.' });
      return z.NEVER;
    }
    return digits;
  }),
  vaga_id: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Vaga inválida.' });
      return z.NEVER;
    }
    return id;
  }),
  status: z.enum(['NOVO', 'EM_PROCESSO', 'APROVADO', 'REPROVADO', 'CONTRATADO', 'ENCERRADO']).default('NOVO'),
  etapa: z.enum(candidateStageValues).default('PRIMEIRO_CONTATO'),
});

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function generateVacancyCode(client, companyId) {
  const normalizedCompanyId = Number(companyId);

  if (!Number.isInteger(normalizedCompanyId) || normalizedCompanyId <= 0) {
    throw new Error('Empresa inválida para geração do código da vaga.');
  }

  // Serializa a geração por empresa. Assim, duas vagas salvas no mesmo
  // instante não recebem o mesmo código.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), $2::INTEGER)`,
    ['genesis_ia_vaga_codigo', normalizedCompanyId],
  );

  const result = await client.query(`
    SELECT
      COALESCE(
        MAX(
          NULLIF(
            substring(UPPER(codigo) FROM '^VAGA-([0-9]+)$'),
            ''
          )::INTEGER
        ),
        0
      ) + 1 AS proximo_numero
    FROM vagas
    WHERE empresa_id = $1
  `, [normalizedCompanyId]);

  const nextNumber = Number(result.rows[0]?.proximo_numero || 1);
  return `VAGA-${String(nextNumber).padStart(3, '0')}`;
}


function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatWhatsappDisplay(value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 13 && digits.startsWith('55')) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return String(value || '').trim() || '(11) 91302-2278';
}

function formatMoneyBRL(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 'Salário a combinar';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(number);
}

function compactText(value, fallback = 'A combinar') {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || fallback;
}

function firstListLine(value, fallback = 'Benefícios informados na vaga') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const first = text
    .split(/\r?\n|;|\|/)
    .map((item) => item.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)[0];
  return (first || fallback).slice(0, 120);
}

function slugify(value) {
  return String(value || 'vaga')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'vaga';
}

function wrapSvgText(value, maxChars = 24, maxLines = 3) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines).map((line, index, array) => (
    index === array.length - 1 && words.join(' ').length > array.join(' ').length
      ? `${line.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
      : line
  ));
}

function buildPromotionAssets(vacancy) {
  const contactDisplay = formatWhatsappDisplay(PROMO_WHATSAPP_NUMBER);
  const contactDigits = normalizePhoneDigits(PROMO_WHATSAPP_NUMBER);
  const title = compactText(vacancy.titulo || vacancy.cargo, 'Vaga disponível');
  const neighborhood = compactText(vacancy.bairro || [vacancy.cidade, vacancy.estado].filter(Boolean).join(' - '), 'Local a combinar');
  const salary = formatMoneyBRL(vacancy.salario);
  const benefits = firstListLine(vacancy.beneficios, 'Benefícios informados no processo seletivo');
  const whatsappText = [
    `*${title} | Início imediato*`,
    `📍 Bairro: ${neighborhood}`,
    `💰 Salário: ${salary}`,
    `🎁 Benefícios: ${benefits}`,
    `📲 Enviar mensagem no WhatsApp para mais informações: ${contactDisplay}`,
  ].join('\n');

  const facebookText = [
    `TEMOS VAGAS — ${title} (início imediato)`,
    `Bairro: ${neighborhood}`,
    `Salário: ${salary}`,
    `Benefícios: ${benefits}`,
    `Enviar mensagem no WhatsApp para mais informações: ${contactDisplay}`,
  ].join('\n');

  const titleLines = wrapSvgText(title.toUpperCase(), 18, 3);
  const salaryLines = wrapSvgText(salary, 18, 2);
  const benefitsLines = wrapSvgText(benefits, 26, 3);
  const neighborhoodLines = wrapSvgText(neighborhood, 22, 2);

  const titleTspans = titleLines.map((line, index) => `<tspan x="90" dy="${index === 0 ? 0 : 56}">${escapeXml(line)}</tspan>`).join('');
  const neighborhoodTspans = neighborhoodLines.map((line, index) => `<tspan x="100" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`).join('');
  const salaryTspans = salaryLines.map((line, index) => `<tspan x="590" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`).join('');
  const benefitsTspans = benefitsLines.map((line, index) => `<tspan x="100" dy="${index === 0 ? 0 : 28}">${escapeXml(line)}</tspan>`).join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="Divulgação da vaga ${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" rx="40" fill="url(#bg)"/>
  <circle cx="980" cy="140" r="160" fill="rgba(255,255,255,0.08)"/>
  <circle cx="160" cy="940" r="220" fill="rgba(255,255,255,0.06)"/>
  <rect x="80" y="72" width="280" height="56" rx="28" fill="#ffffff" opacity="0.95"/>
  <text x="220" y="108" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#0f172a">TEMOS VAGAS</text>
  <text x="82" y="180" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" fill="#dbeafe">ESTAMOS CONTRATANDO</text>
  <text x="90" y="280" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" fill="#ffffff">${titleTspans}</text>
  <text x="90" y="462" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="600" fill="#bfdbfe">INÍCIO IMEDIATO</text>

  <rect x="82" y="520" width="430" height="150" rx="28" fill="#ffffff" opacity="0.96"/>
  <text x="100" y="570" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#1e293b">BAIRRO</text>
  <text x="100" y="616" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#0f172a">${neighborhoodTspans}</text>

  <rect x="548" y="520" width="450" height="150" rx="28" fill="#ffffff" opacity="0.96"/>
  <text x="590" y="570" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#1e293b">SALÁRIO</text>
  <text x="590" y="616" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#0f172a">${salaryTspans}</text>

  <rect x="82" y="710" width="916" height="150" rx="28" fill="#ffffff" opacity="0.96"/>
  <text x="100" y="760" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#1e293b">BENEFÍCIOS</text>
  <text x="100" y="804" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="500" fill="#0f172a">${benefitsTspans}</text>

  <rect x="82" y="898" width="916" height="108" rx="30" fill="#0f172a" opacity="0.94"/>
  <text x="540" y="942" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#bfdbfe">ENVIE MENSAGEM NO WHATSAPP PARA MAIS INFORMAÇÕES</text>
  <text x="540" y="980" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="800" fill="#ffffff">${escapeXml(contactDisplay)}</text>
</svg>`;

  return {
    whatsapp_texto: whatsappText,
    facebook_texto: facebookText,
    contato_display: contactDisplay,
    contato_digits: contactDigits,
    imagem_svg: svg,
    imagem_data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    nome_arquivo: `${slugify(vacancy.codigo || title)}-divulgacao.svg`,
  };
}

function validationError(res, error) {
  return res.status(400).json({
    sucesso: false,
    erro: 'Dados inválidos.',
    detalhes: error.issues.map((issue) => ({
      campo: issue.path.join('.') || 'geral',
      mensagem: issue.message,
    })),
  });
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Falha no health check:', error);
    res.status(503).json({ status: 'erro', banco: 'indisponível' });
  }
});

app.use(basicAuth);

app.get('/api/empresas', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, nome
      FROM empresas
      WHERE ativo = TRUE
      ORDER BY nome ASC
    `);

    res.json({ sucesso: true, empresas: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/candidatos', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id,
        c.nome,
        c.telefone,
        c.vaga_id,
        c.vaga AS vaga_legacy,
        c.status,
        c.etapa,
        c.cep,
        c.observacao_triagem,
        c.motivo_reprovacao,
        c.tempo_faltante_experiencia,
        c.tempo_medio_empresas_texto,
        c.quantidade_vinculos_validos,
        c.updated_at,
        c.apresentacao_profissional,
        c.personalidade_resumo,
        c.personalidade_tags,
        c.personalidade_updated_at,
        v.codigo AS vaga_codigo,
        COALESCE(v.titulo, c.vaga) AS vaga_nome,
        v.status AS vaga_status,
        COALESCE(d.quantidade_documentos, 0)::INTEGER AS quantidade_documentos,
        e.inicio AS entrevista_inicio,
        e.fim AS entrevista_fim,
        e.status AS entrevista_status,
        e.meet_link AS entrevista_meet_link
      FROM candidatos c
      LEFT JOIN vagas v ON v.id = c.vaga_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS quantidade_documentos
        FROM documentos
        WHERE candidato_id = c.id
      ) d ON TRUE
      LEFT JOIN LATERAL (
        SELECT inicio, fim, status, meet_link
        FROM entrevistas
        WHERE candidato_id = c.id
          AND status = 'AGENDADA'
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON TRUE
      ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
    `);

    const candidatos = result.rows;
    const resumo = candidatos.reduce((accumulator, candidato) => {
      const status = String(candidato.status || '').toUpperCase();
      accumulator.total += 1;

      if (status === 'NOVO' || status === 'EM_PROCESSO') {
        accumulator.em_processo += 1;
      }

      if (status === 'APROVADO' || status === 'CONTRATADO') {
        accumulator.aprovados += 1;
      }

      if (status === 'REPROVADO') {
        accumulator.reprovados += 1;
      }

      return accumulator;
    }, {
      total: 0,
      em_processo: 0,
      aprovados: 0,
      reprovados: 0,
    });

    res.json({ sucesso: true, candidatos, resumo });
  } catch (error) {
    next(error);
  }
});

app.get('/api/candidatos/:id/detalhes', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });
    }

    const candidatoResult = await pool.query(`
      SELECT
        c.*,
        v.codigo AS vaga_codigo,
        COALESCE(v.titulo, c.vaga) AS vaga_nome,
        v.bairro AS vaga_bairro,
        v.cidade AS vaga_cidade,
        v.horario AS vaga_horario,
        v.escala AS vaga_escala,
        v.salario AS vaga_salario,
        e.inicio AS entrevista_inicio,
        e.fim AS entrevista_fim,
        e.status AS entrevista_status,
        e.meet_link AS entrevista_meet_link,
        e.google_event_url AS entrevista_google_event_url
      FROM candidatos c
      LEFT JOIN vagas v ON v.id = c.vaga_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM entrevistas
        WHERE candidato_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON TRUE
      WHERE c.id = $1
      LIMIT 1
    `, [id]);

    if (!candidatoResult.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }

    const documentosResult = await pool.query(`
      SELECT
        id,
        tipo,
        titulo,
        COALESCE(nome_arquivo, arquivo, 'documento.pdf') AS nome_arquivo,
        mime_type,
        tamanho_bytes,
        (conteudo IS NOT NULL) AS disponivel_download,
        created_at
      FROM documentos
      WHERE candidato_id = $1
      ORDER BY created_at DESC, id DESC
    `, [id]);

    const timelineResult = await pool.query(`
      SELECT *
      FROM (
        SELECT
          'MENSAGEM'::TEXT AS tipo,
          CASE WHEN quem = 'USUARIO' THEN 'Mensagem do candidato' ELSE 'Mensagem da Evelyn' END AS titulo,
          mensagem::TEXT AS descricao,
          created_at
        FROM mensagens
        WHERE candidato_id = $1

        UNION ALL

        SELECT
          'EVENTO'::TEXT AS tipo,
          REPLACE(evento, '_', ' ') AS titulo,
          descricao::TEXT,
          created_at
        FROM eventos
        WHERE candidato_id = $1

        UNION ALL

        SELECT
          'DOCUMENTO'::TEXT AS tipo,
          COALESCE(titulo, tipo, 'Documento') AS titulo,
          COALESCE(nome_arquivo, arquivo, 'Arquivo recebido') AS descricao,
          created_at
        FROM documentos
        WHERE candidato_id = $1

        UNION ALL

        SELECT
          'ENTREVISTA'::TEXT AS tipo,
          'Entrevista ' || LOWER(status) AS titulo,
          CONCAT(
            'Início: ', TO_CHAR(inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
            CASE WHEN meet_link IS NOT NULL THEN ' | Google Meet disponível' ELSE '' END
          ) AS descricao,
          created_at
        FROM entrevistas
        WHERE candidato_id = $1
      ) linha
      ORDER BY created_at DESC
      LIMIT 200
    `, [id]);

    res.json({
      sucesso: true,
      candidato: candidatoResult.rows[0],
      documentos: documentosResult.rows,
      timeline: timelineResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/documentos/:id/download', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ sucesso: false, erro: 'ID de documento inválido.' });
    }

    const result = await pool.query(`
      SELECT
        COALESCE(nome_arquivo, arquivo, 'documento.pdf') AS nome_arquivo,
        COALESCE(mime_type, 'application/pdf') AS mime_type,
        conteudo
      FROM documentos
      WHERE id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Documento não encontrado.' });
    }

    const documento = result.rows[0];
    if (!documento.conteudo) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Este documento é anterior à ativação do armazenamento para download.',
      });
    }

    const nomeSeguro = String(documento.nome_arquivo || 'documento.pdf')
      .replace(/[\r\n"]/g, '_')
      .slice(0, 180);

    res.setHeader('Content-Type', documento.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', documento.conteudo.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomeSeguro}"; filename*=UTF-8''${encodeURIComponent(nomeSeguro)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(documento.conteudo);
  } catch (error) {
    return next(error);
  }
});


app.post('/api/candidatos', async (req, res, next) => {
  try {
    const parsed = candidateCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const c = parsed.data;

    const result = await pool.query(`
      WITH vaga_selecionada AS (
        SELECT id, titulo
        FROM vagas
        WHERE id = $4
        LIMIT 1
      )
      INSERT INTO candidatos (
        nome, telefone, cep, vaga_id, vaga, status, etapa, aprovado,
        canal, created_at, updated_at
      )
      VALUES (
        $1, $2, $3,
        (SELECT id FROM vaga_selecionada),
        (SELECT titulo FROM vaga_selecionada),
        $5, $6,
        CASE WHEN $5 = 'APROVADO' THEN TRUE WHEN $5 = 'REPROVADO' THEN FALSE ELSE NULL END,
        'Painel Genesis IA', NOW(), NOW()
      )
      RETURNING *
    `, [c.nome, c.telefone, c.cep, c.vaga_id, c.status, c.etapa]);

    res.status(201).json({
      sucesso: true,
      mensagem: 'Candidato adicionado com sucesso.',
      candidato: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/candidatos/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });

    await client.query('BEGIN');
    const candidato = await client.query(`
      SELECT id, nome, telefone,
        EXISTS (SELECT 1 FROM entrevistas e WHERE e.candidato_id = candidatos.id AND e.status = 'AGENDADA') AS possui_entrevista
      FROM candidatos
      WHERE id = $1
      FOR UPDATE
    `, [id]);

    if (!candidato.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }

    const tabelaExiste = async (nome) => {
      const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${nome}`]);
      return Boolean(result.rows[0]?.relation);
    };

    if (await tabelaExiste('n8n_chat_histories')) {
      await client.query('DELETE FROM n8n_chat_histories WHERE session_id = $1', [String(id)]);
    }

    const tabelasDependentes = [
      'entrevistas',
      'entrevista_opcoes',
      'candidato_estado',
      'documentos',
      'eventos',
      'mensagens',
    ];

    for (const tabela of tabelasDependentes) {
      if (await tabelaExiste(tabela)) {
        await client.query(`DELETE FROM ${tabela} WHERE candidato_id = $1`, [id]);
      }
    }

    await client.query('DELETE FROM candidatos WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({
      sucesso: true,
      mensagem: 'Candidato removido do banco de dados.',
      aviso_calendar: candidato.rows[0].possui_entrevista
        ? 'O evento do Google Calendar não é removido pelo painel e deve ser excluído manualmente.'
        : null,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});


app.post('/api/ia/vagas/gerar', async (req, res, next) => {
  try {
    if (!AI_VAGAS_WEBHOOK_URL) {
      return res.status(503).json({
        sucesso: false,
        erro: 'A assistência de IA ainda não foi configurada no servidor.',
      });
    }

    const parsed = aiVacancyRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    const data = parsed.data;
    const titulo = String(data.vaga.titulo || '').trim();
    const cargo = String(data.vaga.cargo || '').trim();

    if (!titulo && !cargo) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Preencha pelo menos o título ou o cargo antes de pedir sugestões à IA.',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_VAGAS_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(AI_VAGAS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origem: 'GENESIS_IA_PAINEL',
          acao: data.acao,
          vaga: data.vaga,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text();
    let body = null;

    try {
      body = responseText ? JSON.parse(responseText) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      console.error('Falha no workflow de IA para vagas:', {
        status: response.status,
        body: body ?? responseText.slice(0, 1_000),
      });

      return res.status(502).json({
        sucesso: false,
        erro: body?.erro
          || body?.message
          || 'O workflow de IA não conseguiu gerar as sugestões.',
      });
    }

    const sugestoes = normalizeAiVacancySuggestions(body);

    if (!Object.values(sugestoes).some(Boolean)) {
      return res.status(502).json({
        sucesso: false,
        erro: 'A IA respondeu, mas não retornou sugestões utilizáveis.',
      });
    }

    return res.json({
      sucesso: true,
      sugestoes,
      avisos: [
        'Revise as sugestões antes de aplicá-las.',
        'Os CBOs são sugeridos pela IA e devem ser confirmados pelo responsável pela vaga.',
      ],
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({
        sucesso: false,
        erro: 'A geração demorou mais que o esperado. Tente novamente.',
      });
    }

    return next(error);
  }
});

app.get('/api/vagas', async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    const busca = String(req.query.busca || '').trim();
    const values = [];
    const filters = [];

    if (status && status !== 'TODAS') {
      if (!['RASCUNHO', 'ATIVA', 'PAUSADA', 'ENCERRADA'].includes(status)) {
        return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
      }
      values.push(status);
      filters.push(`v.status = $${values.length}`);
    }

    if (busca) {
      values.push(`%${busca}%`);
      filters.push(`(
        v.codigo ILIKE $${values.length}
        OR v.titulo ILIKE $${values.length}
        OR v.cargo ILIKE $${values.length}
        OR COALESCE(v.cidade, '') ILIKE $${values.length}
        OR COALESCE(v.bairro, '') ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT
        v.*,
        e.nome AS empresa_nome,
        COALESCE(estatisticas.total_interessados, 0)::INTEGER AS total_interessados,
        COALESCE(estatisticas.em_processo, 0)::INTEGER AS candidatos_em_processo,
        COALESCE(estatisticas.aprovados, 0)::INTEGER AS candidatos_aprovados,
        COALESCE(estatisticas.reprovados, 0)::INTEGER AS candidatos_reprovados
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_interessados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('NOVO', 'EM_PROCESSO')
          ) AS em_processo,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('APROVADO', 'CONTRATADO')
          ) AS aprovados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) = 'REPROVADO'
          ) AS reprovados
        FROM candidatos c
        WHERE c.vaga_id = v.id
      ) estatisticas ON TRUE
      ${where}
      ORDER BY
        CASE v.status
          WHEN 'ATIVA' THEN 1
          WHEN 'RASCUNHO' THEN 2
          WHEN 'PAUSADA' THEN 3
          ELSE 4
        END,
        v.updated_at DESC
    `, values);

    res.json({ sucesso: true, vagas: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/vagas/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const result = await pool.query(`
      SELECT
        v.*,
        e.nome AS empresa_nome,
        COALESCE(estatisticas.total_interessados, 0)::INTEGER AS total_interessados,
        COALESCE(estatisticas.em_processo, 0)::INTEGER AS candidatos_em_processo,
        COALESCE(estatisticas.aprovados, 0)::INTEGER AS candidatos_aprovados,
        COALESCE(estatisticas.reprovados, 0)::INTEGER AS candidatos_reprovados
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_interessados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('NOVO', 'EM_PROCESSO')
          ) AS em_processo,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('APROVADO', 'CONTRATADO')
          ) AS aprovados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) = 'REPROVADO'
          ) AS reprovados
        FROM candidatos c
        WHERE c.vaga_id = v.id
      ) estatisticas ON TRUE
      WHERE v.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    res.json({ sucesso: true, vaga: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/vagas', async (req, res, next) => {
  const client = await pool.connect();

  try {
    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) {
      return validationError(res, parsed.error);
    }

    const v = parsed.data;

    await client.query('BEGIN');

    const codigo = await generateVacancyCode(client, v.empresa_id);

    const result = await client.query(`
      INSERT INTO vagas (
        empresa_id, codigo, titulo, cargo, descricao, cidade, estado, bairro,
        endereco_referencia, tipo_contrato, modalidade, escala, horario, salario,
        beneficios, escolaridade_minima, experiencia_minima_meses,
        aceita_sem_experiencia, exigir_experiencia_compativel, cargos_compativeis,
        cbos_compativeis, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, status, data_inicio, data_encerramento
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28
      )
      RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.beneficios, v.escolaridade_minima,
      v.experiencia_minima_meses, v.aceita_sem_experiencia,
      v.exigir_experiencia_compativel, v.cargos_compativeis, v.cbos_compativeis,
      v.requisitos_obrigatorios, v.requisitos_desejaveis, v.quantidade_vagas,
      v.formulario_url, v.status, v.data_inicio, v.data_encerramento,
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      sucesso: true,
      mensagem: `Vaga ${codigo} cadastrada com sucesso.`,
      vaga: result.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Falha ao desfazer criação da vaga:', rollbackError);
    }
    next(error);
  } finally {
    client.release();
  }
});

app.put('/api/vagas/:id', async (req, res, next) => {
  const client = await pool.connect();

  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    }

    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) {
      return validationError(res, parsed.error);
    }

    const v = parsed.data;

    await client.query('BEGIN');

    const currentResult = await client.query(`
      SELECT id, empresa_id, codigo
      FROM vagas
      WHERE id = $1
      FOR UPDATE
    `, [id]);

    if (!currentResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    const currentVacancy = currentResult.rows[0];
    const companyChanged = Number(currentVacancy.empresa_id) !== Number(v.empresa_id);

    // Normalmente o código permanece imutável. Caso a vaga seja movida para
    // outra empresa, um novo código é criado automaticamente para evitar
    // conflito com os códigos da empresa de destino.
    const codigo = companyChanged
      ? await generateVacancyCode(client, v.empresa_id)
      : currentVacancy.codigo;

    const result = await client.query(`
      UPDATE vagas
      SET
        empresa_id = $1,
        codigo = $2,
        titulo = $3,
        cargo = $4,
        descricao = $5,
        cidade = $6,
        estado = $7,
        bairro = $8,
        endereco_referencia = $9,
        tipo_contrato = $10,
        modalidade = $11,
        escala = $12,
        horario = $13,
        salario = $14,
        beneficios = $15,
        escolaridade_minima = $16,
        experiencia_minima_meses = $17,
        aceita_sem_experiencia = $18,
        exigir_experiencia_compativel = $19,
        cargos_compativeis = $20,
        cbos_compativeis = $21,
        requisitos_obrigatorios = $22,
        requisitos_desejaveis = $23,
        quantidade_vagas = $24,
        formulario_url = $25,
        status = $26,
        data_inicio = $27,
        data_encerramento = $28,
        updated_at = NOW()
      WHERE id = $29
      RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.beneficios, v.escolaridade_minima,
      v.experiencia_minima_meses, v.aceita_sem_experiencia,
      v.exigir_experiencia_compativel, v.cargos_compativeis, v.cbos_compativeis,
      v.requisitos_obrigatorios, v.requisitos_desejaveis, v.quantidade_vagas,
      v.formulario_url, v.status, v.data_inicio, v.data_encerramento, id,
    ]);

    await client.query('COMMIT');

    res.json({
      sucesso: true,
      mensagem: companyChanged
        ? `Vaga atualizada e recebeu o novo código ${codigo}.`
        : 'Vaga atualizada com sucesso.',
      vaga: result.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Falha ao desfazer atualização da vaga:', rollbackError);
    }
    next(error);
  } finally {
    client.release();
  }
});

app.patch('/api/vagas/:id/status', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    const result = await pool.query(`
      UPDATE vagas
      SET
        status = $1,
        data_encerramento = CASE
          WHEN $1 = 'ENCERRADA' THEN COALESCE(data_encerramento, CURRENT_DATE)
          ELSE data_encerramento
        END,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [parsed.data.status, id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    res.json({
      sucesso: true,
      mensagem: 'Status alterado com sucesso.',
      vaga: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});


app.post('/api/vagas/:id/divulgacao', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const result = await pool.query(`
      SELECT v.*, e.nome AS empresa_nome
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
      WHERE v.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    const assets = buildPromotionAssets(result.rows[0]);

    res.json({
      sucesso: true,
      divulgacao: assets,
      vaga: {
        id: result.rows[0].id,
        codigo: result.rows[0].codigo,
        titulo: result.rows[0].titulo,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0,
}));

app.use((req, res, next) => {
  if (req.method === 'GET') {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return next();
});

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error && error.code === '23505') {
    const constraint = String(error.constraint || '');
    return res.status(409).json({
      sucesso: false,
      erro: constraint.toLowerCase().includes('candidato') || constraint.toLowerCase().includes('telefone')
        ? 'Já existe um candidato cadastrado com esse telefone.'
        : 'Não foi possível gerar um código automático exclusivo. Tente salvar novamente.',
    });
  }

  if (error && error.code === '23503') {
    return res.status(400).json({
      sucesso: false,
      erro: 'A empresa informada não existe ou está inválida.',
    });
  }

  return res.status(500).json({
    sucesso: false,
    erro: 'Erro interno. Consulte os logs do serviço no EasyPanel.',
  });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Genesis IA iniciado na porta ${PORT}.`);
    });
  } catch (error) {
    console.error('Não foi possível conectar ao PostgreSQL:', error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`${signal} recebido. Encerrando aplicação...`);
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
