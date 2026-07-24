'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const { z } = require('zod');
const sharp = require('sharp');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const PGHOST = process.env.PGHOST;
const PGPORT = Number(process.env.PGPORT || 5432);
const PGDATABASE = process.env.PGDATABASE;
const PGUSER = process.env.PGUSER;
const PGPASSWORD = process.env.PGPASSWORD;
const APP_LOGIN_USER = String(process.env.APP_LOGIN_USER || process.env.ADMIN_USER || 'recrutadora').trim();
const APP_LOGIN_PASSWORD = String(process.env.APP_LOGIN_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();
const APP_LOGIN_NAME = String(process.env.APP_LOGIN_NAME || 'Recrutadora').trim();
const SESSION_TTL_HOURS = Math.min(Math.max(Number(process.env.SESSION_TTL_HOURS || 12), 1), 168);
const APP_SESSION_SECRET = String(
  process.env.APP_SESSION_SECRET
  || crypto.createHash('sha256').update(APP_LOGIN_PASSWORD || 'genesis-ia').digest('hex'),
).trim();
const DB_SSL = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
const AI_VAGAS_WEBHOOK_URL = String(process.env.AI_VAGAS_WEBHOOK_URL || '').trim();
const AI_VAGAS_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.AI_VAGAS_TIMEOUT_MS || 60_000), 5_000),
  120_000,
);
const PROMO_WHATSAPP_NUMBER = String(process.env.PROMO_WHATSAPP_NUMBER || '(11) 91302-2278').trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const DIVULGACAO_API_TOKEN = String(process.env.DIVULGACAO_API_TOKEN || '').trim();
const REPROVACAO_WEBHOOK_URL = String(process.env.REPROVACAO_WEBHOOK_URL || '').trim();
const REPROVACAO_WEBHOOK_TOKEN = String(process.env.REPROVACAO_WEBHOOK_TOKEN || '').trim();
const REPROVACAO_WEBHOOK_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.REPROVACAO_WEBHOOK_TIMEOUT_MS || 20_000), 3_000),
  60_000,
);

if (!DATABASE_URL && (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD)) {
  console.error('ERRO: configure DATABASE_URL ou as variáveis PGHOST, PGDATABASE, PGUSER e PGPASSWORD.');
  process.exit(1);
}

if (!APP_LOGIN_PASSWORD || APP_LOGIN_PASSWORD.length < 8) {
  console.error('ERRO: configure APP_LOGIN_PASSWORD (ou ADMIN_PASSWORD) com pelo menos 8 caracteres.');
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
      imgSrc: ["'self'", 'data:', 'blob:'],
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

function normalizeAnalyticsPeriod(value) {
  const normalized = String(value || '1D').trim().toUpperCase();
  const allowed = { '1D': 1, '7D': 7, '30D': 30 };
  return { key: allowed[normalized] ? normalized : '1D', days: allowed[normalized] || 1 };
}

async function triggerPostInterviewRejection(payload) {
  if (!REPROVACAO_WEBHOOK_URL) {
    return {
      configurado: false,
      enviado: false,
      aviso: 'REPROVACAO_WEBHOOK_URL ainda não foi configurada no EasyPanel.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPROVACAO_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(REPROVACAO_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: REPROVACAO_WEBHOOK_TOKEN,
        candidato_id: payload.candidatoId,
        origem: 'PAINEL_POS_ENTREVISTA',
        motivo: payload.motivo || '',
        observacao: payload.observacao || '',
        solicitado_por: payload.solicitadoPor || 'Recrutadora',
        finalizar_buffer: false,
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.erro || body.message || `Webhook retornou HTTP ${response.status}.`);
    }
    return {
      configurado: true,
      enviado: body.enviado !== false,
      convite_incluido: Boolean(body.convite_incluido),
      ja_convidado: Boolean(body.ja_convidado),
      aviso: body.aviso || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseCookies(req) {
  const result = {};
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', APP_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req).genesis_session;
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.', 2);
  const expected = crypto
    .createHmac('sha256', APP_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.exp || Number(payload.exp) < Date.now()) return null;
    if (!safeEqual(payload.usuario, APP_LOGIN_USER)) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookieOptions(req) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

function requireLogin(req, res, next) {
  const session = readSession(req);
  if (session) {
    req.user = session;
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ sucesso: false, erro: 'Sua sessão expirou. Entre novamente.' });
  }
  return res.redirect('/login');
}

function currentUserName(req) {
  return String(req.user?.nome || APP_LOGIN_NAME || APP_LOGIN_USER || 'Recrutadora');
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
  possui_insalubridade: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(false),
  percentual_insalubridade: z.union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === '') return null;
      const number = Number(String(value).replace(',', '.'));
      if (!Number.isFinite(number) || number < 0 || number > 100) {
        ctx.addIssue({ code: 'custom', message: 'Percentual de insalubridade inválido.' });
        return z.NEVER;
      }
      return Math.round(number * 100) / 100;
    }),
  observacao_insalubridade: nullableText,
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
    possui_insalubridade: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).optional(),
    percentual_insalubridade: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    observacao_insalubridade: nullableText,
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

function normalizeCboSuggestions(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '').split(/\r?\n|;|\|/);

  const details = [];

  for (const item of source) {
    const object = item && typeof item === 'object' ? item : null;
    const raw = object ? String(object.codigo ?? '') : String(item ?? '');
    const codigo = raw.match(/\b\d{4}(?:-\d{2})?\b/)?.[0] ?? '';
    if (!codigo) continue;

    const confidence = String(object?.confianca ?? 'MEDIA').trim().toUpperCase();
    if (confidence === 'BAIXA') continue;

    if (details.some((entry) => entry.codigo === codigo)) continue;

    details.push({
      codigo,
      titulo: String(object?.titulo ?? '').trim().slice(0, 180),
      confianca: ['ALTA', 'MEDIA'].includes(confidence) ? confidence : 'MEDIA',
      justificativa: String(object?.justificativa ?? '').trim().slice(0, 400),
    });
  }

  return details.slice(0, 10);
}

function normalizeAiVacancySuggestions(payload) {
  const source = payload?.sugestoes
    ?? payload?.suggestions
    ?? payload?.output?.sugestoes
    ?? payload?.output
    ?? payload
    ?? {};

  const cboDetails = normalizeCboSuggestions(
    source.cbo_detalhes?.length ? source.cbo_detalhes : source.cbos_compativeis,
  );

  return {
    descricao: String(source.descricao ?? '').trim().slice(0, 12_000),
    cargos_compativeis: normalizeSuggestionText(source.cargos_compativeis),
    cbos_compativeis: cboDetails.map((item) => item.codigo).join('\n'),
    cbo_detalhes: cboDetails,
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

function promotionTheme(vacancy) {
  const source = compactText([
    vacancy.titulo,
    vacancy.cargo,
    vacancy.descricao,
  ].filter(Boolean).join(' '), '').toLowerCase();

  const themes = [
    {
      key: 'limpeza',
      match: /(limpeza|faxina|higieniza|serviços gerais|servicos gerais|asseio|conservação|conservacao)/,
      colors: ['#052e2b', '#047857', '#22c55e'],
      label: 'LIMPEZA & CONSERVAÇÃO',
      icon: '<path d="M780 158c48 20 78 64 78 112 0 64-52 116-116 116-38 0-72-18-94-47 23 10 49 11 75 1 55-21 83-83 62-138-8-20-20-35-35-49 10 0 20 2 30 5Z" fill="#ecfdf5" opacity=".95"/><path d="M858 193l24 12 12 24-12 24-24 12-24-12-12-24 12-24 24-12Z" fill="#fef08a"/><path d="M715 335l60 137h-120l60-137Z" fill="#86efac"/><rect x="693" y="455" width="44" height="175" rx="20" fill="#f8fafc"/><path d="M635 621h160l-35 93H670l-35-93Z" fill="#bbf7d0"/>',
    },
    {
      key: 'seguranca',
      match: /(porteiro|portaria|vigil|segurança|seguranca|controlador de acesso)/,
      colors: ['#111827', '#1d4ed8', '#38bdf8'],
      label: 'SEGURANÇA & PORTARIA',
      icon: '<path d="M748 150l128 45v98c0 96-55 181-128 215-73-34-128-119-128-215v-98l128-45Z" fill="#dbeafe"/><path d="M748 198v252c52-31 86-93 86-157v-68l-86-27Z" fill="#60a5fa"/><path d="M688 290l38 38 84-88" fill="none" stroke="#0f172a" stroke-width="25" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    {
      key: 'rh',
      match: /(recursos humanos|rh\b|recrutamento|seleção|selecao|departamento pessoal|dp\b)/,
      colors: ['#3b0764', '#7e22ce', '#c084fc'],
      label: 'RECURSOS HUMANOS',
      icon: '',
    },
    {
      key: 'administrativo',
      match: /(administr|recep|financeiro|assistente|secretár|secretar|atendimento)/,
      colors: ['#172554', '#4f46e5', '#a78bfa'],
      label: 'ADMINISTRATIVO & ATENDIMENTO',
      icon: '<rect x="630" y="170" width="240" height="320" rx="28" fill="#ede9fe"/><rect x="675" y="220" width="150" height="22" rx="11" fill="#6366f1"/><rect x="675" y="274" width="150" height="18" rx="9" fill="#c4b5fd"/><rect x="675" y="320" width="120" height="18" rx="9" fill="#c4b5fd"/><circle cx="748" cy="411" r="50" fill="#818cf8"/><path d="M670 505c12-56 46-84 78-84s66 28 78 84" fill="#ddd6fe"/>',
    },
    {
      key: 'manutencao',
      match: /(manutenção|manutencao|eletric|encanador|técnico|tecnico|mecân|mecan|predial)/,
      colors: ['#292524', '#c2410c', '#fb923c'],
      label: 'MANUTENÇÃO & OPERAÇÕES',
      icon: '<path d="M814 171c-31 5-58 23-76 49l57 57-61 61-58-58c-26 18-44 46-49 78-8 58 33 112 91 120 58 8 112-33 120-91 4-29-4-58-20-80l-67 67-62-62 67-67c18 13 38 21 58 22Z" fill="#ffedd5"/><path d="M668 439l-84 84c-16 16-16 42 0 58s42 16 58 0l84-84-58-58Z" fill="#fed7aa"/>',
    },
    {
      key: 'logistica',
      match: /(logística|logistica|estoque|almox|motorista|entrega|expedição|expedicao|operador de empilhadeira)/,
      colors: ['#082f49', '#0369a1', '#22d3ee'],
      label: 'LOGÍSTICA & DISTRIBUIÇÃO',
      icon: '<rect x="595" y="250" width="180" height="150" rx="15" fill="#cffafe"/><path d="M775 300h80l64 75v25H775V300Z" fill="#67e8f9"/><circle cx="665" cy="425" r="36" fill="#0e7490"/><circle cx="845" cy="425" r="36" fill="#0e7490"/><circle cx="665" cy="425" r="15" fill="#ecfeff"/><circle cx="845" cy="425" r="15" fill="#ecfeff"/><path d="M640 250v-65h180v115" fill="none" stroke="#ecfeff" stroke-width="28" stroke-linecap="round"/>',
    },
    {
      key: 'alimentacao',
      match: /(cozinha|cozinheiro|copeir|alimenta|restaurante|garçom|garcom|confeiteiro|padeiro)/,
      colors: ['#431407', '#dc2626', '#f59e0b'],
      label: 'ALIMENTAÇÃO & SERVIÇOS',
      icon: '<path d="M618 320c0-89 58-150 130-150s130 61 130 150H618Z" fill="#fef3c7"/><rect x="603" y="320" width="290" height="35" rx="17" fill="#fde68a"/><path d="M680 172c0-40 30-72 68-72s68 32 68 72" fill="none" stroke="#fff7ed" stroke-width="30" stroke-linecap="round"/><path d="M650 420h195" stroke="#fff7ed" stroke-width="25" stroke-linecap="round"/>',
    },
    {
      key: 'tecnologia',
      match: /(tecnologia|ti\b|suporte|desenvolv|programador|analista de sistemas|infraestrutura|dados)/,
      colors: ['#0f172a', '#6d28d9', '#06b6d4'],
      label: 'TECNOLOGIA & INOVAÇÃO',
      icon: '<rect x="600" y="170" width="290" height="220" rx="25" fill="#e0f2fe"/><rect x="635" y="205" width="220" height="145" rx="12" fill="#0f172a"/><path d="M690 255l-35 25 35 25M800 255l35 25-35 25M752 235l-25 92" fill="none" stroke="#22d3ee" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><path d="M695 420h100M745 390v30" stroke="#e0f2fe" stroke-width="25" stroke-linecap="round"/>',
    },
    {
      key: 'saude',
      match: /(saúde|saude|enferm|cuidador|hospital|clínic|clinic|farmácia|farmacia)/,
      colors: ['#083344', '#0f766e', '#2dd4bf'],
      label: 'SAÚDE & CUIDADO',
      icon: '<path d="M750 475C615 390 595 302 635 242c38-58 117-48 153 8 36-56 115-66 153-8 40 60 20 148-115 233l-38 25-38-25Z" fill="#ccfbf1"/><path d="M760 260h56v66h66v56h-66v66h-56v-66h-66v-56h66v-66Z" fill="#14b8a6"/>',
    },
  ];

  return themes.find((theme) => theme.match.test(source)) || {
    key: 'generico',
    colors: ['#111827', '#4338ca', '#22d3ee'],
    label: 'OPORTUNIDADE PROFISSIONAL',
    icon: '<circle cx="748" cy="270" r="105" fill="#e0e7ff"/><circle cx="748" cy="240" r="48" fill="#6366f1"/><path d="M640 425c15-86 64-132 108-132s93 46 108 132" fill="#a5b4fc"/><path d="M618 485h260" stroke="#ecfeff" stroke-width="28" stroke-linecap="round"/>',
  };
}


function listItems(value, fallback = []) {
  const items = String(value || '')
    .split(/\r?\n|;|\|/)
    .map((item) => item.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
  return items.length ? items : fallback;
}

function formatPercentage(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(number);
}

function themePhotoDataUri(themeKey) {
  const safeKey = /^[a-z0-9_-]+$/i.test(themeKey) ? themeKey : 'generico';
  const candidates = [
    path.join(__dirname, 'public', 'assets', 'vacancy-themes', `${safeKey}.jpg`),
    path.join(__dirname, 'public', 'assets', 'vacancy-themes', 'generico.jpg'),
  ];

  for (const filePath of candidates) {
    try {
      const buffer = fs.readFileSync(filePath);
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch {}
  }

  return '';
}

function buildSvgTextLines(lines, options = {}) {
  const {
    x = 0,
    lineHeight = 32,
    maxLines = lines.length,
    prefix = '',
  } = options;

  return lines.slice(0, maxLines).map((line, index) => (
    `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(prefix + line)}</tspan>`
  )).join('');
}

function calculateInsalubrity(vacancy) {
  const active = vacancy.possui_insalubridade === true
    || String(vacancy.possui_insalubridade || '').toLowerCase() === 'true';
  const percentage = Number(vacancy.percentual_insalubridade);
  const salary = Number(vacancy.salario);

  if (!active) return null;

  const percentText = Number.isFinite(percentage)
    ? `${formatPercentage(percentage)}%`
    : 'percentual a confirmar';
  const estimatedValue = Number.isFinite(percentage) && Number.isFinite(salary) && salary > 0
    ? salary * (percentage / 100)
    : null;

  return {
    percentage: Number.isFinite(percentage) ? percentage : null,
    percentText,
    estimatedValue,
    estimatedText: estimatedValue ? formatMoneyBRL(estimatedValue) : '',
    observation: compactText(vacancy.observacao_insalubridade, ''),
  };
}

function buildPromotionAssets(vacancy) {
  const contactDisplay = formatWhatsappDisplay(PROMO_WHATSAPP_NUMBER);
  const contactDigits = normalizePhoneDigits(PROMO_WHATSAPP_NUMBER);
  const title = compactText(vacancy.titulo || vacancy.cargo, 'Vaga disponível');
  const location = compactText(
    vacancy.bairro || [vacancy.cidade, vacancy.estado].filter(Boolean).join(' - '),
    'Local a combinar',
  );
  const salary = formatMoneyBRL(vacancy.salario);
  const scheduleParts = [
    vacancy.escala ? `Escala ${compactText(vacancy.escala, '')}` : '',
    vacancy.horario ? compactText(vacancy.horario, '') : '',
  ].filter(Boolean);
  const schedule = scheduleParts.length ? scheduleParts.join(' · ') : 'Horário a confirmar';
  const benefits = listItems(
    vacancy.beneficios,
    ['Benefícios informados durante o processo seletivo'],
  );
  const requirements = listItems(vacancy.requisitos_obrigatorios, []);
  const desired = listItems(vacancy.requisitos_desejaveis, []);
  const description = compactText(vacancy.descricao, 'Atividades e detalhes informados durante o processo seletivo.');
  const theme = promotionTheme(vacancy);
  const photoDataUri = themePhotoDataUri(theme.key);
  const insalubrity = calculateInsalubrity(vacancy);

  const insalubrityText = insalubrity
    ? `🧪 Insalubridade: ${insalubrity.percentText}${insalubrity.estimatedText ? ` (aprox. ${insalubrity.estimatedText})` : ''}${insalubrity.observation ? ` — ${insalubrity.observation}` : ''}`
    : '';

  const whatsappText = [
    `*${title} | Início imediato*`,
    `📍 Bairro: ${location}`,
    `🕐 Horário de trabalho: ${schedule}`,
    `💰 Salário: ${salary}`,
    insalubrityText,
    `🎁 Benefícios: ${benefits.join(' | ')}`,
    `📲 Enviar mensagem no WhatsApp para mais informações: ${contactDisplay}`,
  ].filter(Boolean).join('\n');

  const facebookText = [
    `📢 TEMOS VAGAS — ${title} | início imediato`,
    `📍 Bairro: ${location}`,
    `🕐 Horário de trabalho: ${schedule}`,
    `💰 Salário: ${salary}`,
    insalubrityText,
    `🎁 Benefícios: ${benefits.join(' | ')}`,
    `📲 Chame no WhatsApp para mais informações: ${contactDisplay}`,
  ].filter(Boolean).join('\n');

  const titleLines = wrapSvgText(title, 20, 3);
  const locationLines = wrapSvgText(location, 27, 2);
  const scheduleLines = wrapSvgText(schedule, 28, 2);
  const salaryLines = wrapSvgText(salary, 20, 2);
  const benefitLines = benefits.flatMap((item) => wrapSvgText(item, 31, 2)).slice(0, 5);
  const insalubrityLines = insalubrity
    ? wrapSvgText(
        `${insalubrity.percentText}${insalubrity.estimatedText ? ` · ${insalubrity.estimatedText}` : ''}`,
        24,
        2,
      )
    : [];

  const photoMarkup = photoDataUri
    ? `<image href="${photoDataUri}" x="540" y="0" width="540" height="1350" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="540" y="0" width="540" height="1350" fill="${theme.colors[1]}"/>`;

  const primarySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="Divulgação da vaga ${escapeXml(title)}">
  <defs>
    <linearGradient id="leftBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#020c20"/>
      <stop offset="55%" stop-color="#062b5b"/>
      <stop offset="100%" stop-color="#0b4d8a"/>
    </linearGradient>
    <linearGradient id="ctaBg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0b9f41"/>
      <stop offset="100%" stop-color="#27c65f"/>
    </linearGradient>
    <clipPath id="photoClip"><path d="M595 0H1080V1350H520C585 1115 560 850 548 620C536 370 570 150 595 0Z"/></clipPath>
    <linearGradient id="photoShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#041832" stop-opacity=".88"/>
      <stop offset="34%" stop-color="#041832" stop-opacity=".18"/>
      <stop offset="100%" stop-color="#041832" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#020617" flood-opacity=".24"/></filter>
  </defs>

  <rect width="1080" height="1350" fill="#07172f"/>
  <g clip-path="url(#photoClip)">${photoMarkup}<rect x="520" width="560" height="1350" fill="url(#photoShade)"/></g>
  <path d="M0 0H628C588 165 555 344 553 527C551 817 608 1037 523 1350H0Z" fill="url(#leftBg)"/>
  <circle cx="94" cy="1268" r="240" fill="#2563eb" opacity=".08"/>
  <circle cx="508" cy="98" r="150" fill="#38bdf8" opacity=".06"/>

  <rect x="44" y="52" width="304" height="74" rx="36" fill="#fbbf24" filter="url(#shadow)"/>
  <text x="196" y="101" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="33" font-weight="900" fill="#06234b">VAGA ABERTA</text>

  <text x="48" y="208" font-family="Arial, Helvetica, sans-serif" font-size="57" font-weight="900" fill="#ffffff">${buildSvgTextLines(titleLines, { x: 48, lineHeight: 61 })}</text>
  <text x="50" y="385" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="850" fill="#fbbf24">| Início imediato</text>

  <g transform="translate(40 438)">
    <rect width="480" height="114" rx="27" fill="#082e61" stroke="#dbeafe" stroke-opacity=".8" stroke-width="2"/>
    <circle cx="57" cy="57" r="39" fill="#0f5ba8" stroke="#7dd3fc" stroke-width="3"/>
    <text x="57" y="70" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="33" fill="#ffffff">⌖</text>
    <text x="112" y="42" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#bae6fd">BAIRRO / LOCAL</text>
    <text x="112" y="77" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="850" fill="#ffffff">${buildSvgTextLines(locationLines, { x: 112, lineHeight: 31 })}</text>
  </g>

  <g transform="translate(40 570)">
    <rect width="480" height="114" rx="27" fill="#082e61" stroke="#dbeafe" stroke-opacity=".8" stroke-width="2"/>
    <circle cx="57" cy="57" r="39" fill="#0f5ba8" stroke="#7dd3fc" stroke-width="3"/>
    <text x="57" y="70" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="31" fill="#ffffff">◷</text>
    <text x="112" y="42" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#bae6fd">ESCALA E HORÁRIO</text>
    <text x="112" y="77" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="850" fill="#ffffff">${buildSvgTextLines(scheduleLines, { x: 112, lineHeight: 30 })}</text>
  </g>

  <g transform="translate(40 702)">
    <rect width="480" height="112" rx="27" fill="#082e61" stroke="#dbeafe" stroke-opacity=".8" stroke-width="2"/>
    <circle cx="57" cy="56" r="39" fill="#0f5ba8" stroke="#7dd3fc" stroke-width="3"/>
    <text x="57" y="68" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="31" fill="#ffffff">$</text>
    <text x="112" y="40" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#bae6fd">SALÁRIO</text>
    <text x="112" y="78" font-family="Arial, Helvetica, sans-serif" font-size="33" font-weight="900" fill="#fbbf24">${buildSvgTextLines(salaryLines, { x: 112, lineHeight: 34 })}</text>
  </g>

  ${insalubrity ? `<g transform="translate(40 832)">
    <rect width="480" height="108" rx="27" fill="#422006" stroke="#fbbf24" stroke-opacity=".9" stroke-width="2"/>
    <circle cx="57" cy="54" r="39" fill="#854d0e" stroke="#fde68a" stroke-width="3"/>
    <text x="57" y="66" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="#ffffff">+</text>
    <text x="112" y="38" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#fde68a">INSALUBRIDADE</text>
    <text x="112" y="74" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="#ffffff">${buildSvgTextLines(insalubrityLines, { x: 112, lineHeight: 31 })}</text>
  </g>` : ''}

  <g transform="translate(40 ${insalubrity ? 958 : 840})">
    <rect width="480" height="${insalubrity ? 190 : 246}" rx="27" fill="#082e61" stroke="#dbeafe" stroke-opacity=".8" stroke-width="2"/>
    <text x="28" y="38" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" fill="#bae6fd">BENEFÍCIOS</text>
    <text x="30" y="75" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="760" fill="#ffffff">${buildSvgTextLines(benefitLines, { x: 30, lineHeight: 31, prefix: '• ' })}</text>
  </g>

  <g transform="translate(34 1180)">
    <rect width="590" height="132" rx="32" fill="url(#ctaBg)" filter="url(#shadow)"/>
    <circle cx="67" cy="66" r="45" fill="#ffffff" opacity=".98"/>
    <text x="67" y="80" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="39" font-weight="900" fill="#16a34a">☎</text>
    <text x="132" y="48" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Envie mensagem no WhatsApp</text>
    <text x="132" y="92" font-family="Arial, Helvetica, sans-serif" font-size="39" font-weight="900" fill="#ffffff">${escapeXml(contactDisplay)}</text>
  </g>
</svg>`;

  const detailBenefitLines = benefits.flatMap((item) => wrapSvgText(item, 46, 2)).slice(0, 9);
  const descriptionLines = wrapSvgText(description, 52, 7);
  const requirementLines = requirements.flatMap((item) => wrapSvgText(item, 45, 2)).slice(0, 8);
  const desiredLines = desired.flatMap((item) => wrapSvgText(item, 45, 2)).slice(0, 6);
  const detailsSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="Detalhes da vaga ${escapeXml(title)}">
  <defs>
    <linearGradient id="detailsBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#020c20"/><stop offset="100%" stop-color="#0b4d8a"/></linearGradient>
    <linearGradient id="detailsCta" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#0b9f41"/><stop offset="100%" stop-color="#27c65f"/></linearGradient>
  </defs>
  <rect width="1080" height="1350" rx="44" fill="url(#detailsBg)"/>
  <circle cx="1000" cy="80" r="220" fill="#38bdf8" opacity=".08"/>
  <rect x="50" y="48" width="260" height="62" rx="31" fill="#fbbf24"/>
  <text x="180" y="90" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="900" fill="#06234b">DETALHES DA VAGA</text>
  <text x="52" y="178" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="900" fill="#ffffff">${buildSvgTextLines(wrapSvgText(title, 31, 2), { x: 52, lineHeight: 54 })}</text>
  <text x="54" y="294" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="#fbbf24">${escapeXml(schedule)} · ${escapeXml(location)}</text>

  <rect x="50" y="336" width="980" height="210" rx="28" fill="#ffffff" opacity=".97"/>
  <text x="82" y="382" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#1e3a8a">SOBRE A OPORTUNIDADE</text>
  <text x="82" y="425" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="650" fill="#0f172a">${buildSvgTextLines(descriptionLines, { x: 82, lineHeight: 31 })}</text>

  <rect x="50" y="570" width="475" height="310" rx="28" fill="#ffffff" opacity=".97"/>
  <text x="82" y="617" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#1e3a8a">BENEFÍCIOS</text>
  <text x="82" y="658" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="650" fill="#0f172a">${buildSvgTextLines(detailBenefitLines, { x: 82, lineHeight: 30, prefix: '• ' })}</text>

  <rect x="555" y="570" width="475" height="310" rx="28" fill="#ffffff" opacity=".97"/>
  <text x="587" y="617" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#1e3a8a">REQUISITOS OBRIGATÓRIOS</text>
  <text x="587" y="658" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="650" fill="#0f172a">${buildSvgTextLines(requirementLines.length ? requirementLines : ['Informados durante o processo seletivo'], { x: 587, lineHeight: 29, prefix: '• ' })}</text>

  <rect x="50" y="904" width="980" height="190" rx="28" fill="#ffffff" opacity=".97"/>
  <text x="82" y="950" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#1e3a8a">DIFERENCIAIS</text>
  <text x="82" y="992" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="650" fill="#0f172a">${buildSvgTextLines(desiredLines.length ? desiredLines : ['Perfil responsável, pontual e comprometido'], { x: 82, lineHeight: 29, prefix: '• ' })}</text>

  ${insalubrity ? `<rect x="50" y="1117" width="980" height="86" rx="25" fill="#422006" stroke="#fbbf24" stroke-width="2"/><text x="82" y="1153" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" fill="#fde68a">ADICIONAL DE INSALUBRIDADE</text><text x="82" y="1185" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="#ffffff">${escapeXml(insalubrity.percentText)}${insalubrity.estimatedText ? ` · Aproximadamente ${escapeXml(insalubrity.estimatedText)}` : ''}${insalubrity.observation ? ` · ${escapeXml(insalubrity.observation)}` : ''}</text>` : ''}

  <rect x="50" y="1230" width="980" height="82" rx="28" fill="url(#detailsCta)"/>
  <text x="540" y="1282" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="900" fill="#ffffff">WhatsApp ${escapeXml(contactDisplay)}</text>
</svg>`;

  return {
    whatsapp_texto: whatsappText,
    facebook_texto: facebookText,
    contato_display: contactDisplay,
    contato_digits: contactDigits,
    tema: theme.key,
    imagem_svg: primarySvg,
    imagem_data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(primarySvg)}`,
    imagem_detalhes_svg: detailsSvg,
    imagem_detalhes_data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(detailsSvg)}`,
    nome_arquivo: `${slugify(vacancy.codigo || title)}-divulgacao.svg`,
    nome_arquivo_detalhes: `${slugify(vacancy.codigo || title)}-detalhes.svg`,
  };
}

async function promotionPng(vacancy, type = 'principal') {
  const assets = buildPromotionAssets(vacancy);
  const svg = type === 'detalhes' && assets.imagem_detalhes_svg
    ? assets.imagem_detalhes_svg
    : assets.imagem_svg;
  return sharp(Buffer.from(svg, 'utf8')).png({ quality: 94, compressionLevel: 8 }).toBuffer();
}

async function loadVacancyForPromotion(id) {
  const result = await pool.query(`
    SELECT v.*, e.nome AS empresa_nome
    FROM vagas v
    JOIN empresas e ON e.id = v.empresa_id
    WHERE v.id = $1
    LIMIT 1
  `, [id]);
  return result.rows[0] || null;
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

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/login.html', (_req, res) => res.redirect('/login'));
app.get('/login.css', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.css')));
app.get('/login.js', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.js')));

app.post('/api/auth/login', (req, res) => {
  const usuario = String(req.body?.usuario || '').trim();
  const senha = String(req.body?.senha || '');
  if (!safeEqual(usuario, APP_LOGIN_USER) || !safeEqual(senha, APP_LOGIN_PASSWORD)) {
    return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha incorretos.' });
  }
  const payload = {
    usuario: APP_LOGIN_USER,
    nome: APP_LOGIN_NAME,
    exp: Date.now() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
  };
  res.cookie('genesis_session', signSession(payload), sessionCookieOptions(req));
  return res.json({ sucesso: true, usuario: { usuario: APP_LOGIN_USER, nome: APP_LOGIN_NAME } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('genesis_session', { ...sessionCookieOptions(req), maxAge: 0 });
  return res.json({ sucesso: true });
});

app.get('/api/public/vagas/:id/divulgacao/:tipo.png', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!DIVULGACAO_API_TOKEN || !safeEqual(token, DIVULGACAO_API_TOKEN)) {
      return res.status(401).json({ sucesso: false, erro: 'Token de divulgação inválido.' });
    }
    const id = parseId(req.params.id);
    const tipo = String(req.params.tipo || 'principal').toLowerCase();
    if (!id || !['principal', 'detalhes'].includes(tipo)) {
      return res.status(400).json({ sucesso: false, erro: 'Parâmetros inválidos.' });
    }
    const vacancy = await loadVacancyForPromotion(id);
    if (!vacancy) return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    const png = await promotionPng(vacancy, tipo);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(png);
  } catch (error) { return next(error); }
});

app.use(requireLogin);
app.get('/api/auth/me', (req, res) => res.json({
  sucesso: true,
  usuario: { usuario: req.user.usuario, nome: req.user.nome || APP_LOGIN_NAME },
}));


app.get('/api/dashboard', async (req, res, next) => {
  try {
    const period = normalizeAnalyticsPeriod(req.query.periodo);
    const [metricas, funil, entrevistas] = await Promise.all([
      pool.query(`
        WITH periodo AS (
          SELECT (
            DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            - (($1::INTEGER - 1) * INTERVAL '1 day')
          ) AT TIME ZONE 'America/Sao_Paulo' AS inicio
        ),
        entrevista_atual AS (
          SELECT DISTINCT ON (candidato_id)
            candidato_id, inicio, status
          FROM entrevistas
          WHERE status = 'AGENDADA'
          ORDER BY candidato_id, updated_at DESC NULLS LAST, created_at DESC, id DESC
        ),
        vaga_preferida AS (
          SELECT
            c.vaga_id,
            COALESCE(v.titulo, c.vaga, 'Vaga não informada') AS nome,
            COUNT(*)::INTEGER AS quantidade
          FROM candidatos c
          LEFT JOIN vagas v ON v.id = c.vaga_id
          CROSS JOIN periodo p
          WHERE c.vaga_id IS NOT NULL
            AND COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
          GROUP BY c.vaga_id, COALESCE(v.titulo, c.vaga, 'Vaga não informada')
          ORDER BY quantidade DESC, nome ASC
          LIMIT 1
        )
        SELECT
          (SELECT COUNT(*) FROM candidatos)::INTEGER AS total_candidatos,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) IN ('NOVO', 'EM_PROCESSO'))::INTEGER AS em_processo,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'APROVADO')::INTEGER AS aprovados_triagem,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'EM_ADMISSAO')::INTEGER AS em_admissao,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'CONTRATADO')::INTEGER AS contratados,
          (SELECT COUNT(*) FROM vagas WHERE status = 'ATIVA')::INTEGER AS vagas_ativas,
          (SELECT COUNT(*) FROM entrevista_atual WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS entrevistas_hoje,
          (SELECT COUNT(*) FROM entrevista_atual WHERE inicio >= NOW() AND inicio < NOW() + INTERVAL '7 days')::INTEGER AS entrevistas_7_dias,
          (SELECT COUNT(*) FROM mensagens m CROSS JOIN periodo p WHERE UPPER(COALESCE(m.quem, '')) IN ('USUARIO', 'CANDIDATO') AND m.created_at >= p.inicio)::INTEGER AS mensagens_recebidas_periodo,
          (SELECT COUNT(*) FROM candidatos c CROSS JOIN periodo p WHERE c.created_at >= p.inicio)::INTEGER AS candidatos_periodo,
          COALESCE((SELECT nome FROM vaga_preferida), 'Sem dados no período') AS vaga_mais_escolhida_nome,
          COALESCE((SELECT quantidade FROM vaga_preferida), 0)::INTEGER AS vaga_mais_escolhida_quantidade
      `, [period.days]),
      pool.query(`
        SELECT etapa, COUNT(*)::INTEGER AS quantidade
        FROM candidatos
        WHERE UPPER(COALESCE(status, '')) NOT IN ('REPROVADO', 'CONTRATADO', 'ENCERRADO')
        GROUP BY etapa
        ORDER BY quantidade DESC, etapa ASC
      `),
      pool.query(`
        WITH atuais AS (
          SELECT DISTINCT ON (candidato_id)
            id, candidato_id, inicio, fim, meet_link, google_event_url
          FROM entrevistas
          WHERE status = 'AGENDADA'
          ORDER BY candidato_id, updated_at DESC NULLS LAST, created_at DESC, id DESC
        )
        SELECT
          e.id, e.candidato_id, e.inicio, e.fim, e.meet_link, e.google_event_url,
          COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
          COALESCE(v.titulo, c.vaga, 'Vaga não informada') AS vaga_nome
        FROM atuais e
        JOIN candidatos c ON c.id = e.candidato_id
        LEFT JOIN vagas v ON v.id = c.vaga_id
        WHERE e.inicio >= NOW()
        ORDER BY e.inicio ASC
        LIMIT 16
      `),
    ]);
    res.json({
      sucesso: true,
      periodo: period.key,
      metricas: metricas.rows[0],
      funil: funil.rows,
      proximas_entrevistas: entrevistas.rows,
      atualizado_em: new Date().toISOString(),
    });
  } catch (error) { next(error); }
});

app.post('/api/alertas/resolver', async (req, res, next) => {
  try {
    const chave = String(req.body?.chave || '').trim();
    if (!chave || chave.length > 300) {
      return res.status(400).json({ sucesso: false, erro: 'Chave de alerta inválida.' });
    }

    await pool.query(`
      INSERT INTO alertas_resolvidos (chave, resolvido_por, observacao, resolvido_em)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (chave)
      DO UPDATE SET
        resolvido_por = EXCLUDED.resolvido_por,
        observacao = EXCLUDED.observacao,
        resolvido_em = NOW()
    `, [chave, currentUserName(req), String(req.body?.observacao || '').trim() || null]);

    res.json({ sucesso: true, mensagem: 'Alerta marcado como resolvido.' });
  } catch (error) {
    next(error);
  }
});

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

      if (status === 'APROVADO') accumulator.aprovados += 1;
      if (status === 'EM_ADMISSAO') accumulator.em_admissao += 1;
      if (status === 'CONTRATADO') accumulator.contratados += 1;

      if (status === 'REPROVADO') {
        accumulator.reprovados += 1;
      }

      return accumulator;
    }, {
      total: 0,
      em_processo: 0,
      aprovados: 0,
      em_admissao: 0,
      contratados: 0,
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

        UNION ALL

        SELECT
          'AUDITORIA'::TEXT AS tipo,
          CASE acao
            WHEN 'ADICIONADO' THEN 'Candidato adicionado'
            WHEN 'REMOVIDO' THEN 'Candidato removido'
            ELSE 'Cadastro modificado'
          END AS titulo,
          CASE
            WHEN acao = 'MODIFICADO' THEN 'Campos alterados: ' || COALESCE(
              (SELECT STRING_AGG(valor, ', ') FROM JSONB_ARRAY_ELEMENTS_TEXT(campos_alterados) AS campos(valor)),
              'não identificados'
            )
            ELSE COALESCE(nome, telefone, 'Registro de auditoria')
          END AS descricao,
          created_at
        FROM auditoria_candidatos
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
        nome, telefone, cep, vaga_id, vaga, vaga_escolhida_at, status, etapa, aprovado,
        canal, created_at, updated_at
      )
      VALUES (
        $1, $2, $3,
        (SELECT id FROM vaga_selecionada),
        (SELECT titulo FROM vaga_selecionada),
        CASE WHEN EXISTS (SELECT 1 FROM vaga_selecionada) THEN NOW() ELSE NULL END,
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
        'Para CBO, o sistema descartou sugestões de baixa confiança. Confirme código e título na consulta oficial do Ministério do Trabalho antes de salvar.',
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
    const period = normalizeAnalyticsPeriod(req.query.periodo);
    const status = String(req.query.status || '').trim().toUpperCase();
    const busca = String(req.query.busca || '').trim();
    const values = [period.days];
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
      WITH periodo AS (
        SELECT (
          DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
          - (($1::INTEGER - 1) * INTERVAL '1 day')
        ) AT TIME ZONE 'America/Sao_Paulo' AS inicio
      )
      SELECT
        v.*,
        e.nome AS empresa_nome,
        COALESCE(estatisticas.total_interessados, 0)::INTEGER AS total_interessados,
        COALESCE(estatisticas.em_processo, 0)::INTEGER AS candidatos_em_processo,
        COALESCE(estatisticas.aprovados, 0)::INTEGER AS candidatos_aprovados,
        COALESCE(estatisticas.reprovados, 0)::INTEGER AS candidatos_reprovados,
        COALESCE(estatisticas.total_interessados_periodo, 0)::INTEGER AS total_interessados_periodo,
        COALESCE(estatisticas.funil_periodo, 0)::INTEGER AS candidatos_funil_periodo,
        COALESCE(estatisticas.aprovados_periodo, 0)::INTEGER AS candidatos_aprovados_periodo,
        COALESCE(estatisticas.reprovados_periodo, 0)::INTEGER AS candidatos_reprovados_periodo
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_interessados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('NOVO', 'EM_PROCESSO')
          ) AS em_processo,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) IN ('APROVADO', 'EM_ADMISSAO', 'CONTRATADO')
          ) AS aprovados,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) = 'REPROVADO'
          ) AS reprovados,
          COUNT(*) FILTER (
            WHERE COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
          ) AS total_interessados_periodo,
          COUNT(*) FILTER (
            WHERE COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
              AND UPPER(COALESCE(c.status, '')) IN ('NOVO', 'EM_PROCESSO', 'APROVADO', 'EM_ADMISSAO')
          ) AS funil_periodo,
          COUNT(*) FILTER (
            WHERE COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
              AND UPPER(COALESCE(c.status, '')) IN ('APROVADO', 'EM_ADMISSAO', 'CONTRATADO')
          ) AS aprovados_periodo,
          COUNT(*) FILTER (
            WHERE COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
              AND UPPER(COALESCE(c.status, '')) = 'REPROVADO'
          ) AS reprovados_periodo
        FROM candidatos c
        CROSS JOIN periodo p
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

    const ranked = [...result.rows].sort((a, b) =>
      Number(b.total_interessados_periodo || 0) - Number(a.total_interessados_periodo || 0)
      || String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR')
    );
    const top = ranked.find((vaga) => Number(vaga.total_interessados_periodo || 0) > 0) || null;

    res.json({
      sucesso: true,
      periodo: period.key,
      vagas: result.rows,
      resumo_periodo: {
        vaga_mais_escolhida_id: top?.id || null,
        vaga_mais_escolhida_nome: top?.titulo || 'Sem dados no período',
        vaga_mais_escolhida_quantidade: Number(top?.total_interessados_periodo || 0),
      },
    });
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
        possui_insalubridade, percentual_insalubridade, observacao_insalubridade,
        beneficios, escolaridade_minima, experiencia_minima_meses,
        aceita_sem_experiencia, exigir_experiencia_compativel, cargos_compativeis,
        cbos_compativeis, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, status, data_inicio, data_encerramento
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30, $31
      )
      RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.possui_insalubridade,
      v.possui_insalubridade ? v.percentual_insalubridade : null,
      v.possui_insalubridade ? v.observacao_insalubridade : null,
      v.beneficios, v.escolaridade_minima, v.experiencia_minima_meses,
      v.aceita_sem_experiencia, v.exigir_experiencia_compativel,
      v.cargos_compativeis, v.cbos_compativeis, v.requisitos_obrigatorios,
      v.requisitos_desejaveis, v.quantidade_vagas, v.formulario_url,
      v.status, v.data_inicio, v.data_encerramento,
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
        possui_insalubridade = $15,
        percentual_insalubridade = $16,
        observacao_insalubridade = $17,
        beneficios = $18,
        escolaridade_minima = $19,
        experiencia_minima_meses = $20,
        aceita_sem_experiencia = $21,
        exigir_experiencia_compativel = $22,
        cargos_compativeis = $23,
        cbos_compativeis = $24,
        requisitos_obrigatorios = $25,
        requisitos_desejaveis = $26,
        quantidade_vagas = $27,
        formulario_url = $28,
        status = $29,
        data_inicio = $30,
        data_encerramento = $31,
        updated_at = NOW()
      WHERE id = $32
      RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.possui_insalubridade,
      v.possui_insalubridade ? v.percentual_insalubridade : null,
      v.possui_insalubridade ? v.observacao_insalubridade : null,
      v.beneficios, v.escolaridade_minima, v.experiencia_minima_meses,
      v.aceita_sem_experiencia, v.exigir_experiencia_compativel,
      v.cargos_compativeis, v.cbos_compativeis, v.requisitos_obrigatorios,
      v.requisitos_desejaveis, v.quantidade_vagas, v.formulario_url,
      v.status, v.data_inicio, v.data_encerramento, id,
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


app.get('/api/vagas/:id/divulgacao/:tipo.png', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const tipo = String(req.params.tipo || 'principal').toLowerCase();
    if (!id || !['principal', 'detalhes'].includes(tipo)) {
      return res.status(400).json({ sucesso: false, erro: 'Parâmetros inválidos.' });
    }
    const vacancy = await loadVacancyForPromotion(id);
    if (!vacancy) return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    const png = await promotionPng(vacancy, tipo);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${slugify(vacancy.codigo || vacancy.titulo)}-${tipo}.png"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(png);
  } catch (error) { return next(error); }
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
    const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    assets.imagem_png_url = `/api/vagas/${id}/divulgacao/principal.png`;
    assets.imagem_detalhes_png_url = `/api/vagas/${id}/divulgacao/detalhes.png`;
    if (DIVULGACAO_API_TOKEN) {
      assets.imagem_publica_png_url = `${base}/api/public/vagas/${id}/divulgacao/principal.png?token=${encodeURIComponent(DIVULGACAO_API_TOKEN)}`;
      assets.imagem_detalhes_publica_png_url = `${base}/api/public/vagas/${id}/divulgacao/detalhes.png?token=${encodeURIComponent(DIVULGACAO_API_TOKEN)}`;
    }

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



app.get('/api/entrevistas', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'AGENDADA').trim().toUpperCase();
    const periodo = String(req.query.periodo || 'PROXIMAS').trim().toUpperCase();
    const values = [];
    const filters = [];

    if (status && status !== 'TODAS') {
      values.push(status);
      filters.push(`UPPER(COALESCE(e.status, '')) = $${values.length}`);
    }

    if (periodo === 'HOJE') {
      filters.push(`e.inicio >= DATE_TRUNC('day', NOW()) AND e.inicio < DATE_TRUNC('day', NOW()) + INTERVAL '1 day'`);
    } else if (periodo === 'SEMANA') {
      filters.push(`e.inicio >= NOW() - INTERVAL '1 day' AND e.inicio < NOW() + INTERVAL '7 days'`);
    } else if (periodo === 'PROXIMAS') {
      filters.push(`e.inicio >= NOW() - INTERVAL '2 hours'`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await pool.query(`
      WITH entrevistas_base AS (
        SELECT e.*,
          ROW_NUMBER() OVER (
            PARTITION BY e.candidato_id, UPPER(COALESCE(e.status, ''))
            ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC, e.id DESC
          ) AS ordem_agendada
        FROM entrevistas e
      )
      SELECT
        e.*,
        COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
        c.telefone,
        c.status AS candidato_status,
        c.etapa AS candidato_etapa,
        COALESCE(v.titulo, c.vaga, 'Vaga não informada') AS vaga_nome,
        v.codigo AS vaga_codigo,
        v.horario AS vaga_horario,
        v.escala AS vaga_escala
      FROM entrevistas_base e
      JOIN candidatos c ON c.id = e.candidato_id
      LEFT JOIN vagas v ON v.id = c.vaga_id
      ${where}
        ${where ? 'AND' : 'WHERE'} (UPPER(COALESCE(e.status, '')) <> 'AGENDADA' OR e.ordem_agendada = 1)
      ORDER BY e.inicio ASC NULLS LAST, e.created_at DESC
      LIMIT 500
    `, values);

    res.json({ sucesso: true, entrevistas: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/documentos', async (req, res, next) => {
  try {
    const tipo = String(req.query.tipo || '').trim().toUpperCase();
    const values = [];
    const filters = [];

    if (tipo && tipo !== 'TODOS') {
      values.push(tipo);
      filters.push(`UPPER(COALESCE(d.tipo, '')) = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT
        d.id,
        d.candidato_id,
        d.tipo,
        d.titulo,
        COALESCE(d.nome_arquivo, d.arquivo, 'documento.pdf') AS nome_arquivo,
        d.mime_type,
        d.tamanho_bytes,
        d.resultado,
        d.created_at,
        (d.conteudo IS NOT NULL) AS disponivel_download,
        COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
        c.telefone,
        COALESCE(v.titulo, c.vaga, 'Vaga não vinculada') AS vaga_nome
      FROM documentos d
      JOIN candidatos c ON c.id = d.candidato_id
      LEFT JOIN vagas v ON v.id = c.vaga_id
      ${where}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT 1000
    `, values);

    res.json({ sucesso: true, documentos: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/monitoramento', async (_req, res, next) => {
  try {
    const [metricas, logs, erros, tarefas, alertas, atividades, recentes, followups, divulgacoes] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM atendimento_logs WHERE created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS entradas_24h,
          (SELECT COUNT(*) FROM atendimento_logs WHERE candidato_id IS NULL AND created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS entradas_sem_candidato_24h,
          (SELECT COUNT(*) FROM workflow_erros WHERE resolvido IS FALSE)::INTEGER AS erros_pendentes,
          (SELECT COUNT(*) FROM workflow_erros WHERE created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS erros_24h,
          (SELECT COUNT(*) FROM documentos WHERE UPPER(COALESCE(tipo, '')) = 'PENDENTE')::INTEGER AS documentos_pendentes,
          (SELECT COUNT(*) FROM candidatos WHERE etapa = 'ANALISANDO_DOCUMENTOS')::INTEGER AS candidatos_analisando,
          (SELECT COUNT(*) FROM candidato_followups WHERE enviado_em >= NOW() - INTERVAL '24 hours' AND status = 'ENVIADO')::INTEGER AS followups_24h,
          (SELECT COUNT(*) FROM divulgacao_vagas_envios WHERE enviado_em >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AND status IN ('IMAGEM_ENVIADA','TEXTO_ENVIADO','ENVIADO'))::INTEGER AS divulgacoes_hoje,
          (SELECT MAX(created_at) FROM atendimento_logs) AS ultima_entrada,
          (SELECT MAX(created_at) FROM mensagens WHERE quem = 'IA') AS ultima_resposta_ia,
          (SELECT MAX(created_at) FROM candidatos) AS ultimo_candidato_criado,
          (SELECT MAX(enviado_em) FROM divulgacao_vagas_envios WHERE status IN ('IMAGEM_ENVIADA','TEXTO_ENVIADO','ENVIADO')) AS ultima_divulgacao
      `),
      pool.query(`
        SELECT l.id, l.mensagem_id, l.candidato_id, l.telefone_extraido,
          l.raw_from, l.raw_sender_alt, l.tipo_mensagem, l.mime_type,
          l.nome_arquivo, l.status, l.detalhe, l.created_at,
          c.nome AS candidato_nome
        FROM atendimento_logs l
        LEFT JOIN candidatos c ON c.id = l.candidato_id
        ORDER BY l.created_at DESC LIMIT 120
      `),
      pool.query(`SELECT * FROM workflow_erros ORDER BY resolvido ASC, created_at DESC LIMIT 120`),
      pool.query(`
        SELECT t.*, COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome
        FROM candidato_tarefas t JOIN candidatos c ON c.id = t.candidato_id
        WHERE t.status IN ('PENDENTE', 'EM_ANDAMENTO')
        ORDER BY t.vencimento ASC NULLS LAST, t.created_at DESC LIMIT 80
      `),
      pool.query(`
        WITH alertas AS (
          SELECT 'entrada:' || l.id AS chave, 'CRITICO'::TEXT AS severidade,
            'ENTRADA_SEM_CANDIDATO'::TEXT AS tipo, 'Acionamento sem candidato'::TEXT AS titulo,
            CONCAT(COALESCE(NULLIF(l.telefone_extraido, ''), 'Telefone não identificado'), ' · ', COALESCE(l.tipo_mensagem, 'mensagem'), ' · não vinculado ao cadastro') AS descricao,
            l.candidato_id, l.created_at
          FROM atendimento_logs l
          WHERE l.candidato_id IS NULL AND l.created_at < NOW() - INTERVAL '5 minutes'
          UNION ALL
          SELECT 'documento:' || d.id, 'ALTO', 'DOCUMENTO_PENDENTE',
            COALESCE(c.nome, 'Candidato sem nome') || ' enviou um PDF',
            'Documento parado em classificação há mais de 20 minutos', d.candidato_id, d.created_at
          FROM documentos d JOIN candidatos c ON c.id = d.candidato_id
          WHERE UPPER(COALESCE(d.tipo, '')) = 'PENDENTE' AND d.created_at < NOW() - INTERVAL '20 minutes'
          UNION ALL
          SELECT 'candidato:' || c.id || ':' || c.etapa, 'MEDIO', 'CANDIDATO_PARADO',
            COALESCE(c.nome, 'Candidato #' || c.id),
            CONCAT('Sem avanço há ', GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.updated_at)) / 3600)::INTEGER), ' hora(s) em ', REPLACE(c.etapa, '_', ' ')),
            c.id, c.updated_at
          FROM candidatos c
          WHERE c.status IN ('NOVO', 'EM_PROCESSO', 'APROVADO')
            AND c.etapa IN ('ANALISANDO_DOCUMENTOS','GERANDO_OPCOES_ENTREVISTA','ESCOLHENDO_HORARIO','AGUARDANDO_CTPS_CEP','AGUARDANDO_CTPS','AGUARDANDO_CEP','AGUARDANDO_APRESENTACAO')
            AND c.updated_at < NOW() - INTERVAL '18 hours'
        )
        SELECT a.* FROM alertas a
        LEFT JOIN alertas_resolvidos r ON r.chave = a.chave
        WHERE r.chave IS NULL
        ORDER BY CASE a.severidade WHEN 'CRITICO' THEN 1 WHEN 'ALTO' THEN 2 ELSE 3 END, a.created_at ASC
        LIMIT 150
      `),
      pool.query(`
        SELECT id, candidato_id, acao, nome, telefone, campos_alterados, created_at
        FROM auditoria_candidatos ORDER BY created_at DESC LIMIT 60
      `),
      pool.query(`
        SELECT c.id, c.nome, c.telefone, c.status, c.etapa, c.updated_at,
          COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada') AS vaga_nome
        FROM candidatos c LEFT JOIN vagas v ON v.id = c.vaga_id
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC LIMIT 20
      `),
      pool.query(`
        SELECT f.*, COALESCE(c.nome, c.telefone, 'Candidato #' || c.id) AS candidato_nome
        FROM candidato_followups f JOIN candidatos c ON c.id = f.candidato_id
        ORDER BY f.enviado_em DESC LIMIT 50
      `),
      pool.query(`
        SELECT d.*, v.codigo, v.titulo AS vaga_titulo
        FROM divulgacao_vagas_envios d JOIN vagas v ON v.id = d.vaga_id
        ORDER BY d.enviado_em DESC LIMIT 50
      `),
    ]);

    res.json({
      sucesso: true,
      metricas: metricas.rows[0], logs: logs.rows, erros: erros.rows,
      tarefas_pendentes: tarefas.rows, alertas: alertas.rows,
      atividades: atividades.rows, candidatos_recentes: recentes.rows,
      followups: followups.rows, divulgacoes: divulgacoes.rows,
      atualizado_em: new Date().toISOString(),
    });
  } catch (error) { next(error); }
});

app.post('/api/workflow-erros/:id/resolver', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const result = await pool.query(`
      UPDATE workflow_erros
      SET resolvido = TRUE, resolvido_por = $1, resolvido_em = NOW()
      WHERE id = $2
      RETURNING id
    `, [currentUserName(req), id]);

    if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Erro não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Erro marcado como resolvido.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/busca-global', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ sucesso: true, resultados: [] });
    const pattern = `%${q}%`;

    const [candidatos, vagas, documentos] = await Promise.all([
      pool.query(`
        SELECT
          'CANDIDATO'::TEXT AS tipo,
          c.id,
          COALESCE(c.nome, c.telefone, 'Candidato #' || c.id) AS titulo,
          CONCAT(COALESCE(c.telefone, ''), ' · ', COALESCE(v.titulo, c.vaga, 'Sem vaga')) AS subtitulo
        FROM candidatos c
        LEFT JOIN vagas v ON v.id = c.vaga_id
        WHERE COALESCE(c.nome, '') ILIKE $1
           OR COALESCE(c.telefone, '') ILIKE $1
           OR COALESCE(c.cpf, '') ILIKE $1
           OR COALESCE(v.titulo, c.vaga, '') ILIKE $1
        ORDER BY c.updated_at DESC
        LIMIT 10
      `, [pattern]),
      pool.query(`
        SELECT
          'VAGA'::TEXT AS tipo,
          v.id,
          CONCAT(v.codigo, ' · ', v.titulo) AS titulo,
          CONCAT_WS(' · ', NULLIF(v.bairro, ''), NULLIF(v.cidade, ''), NULLIF(v.horario, '')) AS subtitulo
        FROM vagas v
        WHERE v.codigo ILIKE $1 OR v.titulo ILIKE $1 OR v.cargo ILIKE $1
           OR COALESCE(v.bairro, '') ILIKE $1 OR COALESCE(v.cidade, '') ILIKE $1
        ORDER BY v.updated_at DESC
        LIMIT 10
      `, [pattern]),
      pool.query(`
        SELECT
          'DOCUMENTO'::TEXT AS tipo,
          d.id,
          COALESCE(d.nome_arquivo, d.arquivo, 'Documento') AS titulo,
          CONCAT(COALESCE(c.nome, c.telefone, 'Candidato'), ' · ', COALESCE(d.tipo, 'OUTRO')) AS subtitulo,
          d.candidato_id
        FROM documentos d
        JOIN candidatos c ON c.id = d.candidato_id
        WHERE COALESCE(d.nome_arquivo, d.arquivo, '') ILIKE $1
           OR COALESCE(c.nome, '') ILIKE $1
           OR COALESCE(c.telefone, '') ILIKE $1
        ORDER BY d.created_at DESC
        LIMIT 10
      `, [pattern]),
    ]);

    res.json({
      sucesso: true,
      resultados: [...candidatos.rows, ...vagas.rows, ...documentos.rows],
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/candidatos/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const allowedStatuses = ['NOVO', 'EM_PROCESSO', 'APROVADO', 'EM_ADMISSAO', 'REPROVADO', 'CONTRATADO', 'ENCERRADO'];
    const status = req.body?.status ? String(req.body.status).trim().toUpperCase() : null;
    const etapa = req.body?.etapa ? String(req.body.etapa).trim().toUpperCase() : null;
    const vagaId = req.body?.vaga_id === null || req.body?.vaga_id === ''
      ? null
      : req.body?.vaga_id !== undefined ? Number(req.body.vaga_id) : undefined;

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
    }
    if (etapa && !/^[A-Z0-9_]{2,80}$/.test(etapa)) {
      return res.status(400).json({ sucesso: false, erro: 'Etapa inválida.' });
    }
    if (vagaId !== undefined && vagaId !== null && (!Number.isInteger(vagaId) || vagaId <= 0)) {
      return res.status(400).json({ sucesso: false, erro: 'Vaga inválida.' });
    }

    const result = await pool.query(`
      UPDATE candidatos
      SET
        status = COALESCE($1, status),
        etapa = COALESCE($2, etapa),
        vaga_escolhida_at = CASE
          WHEN $3::BOOLEAN AND vaga_id IS DISTINCT FROM $4::BIGINT THEN NOW()
          ELSE vaga_escolhida_at
        END,
        vaga_id = CASE WHEN $3::BOOLEAN THEN $4::BIGINT ELSE vaga_id END,
        vaga = CASE
          WHEN $3::BOOLEAN AND $4::BIGINT IS NOT NULL
          THEN COALESCE((SELECT titulo FROM vagas WHERE id = $4::BIGINT), vaga)
          WHEN $3::BOOLEAN AND $4::BIGINT IS NULL THEN NULL
          ELSE vaga
        END,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [status, etapa, vagaId !== undefined, vagaId ?? null, id]);

    if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Candidato atualizado.', candidato: result.rows[0] });
  } catch (error) {
    next(error);
  }
});


app.post('/api/candidatos/:id/decisao-pos-entrevista', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const decisao = String(req.body?.decisao || '').trim().toUpperCase();
    const motivo = String(req.body?.motivo || '').trim();
    const observacao = String(req.body?.observacao || '').trim();
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    if (!['EM_ADMISSAO', 'REPROVADO_POS_ENTREVISTA', 'CONTRATADO'].includes(decisao)) {
      return res.status(400).json({ sucesso: false, erro: 'Decisão inválida.' });
    }
    if (decisao === 'REPROVADO_POS_ENTREVISTA' && motivo.length < 3) {
      return res.status(400).json({ sucesso: false, erro: 'Informe o motivo da reprovação após a entrevista.' });
    }

    const status = decisao === 'REPROVADO_POS_ENTREVISTA' ? 'REPROVADO' : decisao;
    const etapa = decisao;
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE candidatos
      SET
        status = $1,
        etapa = $2,
        motivo_reprovacao_pos_entrevista = CASE WHEN $2 = 'REPROVADO_POS_ENTREVISTA' THEN $3 ELSE NULL END,
        observacao_decisao_pos_entrevista = NULLIF($4, ''),
        decisao_pos_entrevista_at = NOW(),
        decisao_pos_entrevista_por = $5,
        admissao_iniciada_at = CASE WHEN $2 = 'EM_ADMISSAO' THEN COALESCE(admissao_iniciada_at, NOW()) ELSE admissao_iniciada_at END,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [status, etapa, motivo || null, observacao, currentUserName(req), id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }
    const descricao = decisao === 'REPROVADO_POS_ENTREVISTA'
      ? `Reprovado após entrevista. Motivo: ${motivo}${observacao ? ` | Observação: ${observacao}` : ''}`
      : decisao === 'EM_ADMISSAO'
        ? `Candidato movido para admissão${observacao ? `: ${observacao}` : '.'}`
        : `Candidato marcado como contratado${observacao ? `: ${observacao}` : '.'}`;
    await client.query(`
      INSERT INTO eventos (candidato_id, evento, descricao, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [id, decisao, descricao]);
    await client.query('COMMIT');

    let conviteGrupo = null;
    if (decisao === 'REPROVADO_POS_ENTREVISTA') {
      try {
        conviteGrupo = await triggerPostInterviewRejection({
          candidatoId: id,
          motivo,
          observacao,
          solicitadoPor: currentUserName(req),
        });
      } catch (webhookError) {
        console.error('Falha ao notificar reprovação e grupo:', webhookError);
        conviteGrupo = {
          configurado: Boolean(REPROVACAO_WEBHOOK_URL),
          enviado: false,
          erro: webhookError.message,
        };
      }
    }

    return res.json({
      sucesso: true,
      mensagem: decisao === 'REPROVADO_POS_ENTREVISTA'
        ? 'Reprovação registrada.'
        : 'Decisão registrada.',
      candidato: result.rows[0],
      convite_grupo: conviteGrupo,
      aviso: conviteGrupo?.aviso
        || (conviteGrupo && conviteGrupo.enviado === false
          ? 'A decisão foi salva, mas a mensagem ao candidato não foi confirmada. Você pode clicar em salvar novamente para tentar o envio.'
          : null),
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally { client.release(); }
});

app.get('/api/candidatos/:id/notas', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const result = await pool.query(`
      SELECT * FROM candidato_notas
      WHERE candidato_id = $1
      ORDER BY created_at DESC
    `, [id]);
    res.json({ sucesso: true, notas: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/candidatos/:id/notas', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const nota = String(req.body?.nota || '').trim();
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    if (nota.length < 2 || nota.length > 8000) {
      return res.status(400).json({ sucesso: false, erro: 'A nota deve ter entre 2 e 8000 caracteres.' });
    }
    const result = await pool.query(`
      INSERT INTO candidato_notas (candidato_id, nota, criado_por)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [id, nota, currentUserName(req)]);
    res.status(201).json({ sucesso: true, nota: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/candidatos/:id/tarefas', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const result = await pool.query(`
      SELECT * FROM candidato_tarefas
      WHERE candidato_id = $1
      ORDER BY
        CASE status WHEN 'PENDENTE' THEN 1 WHEN 'EM_ANDAMENTO' THEN 2 ELSE 3 END,
        vencimento ASC NULLS LAST,
        created_at DESC
    `, [id]);
    res.json({ sucesso: true, tarefas: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/candidatos/:id/tarefas', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const titulo = String(req.body?.titulo || '').trim();
    const descricao = String(req.body?.descricao || '').trim() || null;
    const prioridade = String(req.body?.prioridade || 'MEDIA').trim().toUpperCase();
    const vencimento = req.body?.vencimento ? new Date(req.body.vencimento) : null;

    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    if (titulo.length < 2 || titulo.length > 250) {
      return res.status(400).json({ sucesso: false, erro: 'Título da tarefa inválido.' });
    }
    if (!['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'].includes(prioridade)) {
      return res.status(400).json({ sucesso: false, erro: 'Prioridade inválida.' });
    }
    if (vencimento && Number.isNaN(vencimento.getTime())) {
      return res.status(400).json({ sucesso: false, erro: 'Vencimento inválido.' });
    }

    const result = await pool.query(`
      INSERT INTO candidato_tarefas
        (candidato_id, titulo, descricao, prioridade, vencimento, criado_por)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [id, titulo, descricao, prioridade, vencimento, currentUserName(req)]);
    res.status(201).json({ sucesso: true, tarefa: result.rows[0] });
  } catch (error) { next(error); }
});

app.patch('/api/tarefas/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const status = String(req.body?.status || '').trim().toUpperCase();
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    if (!['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'].includes(status)) {
      return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
    }
    const result = await pool.query(`
      UPDATE candidato_tarefas
      SET
        status = $1,
        concluido_em = CASE WHEN $1 = 'CONCLUIDA' THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Tarefa não encontrada.' });
    res.json({ sucesso: true, tarefa: result.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/candidatos/:id/etiquetas', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const [all, selected] = await Promise.all([
      pool.query(`SELECT * FROM etiquetas ORDER BY nome ASC`),
      pool.query(`
        SELECT e.*
        FROM candidato_etiquetas ce
        JOIN etiquetas e ON e.id = ce.etiqueta_id
        WHERE ce.candidato_id = $1
        ORDER BY e.nome ASC
      `, [id]),
    ]);
    res.json({ sucesso: true, etiquetas: all.rows, selecionadas: selected.rows });
  } catch (error) { next(error); }
});

app.post('/api/candidatos/:id/etiquetas', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const etiquetaIds = Array.isArray(req.body?.etiqueta_ids)
      ? [...new Set(req.body.etiqueta_ids.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
      : [];
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    await client.query('BEGIN');
    await client.query(`DELETE FROM candidato_etiquetas WHERE candidato_id = $1`, [id]);
    for (const etiquetaId of etiquetaIds) {
      await client.query(`
        INSERT INTO candidato_etiquetas (candidato_id, etiqueta_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [id, etiquetaId]);
    }
    await client.query('COMMIT');
    res.json({ sucesso: true, mensagem: 'Etiquetas atualizadas.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
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
