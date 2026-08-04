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
const zlib = require('node:zlib');
const { hashPassword, verifyPassword, normalizeUsername } = require('./lib/security');
const { registerAdminV6 } = require('./admin-v6');
const { registerPortalPublications } = require('./portal-publicacoes');

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
  || process.env.SECRET_KEY
  || crypto.createHash('sha256').update(APP_LOGIN_PASSWORD || 'genesis-ia').digest('hex'),
).trim();
const DB_SSL = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
const DB_POOL_MAX = Math.min(Math.max(Number(process.env.DB_POOL_MAX || 8), 2), 50);
const AI_VAGAS_WEBHOOK_URL = String(process.env.AI_VAGAS_WEBHOOK_URL || '').trim();
const AI_VAGAS_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.AI_VAGAS_TIMEOUT_MS || 60_000), 5_000),
  120_000,
);
const PROMO_WHATSAPP_NUMBER = String(process.env.PROMO_WHATSAPP_NUMBER || '(11) 91302-2278').trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const PORTAL_BASE_URL = String(process.env.PORTAL_BASE_URL || PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
let PORTAL_IMAGE_ORIGIN = '';
try {
  PORTAL_IMAGE_ORIGIN = PORTAL_BASE_URL ? new URL(PORTAL_BASE_URL).origin : '';
} catch {
  console.warn('PORTAL_BASE_URL inválida; imagens do portal usarão o placeholder local.');
}
const DIVULGACAO_API_TOKEN = String(process.env.DIVULGACAO_API_TOKEN || '').trim();
const REPROVACAO_WEBHOOK_URL = String(process.env.REPROVACAO_WEBHOOK_URL || '').trim();
const REPROVACAO_WEBHOOK_TOKEN = String(process.env.REPROVACAO_WEBHOOK_TOKEN || '').trim();
const REPROVACAO_WEBHOOK_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.REPROVACAO_WEBHOOK_TIMEOUT_MS || 20_000), 3_000),
  60_000,
);
const ATENDIMENTO_MANUAL_WEBHOOK_URL = String(process.env.ATENDIMENTO_MANUAL_WEBHOOK_URL || '').trim();
const ATENDIMENTO_MANUAL_WEBHOOK_TOKEN = String(process.env.ATENDIMENTO_MANUAL_WEBHOOK_TOKEN || '').trim();
const ATENDIMENTO_MANUAL_WEBHOOK_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.ATENDIMENTO_MANUAL_WEBHOOK_TIMEOUT_MS || 20_000), 3_000),
  60_000,
);
const CHATBOT_WEBHOOK_URL = String(process.env.CHATBOT_WEBHOOK_URL || '').trim();
const CHATBOT_REPROCESS_TOKEN = String(
  process.env.CHATBOT_REPROCESS_TOKEN || DIVULGACAO_API_TOKEN || '',
).trim();
const CHATBOT_WAHA_SESSION = String(process.env.CHATBOT_WAHA_SESSION || 'whats_junior').trim();
const CHATBOT_REPROCESS_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.CHATBOT_REPROCESS_TIMEOUT_MS || 20_000), 3_000),
  60_000,
);
const AUDITORIA_IA_WEBHOOK_URL = String(process.env.AUDITORIA_IA_WEBHOOK_URL || '').trim();
const AUDITORIA_IA_WEBHOOK_TOKEN = String(process.env.AUDITORIA_IA_WEBHOOK_TOKEN || '').trim();
const AUDITORIA_INTERNAL_TOKEN = String(process.env.AUDITORIA_INTERNAL_TOKEN || '').trim();
const AUDITORIA_IA_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AUDITORIA_IA_TIMEOUT_MS || 45_000), 5_000), 120_000);
const AUDITORIA_MAX_CONVERSAS = Math.min(Math.max(Number(process.env.AUDITORIA_MAX_CONVERSAS || 250), 25), 1000);
const AUDITORIA_IA_MAX_CONVERSAS = Math.min(Math.max(Number(process.env.AUDITORIA_IA_MAX_CONVERSAS || 30), 0), 250);

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
  max: DB_POOL_MAX,
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
      imgSrc: ["'self'", 'data:', 'blob:', ...(PORTAL_IMAGE_ORIGIN ? [PORTAL_IMAGE_ORIGIN] : [])],
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


async function triggerManualCandidateMessage(payload) {
  if (!ATENDIMENTO_MANUAL_WEBHOOK_URL) {
    return {
      configurado: false,
      enviado: false,
      aviso: 'ATENDIMENTO_MANUAL_WEBHOOK_URL ainda não foi configurada no EasyPanel.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATENDIMENTO_MANUAL_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(ATENDIMENTO_MANUAL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: ATENDIMENTO_MANUAL_WEBHOOK_TOKEN,
        candidato_id: payload.candidatoId,
        mensagem: payload.mensagem,
        evento: payload.evento || 'ATENDIMENTO_CONTINUADO_PELO_PAINEL',
        solicitado_por: payload.solicitadoPor || 'Recrutador',
        session: payload.session || CHATBOT_WAHA_SESSION,
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
      aviso: body.aviso || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function triggerChatbotReprocess(payload) {
  if (!CHATBOT_WEBHOOK_URL) {
    throw new Error('CHATBOT_WEBHOOK_URL ainda não foi configurada no EasyPanel.');
  }

  const phone = String(payload.telefone || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(phone)) {
    throw new Error('O telefone do candidato não está em um formato válido para reprocessamento.');
  }

  const chatId = `${phone}@c.us`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHATBOT_REPROCESS_TIMEOUT_MS);
  try {
    const response = await fetch(CHATBOT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'message',
        session: payload.session || CHATBOT_WAHA_SESSION,
        manual_force_reply: true,
        manual_origin: 'PAINEL_REPROCESSAR_CTPS',
        manual_action: 'REPROCESSAR_DOCUMENTO',
        manual_candidate_id: payload.candidatoId,
        manual_reprocess_document_id: payload.documentoId,
        payload: {
          id: `manual-reprocess-${payload.candidatoId}-${Date.now()}`,
          from: chatId,
          fromMe: false,
          hasMedia: true,
          body: '',
          media: {
            mimetype: payload.mimeType || 'application/pdf',
            filename: payload.nomeArquivo || 'CTPS Digital.pdf',
            url: payload.mediaUrl,
          },
          _data: {
            Info: {
              IsGroup: false,
              Chat: chatId,
              Sender: chatId,
              SenderAlt: chatId,
            },
          },
        },
      }),
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(responseText || `Webhook do chatbot retornou HTTP ${response.status}.`);
    }
    return { acionado: true };
  } finally {
    clearTimeout(timer);
  }
}

function candidateFirstName(candidate) {
  const name = String(candidate?.nome || '').trim();
  return name ? name.split(/\s+/)[0] : '';
}

function buildManualContinuationMessage(candidate, customMessage = '') {
  const custom = String(customMessage || '').trim();
  if (custom) return custom.slice(0, 4000);

  const firstName = candidateFirstName(candidate);
  const hello = firstName ? `Olá, ${firstName}!` : 'Olá!';
  const vacancy = String(candidate?.vaga_nome || candidate?.vaga || 'vaga atual').trim();
  const status = String(candidate?.status || '').toUpperCase();
  const stage = String(candidate?.etapa || '').toUpperCase();

  if (status === 'REPROVADO' || ['REPROVADO_PRE_TRIAGEM', 'REPROVADO_TRIAGEM'].includes(stage)) {
    return `${hello} Após a análise do seu perfil para a vaga ${vacancy}, neste momento não será possível continuar nesta oportunidade. Seus dados poderão ser considerados em futuras vagas compatíveis.`;
  }
  if (status === 'CONTRATADO' || stage === 'CONTRATADO') {
    return `${hello} Seu processo foi concluído e você está registrado como contratado. A equipe seguirá com as orientações necessárias.`;
  }
  if (status === 'EM_ADMISSAO' || stage === 'EM_ADMISSAO') {
    return `${hello} Seu processo avançou para a etapa de admissão. A equipe responsável seguirá com as orientações necessárias por aqui.`;
  }
  if (stage === 'AGUARDANDO_CTPS_CEP') {
    return `${hello} Para continuar no processo da vaga ${vacancy}, envie sua Carteira de Trabalho Digital como Documento PDF e informe seu CEP. O CEP pode ser enviado com ou sem ponto ou hífen.`;
  }
  if (stage === 'AGUARDANDO_CTPS') {
    return `${hello} Seu CEP já foi registrado. Para continuar no processo da vaga ${vacancy}, envie agora a Carteira de Trabalho Digital como Documento PDF.`;
  }
  if (stage === 'AGUARDANDO_CEP') {
    return `${hello} Sua CTPS já foi analisada. Agora preciso apenas do seu CEP. Você pode enviá-lo com ou sem ponto ou hífen.`;
  }
  if (status === 'APROVADO' && stage === 'AGUARDANDO_APRESENTACAO') {
    return `${hello} Seu perfil foi aprovado na triagem para a vaga ${vacancy}! Antes de marcarmos a entrevista, conte brevemente sobre suas experiências, atividades principais e pontos fortes.`;
  }
  if (status === 'APROVADO' && ['GERANDO_OPCOES_ENTREVISTA', 'ESCOLHENDO_HORARIO', 'AGUARDANDO_ENTREVISTA'].includes(stage)) {
    return `${hello} Seu perfil está aprovado para a vaga ${vacancy}. Responda OK para continuarmos com as opções de horário da entrevista.`;
  }
  if (stage === 'ENTREVISTA_AGENDADA') {
    return `${hello} Sua entrevista está agendada. Caso precise dos dados ou queira reagendar, envie uma mensagem por aqui.`;
  }
  if (stage === 'ESCOLHENDO_VAGA') {
    return `${hello} Vamos continuar seu atendimento. Informe o nome ou o código da vaga em que você tem interesse.`;
  }
  if (stage === 'ANALISANDO_DOCUMENTOS') {
    return `${hello} Seu documento será reprocessado agora. Assim que a análise terminar, você receberá o resultado automaticamente.`;
  }
  return `${hello} Vamos continuar seu atendimento a partir da etapa atual. Responda por aqui para prosseguirmos.`;
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
    if (!payload?.usuario) return null;
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
  if (req.path === '/api/internal/auditoria/sincronizar') {
    const token = String(req.body?.token || req.headers['x-auditoria-token'] || '');
    if (AUDITORIA_INTERNAL_TOKEN && safeEqual(token, AUDITORIA_INTERNAL_TOKEN)) {
      req.user = { id: null, usuario: 'workflow-auditoria', nome: 'Workflow diário', perfil: 'ADMIN' };
      return next();
    }
  }
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

function requireAdmin(req, res, next) {
  if (String(req.user?.perfil || '').toUpperCase() === 'ADMIN') return next();
  return res.status(403).json({ sucesso: false, erro: 'Acesso exclusivo para administradores.' });
}

async function ensureBootstrapAdmin() {
  try {
    const count = await pool.query('SELECT COUNT(*)::INTEGER AS total FROM app_usuarios');
    if (Number(count.rows[0]?.total || 0) > 0) return;
    const usuario = normalizeUsername(APP_LOGIN_USER) || 'admin';
    const senhaHash = await hashPassword(APP_LOGIN_PASSWORD);
    await pool.query(`
      INSERT INTO app_usuarios (usuario, senha_hash, nome, perfil, ativo)
      VALUES ($1, $2, $3, 'ADMIN', TRUE)
      ON CONFLICT (usuario) DO NOTHING
    `, [usuario, senhaHash, APP_LOGIN_NAME || 'Administrador']);
    console.log(`[LOGIN V6] Administrador inicial criado: ${usuario}`);
  } catch (error) {
    if (String(error.code || '') === '42P01') {
      console.warn('[LOGIN V6] Migração 08 ainda não executada. Login legado permanecerá disponível.');
      return;
    }
    throw error;
  }
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
  sexo: z.enum(['MASCULINO', 'FEMININO', 'UNISSEX']).default('UNISSEX'),
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
  vale_refeicao_valor: nullableMoney,
  vale_alimentacao_valor: nullableMoney,
  premio_assiduidade_valor: nullableMoney,
  outros_beneficios_valor: nullableMoney,
  vale_transporte_descricao: nullableText,
  beneficios_observacao: nullableText,
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
  idade_minima: z.coerce.number().int().min(14).max(100).default(25),
  idade_maxima: z.preprocess(
    (value) => (value === null || value === undefined || String(value).trim() === '' ? null : Number(value)),
    z.number().int().min(14).max(100).nullable(),
  ).default(null),
  entrevista_dias_semana: z.union([
    z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
    z.null(),
    z.undefined(),
  ]).transform((items) => [...new Set(items || [1, 2, 3, 4, 5])].sort()),
  entrevista_horarios: z.union([
    z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.')).min(1).max(48),
    z.null(),
    z.undefined(),
  ]).transform((items) => [...new Set(items || ['09:00', '10:00', '14:00', '15:00'])].sort()),
  entrevista_duracao_minutos: z.coerce.number().int().min(10).max(180).default(30),
  entrevista_busca_dias: z.coerce.number().int().min(1).max(60).default(7),
  entrevista_evitar_feriados: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(true),
  experiencia_minima_meses: z.coerce.number().int().min(0).max(600).default(0),
  experiencia_revisao_minima_meses: z.coerce.number().int().min(0).max(600).default(0),
  permitir_experiencia_informal_revisao: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on').default(false),
  chatbot_estatico_ativo: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()]).transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on').default(true),
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
  publicar_portal: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(true),
  destaque_portal: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on')
    .default(false),
  imagem_capa_url: z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === '') return null;
    try { return new URL(value.trim()).toString(); } catch { ctx.addIssue({ code: 'custom', message: 'URL da imagem de capa inválida.' }); return z.NEVER; }
  }),
  seo_titulo: nullableText,
  seo_descricao: nullableText,
  canal_candidatura: z.enum(['WHATSAPP_GENESIS', 'URL_EXTERNA', 'EMAIL']).default('WHATSAPP_GENESIS'),
  whatsapp_candidatura: nullableText,
  candidatura_url: z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === '') return null;
    try { return new URL(value.trim()).toString(); } catch { ctx.addIssue({ code: 'custom', message: 'URL externa de candidatura inválida.' }); return z.NEVER; }
  }),
  candidatura_email: z.union([z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    if (value === null || value === undefined || value.trim() === '') return null;
    const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ctx.addIssue({ code: 'custom', message: 'E-mail de candidatura inválido.' }); return z.NEVER; }
    return email;
  }),
  status: z.enum(['RASCUNHO', 'ATIVA', 'PAUSADA', 'ENCERRADA']).default('RASCUNHO'),
  data_inicio: nullableDate,
  data_encerramento: nullableDate,
}).superRefine((vacancy, ctx) => {
  if (vacancy.experiencia_revisao_minima_meses > vacancy.experiencia_minima_meses) { ctx.addIssue({ code: 'custom', path: ['experiencia_revisao_minima_meses'], message: 'A faixa de revisão não pode superar a experiência exigida.' }); }
  if (vacancy.idade_maxima !== null && vacancy.idade_maxima < vacancy.idade_minima) {
    ctx.addIssue({
      code: 'custom',
      path: ['idade_maxima'],
      message: 'A idade máxima não pode ser menor que a idade mínima.',
    });
  }
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
    sexo: z.union([z.string(), z.null(), z.undefined()]).optional(),
    descricao: nullableText,
    cidade: nullableText,
    estado: nullableText,
    bairro: nullableText,
    tipo_contrato: nullableText,
    modalidade: nullableText,
    escala: nullableText,
    horario: nullableText,
    salario: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    vale_refeicao_valor: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    vale_alimentacao_valor: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    premio_assiduidade_valor: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    outros_beneficios_valor: z.union([z.number(), z.string(), z.null(), z.undefined()]).optional(),
    vale_transporte_descricao: nullableText,
    beneficios_observacao: nullableText,
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
  // Chatbot Estático V1 — máquina de estados oficial da Nova Fase.
  'AGUARDANDO_INTENCAO', 'ESCOLHENDO_VAGA', 'AGUARDANDO_ACAO_VAGA',
  'DUVIDAS_GERAIS', 'DUVIDAS_VAGA', 'RECRUTADOR_MENU', 'AGUARDANDO_NOME',
  'AGUARDANDO_EXPERIENCIA', 'AGUARDANDO_TEMPO_DESLOCAMENTO',
  'AGUARDANDO_CONFIRMACAO_CHEGADA', 'AGUARDANDO_CEP', 'AGUARDANDO_CTPS',
  'PROCESSANDO_CTPS', 'REVISAO_DOCUMENTAL', 'PENDENTE_APROVACAO_RECRUTADOR',
  'AGUARDANDO_ESCOLHA_HORARIO', 'ENTREVISTA_AGENDADA', 'NAO_APTO_NESTA_VAGA',
  'PAUSADO_ATENDIMENTO_HUMANO',
  // Etapas legadas preservadas para leitura e migração de candidatos antigos.
  'PRIMEIRO_CONTATO', 'PERGUNTANDO_IDADE', 'PERGUNTANDO_SEXO', 'PERGUNTANDO_EXPERIENCIA',
  'AGUARDANDO_CTPS_CEP', 'ANALISANDO_DOCUMENTOS', 'APROVADO_TRIAGEM',
  'REPROVADO_PRE_TRIAGEM', 'REPROVADO_TRIAGEM', 'AGUARDANDO_APRESENTACAO',
  'GERANDO_OPCOES_ENTREVISTA', 'ESCOLHENDO_HORARIO', 'AGUARDANDO_ENTREVISTA',
  'EM_ADMISSAO', 'CONTRATADO', 'ENCERRADO'
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

async function triggerStaticChatbotAction(payload) {
  if (!CHATBOT_WEBHOOK_URL) return { configurado: false, acionado: false, aviso: 'CHATBOT_WEBHOOK_URL não configurada.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHATBOT_REPROCESS_TIMEOUT_MS);
  try {
    const response = await fetch(CHATBOT_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        event: 'genesis.manual', session: payload.session || CHATBOT_WAHA_SESSION,
        manual_force_reply: true, manual_origin: payload.origem || 'PAINEL_CHATBOT_ESTATICO_V1',
        manual_action: payload.action, manual_candidate_id: payload.candidatoId,
        manual_review_id: payload.revisaoId || null, manual_rescue_id: payload.resgateId || null,
        manual_message: payload.mensagem || '',
        payload: { id: `manual-static-${payload.candidatoId}-${Date.now()}`, fromMe: false, hasMedia: false, body: '' },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.erro || body.message || `Webhook retornou HTTP ${response.status}.`);
    return { configurado: true, acionado: true, retorno: body };
  } finally { clearTimeout(timer); }
}

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

function normalizeVacancySex(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (['MASCULINO', 'MASC', 'M'].includes(raw)) return 'MASCULINO';
  if (['FEMININO', 'FEM', 'F'].includes(raw)) return 'FEMININO';
  return 'UNISSEX';
}

function vacancySexLabel(value) {
  const sexo = normalizeVacancySex(value);
  return sexo === 'MASCULINO' ? 'Vaga masculina' : sexo === 'FEMININO' ? 'Vaga feminina' : 'Vaga unissex';
}


const rejectionReasonCatalog = Object.freeze({
  IDADE_MINIMA_NAO_ATENDIDA: { categoria: 'IDADE', label: 'Idade abaixo da faixa da vaga', realocavel: true },
  IDADE_MAXIMA_NAO_ATENDIDA: { categoria: 'IDADE', label: 'Idade acima da faixa da vaga', realocavel: true },
  EXPERIENCIA_DECLARADA_NAO_ATENDE: { categoria: 'EXPERIENCIA', label: 'Candidato declarou não atender ao tempo mínimo da vaga', realocavel: true },
  EXPERIENCIA_INSUFICIENTE: { categoria: 'EXPERIENCIA', label: 'Tempo de experiência comprovada abaixo do requisito', realocavel: true },
  EXPERIENCIA_NAO_COMPATIVEL: { categoria: 'EXPERIENCIA', label: 'Experiência não compatível com esta vaga', realocavel: true },
  DOCUMENTO_INSUFICIENTE: { categoria: 'DOCUMENTO', label: 'Documento insuficiente ou inconclusivo', realocavel: true },
  NAO_COMPARECEU_ENTREVISTA: { categoria: 'ENTREVISTA', label: 'Não compareceu à entrevista', realocavel: true },
  DESISTIU_PROCESSO: { categoria: 'DESISTENCIA', label: 'Desistiu do processo seletivo', realocavel: true },
  DISPONIBILIDADE_INCOMPATIVEL: { categoria: 'DISPONIBILIDADE', label: 'Disponibilidade de horário ou escala incompatível com esta vaga', realocavel: true },
  DESLOCAMENTO_INCOMPATIVEL: { categoria: 'DISPONIBILIDADE', label: 'Local ou deslocamento incompatível com esta vaga', realocavel: true },
  EXPERIENCIA_NAO_CONFIRMADA_ENTREVISTA: { categoria: 'EXPERIENCIA', label: 'Experiência exigida não foi confirmada na entrevista', realocavel: true },
  REQUISITO_NAO_CONFIRMADO_ENTREVISTA: { categoria: 'REQUISITO_DA_VAGA', label: 'Requisito obrigatório específico não confirmado', realocavel: true, exigeDetalhe: true },
  PERFIL_NAO_ADERENTE_VAGA: { categoria: 'REQUISITO_DA_VAGA', label: 'Registro legado: perfil não aderente', realocavel: true, exigeDetalhe: true },
  DOCUMENTACAO_PENDENTE: { categoria: 'DOCUMENTO', label: 'Documentação obrigatória pendente', realocavel: true },
  OUTRO: { categoria: 'OUTRO', label: 'Outro motivo', realocavel: true, exigeDetalhe: true },
});

function rejectionReasonInfo(code, fallbackText = '') {
  const normalized = String(code || '').trim().toUpperCase();
  const found = rejectionReasonCatalog[normalized];
  if (found) return { codigo: normalized, ...found };
  const fallback = String(fallbackText || code || '').trim();
  return { codigo: normalized || 'OUTRO', categoria: 'OUTRO', label: fallback || 'Motivo não detalhado', realocavel: true };
}

function candidateSexLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MASCULINO') return 'Masculino';
  if (normalized === 'FEMININO') return 'Feminino';
  return 'Não informado';
}

function inferCompatibleCbosAndRoles(sourceValue) {
  const source = String(sourceValue || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const rules = [
    { re: /(auxiliar de limpeza|limpeza|servicos gerais|serviços gerais|conservacao|conservação|faxina)/, cargo: 'Auxiliar de Limpeza', cargos: 'Auxiliar de Limpeza\nAuxiliar de Serviços Gerais\nServente de Limpeza', cbos: '5143-20\n5143-25\n5143-10' },
    { re: /(porteiro|controlador de acesso|portaria)/, cargo: 'Porteiro', cargos: 'Porteiro\nControlador de Acesso', cbos: '5174-10\n5174-15' },
    { re: /(recepcionista|recepcao|recepção)/, cargo: 'Recepcionista', cargos: 'Recepcionista', cbos: '4221-05' },
    { re: /(administrativo|auxiliar administrativo|assistente administrativo)/, cargo: 'Assistente Administrativo', cargos: 'Assistente Administrativo\nAuxiliar Administrativo', cbos: '4110-10\n4110-05' },
    { re: /(cozinha|cozinheiro|auxiliar de cozinha|copeira|copeiro)/, cargo: 'Auxiliar de Cozinha', cargos: 'Auxiliar de Cozinha\nCopeiro\nCozinheiro', cbos: '5135-05\n5134-25\n5132-05' },
    { re: /(logistica|logística|estoque|almoxarife|expedicao|expedição)/, cargo: 'Auxiliar de Logística', cargos: 'Auxiliar de Logística\nAlmoxarife\nEstoquista', cbos: '4141-05\n4141-10\n4141-25' },
    { re: /(manutencao|manutenção|eletricista|encanador|predial)/, cargo: 'Oficial de Manutenção', cargos: 'Oficial de Manutenção\nTécnico de Manutenção', cbos: '9113-05\n3131-20\n9511-05' },
  ];
  return rules.find((r) => r.re.test(source)) || null;
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

function monetaryBenefitItems(vacancy) {
  const items = [
    ['Vale-refeição', vacancy.vale_refeicao_valor],
    ['Vale-alimentação', vacancy.vale_alimentacao_valor],
    ['Prêmio assiduidade', vacancy.premio_assiduidade_valor],
    ['Outros benefícios', vacancy.outros_beneficios_valor],
  ];
  return items
    .map(([label, value]) => ({ label, value: Number(value) }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);
}

function calculateApproximateGains(vacancy) {
  const salary = Number(vacancy.salario);
  const insalubrity = calculateInsalubrity(vacancy);
  const benefits = monetaryBenefitItems(vacancy);
  const totalBenefits = benefits.reduce((sum, item) => sum + item.value, 0);
  const total = (Number.isFinite(salary) && salary > 0 ? salary : 0)
    + totalBenefits
    + Number(insalubrity?.estimatedValue || 0);
  return {
    salary: Number.isFinite(salary) && salary > 0 ? salary : 0,
    benefits,
    totalBenefits,
    insalubrity,
    total,
    totalText: total > 0 ? formatMoneyBRL(total) : 'A combinar',
  };
}

function buildPromotionAssets(vacancy) {
  const contactDisplay = formatWhatsappDisplay(PROMO_WHATSAPP_NUMBER);
  const contactDigits = normalizePhoneDigits(PROMO_WHATSAPP_NUMBER);
  const title = compactText(vacancy.titulo || vacancy.cargo, 'Vaga disponível');
  const company = compactText(vacancy.empresa_nome, 'Empresa contratante');
  const location = compactText(
    [vacancy.bairro, vacancy.cidade, vacancy.estado].filter(Boolean).join(' · '),
    'Local a combinar',
  );
  const salary = formatMoneyBRL(vacancy.salario);
  const sexoLabel = vacancySexLabel(vacancy.sexo);
  const schedule = [
    vacancy.escala ? `Escala ${compactText(vacancy.escala, '')}` : '',
    vacancy.horario ? compactText(vacancy.horario, '') : '',
  ].filter(Boolean).join(' · ') || 'Horário a confirmar';
  const textualBenefits = listItems(vacancy.beneficios, []);
  const theme = promotionTheme(vacancy);
  const photoDataUri = themePhotoDataUri(theme.key);
  const gains = calculateApproximateGains(vacancy);

  const benefitLinesText = [
    ...gains.benefits.map((item) => `${item.label}: ${formatMoneyBRL(item.value)}`),
    vacancy.vale_transporte_descricao ? `VT: ${compactText(vacancy.vale_transporte_descricao, '')}` : '',
    ...textualBenefits,
  ].filter(Boolean);

  const breakdownLines = [
    `💰 Salário: ${salary}`,
    ...gains.benefits.map((item) => `• ${item.label}: ${formatMoneyBRL(item.value)}`),
    gains.insalubrity ? `• Insalubridade ${gains.insalubrity.percentText}${gains.insalubrity.estimatedText ? `: aprox. ${gains.insalubrity.estimatedText}` : ''}` : '',
    vacancy.vale_transporte_descricao ? `🚌 Vale-transporte: ${compactText(vacancy.vale_transporte_descricao, '')}` : '',
  ].filter(Boolean);

  const whatsappText = [
    `*${title} | Início imediato*`,
    `👥 ${sexoLabel}`,
    `🏢 Empresa: ${company}`,
    `📍 Local: ${location}`,
    `🕐 Jornada: ${schedule}`,
    ...breakdownLines,
    gains.total > 0 ? `💵 *Ganhos mensais aproximados: ${gains.totalText}*` : '',
    benefitLinesText.length ? `🎁 Benefícios: ${benefitLinesText.join(' | ')}` : '',
    vacancy.beneficios_observacao ? `ℹ️ ${compactText(vacancy.beneficios_observacao, '')}` : '',
    '',
    `📲 Para se candidatar, envie mensagem no WhatsApp: ${contactDisplay}`,
  ].filter(Boolean).join('\n');

  const facebookText = [
    `📢 VAGA ABERTA — ${title}`,
    `👥 ${sexoLabel}`,
    `🏢 ${company}`,
    `📍 ${location}`,
    `🕐 ${schedule}`,
    `💰 Salário: ${salary}`,
    gains.total > 0 ? `💵 Ganhos mensais aproximados: ${gains.totalText}` : '',
    benefitLinesText.length ? `🎁 ${benefitLinesText.join(' | ')}` : '',
    '',
    `📲 WhatsApp: ${contactDisplay}`,
  ].filter(Boolean).join('\n');

  const titleLines = wrapSvgText(title, 18, 3);
  const locationLines = wrapSvgText(location, 27, 2);
  const scheduleLines = wrapSvgText(schedule, 29, 2);
  const benefitCardLines = benefitLinesText.length
    ? benefitLinesText.flatMap((item) => wrapSvgText(item, 31, 1)).slice(0, 4)
    : ['Benefícios informados na seleção'];
  const gainsLine = gains.total > 0 ? gains.totalText : salary;
  const [dark, primary, accent] = theme.colors;

  const primarySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="Vaga ${escapeXml(title)}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${dark}"/><stop offset="65%" stop-color="${primary}"/><stop offset="100%" stop-color="${accent}"/></linearGradient>
    <linearGradient id="whatsapp" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#16a34a"/><stop offset="100%" stop-color="#22c55e"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#020617" flood-opacity=".28"/></filter>
    <clipPath id="photoClip"><path d="M560 0H1080V1350H470C545 1130 565 920 540 690C515 450 500 245 560 0Z"/></clipPath>
    <linearGradient id="photoShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#020617" stop-opacity=".7"/><stop offset="55%" stop-color="#020617" stop-opacity=".08"/><stop offset="100%" stop-color="#020617" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1080" height="1350" fill="#f8fafc"/>
  ${photoDataUri ? `<image href="${photoDataUri}" x="470" y="0" width="610" height="1350" preserveAspectRatio="xMidYMid slice" clip-path="url(#photoClip)"/>` : ''}
  <path d="M560 0H1080V1350H470C545 1130 565 920 540 690C515 450 500 245 560 0Z" fill="url(#photoShade)"/>
  <path d="M0 0H650C590 230 610 450 635 690C660 930 625 1135 545 1350H0Z" fill="url(#panel)"/>
  <g opacity=".12" fill="#ffffff"><circle cx="80" cy="120" r="3"/><circle cx="120" cy="120" r="3"/><circle cx="160" cy="120" r="3"/><circle cx="80" cy="160" r="3"/><circle cx="120" cy="160" r="3"/><circle cx="160" cy="160" r="3"/></g>

  <g transform="translate(46 62)">
    <rect width="285" height="62" rx="31" fill="#fbbf24" filter="url(#shadow)"/>
    <text x="142" y="41" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="900" fill="#07152e">📣 VAGA ABERTA</text>
  </g>

  <text x="48" y="215" font-family="DejaVu Sans, sans-serif" font-size="66" font-weight="900" fill="#ffffff">${buildSvgTextLines(titleLines, { x: 48, lineHeight: 69 })}</text>
  <text x="51" y="420" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="800" fill="#fbbf24">INÍCIO IMEDIATO</text>
  <text x="51" y="463" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="700" fill="#dbeafe">${escapeXml(company)}</text>
  <g transform="translate(40 486)" filter="url(#shadow)">
    <rect width="260" height="44" rx="22" fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".45"/>
    <text x="130" y="29" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="900" fill="#ffffff">${escapeXml(sexoLabel.toUpperCase())}</text>
  </g>

  <g transform="translate(38 510)" filter="url(#shadow)">
    <rect width="500" height="116" rx="28" fill="#ffffff" fill-opacity=".11" stroke="#ffffff" stroke-opacity=".65" stroke-width="2"/>
    <circle cx="58" cy="58" r="38" fill="#ffffff" fill-opacity=".16"/><text x="58" y="70" text-anchor="middle" font-size="34">📍</text>
    <text x="112" y="41" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="800" fill="#bae6fd">LOCAL</text>
    <text x="112" y="76" font-family="DejaVu Sans, sans-serif" font-size="25" font-weight="850" fill="#ffffff">${buildSvgTextLines(locationLines, { x: 112, lineHeight: 29 })}</text>
  </g>

  <g transform="translate(38 646)" filter="url(#shadow)">
    <rect width="500" height="116" rx="28" fill="#ffffff" fill-opacity=".11" stroke="#ffffff" stroke-opacity=".65" stroke-width="2"/>
    <circle cx="58" cy="58" r="38" fill="#ffffff" fill-opacity=".16"/><text x="58" y="70" text-anchor="middle" font-size="34">🕐</text>
    <text x="112" y="41" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="800" fill="#bae6fd">ESCALA E HORÁRIO</text>
    <text x="112" y="76" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="850" fill="#ffffff">${buildSvgTextLines(scheduleLines, { x: 112, lineHeight: 28 })}</text>
  </g>

  <g transform="translate(38 782)" filter="url(#shadow)">
    <rect width="500" height="128" rx="28" fill="#ffffff" fill-opacity=".96"/>
    <text x="30" y="38" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="900" fill="#475569">GANHOS MENSAIS APROXIMADOS</text>
    <text x="30" y="90" font-family="DejaVu Sans, sans-serif" font-size="43" font-weight="950" fill="#0f172a">${escapeXml(gainsLine)}</text>
    <text x="30" y="116" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="700" fill="#64748b">Salário + adicionais e benefícios com valor informado</text>
  </g>

  <g transform="translate(38 930)" filter="url(#shadow)">
    <rect width="500" height="190" rx="28" fill="#07152e" fill-opacity=".88" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/>
    <text x="28" y="39" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="900" fill="#fbbf24">BENEFÍCIOS E ADICIONAIS</text>
    <text x="30" y="77" font-family="DejaVu Sans, sans-serif" font-size="23" font-weight="750" fill="#ffffff">${buildSvgTextLines(benefitCardLines, { x: 30, lineHeight: 31, prefix: '• ' })}</text>
  </g>

  <g transform="translate(34 1170)" filter="url(#shadow)">
    <rect width="600" height="132" rx="34" fill="url(#whatsapp)"/>
    <circle cx="68" cy="66" r="45" fill="#ffffff"/><text x="68" y="80" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="39" font-weight="900" fill="#16a34a">☎</text>
    <text x="132" y="49" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Candidate-se pelo WhatsApp</text>
    <text x="132" y="94" font-family="DejaVu Sans, sans-serif" font-size="39" font-weight="950" fill="#ffffff">${escapeXml(contactDisplay)}</text>
  </g>
</svg>`;

  return {
    whatsapp_texto: whatsappText,
    facebook_texto: facebookText,
    contato_display: contactDisplay,
    contato_digits: contactDigits,
    tema: theme.key,
    ganhos_aproximados: gains.total,
    ganhos_aproximados_texto: gains.totalText,
    imagem_svg: primarySvg,
    imagem_data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(primarySvg)}`,
    nome_arquivo: `${slugify(vacancy.codigo || title)}-divulgacao.svg`,
  };
}

async function promotionPng(vacancy) {
  const assets = buildPromotionAssets(vacancy);
  const svg = assets.imagem_svg;
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

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const usuario = normalizeUsername(req.body?.usuario);
    const senha = String(req.body?.senha || '');
    let account = null;
    try {
      const result = await pool.query(`
        SELECT id, usuario, senha_hash, nome, perfil, ativo, deve_trocar_senha
        FROM app_usuarios
        WHERE LOWER(usuario) = LOWER($1)
        LIMIT 1
      `, [usuario]);
      account = result.rows[0] || null;
    } catch (error) {
      if (String(error.code || '') !== '42P01') throw error;
    }

    if (account) {
      const valid = account.ativo === true && await verifyPassword(senha, account.senha_hash);
      if (!valid) return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha incorretos.' });
      const payload = {
        id: account.id,
        usuario: account.usuario,
        nome: account.nome,
        perfil: account.perfil,
        exp: Date.now() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
      };
      await pool.query('UPDATE app_usuarios SET ultimo_login_at = NOW() WHERE id = $1', [account.id]);
      res.cookie('genesis_session', signSession(payload), sessionCookieOptions(req));
      return res.json({ sucesso: true, usuario: { id: account.id, usuario: account.usuario, nome: account.nome, perfil: account.perfil } });
    }

    // Fallback de segurança antes da migração V6.
    if (!safeEqual(usuario, normalizeUsername(APP_LOGIN_USER)) || !safeEqual(senha, APP_LOGIN_PASSWORD)) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha incorretos.' });
    }
    const payload = {
      id: null,
      usuario: normalizeUsername(APP_LOGIN_USER),
      nome: APP_LOGIN_NAME,
      perfil: 'ADMIN',
      exp: Date.now() + (SESSION_TTL_HOURS * 60 * 60 * 1000),
    };
    res.cookie('genesis_session', signSession(payload), sessionCookieOptions(req));
    return res.json({ sucesso: true, usuario: payload });
  } catch (error) { next(error); }
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

app.get('/api/public/documentos/:id/reprocessar.pdf', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!CHATBOT_REPROCESS_TOKEN || !safeEqual(token, CHATBOT_REPROCESS_TOKEN)) {
      return res.status(401).json({ sucesso: false, erro: 'Token de reprocessamento inválido.' });
    }
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de documento inválido.' });

    const result = await pool.query(`
      SELECT
        COALESCE(nome_arquivo, arquivo, 'CTPS Digital.pdf') AS nome_arquivo,
        COALESCE(NULLIF(mime_type, ''), 'application/pdf') AS mime_type,
        conteudo
      FROM documentos
      WHERE id = $1
        AND conteudo IS NOT NULL
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Documento não encontrado ou sem arquivo armazenado.' });
    }

    const document = result.rows[0];
    res.setHeader('Content-Type', document.mime_type || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(document.nome_arquivo).replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store, private');
    return res.send(document.conteudo);
  } catch (error) {
    return next(error);
  }
});

app.use(requireLogin);
app.get('/api/auth/me', (req, res) => res.json({
  sucesso: true,
  usuario: { id: req.user.id || null, usuario: req.user.usuario, nome: req.user.nome || APP_LOGIN_NAME, perfil: req.user.perfil || 'RECRUTADOR' },
}));

registerAdminV6({ app, pool, requireAdmin, currentUserName });
registerPortalPublications({ app, pool, requireAdmin, currentUserName, portalBaseUrl: PORTAL_BASE_URL });


app.get('/api/dashboard', async (req, res, next) => {
  try {
    const period = normalizeAnalyticsPeriod(req.query.periodo);
    const [metricas, funil, entrevistas, atencao, saude] = await Promise.all([
      pool.query(`
        WITH periodo AS (
          SELECT (
            DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
            - (($1::INTEGER - 1) * INTERVAL '1 day')
          ) AT TIME ZONE 'America/Sao_Paulo' AS inicio
        ),
        entrevista_atual AS (
          SELECT DISTINCT ON (candidato_id) candidato_id, inicio, status
          FROM entrevistas
          WHERE status = 'AGENDADA'
          ORDER BY candidato_id, updated_at DESC NULLS LAST, created_at DESC, id DESC
        ),
        mensagens_ultimas AS (
          SELECT c.id,
            MAX(m.created_at) FILTER (WHERE UPPER(COALESCE(m.quem, '')) IN ('USUARIO','CANDIDATO')) AS ultima_usuario,
            MAX(m.created_at) FILTER (WHERE UPPER(COALESCE(m.quem, '')) = 'IA') AS ultima_ia
          FROM candidatos c
          LEFT JOIN mensagens m ON m.candidato_id = c.id
          WHERE UPPER(COALESCE(c.status, '')) IN ('NOVO','EM_PROCESSO','APROVADO')
          GROUP BY c.id
        ),
        vaga_preferida AS (
          SELECT c.vaga_id, COALESCE(v.titulo, c.vaga, 'Vaga não informada') AS nome, COUNT(*)::INTEGER AS quantidade
          FROM candidatos c
          LEFT JOIN vagas v ON v.id = c.vaga_id
          CROSS JOIN periodo p
          WHERE c.vaga_id IS NOT NULL AND COALESCE(c.vaga_escolhida_at, c.created_at, c.updated_at) >= p.inicio
          GROUP BY c.vaga_id, COALESCE(v.titulo, c.vaga, 'Vaga não informada')
          ORDER BY quantidade DESC, nome ASC LIMIT 1
        )
        SELECT
          (SELECT COUNT(*) FROM candidatos)::INTEGER AS total_candidatos,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) IN ('NOVO', 'EM_PROCESSO'))::INTEGER AS em_processo,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'APROVADO')::INTEGER AS aprovados_triagem,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'EM_ADMISSAO')::INTEGER AS em_admissao,
          (SELECT COUNT(*) FROM candidatos WHERE UPPER(COALESCE(status, '')) = 'CONTRATADO')::INTEGER AS contratados,
          (SELECT COUNT(*) FROM vagas WHERE status = 'ATIVA')::INTEGER AS vagas_ativas,
          (SELECT COUNT(*) FROM entrevista_atual WHERE (inicio AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS entrevistas_hoje,
          (SELECT COUNT(*) FROM candidato_revisoes WHERE UPPER(COALESCE(status, 'PENDENTE')) = 'PENDENTE')::INTEGER AS pendencias_humanas,
          (SELECT COUNT(*) FROM documentos WHERE UPPER(COALESCE(status_processamento, '')) IN ('ERRO','ERRO_PROCESSAMENTO','INCONCLUSIVO'))::INTEGER AS documentos_falha,
          (SELECT COUNT(*) FROM mensagens_ultimas WHERE ultima_usuario <= NOW() - INTERVAL '2 hours' AND (ultima_ia IS NULL OR ultima_ia < ultima_usuario))::INTEGER AS sem_resposta_2h,
          (SELECT COUNT(*) FROM mensagens m CROSS JOIN periodo p WHERE UPPER(COALESCE(m.quem, '')) IN ('USUARIO', 'CANDIDATO') AND m.created_at >= p.inicio)::INTEGER AS mensagens_recebidas_periodo,
          (SELECT COUNT(*) FROM candidatos c CROSS JOIN periodo p WHERE c.created_at >= p.inicio)::INTEGER AS candidatos_periodo,
          COALESCE((SELECT nome FROM vaga_preferida), 'Sem dados no período') AS vaga_mais_escolhida_nome,
          COALESCE((SELECT quantidade FROM vaga_preferida), 0)::INTEGER AS vaga_mais_escolhida_quantidade,
          (SELECT COUNT(*) FROM candidatos WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS movimento_iniciaram,
          (SELECT COUNT(*) FROM documentos WHERE UPPER(COALESCE(tipo, '')) = 'CTPS' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS movimento_ctps,
          (SELECT COUNT(*) FROM candidatos WHERE (aprovado IS TRUE OR UPPER(COALESCE(status, '')) = 'APROVADO') AND (updated_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS movimento_aprovados,
          (SELECT COUNT(*) FROM entrevistas WHERE UPPER(COALESCE(status, '')) = 'AGENDADA' AND (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE)::INTEGER AS movimento_agendados
      `, [period.days]),
      pool.query(`
        SELECT etapa, COUNT(*)::INTEGER AS quantidade
        FROM candidatos
        WHERE UPPER(COALESCE(status, '')) NOT IN ('REPROVADO', 'CONTRATADO', 'ENCERRADO')
        GROUP BY etapa ORDER BY quantidade DESC, etapa ASC
      `),
      pool.query(`
        WITH atuais AS (
          SELECT DISTINCT ON (candidato_id) id, candidato_id, inicio, fim, meet_link, google_event_url
          FROM entrevistas WHERE status = 'AGENDADA'
          ORDER BY candidato_id, updated_at DESC NULLS LAST, created_at DESC, id DESC
        )
        SELECT e.id, e.candidato_id, e.inicio, e.fim, e.meet_link, e.google_event_url,
          COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
          COALESCE(v.titulo, c.vaga, 'Vaga não informada') AS vaga_nome
        FROM atuais e
        JOIN candidatos c ON c.id = e.candidato_id
        LEFT JOIN vagas v ON v.id = c.vaga_id
        WHERE e.inicio >= NOW()
        ORDER BY e.inicio ASC LIMIT 16
      `),
      pool.query(`
        WITH mensagens_ultimas AS (
          SELECT c.id AS candidato_id, COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
            COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada') AS vaga_nome,
            MAX(m.created_at) FILTER (WHERE UPPER(COALESCE(m.quem, '')) IN ('USUARIO','CANDIDATO')) AS ultima_usuario,
            MAX(m.created_at) FILTER (WHERE UPPER(COALESCE(m.quem, '')) = 'IA') AS ultima_ia
          FROM candidatos c
          LEFT JOIN vagas v ON v.id = c.vaga_id
          LEFT JOIN mensagens m ON m.candidato_id = c.id
          WHERE UPPER(COALESCE(c.status, '')) IN ('NOVO','EM_PROCESSO','APROVADO')
          GROUP BY c.id, COALESCE(c.nome, 'Candidato #' || c.id), COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada')
        ),
        itens AS (
          SELECT 1 AS ordem, 'DOCUMENTOS_FALHA'::TEXT AS tipo, COUNT(*)::INTEGER AS quantidade,
            MIN(d.created_at) AS referencia,
            (ARRAY_AGG(d.candidato_id ORDER BY d.created_at ASC))[1] AS candidato_id,
            (ARRAY_AGG(COALESCE(c.nome, 'Candidato #' || c.id) ORDER BY d.created_at ASC))[1] AS candidato_nome,
            (ARRAY_AGG(COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada') ORDER BY d.created_at ASC))[1] AS vaga_nome
          FROM documentos d JOIN candidatos c ON c.id = d.candidato_id LEFT JOIN vagas v ON v.id = c.vaga_id
          WHERE UPPER(COALESCE(d.status_processamento, '')) IN ('ERRO','ERRO_PROCESSAMENTO','INCONCLUSIVO')
          HAVING COUNT(*) > 0
          UNION ALL
          SELECT 2, 'REVISOES_PENDENTES', COUNT(*)::INTEGER, MIN(r.created_at),
            (ARRAY_AGG(r.candidato_id ORDER BY r.created_at ASC))[1],
            (ARRAY_AGG(COALESCE(c.nome, 'Candidato #' || c.id) ORDER BY r.created_at ASC))[1],
            (ARRAY_AGG(COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada') ORDER BY r.created_at ASC))[1]
          FROM candidato_revisoes r JOIN candidatos c ON c.id = r.candidato_id
          LEFT JOIN vagas v ON v.id = COALESCE(r.vaga_id, c.vaga_id)
          WHERE UPPER(COALESCE(r.status, 'PENDENTE')) = 'PENDENTE' HAVING COUNT(*) > 0
          UNION ALL
          SELECT 3, 'APROVADOS_SEM_HORARIO', COUNT(*)::INTEGER, MIN(c.updated_at),
            (ARRAY_AGG(c.id ORDER BY c.updated_at ASC))[1],
            (ARRAY_AGG(COALESCE(c.nome, 'Candidato #' || c.id) ORDER BY c.updated_at ASC))[1],
            (ARRAY_AGG(COALESCE(v.titulo, c.vaga, 'Sem vaga vinculada') ORDER BY c.updated_at ASC))[1]
          FROM candidatos c LEFT JOIN vagas v ON v.id = c.vaga_id
          WHERE (c.aprovado IS TRUE OR UPPER(COALESCE(c.status, '')) = 'APROVADO')
            AND NOT EXISTS (SELECT 1 FROM entrevistas e WHERE e.candidato_id = c.id AND UPPER(COALESCE(e.status, '')) = 'AGENDADA')
          HAVING COUNT(*) > 0
          UNION ALL
          SELECT 4, 'SEM_RESPOSTA', COUNT(*)::INTEGER, MIN(ultima_usuario),
            (ARRAY_AGG(candidato_id ORDER BY ultima_usuario ASC))[1],
            (ARRAY_AGG(candidato_nome ORDER BY ultima_usuario ASC))[1],
            (ARRAY_AGG(vaga_nome ORDER BY ultima_usuario ASC))[1]
          FROM mensagens_ultimas
          WHERE ultima_usuario <= NOW() - INTERVAL '2 hours' AND (ultima_ia IS NULL OR ultima_ia < ultima_usuario)
          HAVING COUNT(*) > 0
        )
        SELECT ordem, tipo, quantidade, referencia, candidato_id, candidato_nome, vaga_nome
        FROM itens ORDER BY ordem LIMIT 5
      `),
      pool.query(`
        SELECT
          (SELECT MAX(created_at) FROM atendimento_logs) AS ultima_entrada,
          (SELECT MAX(created_at) FROM mensagens WHERE UPPER(COALESCE(quem, '')) = 'IA') AS ultima_resposta_ia,
          (SELECT COUNT(*) FROM workflow_erros WHERE resolvido IS FALSE)::INTEGER AS erros_pendentes,
          (SELECT COUNT(*) FROM workflow_erros WHERE resolvido IS FALSE
            AND (COALESCE(workflow_nome, '') ILIKE '%calendar%' OR COALESCE(node_nome, '') ILIKE '%calendar%' OR COALESCE(erro_mensagem, '') ILIKE '%calendar%'))::INTEGER AS erros_calendar
      `),
    ]);

    const metrics = metricas.rows[0] || {};
    const healthRow = saude.rows[0] || {};
    const recentActivity = healthRow.ultima_entrada && new Date(healthRow.ultima_entrada).getTime() > Date.now() - 60 * 60 * 1000;
    const recentReply = healthRow.ultima_resposta_ia && new Date(healthRow.ultima_resposta_ia).getTime() > Date.now() - 60 * 60 * 1000;

    res.json({
      sucesso: true,
      periodo: period.key,
      metricas: metrics,
      movimento_dia: {
        iniciaram: metrics.movimento_iniciaram || 0,
        ctps_recebidas: metrics.movimento_ctps || 0,
        aprovados: metrics.movimento_aprovados || 0,
        agendados: metrics.movimento_agendados || 0,
      },
      funil: funil.rows,
      proximas_entrevistas: entrevistas.rows,
      atencao: atencao.rows,
      saude: {
        n8n: Number(healthRow.erros_pendentes || 0) > 0 ? 'Atenção' : 'Online',
        waha: recentActivity ? 'Online' : 'Sem atividade',
        banco: 'Online',
        calendar: Number(healthRow.erros_calendar || 0) > 0 ? 'Atenção' : 'Sem erro recente',
        atendimento: recentReply ? 'Ativo' : 'Sem atividade',
      },
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
        c.ia_atendimento_ativo,
        c.ia_pausada_em,
        c.ia_pausada_por,
        c.ia_pausa_motivo,
        c.cep,
        c.observacao_triagem,
        c.motivo_reprovacao,
        c.motivo_reprovacao_codigo,
        c.motivo_reprovacao_categoria,
        c.motivo_reprovacao_detalhe,
        c.reprovacao_realocavel,
        c.sexo,
        c.sexo_origem,
        c.sexo_nao_informado,
        c.sexo_compativel_vaga,
        c.sexo_revisao_necessaria,
        c.tempo_faltante_experiencia,
        c.tempo_medio_empresas_texto,
        c.quantidade_vinculos_validos,
        c.created_at,
        c.updated_at,
        c.apresentacao_profissional,
        c.personalidade_resumo,
        c.personalidade_tags,
        c.personalidade_updated_at,
        v.codigo AS vaga_codigo,
        COALESCE(v.titulo, c.vaga) AS vaga_nome,
        v.status AS vaga_status,
        COALESCE(d.quantidade_documentos, 0)::INTEGER AS quantidade_documentos,
        COALESCE(d.tem_ctps, FALSE) AS tem_ctps,
        COALESCE(d.tem_curriculo, FALSE) AS tem_curriculo,
        COALESCE(d.tem_documento_processando, FALSE) AS tem_documento_processando,
        COALESCE(d.tem_documento_pendente_revisao, FALSE) AS tem_documento_pendente_revisao,
        e.inicio AS entrevista_inicio,
        e.fim AS entrevista_fim,
        e.status AS entrevista_status,
        e.meet_link AS entrevista_meet_link
      FROM candidatos c
      LEFT JOIN vagas v ON v.id = c.vaga_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS quantidade_documentos,
          BOOL_OR(UPPER(COALESCE(tipo, '')) = 'CTPS') AS tem_ctps,
          BOOL_OR(UPPER(COALESCE(tipo, '')) = 'CURRICULO') AS tem_curriculo,
          BOOL_OR(UPPER(COALESCE(status_processamento, '')) IN ('PROCESSANDO','PENDENTE')) AS tem_documento_processando,
          BOOL_OR(UPPER(COALESCE(tipo, '')) = 'PENDENTE_REVISAO') AS tem_documento_pendente_revisao
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
        v.sexo AS vaga_sexo,
        v.experiencia_minima_meses,
        v.experiencia_revisao_minima_meses,
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

    const isAdminUser = String(req.user?.perfil || '').toUpperCase() === 'ADMIN';
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
        AND ($2::BOOLEAN OR UPPER(COALESCE(tipo, '')) IN ('CTPS','PENDENTE','OUTRO'))
      ORDER BY created_at DESC, id DESC
      LIMIT CASE WHEN $2::BOOLEAN THEN 200 ELSE 5 END
    `, [id, isAdminUser]);

    const conversaResult = await pool.query(`
      SELECT id, quem, mensagem, created_at
      FROM mensagens
      WHERE candidato_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 120
    `, [id]);

    const timelineResult = isAdminUser ? await pool.query(`
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
          'REPROVACAO'::TEXT AS tipo,
          'Reprovação: ' || COALESCE(NULLIF(motivo, ''), codigo) AS titulo,
          CONCAT(
            'Categoria: ', categoria,
            ' | Realocável: ', CASE WHEN realocavel THEN 'sim' ELSE 'não' END,
            CASE WHEN observacao IS NOT NULL AND BTRIM(observacao) <> '' THEN ' | ' || observacao ELSE '' END
          ) AS descricao,
          created_at
        FROM candidato_reprovacoes_historico
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
    `, [id]) : { rows: [] };

    res.json({
      sucesso: true,
      candidato: candidatoResult.rows[0],
      documentos: documentosResult.rows,
      conversa: conversaResult.rows.reverse(),
      timeline: timelineResult.rows,
      permissoes: { administrador: isAdminUser },
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
        tipo,
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
    const isAdminUser = String(req.user?.perfil || '').toUpperCase() === 'ADMIN';
    if (!isAdminUser && !['CTPS','PENDENTE','OUTRO'].includes(String(documento.tipo || '').toUpperCase())) {
      return res.status(403).json({ sucesso: false, erro: 'Este documento está disponível somente para administradores.' });
    }
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

app.delete('/api/candidatos/:id', requireAdmin, async (req, res, next) => {
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
        COALESCE(estatisticas.reprovados_periodo, 0)::INTEGER AS candidatos_reprovados_periodo,
        COALESCE(estatisticas.novos, 0)::INTEGER AS candidatos_novos,
        COALESCE(estatisticas.em_analise, 0)::INTEGER AS candidatos_em_analise,
        COALESCE(estatisticas.entrevistas, 0)::INTEGER AS candidatos_entrevista,
        COALESCE(estatisticas.entrevistas_hoje, 0)::INTEGER AS entrevistas_hoje,
        estatisticas.ultima_movimentacao
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
          ) AS reprovados_periodo,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(c.status, '')) = 'NOVO') AS novos,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) = 'EM_PROCESSO'
              AND UPPER(COALESCE(c.etapa, '')) NOT IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
          ) AS em_analise,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.etapa, '')) IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
          ) AS entrevistas,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.etapa, '')) IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
              AND c.updated_at::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          ) AS entrevistas_hoje,
          MAX(c.updated_at) AS ultima_movimentacao
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
      portal_base_url: PORTAL_BASE_URL,
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
        COALESCE(estatisticas.reprovados, 0)::INTEGER AS candidatos_reprovados,
        COALESCE(estatisticas.novos, 0)::INTEGER AS candidatos_novos,
        COALESCE(estatisticas.em_analise, 0)::INTEGER AS candidatos_em_analise,
        COALESCE(estatisticas.entrevistas, 0)::INTEGER AS candidatos_entrevista,
        COALESCE(estatisticas.entrevistas_hoje, 0)::INTEGER AS entrevistas_hoje,
        estatisticas.ultima_movimentacao
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
          ) AS reprovados,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(c.status, '')) = 'NOVO') AS novos,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.status, '')) = 'EM_PROCESSO'
              AND UPPER(COALESCE(c.etapa, '')) NOT IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
          ) AS em_analise,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.etapa, '')) IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
          ) AS entrevistas,
          COUNT(*) FILTER (
            WHERE UPPER(COALESCE(c.etapa, '')) IN ('AGUARDANDO_ENTREVISTA', 'ENTREVISTA_AGENDADA')
              AND c.updated_at::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          ) AS entrevistas_hoje,
          MAX(c.updated_at) AS ultima_movimentacao
        FROM candidatos c
        WHERE c.vaga_id = v.id
      ) estatisticas ON TRUE
      WHERE v.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    res.json({ sucesso: true, portal_base_url: PORTAL_BASE_URL, vaga: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/vagas/:id/duplicar', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM vagas WHERE id = $1 FOR SHARE', [id]);
    if (!sourceResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }
    const v = sourceResult.rows[0];
    const codigo = await generateVacancyCode(client, v.empresa_id);
    const result = await client.query(`
      INSERT INTO vagas (
        empresa_id, codigo, titulo, cargo, sexo, descricao, cidade, estado, bairro,
        endereco_referencia, tipo_contrato, modalidade, escala, horario, salario,
        vale_refeicao_valor, vale_alimentacao_valor, premio_assiduidade_valor,
        outros_beneficios_valor, vale_transporte_descricao, beneficios_observacao,
        possui_insalubridade, percentual_insalubridade, observacao_insalubridade,
        beneficios, escolaridade_minima, experiencia_minima_meses, experiencia_revisao_minima_meses, permitir_experiencia_informal_revisao, chatbot_estatico_ativo,
        aceita_sem_experiencia, exigir_experiencia_compativel, cargos_compativeis,
        cbos_compativeis, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, publicar_portal, destaque_portal,
        imagem_capa_url, seo_titulo, seo_descricao, canal_candidatura,
        whatsapp_candidatura, candidatura_url, candidatura_email,
        status, data_inicio, data_encerramento, portal_publicado_em
      )
      SELECT
        empresa_id, $1, titulo || ' — Cópia', cargo, sexo, descricao, cidade, estado, bairro,
        endereco_referencia, tipo_contrato, modalidade, escala, horario, salario,
        vale_refeicao_valor, vale_alimentacao_valor, premio_assiduidade_valor,
        outros_beneficios_valor, vale_transporte_descricao, beneficios_observacao,
        possui_insalubridade, percentual_insalubridade, observacao_insalubridade,
        beneficios, escolaridade_minima, experiencia_minima_meses, experiencia_revisao_minima_meses, permitir_experiencia_informal_revisao, chatbot_estatico_ativo,
        aceita_sem_experiencia, exigir_experiencia_compativel, cargos_compativeis,
        cbos_compativeis, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, publicar_portal, FALSE,
        imagem_capa_url, seo_titulo, seo_descricao, canal_candidatura,
        whatsapp_candidatura, candidatura_url, candidatura_email,
        'RASCUNHO', NULL, NULL, NULL
      FROM vagas WHERE id = $2
      RETURNING *
    `, [codigo, id]);
    const enriched = await client.query(`
      UPDATE vagas SET
        idade_minima = $2,
        idade_maxima = $3,
        entrevista_dias_semana = $4::SMALLINT[],
        entrevista_horarios = $5::JSONB,
        entrevista_duracao_minutos = $6,
        entrevista_busca_dias = $7,
        entrevista_evitar_feriados = $8,
        updated_at = NOW()
      WHERE id = $1 RETURNING *
    `, [result.rows[0].id, Number(v.idade_minima ?? 25), v.idade_maxima ?? null, v.entrevista_dias_semana ?? [],
      JSON.stringify(v.entrevista_horarios ?? []),
      Number(v.entrevista_duracao_minutos || 30), Number(v.entrevista_busca_dias || 7),
      v.entrevista_evitar_feriados !== false]);
    await client.query('COMMIT');
    res.status(201).json({ sucesso: true, mensagem: `Vaga duplicada como ${codigo}.`, vaga: enriched.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally { client.release(); }
});

app.post('/api/vagas', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const aiProfile = inferCompatibleCbosAndRoles([parsed.data.titulo, parsed.data.descricao].filter(Boolean).join(' ')) || {};
    const v = { ...parsed.data, cargo: parsed.data.cargo || aiProfile.cargo || parsed.data.titulo, cargos_compativeis: parsed.data.cargos_compativeis || aiProfile.cargos || parsed.data.titulo, cbos_compativeis: parsed.data.cbos_compativeis || aiProfile.cbos || '' };
    await client.query('BEGIN');
    const codigo = await generateVacancyCode(client, v.empresa_id);
    const result = await client.query(`
      INSERT INTO vagas (
        empresa_id, codigo, titulo, cargo, sexo, descricao, cidade, estado, bairro,
        endereco_referencia, tipo_contrato, modalidade, escala, horario, salario,
        vale_refeicao_valor, vale_alimentacao_valor, premio_assiduidade_valor,
        outros_beneficios_valor, vale_transporte_descricao, beneficios_observacao,
        possui_insalubridade, percentual_insalubridade, observacao_insalubridade,
        beneficios, escolaridade_minima, experiencia_minima_meses, experiencia_revisao_minima_meses, permitir_experiencia_informal_revisao, chatbot_estatico_ativo,
        aceita_sem_experiencia, exigir_experiencia_compativel, cargos_compativeis,
        cbos_compativeis, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, publicar_portal, destaque_portal,
        imagem_capa_url, seo_titulo, seo_descricao, canal_candidatura,
        whatsapp_candidatura, candidatura_url, candidatura_email,
        status, data_inicio, data_encerramento
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,
        $46,$47,$48,$49,$50
      ) RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.sexo, v.descricao, v.cidade, v.estado, v.bairro,
      v.endereco_referencia, v.tipo_contrato, v.modalidade, v.escala, v.horario, v.salario,
      v.vale_refeicao_valor, v.vale_alimentacao_valor, v.premio_assiduidade_valor,
      v.outros_beneficios_valor, v.vale_transporte_descricao, v.beneficios_observacao,
      v.possui_insalubridade,
      v.possui_insalubridade ? v.percentual_insalubridade : null,
      v.possui_insalubridade ? v.observacao_insalubridade : null,
      v.beneficios, v.escolaridade_minima, v.experiencia_minima_meses, v.experiencia_revisao_minima_meses, v.permitir_experiencia_informal_revisao, v.chatbot_estatico_ativo,
      v.aceita_sem_experiencia, v.exigir_experiencia_compativel,
      v.cargos_compativeis, v.cbos_compativeis, v.requisitos_obrigatorios,
      v.requisitos_desejaveis, v.quantidade_vagas, v.formulario_url,
      v.publicar_portal, v.destaque_portal, v.imagem_capa_url, v.seo_titulo,
      v.seo_descricao, v.canal_candidatura, v.whatsapp_candidatura,
      v.candidatura_url, v.candidatura_email, v.status, v.data_inicio, v.data_encerramento,
    ]);
    const enriched = await client.query(`
      UPDATE vagas SET
        idade_minima = $2,
        idade_maxima = $3,
        entrevista_dias_semana = $4::SMALLINT[],
        entrevista_horarios = $5::JSONB,
        entrevista_duracao_minutos = $6,
        entrevista_busca_dias = $7,
        entrevista_evitar_feriados = $8,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [result.rows[0].id, v.idade_minima, v.idade_maxima, v.entrevista_dias_semana,
      JSON.stringify(v.entrevista_horarios), v.entrevista_duracao_minutos,
      v.entrevista_busca_dias, v.entrevista_evitar_feriados]);
    await client.query('COMMIT');
    res.status(201).json({ sucesso: true, mensagem: `Vaga ${codigo} cadastrada com sucesso.`, vaga: enriched.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Falha ao desfazer criação da vaga:', rollbackError); }
    next(error);
  } finally { client.release(); }
});

app.put('/api/vagas/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const aiProfile = inferCompatibleCbosAndRoles([parsed.data.titulo, parsed.data.descricao].filter(Boolean).join(' ')) || {};
    const v = { ...parsed.data, cargo: parsed.data.cargo || aiProfile.cargo || parsed.data.titulo, cargos_compativeis: parsed.data.cargos_compativeis || aiProfile.cargos || parsed.data.titulo, cbos_compativeis: parsed.data.cbos_compativeis || aiProfile.cbos || '' };
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT id, empresa_id, codigo FROM vagas WHERE id = $1 FOR UPDATE', [id]);
    if (!currentResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }
    const currentVacancy = currentResult.rows[0];
    const companyChanged = Number(currentVacancy.empresa_id) !== Number(v.empresa_id);
    const codigo = companyChanged ? await generateVacancyCode(client, v.empresa_id) : currentVacancy.codigo;
    const result = await client.query(`
      UPDATE vagas SET
        empresa_id=$1, codigo=$2, titulo=$3, cargo=$4, sexo=$5, descricao=$6, cidade=$7,
        estado=$8, bairro=$9, endereco_referencia=$10, tipo_contrato=$11,
        modalidade=$12, escala=$13, horario=$14, salario=$15,
        vale_refeicao_valor=$16, vale_alimentacao_valor=$17,
        premio_assiduidade_valor=$18, outros_beneficios_valor=$19,
        vale_transporte_descricao=$20, beneficios_observacao=$21,
        possui_insalubridade=$22, percentual_insalubridade=$23,
        observacao_insalubridade=$24, beneficios=$25,
        escolaridade_minima=$26, experiencia_minima_meses=$27,
        experiencia_revisao_minima_meses=$28,
        permitir_experiencia_informal_revisao=$29,
        chatbot_estatico_ativo=$30,
        aceita_sem_experiencia=$31, exigir_experiencia_compativel=$32,
        cargos_compativeis=$33, cbos_compativeis=$34,
        requisitos_obrigatorios=$35, requisitos_desejaveis=$36,
        quantidade_vagas=$37, formulario_url=$38, publicar_portal=$39,
        destaque_portal=$40, imagem_capa_url=$41, seo_titulo=$42,
        seo_descricao=$43, canal_candidatura=$44, whatsapp_candidatura=$45,
        candidatura_url=$46, candidatura_email=$47, status=$48,
        data_inicio=$49, data_encerramento=$50, updated_at=NOW()
      WHERE id=$51 RETURNING *
    `, [
      v.empresa_id, codigo, v.titulo, v.cargo, v.sexo, v.descricao, v.cidade, v.estado, v.bairro,
      v.endereco_referencia, v.tipo_contrato, v.modalidade, v.escala, v.horario, v.salario,
      v.vale_refeicao_valor, v.vale_alimentacao_valor, v.premio_assiduidade_valor,
      v.outros_beneficios_valor, v.vale_transporte_descricao, v.beneficios_observacao,
      v.possui_insalubridade,
      v.possui_insalubridade ? v.percentual_insalubridade : null,
      v.possui_insalubridade ? v.observacao_insalubridade : null,
      v.beneficios, v.escolaridade_minima, v.experiencia_minima_meses, v.experiencia_revisao_minima_meses, v.permitir_experiencia_informal_revisao, v.chatbot_estatico_ativo,
      v.aceita_sem_experiencia, v.exigir_experiencia_compativel,
      v.cargos_compativeis, v.cbos_compativeis, v.requisitos_obrigatorios,
      v.requisitos_desejaveis, v.quantidade_vagas, v.formulario_url,
      v.publicar_portal, v.destaque_portal, v.imagem_capa_url, v.seo_titulo,
      v.seo_descricao, v.canal_candidatura, v.whatsapp_candidatura,
      v.candidatura_url, v.candidatura_email, v.status, v.data_inicio,
      v.data_encerramento, id,
    ]);
    const enriched = await client.query(`
      UPDATE vagas SET
        idade_minima = $2,
        idade_maxima = $3,
        entrevista_dias_semana = $4::SMALLINT[],
        entrevista_horarios = $5::JSONB,
        entrevista_duracao_minutos = $6,
        entrevista_busca_dias = $7,
        entrevista_evitar_feriados = $8,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, v.idade_minima, v.idade_maxima, v.entrevista_dias_semana,
      JSON.stringify(v.entrevista_horarios), v.entrevista_duracao_minutos,
      v.entrevista_busca_dias, v.entrevista_evitar_feriados]);
    await client.query('COMMIT');
    res.json({ sucesso: true, mensagem: companyChanged ? `Vaga atualizada e recebeu o novo código ${codigo}.` : 'Vaga atualizada com sucesso.', vaga: enriched.rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { console.error('Falha ao desfazer atualização da vaga:', rollbackError); }
    next(error);
  } finally { client.release(); }
});

app.delete('/api/vagas/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    await client.query('BEGIN');
    const vacancy = await client.query('SELECT id, titulo, codigo FROM vagas WHERE id = $1 FOR UPDATE', [id]);
    if (!vacancy.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }
    const linked = await client.query('SELECT COUNT(*)::INTEGER AS total FROM candidatos WHERE vaga_id = $1', [id]);
    if (Number(linked.rows[0]?.total || 0) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ sucesso: false, erro: 'Esta vaga possui candidatos vinculados. Encerre a vaga ou remova os vínculos antes de excluir.' });
    }
    await client.query('DELETE FROM vagas WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ sucesso: true, mensagem: 'Vaga excluída com sucesso.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally { client.release(); }
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
        status = $1::VARCHAR,
        data_encerramento = CASE
          WHEN $1::VARCHAR = 'ENCERRADA'::VARCHAR THEN COALESCE(data_encerramento, CURRENT_DATE)
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
    if (DIVULGACAO_API_TOKEN) {
      assets.imagem_publica_png_url = `${base}/api/public/vagas/${id}/divulgacao/principal.png?token=${encodeURIComponent(DIVULGACAO_API_TOKEN)}`;
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




app.get('/api/revisoes', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'PENDENTE').toUpperCase();
    const result = await pool.query(`
      SELECT r.*, COALESCE(c.nome,c.telefone,'Candidato #'||c.id) AS candidato_nome,
        c.telefone, c.etapa, c.status AS candidato_status, COALESCE(v.titulo,c.vaga,'Sem vaga') AS vaga_nome,
        curriculo.id AS curriculo_id, curriculo.resultado AS curriculo_resultado
      FROM candidato_revisoes r
      JOIN candidatos c ON c.id=r.candidato_id
      LEFT JOIN vagas v ON v.id=r.vaga_id
      LEFT JOIN LATERAL (
        SELECT d.id,d.resultado FROM documentos d
        WHERE d.candidato_id=c.id AND UPPER(COALESCE(d.tipo,''))='CURRICULO'
        ORDER BY d.created_at DESC,d.id DESC LIMIT 1
      ) curriculo ON TRUE
      WHERE ($1='TODOS' OR r.status=$1)
      ORDER BY CASE r.tipo WHEN 'REVISAO_DOCUMENTAL' THEN 1 WHEN 'EXCECAO_EXPERIENCIA' THEN 2 ELSE 3 END, r.created_at ASC
    `, [status]);
    res.json({ sucesso: true, revisoes: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/revisoes/:id/decidir', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const decisao = String(req.body?.decisao || '').toUpperCase();
    const motivo = String(req.body?.motivo || '').trim().slice(0,4000) || null;
    if (!id || !['APROVAR','NAO_APROVAR','REPROCESSAR','SOLICITAR_NOVO_PDF'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
    await client.query('BEGIN');
    const result = await client.query(`SELECT * FROM genesis_resolver_revisao_v1($1,$2,$3,$4)`, [id, decisao, motivo, currentUserName(req)]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ sucesso:false, erro:'Revisão não encontrada ou já concluída.' }); }
    await client.query('COMMIT');
    const data=result.rows[0];
    let acionamento=null;
    try { acionamento=await triggerStaticChatbotAction({ candidatoId:data.candidato_id, revisaoId:id, action:data.action, mensagem:data.mensagem_whatsapp || '', origem:'PAINEL_REVISAO_CHATBOT_ESTATICO_V1' }); }
    catch(error){ acionamento={acionado:false,aviso:error.message}; }
    res.json({ sucesso:true, mensagem:data.mensagem_painel || 'Decisão registrada.', resultado:data, acionamento });
  } catch(error){ try{await client.query('ROLLBACK')}catch{} next(error); } finally { client.release(); }
});

app.post('/api/candidatos/:id/resgate', async (req, res, next) => {
  try {
    const candidatoId=parseId(req.params.id); const problemaId=parseId(req.body?.auditoria_problema_id);
    if(!candidatoId) return res.status(400).json({sucesso:false,erro:'Candidato inválido.'});
    const result=await pool.query(`INSERT INTO candidato_resgates (candidato_id,auditoria_problema_id,origem,motivo,status,solicitado_por) VALUES ($1,$2,'PAINEL',COALESCE((SELECT titulo FROM auditoria_problemas WHERE id=$2),'Retomada solicitada pelo painel'),'SOLICITADO',$3) RETURNING *`,[candidatoId,problemaId,currentUserName(req)]);
    let acionamento=null; try{acionamento=await triggerStaticChatbotAction({candidatoId,resgateId:result.rows[0].id,action:'RESGATAR',origem:'PAINEL_RESGATE_CHATBOT_ESTATICO_V1'});}catch(error){acionamento={acionado:false,aviso:error.message};}
    res.json({sucesso:true,mensagem:'Candidato enviado para a fila de resgate.',resgate:result.rows[0],acionamento});
  } catch(error){next(error);}
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

    if (tipo === 'FALHA') {
      filters.push(`UPPER(COALESCE(d.status_processamento, '')) IN ('ERRO','ERRO_PROCESSAMENTO','INCONCLUSIVO')`);
    } else if (tipo === 'PENDENTE') {
      filters.push(`(
        UPPER(COALESCE(d.tipo, '')) IN ('PENDENTE','PENDENTE_REVISAO')
        OR UPPER(COALESCE(d.status_processamento, '')) IN ('RECEBIDO','ARMAZENADO','PROCESSANDO','REPROCESSAMENTO_SOLICITADO','REVISAO','PENDENTE')
      )`);
    } else if (tipo && tipo !== 'TODOS') {
      values.push(tipo);
      filters.push(`UPPER(COALESCE(d.tipo, '')) = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT d.id, d.candidato_id, d.tipo, d.titulo,
        COALESCE(d.nome_arquivo, d.arquivo, 'documento.pdf') AS nome_arquivo,
        d.mime_type, d.tamanho_bytes, d.status_processamento, d.resultado, d.processado_at, d.created_at,
        (d.conteudo IS NOT NULL) AS disponivel_download,
        COALESCE(c.nome, 'Candidato #' || c.id) AS candidato_nome,
        c.telefone, c.etapa AS candidato_etapa, c.status AS candidato_status,
        COALESCE(v.titulo, c.vaga, 'Vaga não vinculada') AS vaga_nome
      FROM documentos d
      JOIN candidatos c ON c.id = d.candidato_id
      LEFT JOIN vagas v ON v.id = c.vaga_id
      ${where}
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1000
    `, values);

    res.json({ sucesso: true, documentos: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/monitoramento', requireAdmin, async (_req, res, next) => {
  try {
    const [metricas, logs, erros, tarefas, alertas, atividades, recentes, followups, divulgacoes] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM atendimento_logs WHERE created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS entradas_24h,
          (SELECT COUNT(*) FROM atendimento_logs WHERE candidato_id IS NULL AND created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS entradas_sem_candidato_24h,
          (SELECT COUNT(*) FROM workflow_erros WHERE resolvido IS FALSE)::INTEGER AS erros_pendentes,
          (SELECT COUNT(*) FROM workflow_erros WHERE created_at >= NOW() - INTERVAL '24 hours')::INTEGER AS erros_24h,
          (SELECT COUNT(*) FROM documentos WHERE UPPER(COALESCE(tipo, '')) = 'PENDENTE')::INTEGER AS documentos_pendentes,
          (SELECT COUNT(*) FROM candidatos WHERE etapa = 'PROCESSANDO_CTPS')::INTEGER AS candidatos_analisando,
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
            AND c.etapa IN ('PROCESSANDO_CTPS','REVISAO_DOCUMENTAL','PENDENTE_APROVACAO_RECRUTADOR','AGUARDANDO_ESCOLHA_HORARIO','AGUARDANDO_CTPS','AGUARDANDO_CEP','AGUARDANDO_NOME','AGUARDANDO_EXPERIENCIA','AGUARDANDO_TEMPO_DESLOCAMENTO','AGUARDANDO_CONFIRMACAO_CHEGADA')
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

app.post('/api/workflow-erros/:id/resolver', requireAdmin, async (req, res, next) => {
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

app.post('/api/admin/candidatos/:id/acao', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const action = String(req.body?.action || '').trim().toUpperCase();
    const observation = String(req.body?.observacao || '').trim().slice(0, 2000);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });
    if (!['REPROVAR_VAGA', 'ENCERRAR', 'REABRIR'].includes(action)) {
      return res.status(400).json({ sucesso: false, erro: 'Ação administrativa inválida.' });
    }

    await client.query('BEGIN');
    const current = await client.query(`
      SELECT c.*, COALESCE(v.titulo, c.vaga, 'vaga atual') AS vaga_nome
      FROM candidatos c
      LEFT JOIN vagas v ON v.id=c.vaga_id
      WHERE c.id=$1
      FOR UPDATE
    `, [id]);
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }

    const candidate = current.rows[0];
    const userName = currentUserName(req);
    let message = '';
    let eventName = '';
    let eventDescription = '';

    if (action === 'REPROVAR_VAGA') {
      const reasonCode = String(req.body?.motivo_codigo || '').trim().toUpperCase();
      const allowedReasons = ['EXPERIENCIA_INSUFICIENTE','EXPERIENCIA_NAO_COMPATIVEL','DOCUMENTO_INSUFICIENTE','DISPONIBILIDADE_INCOMPATIVEL','DESLOCAMENTO_INCOMPATIVEL','OUTRO'];
      if (!allowedReasons.includes(reasonCode)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ sucesso: false, erro: 'Selecione um motivo válido para a reprovação.' });
      }
      if (reasonCode === 'OUTRO' && !observation) {
        await client.query('ROLLBACK');
        return res.status(400).json({ sucesso: false, erro: 'Descreva o motivo da reprovação.' });
      }
      const reasonInfo = rejectionReasonInfo(reasonCode, reasonCode);
      const reallocatable = req.body?.realocavel !== false;
      await client.query(`
        UPDATE candidatos SET
          status='REPROVADO', etapa='NAO_APTO_NESTA_VAGA', aprovado=FALSE,
          motivo_reprovacao=$2, motivo_reprovacao_codigo=$3,
          motivo_reprovacao_categoria=$4,
          motivo_reprovacao_detalhe=COALESCE(NULLIF($5,''),$2),
          reprovacao_realocavel=$6, reprovacao_vaga_id=vaga_id,
          reprovacao_registrada_em=NOW(), revisao_pendente=FALSE,
          revisao_tipo=NULL, revisao_motivo=NULL,
          ia_atendimento_ativo=FALSE, ia_pausada_em=NOW(), ia_pausada_por=$7,
          ia_pausa_motivo='Reprovação administrativa nesta vaga', updated_at=NOW()
        WHERE id=$1
      `, [id, reasonInfo.label, reasonInfo.codigo, reasonInfo.categoria, observation, reallocatable, userName]);
      await client.query(`
        INSERT INTO candidato_reprovacoes_historico
          (candidato_id,vaga_id,codigo,categoria,motivo,observacao,realocavel,origem,created_at)
        VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,'PAINEL_ADMIN',NOW())
      `, [id, candidate.vaga_id, reasonInfo.codigo, reasonInfo.categoria, reasonInfo.label, observation, reallocatable]).catch(() => {});
      message = `${candidateFirstName(candidate) ? `${candidateFirstName(candidate)}, ` : ''}após a análise do seu perfil, neste momento não será possível continuar na vaga ${candidate.vaga_nome}. Seu cadastro poderá ser considerado em futuras oportunidades compatíveis.`;
      eventName = 'REPROVACAO_ADMINISTRATIVA_NA_VAGA';
      eventDescription = `Reprovação registrada por ${userName}. Motivo: ${reasonInfo.label}.${observation ? ` Detalhe: ${observation}` : ''}`;
    }

    if (action === 'ENCERRAR') {
      await client.query(`
        UPDATE candidatos SET status='ENCERRADO', etapa='ENCERRADO',
          ia_atendimento_ativo=FALSE, ia_pausada_em=NOW(), ia_pausada_por=$2,
          ia_pausa_motivo=COALESCE(NULLIF($3,''),'Candidatura encerrada administrativamente'),
          updated_at=NOW()
        WHERE id=$1
      `, [id, userName, observation]);
      eventName = 'CANDIDATURA_ENCERRADA_ADMIN';
      eventDescription = `Candidatura encerrada por ${userName}.${observation ? ` Motivo: ${observation}` : ''}`;
    }

    if (action === 'REABRIR') {
      await client.query(`
        UPDATE candidatos SET status='EM_PROCESSO', etapa='AGUARDANDO_INTENCAO', aprovado=NULL,
          motivo_reprovacao=NULL, motivo_reprovacao_codigo=NULL,
          motivo_reprovacao_categoria=NULL, motivo_reprovacao_detalhe=NULL,
          revisao_pendente=FALSE, revisao_tipo=NULL, revisao_motivo=NULL,
          ia_atendimento_ativo=TRUE, ia_retomada_em=NOW(), ia_retomada_por=$2,
          ia_pausa_motivo=NULL, updated_at=NOW()
        WHERE id=$1
      `, [id, userName]);
      eventName = 'CANDIDATURA_REABERTA_ADMIN';
      eventDescription = `Candidatura reaberta por ${userName}; fluxo retomado no menu inicial.`;
    }

    await client.query(`INSERT INTO eventos(candidato_id,evento,descricao,created_at) VALUES($1,$2,$3,NOW())`, [id, eventName, eventDescription]);
    await client.query('COMMIT');

    let delivery = null;
    if (action === 'REPROVAR_VAGA' && req.body?.enviar_mensagem === true) {
      try {
        delivery = await triggerManualCandidateMessage({
          candidatoId: id,
          mensagem: message,
          evento: 'REPROVACAO_ADMINISTRATIVA_ENVIADA',
          solicitadoPor: userName,
        });
      } catch (error) {
        delivery = { enviado: false, erro: error.message };
      }
    }

    return res.json({
      sucesso: true,
      mensagem: action === 'REPROVAR_VAGA' ? 'Candidato reprovado nesta vaga.' : action === 'ENCERRAR' ? 'Candidatura encerrada.' : 'Candidatura reaberta.',
      aviso: delivery && !delivery.enviado ? (delivery.erro || delivery.aviso || 'A decisão foi salva, mas a mensagem não foi confirmada.') : null,
      envio: delivery,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

app.post('/api/candidatos/:id/ia', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });
    if (typeof req.body?.ativo !== 'boolean') {
      return res.status(400).json({ sucesso: false, erro: 'Informe ativo como true ou false.' });
    }

    const active = req.body.ativo;
    const reason = String(req.body?.motivo || '').trim().slice(0, 1000);
    const userName = currentUserName(req);

    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE candidatos
      SET
        ia_atendimento_ativo = $1,
        ia_pausada_em = CASE WHEN $1 = FALSE THEN NOW() ELSE ia_pausada_em END,
        ia_pausada_por = CASE WHEN $1 = FALSE THEN $2 ELSE ia_pausada_por END,
        ia_pausa_motivo = CASE WHEN $1 = FALSE THEN NULLIF($3, '') ELSE ia_pausa_motivo END,
        ia_retomada_em = CASE WHEN $1 = TRUE THEN NOW() ELSE ia_retomada_em END,
        ia_retomada_por = CASE WHEN $1 = TRUE THEN $2 ELSE ia_retomada_por END,
        ia_ultima_acao_manual = CASE WHEN $1 = TRUE THEN 'IA_RETOMADA' ELSE 'IA_PAUSADA' END,
        ia_ultima_acao_manual_em = NOW(),
        ia_ultima_acao_manual_por = $2,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [active, userName, reason, id]);

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }

    await client.query(`
      INSERT INTO eventos (candidato_id, evento, descricao, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [
      id,
      active ? 'ATENDIMENTO_IA_RETOMADO' : 'ATENDIMENTO_IA_PAUSADO',
      active
        ? `Atendimento automático retomado por ${userName}.`
        : `Atendimento automático pausado por ${userName}.${reason ? ` Motivo: ${reason}` : ''}`,
    ]);
    await client.query('COMMIT');

    return res.json({
      sucesso: true,
      mensagem: active
        ? 'Atendimento automático retomado.'
        : 'Atendimento automático pausado. A IA não responderá novas mensagens deste candidato.',
      candidato: result.rows[0],
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

app.post('/api/candidatos/:id/continuar-atendimento', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });

    const allowedStatuses = ['NOVO', 'EM_PROCESSO', 'APROVADO', 'EM_ADMISSAO', 'REPROVADO', 'CONTRATADO', 'ENCERRADO'];
    const status = String(req.body?.status || '').trim().toUpperCase();
    const stage = String(req.body?.etapa || '').trim().toUpperCase();
    const customMessage = String(req.body?.mensagem || '').trim().slice(0, 4000);
    const sendNow = req.body?.enviar_mensagem !== false;
    const activateAi = req.body?.ativar_ia !== false;

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ sucesso: false, erro: 'Status inválido.' });
    }
    if (!candidateStageValues.includes(stage)) {
      return res.status(400).json({ sucesso: false, erro: 'Etapa inválida.' });
    }

    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE candidatos c
      SET
        status = $1,
        etapa = $2,
        ia_atendimento_ativo = $3,
        ia_retomada_em = CASE WHEN $3 = TRUE THEN NOW() ELSE ia_retomada_em END,
        ia_retomada_por = CASE WHEN $3 = TRUE THEN $4 ELSE ia_retomada_por END,
        ia_ultima_acao_manual = 'CONTINUAR_ATENDIMENTO',
        ia_ultima_acao_manual_em = NOW(),
        ia_ultima_acao_manual_por = $4,
        updated_at = NOW()
      WHERE c.id = $5
      RETURNING c.*,
        COALESCE((SELECT titulo FROM vagas WHERE id = c.vaga_id), c.vaga, 'vaga atual') AS vaga_nome
    `, [status, stage, activateAi, currentUserName(req), id]);

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ sucesso: false, erro: 'Candidato não encontrado.' });
    }

    const candidate = result.rows[0];
    const message = buildManualContinuationMessage(candidate, customMessage);
    await client.query(`
      UPDATE candidatos
      SET ia_ultima_mensagem_manual = $1
      WHERE id = $2
    `, [message, id]);
    await client.query(`
      INSERT INTO eventos (candidato_id, evento, descricao, created_at)
      VALUES ($1, 'ATENDIMENTO_CONTINUADO_PELO_PAINEL', $2, NOW())
    `, [id, `Status ${status}; etapa ${stage}; ação executada por ${currentUserName(req)}.`]);
    await client.query('COMMIT');

    let delivery = { configurado: false, enviado: false };
    if (sendNow) {
      try {
        delivery = await triggerManualCandidateMessage({
          candidatoId: id,
          mensagem: message,
          evento: 'MENSAGEM_CONTINUACAO_MANUAL',
          solicitadoPor: currentUserName(req),
        });
      } catch (webhookError) {
        console.error('Falha ao enviar continuação manual:', webhookError);
        delivery = { configurado: Boolean(ATENDIMENTO_MANUAL_WEBHOOK_URL), enviado: false, erro: webhookError.message };
      }
    }

    return res.json({
      sucesso: true,
      mensagem: sendNow
        ? (delivery.enviado ? 'Atendimento retomado e mensagem enviada.' : 'Etapa atualizada, mas o envio da mensagem não foi confirmado.')
        : 'Etapa atualizada sem envio de mensagem.',
      candidato: candidate,
      mensagem_enviada: message,
      envio: delivery,
      aviso: sendNow && !delivery.enviado
        ? (delivery.aviso || delivery.erro || 'Revise o workflow de atendimento manual no n8n.')
        : null,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return next(error);
  } finally {
    client.release();
  }
});

app.post('/api/candidatos/:id/reprocessar-ctps', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID de candidato inválido.' });
    if (!CHATBOT_WEBHOOK_URL) {
      return res.status(503).json({ sucesso: false, erro: 'Configure CHATBOT_WEBHOOK_URL no serviço do painel.' });
    }
    if (!CHATBOT_REPROCESS_TOKEN) {
      return res.status(503).json({ sucesso: false, erro: 'Configure CHATBOT_REPROCESS_TOKEN no serviço do painel.' });
    }

    const result = await pool.query(`
      SELECT
        c.id AS candidato_id,
        c.nome,
        c.telefone,
        c.status,
        c.etapa,
        d.id AS documento_id,
        COALESCE(d.nome_arquivo, d.arquivo, 'CTPS Digital.pdf') AS nome_arquivo,
        COALESCE(NULLIF(d.mime_type, ''), 'application/pdf') AS mime_type
      FROM candidatos c
      JOIN LATERAL (
        SELECT id, nome_arquivo, arquivo, mime_type
        FROM documentos
        WHERE candidato_id = c.id
          AND conteudo IS NOT NULL
          AND COALESCE(NULLIF(mime_type, ''), 'application/pdf') = 'application/pdf'
          AND UPPER(COALESCE(tipo, '')) IN ('CTPS', 'PENDENTE', 'OUTRO')
        ORDER BY
          CASE UPPER(COALESCE(tipo, '')) WHEN 'CTPS' THEN 0 WHEN 'PENDENTE' THEN 1 ELSE 2 END,
          created_at DESC,
          id DESC
        LIMIT 1
      ) d ON TRUE
      WHERE c.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rowCount) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Não há uma CTPS/PDF armazenada para reprocessar. Peça ao candidato para enviar o arquivo novamente.',
      });
    }

    const data = result.rows[0];
    if (['CONTRATADO', 'ENCERRADO'].includes(String(data.status || '').toUpperCase())) {
      return res.status(400).json({ sucesso: false, erro: 'Este processo já está encerrado e não pode ser reprocessado.' });
    }

    const publicBase = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const mediaUrl = `${publicBase}/api/public/documentos/${data.documento_id}/reprocessar.pdf?token=${encodeURIComponent(CHATBOT_REPROCESS_TOKEN)}`;

    await pool.query(`
      UPDATE candidatos
      SET
        status = 'EM_PROCESSO',
        etapa = 'ANALISANDO_DOCUMENTOS',
        ia_atendimento_ativo = TRUE,
        ia_retomada_em = NOW(),
        ia_retomada_por = $1,
        ia_ultima_acao_manual = 'REPROCESSAR_CTPS',
        ia_ultima_acao_manual_em = NOW(),
        ia_ultima_acao_manual_por = $1,
        updated_at = NOW()
      WHERE id = $2
    `, [currentUserName(req), id]);

    await pool.query(`
      INSERT INTO eventos (candidato_id, evento, descricao, created_at)
      VALUES ($1, 'REPROCESSAMENTO_CTPS_SOLICITADO', $2, NOW())
    `, [id, `Reprocessamento solicitado no painel por ${currentUserName(req)}. Documento #${data.documento_id}.`]);

    await triggerChatbotReprocess({
      candidatoId: id,
      telefone: data.telefone,
      documentoId: data.documento_id,
      nomeArquivo: data.nome_arquivo,
      mimeType: data.mime_type,
      mediaUrl,
    });

    return res.json({
      sucesso: true,
      mensagem: 'A CTPS foi enviada novamente para análise. O resultado será encaminhado automaticamente ao candidato.',
      documento_id: data.documento_id,
    });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/candidatos/:id', requireAdmin, async (req, res, next) => {
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
    if (status === 'REPROVADO' || etapa === 'REPROVADO_POS_ENTREVISTA') {
      return res.status(400).json({
        sucesso: false,
        erro: 'Para reprovar após a entrevista, use o campo “Resultado após entrevista” e informe o motivo obrigatório.',
      });
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
    const motivoCodigo = String(req.body?.motivo_codigo || req.body?.motivo || '').trim().toUpperCase();
    const motivoInfo = rejectionReasonInfo(motivoCodigo, req.body?.motivo);
    const motivo = motivoInfo.label;
    const observacao = String(req.body?.observacao || '').trim();
    const realocavel = req.body?.realocavel === undefined ? motivoInfo.realocavel : Boolean(req.body.realocavel);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    if (!['EM_ADMISSAO', 'REPROVADO_POS_ENTREVISTA', 'CONTRATADO'].includes(decisao)) {
      return res.status(400).json({ sucesso: false, erro: 'Decisão inválida.' });
    }
    if (decisao === 'REPROVADO_POS_ENTREVISTA' && !rejectionReasonCatalog[motivoInfo.codigo]) {
      return res.status(400).json({ sucesso: false, erro: 'Selecione um motivo válido para a reprovação após a entrevista.' });
    }
    if (decisao === 'REPROVADO_POS_ENTREVISTA' && motivoInfo.exigeDetalhe && !observacao) {
      return res.status(400).json({ sucesso: false, erro: 'Descreva o requisito ou contexto específico desta reprovação.' });
    }

    const status = decisao === 'REPROVADO_POS_ENTREVISTA' ? 'REPROVADO' : decisao;
    const etapa = decisao;
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE candidatos
      SET
        status = $1::VARCHAR,
        etapa = $2::VARCHAR,
        motivo_reprovacao_pos_entrevista = CASE
          WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN $3::TEXT
          ELSE NULL::TEXT
        END,
        motivo_reprovacao = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN $3::TEXT ELSE motivo_reprovacao END,
        motivo_reprovacao_codigo = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN $7::TEXT ELSE motivo_reprovacao_codigo END,
        motivo_reprovacao_categoria = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN $8::TEXT ELSE motivo_reprovacao_categoria END,
        motivo_reprovacao_detalhe = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN COALESCE(NULLIF($4::TEXT, ''), $3::TEXT) ELSE motivo_reprovacao_detalhe END,
        reprovacao_realocavel = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN $9::BOOLEAN ELSE reprovacao_realocavel END,
        reprovacao_vaga_id = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN vaga_id ELSE reprovacao_vaga_id END,
        reprovacao_registrada_em = CASE WHEN $2::VARCHAR = 'REPROVADO_POS_ENTREVISTA'::VARCHAR THEN NOW() ELSE reprovacao_registrada_em END,
        observacao_decisao_pos_entrevista = NULLIF($4::TEXT, ''),
        decisao_pos_entrevista_at = NOW(),
        decisao_pos_entrevista_por = $5::TEXT,
        admissao_iniciada_at = CASE
          WHEN $2::VARCHAR = 'EM_ADMISSAO'::VARCHAR
          THEN COALESCE(admissao_iniciada_at, NOW())
          ELSE admissao_iniciada_at
        END,
        updated_at = NOW()
      WHERE id = $6::BIGINT
      RETURNING *
    `, [status, etapa, motivo || null, observacao, currentUserName(req), id, motivoInfo.codigo, motivoInfo.categoria, realocavel]);
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

    if (decisao === 'REPROVADO_POS_ENTREVISTA') {
      await client.query(`
        INSERT INTO candidato_reprovacoes_historico
        (candidato_id, vaga_id, etapa, categoria, codigo, motivo, observacao, realocavel, origem, dados_contexto, registrado_por)
        SELECT
          c.id, c.vaga_id, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT,
          NULLIF($6::TEXT, ''), $7::BOOLEAN, 'PAINEL',
          JSONB_BUILD_OBJECT('status_anterior', c.status, 'decisao', $2::TEXT), $8::TEXT
        FROM candidatos c
        WHERE c.id = $1
      `, [id, etapa, motivoInfo.categoria, motivoInfo.codigo, motivo, observacao, realocavel, currentUserName(req)]);
    }
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

app.get('/api/candidatos/:id/notas', requireAdmin, async (req, res, next) => {
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

app.post('/api/candidatos/:id/notas', requireAdmin, async (req, res, next) => {
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

app.get('/api/candidatos/:id/tarefas', requireAdmin, async (req, res, next) => {
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

app.post('/api/candidatos/:id/tarefas', requireAdmin, async (req, res, next) => {
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

app.patch('/api/tarefas/:id', requireAdmin, async (req, res, next) => {
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

app.get('/api/candidatos/:id/etiquetas', requireAdmin, async (req, res, next) => {
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

app.post('/api/candidatos/:id/etiquetas', requireAdmin, async (req, res, next) => {
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


// ============================================================
// GENESIS IA V9 — Templates de vagas e Auditoria híbrida
// ============================================================

const templateDataSchema = z.record(z.string(), z.any());
const vacancyTemplateSchema = z.object({
  nome: z.string().trim().min(2).max(160),
  descricao: nullableText,
  empresa_id: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) { ctx.addIssue({ code: 'custom', message: 'Empresa inválida.' }); return z.NEVER; }
    return id;
  }),
  dados: templateDataSchema,
  ativo: z.union([z.boolean(), z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => !(value === false || value === 0 || value === '0' || value === 'false'))
    .default(true),
});

app.get('/api/vagas-templates', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT t.*, e.nome AS empresa_nome
      FROM vagas_templates t
      LEFT JOIN empresas e ON e.id = t.empresa_id
      WHERE t.ativo = TRUE
      ORDER BY t.nome ASC
    `);
    res.json({ sucesso: true, templates: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/vagas-templates', async (req, res, next) => {
  try {
    const parsed = vacancyTemplateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const d = parsed.data;
    const result = await pool.query(`
      INSERT INTO vagas_templates (nome, descricao, empresa_id, dados, ativo, criado_por, atualizado_por)
      VALUES ($1,$2,$3,$4::JSONB,$5,$6,$6)
      ON CONFLICT (nome) DO UPDATE SET
        descricao = EXCLUDED.descricao,
        empresa_id = EXCLUDED.empresa_id,
        dados = EXCLUDED.dados,
        ativo = TRUE,
        atualizado_por = EXCLUDED.atualizado_por,
        updated_at = NOW()
      RETURNING *
    `, [d.nome, d.descricao, d.empresa_id, JSON.stringify(d.dados || {}), d.ativo, currentUserName(req)]);
    res.status(201).json({ sucesso: true, mensagem: 'Template salvo com sucesso.', template: result.rows[0] });
  } catch (error) { next(error); }
});

app.put('/api/vagas-templates/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const parsed = vacancyTemplateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const d = parsed.data;
    const result = await pool.query(`
      UPDATE vagas_templates SET nome=$2, descricao=$3, empresa_id=$4,
        dados=$5::JSONB, ativo=$6, atualizado_por=$7, updated_at=NOW()
      WHERE id=$1 RETURNING *
    `, [id, d.nome, d.descricao, d.empresa_id, JSON.stringify(d.dados || {}), d.ativo, currentUserName(req)]);
    if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Template não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Template atualizado.', template: result.rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/vagas-templates/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const result = await pool.query(`UPDATE vagas_templates SET ativo=FALSE, atualizado_por=$2, updated_at=NOW() WHERE id=$1 RETURNING id`, [id, currentUserName(req)]);
    if (!result.rowCount) return res.status(404).json({ sucesso: false, erro: 'Template não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Template desativado.' });
  } catch (error) { next(error); }
});

function auditNormalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/https?:\/\/\S+/g, ' link ').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function auditSimilarity(left, right) {
  const a = auditNormalizeText(left);
  const b = auditNormalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (text) => {
    const padded = `  ${text}  `;
    const set = new Set();
    for (let i = 0; i < padded.length - 2; i += 1) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ga = grams(a); const gb = grams(b);
  let intersection = 0;
  for (const item of ga) if (gb.has(item)) intersection += 1;
  return (2 * intersection) / Math.max(1, ga.size + gb.size);
}

function calculateAgeAt(dateOfBirth, reference = new Date()) {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(reference).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  let age = Number(parts.year) - birth.getUTCFullYear();
  const month = Number(parts.month) - 1;
  const day = Number(parts.day);
  if (month < birth.getUTCMonth() || (month === birth.getUTCMonth() && day < birth.getUTCDate())) age -= 1;
  return age;
}

function auditFingerprint(parts) {
  return crypto.createHash('sha256').update(parts.map((item) => String(item ?? '')).join('|')).digest('hex');
}

async function insertAuditIssue(client, runId, candidate, issue) {
  const fingerprint = auditFingerprint([
    candidate.id, issue.categoria, issue.mensagem_usuario_id, issue.mensagem_ia_id,
    issue.anchor || issue.descricao?.slice(0, 120),
  ]);
  const result = await client.query(`
    INSERT INTO auditoria_problemas (
      auditoria_id, candidato_id, vaga_id, categoria, gravidade, origem_deteccao,
      confianca, titulo, descricao, evidencia, comportamento_esperado,
      sugestao_correcao, mensagem_usuario_id, mensagem_ia_id, fingerprint
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::JSONB,$11,$12,$13,$14,$15)
    ON CONFLICT (fingerprint) DO UPDATE SET
      auditoria_id = EXCLUDED.auditoria_id,
      gravidade = EXCLUDED.gravidade,
      confianca = EXCLUDED.confianca,
      descricao = EXCLUDED.descricao,
      evidencia = EXCLUDED.evidencia,
      comportamento_esperado = EXCLUDED.comportamento_esperado,
      sugestao_correcao = EXCLUDED.sugestao_correcao,
      updated_at = NOW()
    RETURNING id
  `, [runId, candidate.id, candidate.vaga_id || null, issue.categoria, issue.gravidade,
    issue.origem_deteccao || 'REGRA', issue.confianca ?? 100, issue.titulo,
    issue.descricao, JSON.stringify(issue.evidencia || {}), issue.comportamento_esperado || null,
    issue.sugestao_correcao || null, issue.mensagem_usuario_id || null,
    issue.mensagem_ia_id || null, fingerprint]);
  return result.rows[0]?.id || null;
}

function asksForCtps(message) {
  const text = auditNormalizeText(message);
  return /(ctps|carteira de trabalho)/.test(text) && /(envie|enviar|mande|mandar|preciso|necessario|necessaria|aguardo|anexe|encaminhe)/.test(text);
}
function asksForCep(message) {
  const text = auditNormalizeText(message);
  return /\bcep\b/.test(text) && /(informe|envie|mandar|mande|preciso|qual|digite)/.test(text);
}
function asksForAge(message) {
  const text = auditNormalizeText(message);
  return /(data de nascimento|nascimento|qual.*idade|idade atual)/.test(text)
    && /(informe|qual|pode.*responder|preciso|confirma)/.test(text);
}
function textContainsBirthOrAge(message) {
  const raw = String(message || '');
  const text = auditNormalizeText(raw);
  return /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}\b/.test(raw)
    || /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(raw)
    || /\b\d{1,2}\s+(?:de\s+)?(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?\d{4}\b/.test(text)
    || /\b(?:tenho|estou com|minha idade e|idade)\s*:?\s*\d{1,3}\s*anos?\b/.test(text)
    || /^\s*\d{1,3}\s*anos?\s*$/.test(text);
}
function extractCepFromMessage(message) {
  const match = String(message || '').match(/(?:^|\D)(\d{5})[-. ]?(\d{3})(?:\D|$)/);
  return match ? `${match[1]}${match[2]}` : null;
}
function isPauseOrClosure(message) {
  const text = auditNormalizeText(message);
  return /(vou aguardar|prefiro aguardar|aguardar outra oportunidade|nao consigo.*domingo|nao posso.*domingo|curso.*domingo|sem disponibilidade|nao tenho interesse|nao quero.*vaga|pode pausar|nao precisa.*chamar)/.test(text);
}
function isFollowupMessage(message) {
  const text = auditNormalizeText(message);
  return /(ainda deseja continuar|ainda faltam|para continuar|vi que voce iniciou|nao concluiu|lembrete|retomar.*processo)/.test(text);
}
function asksForSex(message) {
  const text = auditNormalizeText(message);
  return /(sexo|genero)/.test(text) && /(masculino|feminino|como.*prefere.*informar|pode.*informar|qual)/.test(text);
}
function textContainsSexAnswer(message) {
  const text = auditNormalizeText(message);
  return /^(masculino|feminino|homem|mulher)$/.test(text)
    || /\b(?:sexo|genero|sou|me identifico como)\s*(?:e|:|-)?\s*(masculino|feminino|homem|mulher)\b/.test(text)
    || /(prefiro nao informar|nao quero informar|nao desejo informar)/.test(text);
}
function exposesTechnicalError(message) {
  const text = String(message || '');
  return /(problem in node|module ['"]?.+['"]? is disallowed|cannot read properties|syntaxerror|referenceerror|typeerror|sqlstate|postgres(?:ql)? error|webhook error|execution failed|undefined is not|stack trace|erro no node|falha no workflow)/i.test(text);
}
function containsVacancyGroupLink(message) {
  return /https?:\/\/(?:chat\.)?whatsapp\.com\/\S+/i.test(String(message || ''));
}
function mentionsInterviewOffer(message) {
  const text = auditNormalizeText(message);
  return /(entrevista|google meet|horarios disponiveis|opcoes disponiveis)/.test(text)
    && /(marcar|agendar|opcao 1|responda com 1|horario|disponiveis)/.test(text);
}

async function callAiAudit(candidate, messages, vacancy, documents) {
  if (!AUDITORIA_IA_WEBHOOK_URL) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDITORIA_IA_TIMEOUT_MS);
  try {
    const response = await fetch(AUDITORIA_IA_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: AUDITORIA_IA_WEBHOOK_TOKEN,
        candidato: candidate,
        vaga: vacancy,
        documentos: documents,
        mensagens: messages,
        categorias_permitidas: [
          'PERGUNTA_IGNORADA','RESPOSTA_FORA_CONTEXTO','INFORMACAO_INVENTADA','CONTRADICAO',
          'INSTRUCAO_CONFUSA','NAO_RECONHECEU_DOCUMENTO','PERGUNTA_FORA_DA_ETAPA',
          'RESPOSTA_INCOMPLETA','OPCAO_INVALIDA_NAO_REPETIDA','SOLICITOU_MULTIPLAS_PENDENCIAS',
          'CONFIRMACAO_IGNORADA','ENCERRAMENTO_NAO_RESPEITADO',
          'PERGUNTA_REPETIDA','RESPOSTA_REDUNDANTE','PROMESSA_NAO_CUMPRIDA',
          'INSTRUCAO_CONFUSA','CONDUCAO_EXCESSIVAMENTE_LONGA','RESPOSTA_FRIA_EM_REPROVACAO'
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Auditoria IA retornou HTTP ${response.status}.`);
    const body = await response.json().catch(() => ({}));
    return Array.isArray(body.problemas) ? body.problemas.slice(0, 10) : [];
  } finally { clearTimeout(timer); }
}

async function executeHybridAudit({ start, end, origin, requestedBy }) {
  const client = await pool.connect();
  let runId = null;
  try {
    const run = await client.query(`
      INSERT INTO auditorias_conversas (origem, inicio_periodo, fim_periodo, status, solicitado_por)
      VALUES ($1,$2,$3,'PROCESSANDO',$4) RETURNING id
    `, [origin, start, end, requestedBy]);
    runId = run.rows[0].id;

    const candidatesResult = await client.query(`
      SELECT c.*, v.titulo AS vaga_nome, v.idade_minima, v.idade_maxima,
        v.entrevista_horarios, v.entrevista_dias_semana,
        v.entrevista_duracao_minutos, v.experiencia_minima_meses, v.experiencia_revisao_minima_meses, TO_JSONB(v) AS vaga_dados
      FROM candidatos c
      LEFT JOIN vagas v ON v.id = c.vaga_id
      WHERE EXISTS (
        SELECT 1 FROM mensagens m
        WHERE m.candidato_id = c.id AND m.created_at >= $1 AND m.created_at < $2
      )
      ORDER BY c.updated_at DESC
      LIMIT $3
    `, [start, end, AUDITORIA_MAX_CONVERSAS]);

    const candidatesWithIssues = new Set();
    let totalIssues = 0;
    let aiAuditedConversations = 0;
    for (const candidate of candidatesResult.rows) {
      const [messagesResult, documentsResult, interviewsResult, historyResult] = await Promise.all([
        client.query(`SELECT id, quem, mensagem, mensagem_id, contexto_snapshot, lote_resposta_id, origem_mensagem_id, created_at FROM mensagens WHERE candidato_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC, id ASC`, [candidate.id, start, end]),
        client.query(`SELECT id, tipo, titulo, nome_arquivo, mensagem_id, hash_sha256, status_processamento, classificacao_confianca, resultado, (conteudo IS NOT NULL) AS arquivo_armazenado, created_at, processando_at, processado_at FROM documentos WHERE candidato_id=$1 ORDER BY created_at ASC, id ASC`, [candidate.id]),
        client.query(`SELECT id, inicio, fim, status, meet_link, google_event_url, created_at FROM entrevistas WHERE candidato_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC`, [candidate.id, start, end]),
        client.query(`SELECT * FROM candidato_etapas_historico WHERE candidato_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC`, [candidate.id, start, end]).catch(() => ({ rows: [] })),
      ]);
      const messages = messagesResult.rows;
      const documents = documentsResult.rows;
      const interviews = interviewsResult.rows;
      const issues = [];
      const iaMessages = messages.filter((item) => String(item.quem).toUpperCase() === 'IA');
      const staticFlow = String(candidate.fluxo_versao || '').toUpperCase() === 'CHATBOT_ESTATICO_V1';

      for (let index = 1; index < messages.length; index += 1) {
        const previous = messages[index - 1];
        const current = messages[index];
        if (String(previous.quem).toUpperCase() !== 'IA' || String(current.quem).toUpperCase() !== 'IA') continue;
        const seconds = (new Date(current.created_at) - new Date(previous.created_at)) / 1000;
        if (seconds < 0 || seconds > 120) continue;
        const similarity = auditSimilarity(previous.mensagem, current.mensagem);
        if (similarity >= 0.90) {
          issues.push({ categoria: 'MENSAGEM_DUPLICADA', gravidade: seconds <= 5 ? 'ALTA' : 'MEDIA',
            titulo: 'Mensagem duplicada ou muito semelhante',
            descricao: `A Evelyn enviou duas respostas consecutivas com ${Math.round(similarity * 100)}% de similaridade em ${Math.round(seconds)} segundo(s).`,
            evidencia: { anterior: previous, atual: current, similaridade: similarity },
            comportamento_esperado: 'Enviar uma única resposta consolidada para cada lote de mensagens.',
            sugestao_correcao: 'Revisar idempotência, buffer e execuções concorrentes.', mensagem_ia_id: current.id,
            anchor: `${previous.id}-${current.id}` });
        } else {
          issues.push({ categoria: 'RESPOSTAS_CONCORRENTES', gravidade: seconds <= 10 ? 'ALTA' : 'MEDIA',
            titulo: 'Duas respostas da IA sem nova mensagem do candidato',
            descricao: `A Evelyn enviou duas respostas diferentes em ${Math.round(seconds)} segundo(s), sem uma nova mensagem do candidato entre elas.`,
            evidencia: { anterior: previous, atual: current, similaridade: similarity },
            comportamento_esperado: 'Processar cada lote uma única vez e consolidar a resposta.',
            sugestao_correcao: 'Verificar múltiplos webhooks, retries e concorrência por candidato.', mensagem_ia_id: current.id,
            anchor: `concurrent-${previous.id}-${current.id}` });
        }
      }

      for (const message of iaMessages) {
        const messageDate = new Date(message.created_at);
        const snapshot = message.contexto_snapshot && typeof message.contexto_snapshot === 'object' ? message.contexto_snapshot : {};
        const messagesBefore = messages.filter((item) => new Date(item.created_at) < messageDate);
        const priorUserMessages = messagesBefore.filter((item) => String(item.quem).toUpperCase() === 'USUARIO');

        if (!String(message.mensagem || '').trim()) {
          issues.push({ categoria: 'MENSAGEM_IA_VAZIA', gravidade: 'ALTA', titulo: 'Resposta vazia da IA',
            descricao: 'Foi registrado um envio da IA sem conteúdo textual.', evidencia: { mensagem: message },
            comportamento_esperado: 'Não enviar mensagens vazias e registrar falhas técnicas separadamente.',
            sugestao_correcao: 'Validar o texto antes do node de envio.', mensagem_ia_id: message.id, anchor: `empty-${message.id}` });
        }
        if (exposesTechnicalError(message.mensagem)) {
          issues.push({ categoria: 'ERRO_TECNICO_EXPOSTO', gravidade: 'CRITICA', titulo: 'Erro técnico exposto ao candidato',
            descricao: 'A resposta contém detalhes internos de execução, código ou infraestrutura.', evidencia: { mensagem: message },
            comportamento_esperado: 'Enviar uma mensagem segura e registrar o erro somente nos logs administrativos.',
            sugestao_correcao: 'Adicionar fallback amigável antes do envio ao WhatsApp.', mensagem_ia_id: message.id, anchor: `technical-${message.id}` });
        }
        const sexKnownBefore = priorUserMessages.some((item) => textContainsSexAnswer(item.mensagem));
        const sexAskedBefore = messagesBefore.some((item) => String(item.quem).toUpperCase() === 'IA' && asksForSex(item.mensagem));
        if (staticFlow && asksForSex(message.mensagem)) {
          issues.push({ categoria: 'SEXO_SOLICITADO_NO_FLUXO_ESTATICO', gravidade: 'ALTA', titulo: 'Sexo perguntado ao candidato no fluxo estático',
            descricao: 'Na Nova Fase, o sexo só pode ser extraído quando estiver explícito na CTPS e nunca deve ser solicitado no WhatsApp.', evidencia: { mensagem: message },
            comportamento_esperado: 'Manter a etapa atual e coletar sexo somente da CTPS, sem inferência e sem bloqueio.',
            sugestao_correcao: 'Remover a pergunta do template ou do workflow ativo.', mensagem_ia_id: message.id, anchor: `static-sex-${message.id}` });
        } else if (asksForSex(message.mensagem) && (sexKnownBefore || sexAskedBefore)) {
          issues.push({ categoria: 'SEXO_SOLICITADO_NOVAMENTE', gravidade: 'MEDIA', titulo: 'Sexo solicitado novamente',
            descricao: 'A informação já havia sido respondida, recusada ou perguntada anteriormente.', evidencia: { mensagem: message },
            comportamento_esperado: 'Perguntar uma única vez e continuar mesmo quando a pessoa preferir não informar.',
            sugestao_correcao: 'Usar sexo_perguntado_em, sexo e sexo_nao_informado antes da pergunta.', mensagem_ia_id: message.id, anchor: `sex-repeat-${message.id}` });
        }
        const statusBeforeMessage = String(snapshot.status_antes || '').toUpperCase();
        if (isFollowupMessage(message.mensagem) && ['REPROVADO','CONTRATADO','ENCERRADO','EM_ADMISSAO'].includes(statusBeforeMessage)) {
          issues.push({ categoria: 'FOLLOWUP_APOS_STATUS_FINAL', gravidade: 'ALTA', titulo: 'Follow-up incompatível com o status',
            descricao: `Foi enviado um lembrete quando o status anterior era ${statusBeforeMessage}.`, evidencia: { mensagem: message, contexto_snapshot: snapshot },
            comportamento_esperado: 'Não cobrar etapas antigas de candidatos em status final ou administrativo.',
            sugestao_correcao: 'Excluir status finais da seleção de follow-ups.', mensagem_ia_id: message.id, anchor: `followup-final-${message.id}` });
        }

        const docsBefore = documents.filter((doc) => new Date(doc.created_at) <= messageDate);
        const hasCtpsOrProcessing = docsBefore.some((doc) => ['CTPS','PENDENTE','PENDENTE_REVISAO'].includes(String(doc.tipo || '').toUpperCase())
          || ['PROCESSANDO','PENDENTE'].includes(String(doc.status_processamento || '').toUpperCase()));
        if (asksForCtps(message.mensagem) && hasCtpsOrProcessing) {
          const doc = docsBefore.at(-1);
          issues.push({ categoria: 'PEDIDO_REPETIDO_CTPS', gravidade: 'ALTA', titulo: 'CTPS solicitada novamente',
            descricao: 'A Evelyn solicitou a CTPS apesar de já existir um documento recebido ou em processamento.',
            evidencia: { mensagem: message, documento: doc },
            comportamento_esperado: 'Reconhecer o recebimento e informar que o documento está sendo processado.',
            sugestao_correcao: 'Bloquear a solicitação de CTPS quando houver documento PENDENTE, PROCESSANDO ou CTPS.', mensagem_ia_id: message.id,
            anchor: `${message.id}-${doc?.id || 'doc'}` });
        }
        const cepBefore = snapshot.tem_cep === true || messagesBefore.some((item) => String(item.quem).toUpperCase() === 'USUARIO' && Boolean(extractCepFromMessage(item.mensagem)));
        if (asksForCep(message.mensagem) && cepBefore) {
          issues.push({ categoria: 'PEDIDO_REPETIDO_CEP', gravidade: 'MEDIA', titulo: 'CEP solicitado novamente',
            descricao: 'A Evelyn pediu o CEP embora ele já estivesse disponível antes desta resposta.',
            evidencia: { mensagem: message, contexto_snapshot: snapshot, cep_previamente_informado: true },
            comportamento_esperado: 'Usar o CEP já salvo e avançar para a pendência seguinte.',
            sugestao_correcao: 'Usar o snapshot temporal da resposta e impedir pedidos repetidos.', mensagem_ia_id: message.id,
            anchor: message.id });
        }
        const ageKnownBefore = snapshot.idade_declarada != null || snapshot.idade_confirmada_documentalmente === true
          || messagesBefore.some((item) => String(item.quem).toUpperCase() === 'USUARIO' && textContainsBirthOrAge(item.mensagem));
        if (staticFlow && asksForAge(message.mensagem)) {
          issues.push({ categoria: 'IDADE_SOLICITADA_NO_FLUXO_ESTATICO', gravidade: 'ALTA', titulo: 'Idade perguntada ao candidato no fluxo estático',
            descricao: 'Na Nova Fase, a data de nascimento e a idade são extraídas internamente da CTPS.',
            evidencia: { mensagem: message, contexto_snapshot: snapshot },
            comportamento_esperado: 'Não perguntar idade ou nascimento no WhatsApp; encaminhar para revisão se a CTPS não permitir a validação.',
            sugestao_correcao: 'Remover a pergunta do template ou workflow ativo.', mensagem_ia_id: message.id,
            anchor: `static-age-${message.id}` });
        } else if (asksForAge(message.mensagem) && ageKnownBefore) {
          issues.push({ categoria: 'IDADE_SOLICITADA_NOVAMENTE', gravidade: 'MEDIA', titulo: 'Idade ou nascimento solicitado novamente',
            descricao: 'A conversa já continha data de nascimento ou idade declarada antes desta pergunta.',
            evidencia: { mensagem: message, contexto_snapshot: snapshot },
            comportamento_esperado: 'Registrar a confirmação preliminar e só validar definitivamente pelo documento.',
            sugestao_correcao: 'Aceitar data por extenso e idade declarada sem repetir a pergunta.', mensagem_ia_id: message.id,
            anchor: `age-repeat-${message.id}` });
        }
        const pauseBefore = messagesBefore.filter((item) => String(item.quem).toUpperCase() === 'USUARIO').some((item) => isPauseOrClosure(item.mensagem));
        if (pauseBefore && isFollowupMessage(message.mensagem)) {
          issues.push({ categoria: 'FOLLOWUP_APOS_PAUSA', gravidade: 'MEDIA', titulo: 'Follow-up enviado após pedido de pausa',
            descricao: 'O candidato havia indicado que desejava aguardar ou não possuía disponibilidade, mas recebeu uma cobrança de continuidade.',
            evidencia: { mensagem: message },
            comportamento_esperado: 'Pausar os lembretes até o candidato demonstrar novo interesse.',
            sugestao_correcao: 'Ampliar os gatilhos de pausa e reativar somente por mensagem do candidato.', mensagem_ia_id: message.id,
            anchor: `followup-pause-${message.id}` });
        }
        if (mentionsInterviewOffer(message.mensagem)) {
          const age = calculateAgeAt(candidate.data_nascimento, messageDate);
          const minAge = Number(candidate.idade_minima ?? 0);
          const maxAge = candidate.idade_maxima === null || candidate.idade_maxima === undefined ? null : Number(candidate.idade_maxima);
          const missing = [];
          const hasSnapshot = message.contexto_snapshot && typeof message.contexto_snapshot === 'object';
          const snap = hasSnapshot ? message.contexto_snapshot : {};
          if (!(hasSnapshot ? snap.tem_cep === true : cepBefore)) missing.push('CEP');
          if (!(hasSnapshot ? snap.tem_ctps === true : documents.some((doc) => String(doc.tipo || '').toUpperCase() === 'CTPS' && new Date(doc.created_at) <= messageDate))) missing.push('CTPS');
          if (!(hasSnapshot ? snap.aprovado === true : (candidate.aprovado === true || String(candidate.status || '').toUpperCase() === 'APROVADO'))) missing.push('aprovação da triagem');
          if (!staticFlow && !(hasSnapshot ? snap.apresentacao_informada === true : Boolean(String(candidate.apresentacao_profissional || '').trim()))) missing.push('apresentação profissional');
          if (minAge > 0 || maxAge !== null) {
            if (!(hasSnapshot ? snap.idade_confirmada_documentalmente === true : candidate.idade_confirmada_documentalmente === true)) missing.push('confirmação documental da idade');
            else if (!(hasSnapshot ? snap.idade_validada === true : candidate.idade_validada === true)) missing.push('faixa etária validada');
          }
          if (missing.length) {
            issues.push({ categoria: 'ENTREVISTA_SEM_REQUISITOS', gravidade: 'CRITICA', titulo: 'Entrevista liberada sem pré-requisitos',
              descricao: `Foram oferecidos horários de entrevista sem: ${missing.join(', ')}.`,
              evidencia: { mensagem: message, requisitos_ausentes: missing, candidato: { status: candidate.status, etapa: candidate.etapa, aprovado: candidate.aprovado, cep: candidate.cep, idade: age } },
              comportamento_esperado: 'Bloquear agenda até todos os requisitos obrigatórios estarem concluídos.',
              sugestao_correcao: 'Aplicar a trava determinística antes de consultar ou criar horários.', mensagem_ia_id: message.id,
              anchor: message.id });
          }
        }
      }

      const groupLinkMessages = iaMessages.filter((item) => containsVacancyGroupLink(item.mensagem));
      if (groupLinkMessages.length > 1) {
        issues.push({ categoria: 'LINK_GRUPO_REPETIDO', gravidade: 'MEDIA', titulo: 'Link do grupo enviado repetidamente',
          descricao: `O link de grupo foi enviado ${groupLinkMessages.length} vezes no período analisado.`,
          evidencia: { mensagens: groupLinkMessages.map((item) => ({ id: item.id, created_at: item.created_at })) },
          comportamento_esperado: 'Enviar o link uma vez por contexto de reprovação ou solicitação explícita.',
          sugestao_correcao: 'Consultar o evento CONVITE_GRUPO_VAGAS_ENVIADO antes do novo envio.', anchor: `group-link-${candidate.id}` });
      }

      const hashes = new Map();
      for (const doc of documents) {
        const hash = String(doc.hash_sha256 || '').trim();
        if (hash) {
          if (!hashes.has(hash)) hashes.set(hash, []);
          hashes.get(hash).push(doc);
        }
      }
      for (const [hash, sameDocs] of hashes) {
        if (sameDocs.length > 1) {
          issues.push({ categoria: 'DOCUMENTO_DUPLICADO', gravidade: 'MEDIA', titulo: 'Mesmo arquivo armazenado mais de uma vez',
            descricao: `Foram encontrados ${sameDocs.length} registros com o mesmo hash SHA-256.`,
            evidencia: { hash_sha256: hash, documentos: sameDocs.map((item) => ({ id: item.id, tipo: item.tipo, created_at: item.created_at })) },
            comportamento_esperado: 'Manter um único registro por candidato e conteúdo de arquivo.',
            sugestao_correcao: 'Revisar idempotência por mensagem_id e hash.', anchor: `doc-hash-${candidate.id}-${hash.slice(0,12)}` });
        }
      }

      for (const doc of documents) {
        const type = String(doc.tipo || '').toUpperCase();
        const processing = String(doc.status_processamento || '').toUpperCase();
        const pending = ['PENDENTE','PROCESSANDO'].includes(processing) || type === 'PENDENTE';
        const ageMinutes = (new Date(end) - new Date(doc.created_at)) / 60000;
        if (pending && ageMinutes > 15) {
          issues.push({ categoria: 'DOCUMENTO_PRESO', gravidade: ageMinutes > 60 ? 'ALTA' : 'MEDIA', titulo: 'Documento preso em processamento',
            descricao: `O documento permanece pendente há aproximadamente ${Math.round(ageMinutes)} minutos.`,
            evidencia: { documento: doc, minutos_pendente: Math.round(ageMinutes) },
            comportamento_esperado: 'Concluir a classificação ou encaminhar para revisão segura.',
            sugestao_correcao: 'Verificar download, OCR e persistência final do documento.', anchor: `doc-${doc.id}` });
        }
        if (type === 'OUTRO' || type === 'PENDENTE_REVISAO') {
          issues.push({ categoria: 'DOCUMENTO_NAO_RECONHECIDO', gravidade: 'MEDIA', titulo: 'Documento não reconhecido automaticamente',
            descricao: 'O PDF não foi confirmado como CTPS ou currículo e requer revisão.', evidencia: { documento: doc },
            comportamento_esperado: 'Preservar o arquivo e permitir revisão sem solicitar reenvio imediato.',
            sugestao_correcao: 'Revisar OCR e classificação do documento.', anchor: `doc-unrecognized-${doc.id}` });
        }
        if (String(doc.classificacao_confianca || '').toUpperCase() === 'BAIXA') {
          issues.push({ categoria: 'DOCUMENTO_BAIXA_CONFIANCA', gravidade: 'MEDIA', titulo: 'Classificação documental com baixa confiança',
            descricao: 'O classificador registrou baixa confiança para este PDF.', evidencia: { documento: doc },
            comportamento_esperado: 'Encaminhar para revisão e impedir decisões definitivas baseadas em classificação incerta.',
            sugestao_correcao: 'Ajustar sinais do classificador ou revisar manualmente.', anchor: `doc-low-${doc.id}` });
        }
        const resultText = JSON.stringify(doc.resultado || {});
        if (/OCR_VAZIO|texto_ocr.{0,20}(""|null)|SEM_TEXTO/i.test(resultText)) {
          issues.push({ categoria: 'OCR_VAZIO_OU_INSUFICIENTE', gravidade: 'ALTA', titulo: 'OCR vazio ou insuficiente',
            descricao: 'O resultado do documento não contém texto suficiente para uma classificação segura.', evidencia: { documento: doc },
            comportamento_esperado: 'Não decidir a triagem e encaminhar o arquivo para revisão.',
            sugestao_correcao: 'Verificar qualidade do PDF, download e provedor de OCR.', anchor: `ocr-empty-${doc.id}` });
        }
      }

      const completedCtps = documents.some((doc) => String(doc.tipo || '').toUpperCase() === 'CTPS'
        && String(doc.status_processamento || 'CONCLUIDO').toUpperCase() === 'CONCLUIDO');
      const currentStatusUpper = String(candidate.status || '').toUpperCase();
      if (['APROVADO','EM_ADMISSAO','CONTRATADO'].includes(currentStatusUpper) && !completedCtps) {
        issues.push({ categoria: 'APROVADO_SEM_CTPS', gravidade: 'CRITICA', titulo: 'Candidato avançado sem CTPS concluída',
          descricao: `O candidato está com status ${currentStatusUpper}, mas não há CTPS concluída.`,
          evidencia: { status: candidate.status, etapa: candidate.etapa, documentos: documents.map((item) => ({ id: item.id, tipo: item.tipo, status: item.status_processamento })) },
          comportamento_esperado: 'Concluir e validar a CTPS antes de aprovar ou iniciar admissão.',
          sugestao_correcao: 'Revisar a origem da aprovação e bloquear a transição.', anchor: `approved-no-ctps-${candidate.id}` });
      }
      if (candidate.documento_processando === true && candidate.processamento_bloqueado_ate
          && new Date(candidate.processamento_bloqueado_ate) < new Date(end)) {
        issues.push({ categoria: 'BLOQUEIO_DOCUMENTO_EXPIRADO', gravidade: 'ALTA', titulo: 'Bloqueio de documento expirado',
          descricao: 'O candidato permaneceu bloqueado após o limite de segurança do processamento.',
          evidencia: { processamento_bloqueado_ate: candidate.processamento_bloqueado_ate },
          comportamento_esperado: 'Liberar o atendimento e encaminhar o documento para revisão.',
          sugestao_correcao: 'Executar o mecanismo de recuperação de processamento expirado.', anchor: `stale-lock-${candidate.id}` });
      }
      const hasAgeRuleAudit = Number(candidate.idade_minima || 0) > 0 || candidate.idade_maxima !== null;
      if (hasAgeRuleAudit && candidate.idade_validada === true && candidate.idade_confirmada_documentalmente !== true) {
        issues.push({ categoria: 'IDADE_VALIDADA_SEM_DOCUMENTO', gravidade: 'ALTA', titulo: 'Idade marcada como validada sem fonte documental',
          descricao: 'idade_validada está true, mas idade_confirmada_documentalmente não está true.',
          evidencia: { origem: candidate.data_nascimento_origem, idade: candidate.idade_calculada },
          comportamento_esperado: 'Usar idade_validada como decisão final somente após CTPS ou currículo.',
          sugestao_correcao: 'Migrar o registro para validação preliminar e aguardar documento.', anchor: `age-valid-no-doc-${candidate.id}` });
      }
      const ageRejectCode = String(candidate.motivo_reprovacao_codigo || candidate.motivo_reprovacao || '').toUpperCase();
      if (String(candidate.status || '').toUpperCase() === 'REPROVADO'
          && ageRejectCode.startsWith('IDADE_')
          && candidate.idade_confirmada_documentalmente !== true) {
        issues.push({ categoria: 'REPROVACAO_ETARIA_SEM_DOCUMENTO', gravidade: 'CRITICA', titulo: 'Reprovação etária baseada apenas em informação preliminar',
          descricao: 'O candidato foi reprovado por idade sem confirmação da CTPS ou currículo.',
          evidencia: { codigo: ageRejectCode, origem: candidate.data_nascimento_origem, idade_declarada: candidate.idade_declarada },
          comportamento_esperado: 'Registrar a idade preliminar e continuar até a validação documental.',
          sugestao_correcao: 'Reabrir o processo e aplicar a confirmação documental.', anchor: `age-reject-no-doc-${candidate.id}` });
      }
      if (candidate.vaga_id && String(candidate.vaga_dados?.status || '').toUpperCase() === 'ATIVA'
          && (!Array.isArray(candidate.entrevista_dias_semana) || !candidate.entrevista_dias_semana.length
              || !Array.isArray(candidate.entrevista_horarios) || !candidate.entrevista_horarios.length)) {
        issues.push({ categoria: 'VAGA_SEM_CONFIGURACAO_ENTREVISTA', gravidade: 'ALTA', titulo: 'Vaga sem horários de entrevista',
          descricao: 'A vaga ativa não possui dias e horários suficientes para gerar opções seguras.',
          evidencia: { vaga_id: candidate.vaga_id, dias: candidate.entrevista_dias_semana, horarios: candidate.entrevista_horarios },
          comportamento_esperado: 'Configurar dias, horários e duração antes de ativar o atendimento.',
          sugestao_correcao: 'Editar a vaga e concluir a seção de disponibilidade.', anchor: `vacancy-schedule-${candidate.vaga_id}` });
      }

      const allowedTransitions = new Map([
        ['PRIMEIRO_CONTATO', new Set(['PRIMEIRO_CONTATO','ESCOLHENDO_VAGA','PERGUNTANDO_IDADE','PERGUNTANDO_SEXO','PERGUNTANDO_EXPERIENCIA'])],
        ['ESCOLHENDO_VAGA', new Set(['ESCOLHENDO_VAGA','PERGUNTANDO_IDADE','PERGUNTANDO_SEXO','PERGUNTANDO_EXPERIENCIA','PERGUNTANDO_IDADE','AGUARDANDO_CTPS_CEP','AGUARDANDO_CTPS','AGUARDANDO_CEP','REPROVADO_PRE_TRIAGEM'])],
        ['PERGUNTANDO_IDADE', new Set(['PERGUNTANDO_IDADE','PERGUNTANDO_SEXO','PERGUNTANDO_EXPERIENCIA','ANALISANDO_DOCUMENTOS','AGUARDANDO_VALIDACAO_IDADE','AGUARDANDO_CTPS_CEP','AGUARDANDO_CTPS','AGUARDANDO_CEP','REPROVADO_PRE_TRIAGEM'])],
        ['PERGUNTANDO_SEXO', new Set(['PERGUNTANDO_SEXO','AGUARDANDO_CEP','AGUARDANDO_APRESENTACAO','GERANDO_OPCOES_ENTREVISTA'])],
        ['PERGUNTANDO_EXPERIENCIA', new Set(['PERGUNTANDO_EXPERIENCIA','PERGUNTANDO_IDADE','PERGUNTANDO_SEXO','ESCOLHENDO_VAGA','AGUARDANDO_CTPS_CEP','AGUARDANDO_CTPS','AGUARDANDO_CEP','REPROVADO_PRE_TRIAGEM'])],
        ['AGUARDANDO_CTPS_CEP', new Set(['AGUARDANDO_CTPS_CEP','AGUARDANDO_CTPS','AGUARDANDO_CEP','ANALISANDO_DOCUMENTOS','REPROVADO_TRIAGEM'])],
        ['AGUARDANDO_CTPS', new Set(['AGUARDANDO_CTPS','ANALISANDO_DOCUMENTOS','REPROVADO_TRIAGEM'])],
        ['AGUARDANDO_CEP', new Set(['AGUARDANDO_CEP','PERGUNTANDO_SEXO','ANALISANDO_DOCUMENTOS','APROVADO_TRIAGEM','AGUARDANDO_APRESENTACAO','REPROVADO_TRIAGEM'])],
        ['ANALISANDO_DOCUMENTOS', new Set(['ANALISANDO_DOCUMENTOS','AGUARDANDO_VALIDACAO_IDADE','AGUARDANDO_CEP','PERGUNTANDO_SEXO','APROVADO_TRIAGEM','AGUARDANDO_APRESENTACAO','REPROVADO_TRIAGEM'])],
        ['AGUARDANDO_VALIDACAO_IDADE', new Set(['AGUARDANDO_VALIDACAO_IDADE','ANALISANDO_DOCUMENTOS','AGUARDANDO_CEP','PERGUNTANDO_SEXO','APROVADO_TRIAGEM','AGUARDANDO_APRESENTACAO','REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM'])],
        ['APROVADO_TRIAGEM', new Set(['APROVADO_TRIAGEM','PERGUNTANDO_SEXO','AGUARDANDO_APRESENTACAO','GERANDO_OPCOES_ENTREVISTA'])],
        ['AGUARDANDO_APRESENTACAO', new Set(['AGUARDANDO_APRESENTACAO','GERANDO_OPCOES_ENTREVISTA','ESCOLHENDO_HORARIO'])],
        ['GERANDO_OPCOES_ENTREVISTA', new Set(['GERANDO_OPCOES_ENTREVISTA','ESCOLHENDO_HORARIO','AGUARDANDO_ENTREVISTA'])],
        ['ESCOLHENDO_HORARIO', new Set(['ESCOLHENDO_HORARIO','ENTREVISTA_AGENDADA','AGUARDANDO_ENTREVISTA'])],
      ]);
      for (const change of historyResult.rows) {
        const from = String(change.etapa_anterior || '').toUpperCase();
        const to = String(change.etapa_nova || '').toUpperCase();
        if (from && to && allowedTransitions.has(from) && !allowedTransitions.get(from).has(to)) {
          issues.push({ categoria: 'SALTO_ETAPA', gravidade: ['GERANDO_OPCOES_ENTREVISTA','ESCOLHENDO_HORARIO','ENTREVISTA_AGENDADA'].includes(to) ? 'CRITICA' : 'ALTA',
            titulo: 'Transição de etapa fora da sequência esperada',
            descricao: `A etapa mudou de ${from} para ${to} sem uma transição prevista.`,
            evidencia: change,
            comportamento_esperado: 'Manter a sequência da pré-triagem e registrar uma justificativa para exceções.',
            sugestao_correcao: 'Revisar a saída estruturada da IA e a validação de transições.', anchor: `stage-${change.id}` });
        }
      }

      const rejectionStagesAudit = new Set(['REPROVADO_PRE_TRIAGEM','REPROVADO_TRIAGEM','REPROVADO_POS_ENTREVISTA']);
      const statusAudit = String(candidate.status || '').toUpperCase();
      const stageAudit = String(candidate.etapa || '').toUpperCase();
      if ((statusAudit === 'REPROVADO') !== rejectionStagesAudit.has(stageAudit)) {
        issues.push({ categoria: 'STATUS_ETAPA_INCONSISTENTE', gravidade: 'CRITICA', titulo: 'Status e etapa incompatíveis',
          descricao: `O cadastro está com status ${statusAudit || 'vazio'} e etapa ${stageAudit || 'vazia'}, uma combinação não permitida.`,
          evidencia: { status: candidate.status, etapa: candidate.etapa, motivo: candidate.motivo_reprovacao_codigo || candidate.motivo_reprovacao || null },
          comportamento_esperado: 'Manter status e etapa coerentes e impedir REPROVADO em etapas normais.',
          sugestao_correcao: 'Aplicar o normalizador de status/etapa e revisar o registro.', anchor: `state-${candidate.id}` });
      }
      if (!staticFlow && (candidate.idade_declarada != null || String(candidate.data_nascimento_origem || '').toUpperCase() === 'INFORMADA')
          && candidate.idade_confirmada_documentalmente !== true
          && ['APROVADO','EM_ADMISSAO','CONTRATADO'].includes(statusAudit)) {
        issues.push({ categoria: 'IDADE_SEM_CONFIRMACAO_DOCUMENTAL', gravidade: 'ALTA', titulo: 'Processo avançou sem confirmação documental da idade',
          descricao: 'A idade existe apenas como informação preliminar, mas o processo já está em uma etapa avançada.',
          evidencia: { idade_declarada: candidate.idade_declarada, origem: candidate.data_nascimento_origem, status: candidate.status, etapa: candidate.etapa },
          comportamento_esperado: 'Confirmar a idade pela CTPS antes da entrevista.',
          sugestao_correcao: 'Bloquear a agenda até idade_confirmada_documentalmente=true.', anchor: `age-doc-${candidate.id}` });
      }
      if (candidate.idade_divergencia_documental === true) {
        issues.push({ categoria: 'IDADE_DIVERGENTE_ENTRE_FONTES', gravidade: 'ALTA', titulo: 'Idade divergente entre conversa e documento',
          descricao: 'A idade ou data informada na conversa diverge da informação extraída do documento.',
          evidencia: { idade_declarada: candidate.idade_declarada, idade_documental: candidate.idade_calculada, origem: candidate.data_nascimento_origem },
          comportamento_esperado: 'Usar o documento como fonte oficial e revisar a divergência.',
          sugestao_correcao: 'Confirmar o dado com o candidato antes de decisões irreversíveis.', anchor: `age-divergence-${candidate.id}` });
      }

      const rejectedStatus = String(candidate.status || '').toUpperCase() === 'REPROVADO';
      const rejectionCodeAudit = String(candidate.motivo_reprovacao_codigo || '').trim().toUpperCase();
      const rejectionTextAudit = [candidate.motivo_reprovacao, candidate.motivo_reprovacao_detalhe, candidate.observacao_triagem]
        .filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (rejectedStatus && !rejectionCodeAudit) {
        issues.push({ categoria: 'REPROVACAO_SEM_MOTIVO_ESTRUTURADO', gravidade: 'ALTA', titulo: 'Reprovação sem motivo estruturado',
          descricao: 'O candidato está reprovado, mas o código e a categoria do motivo não foram registrados.',
          evidencia: { candidato_id: candidate.id, etapa: candidate.etapa, motivo_legado: candidate.motivo_reprovacao || null },
          comportamento_esperado: 'Registrar categoria, código, detalhe e indicador de realocação para toda reprovação.',
          sugestao_correcao: 'Revisar o fluxo que gerou a reprovação e completar o motivo no painel.', anchor: `reject-reason-${candidate.id}` });
      }
      if (rejectedStatus && candidate.reprovacao_realocavel === null) {
        issues.push({ categoria: 'REALOCAÇÃO_NAO_DEFINIDA', gravidade: 'MEDIA', titulo: 'Realocação não definida na reprovação',
          descricao: 'O cadastro reprovado não informa se o candidato deve permanecer disponível para outras vagas.',
          evidencia: { codigo: rejectionCodeAudit || null, etapa: candidate.etapa },
          comportamento_esperado: 'Registrar explicitamente se a reprovação permite realocação.',
          sugestao_correcao: 'Revisar o motivo e marcar a opção de realocação no perfil.', anchor: `reallocation-${candidate.id}` });
      }
      if (rejectedStatus && ['MOTIVO_NAO_DETALHADO','OUTRO'].includes(rejectionCodeAudit)
          && String(candidate.motivo_reprovacao_detalhe || '').trim().length < 20) {
        issues.push({ categoria: 'MOTIVO_REPROVACAO_VAGO', gravidade: 'MEDIA', titulo: 'Motivo de reprovação pouco claro',
          descricao: 'O código é genérico e o detalhamento não explica objetivamente a decisão.',
          evidencia: { codigo: rejectionCodeAudit, detalhe: candidate.motivo_reprovacao_detalhe || null },
          comportamento_esperado: 'Registrar um motivo específico que permita revisão e realocação.',
          sugestao_correcao: 'Completar o motivo no perfil do candidato.', anchor: `reject-vague-${candidate.id}` });
      }
      if (rejectedStatus && (/\b(sexo|genero|masculino|feminino)\b/.test(rejectionTextAudit) || rejectionCodeAudit.includes('SEXO'))) {
        issues.push({ categoria: 'REPROVACAO_POR_SEXO', gravidade: 'CRITICA', titulo: 'Possível reprovação automática por sexo',
          descricao: 'O motivo registrado faz referência a sexo ou gênero. A regra vigente trata esse dado apenas como sinalização para revisão humana.',
          evidencia: { candidato_id: candidate.id, codigo: rejectionCodeAudit || null, detalhe: candidate.motivo_reprovacao_detalhe || candidate.motivo_reprovacao || null },
          comportamento_esperado: 'Permitir que o candidato continue o processo e usar a divergência somente para revisão e realocação.',
          sugestao_correcao: 'Revisar manualmente a decisão e remover qualquer bloqueio automático baseado em sexo.', anchor: `reject-sex-${candidate.id}` });
      }

      const ageNow = calculateAgeAt(candidate.data_nascimento, new Date(end));
      const minAgeNow = Number(candidate.idade_minima ?? 0);
      const maxAgeNow = candidate.idade_maxima === null || candidate.idade_maxima === undefined ? null : Number(candidate.idade_maxima);
      const ageOutsideRange = candidate.idade_confirmada_documentalmente === true && ageNow !== null && (ageNow < minAgeNow || (maxAgeNow !== null && Number.isFinite(maxAgeNow) && ageNow > maxAgeNow));
      if (ageOutsideRange && !['REPROVADO','ENCERRADO'].includes(String(candidate.status || '').toUpperCase())) {
        const rangeText = maxAgeNow !== null && Number.isFinite(maxAgeNow)
          ? `entre ${minAgeNow} e ${maxAgeNow} anos`
          : `no mínimo ${minAgeNow} anos`;
        issues.push({ categoria: 'FAIXA_ETARIA_IGNORADA', gravidade: 'CRITICA', titulo: 'Candidato fora da faixa etária avançou',
          descricao: `O candidato possui ${ageNow} anos e a vaga permite candidatos com ${rangeText}.`,
          evidencia: { idade: ageNow, idade_minima: minAgeNow, idade_maxima: maxAgeNow, origem_data_nascimento: candidate.data_nascimento_origem, etapa: candidate.etapa, status: candidate.status },
          comportamento_esperado: 'Interromper a pré-triagem e registrar reprovação por faixa etária não atendida.',
          sugestao_correcao: 'Validar a data de nascimento confirmada pela CTPS antes de liberar a entrevista.', anchor: `age-${candidate.id}` });
      }

      if (staticFlow) {
        const staticStages = new Set(['AGUARDANDO_INTENCAO','ESCOLHENDO_VAGA','AGUARDANDO_ACAO_VAGA','DUVIDAS_GERAIS','DUVIDAS_VAGA','RECRUTADOR_MENU','AGUARDANDO_NOME','AGUARDANDO_EXPERIENCIA','AGUARDANDO_TEMPO_DESLOCAMENTO','AGUARDANDO_CONFIRMACAO_CHEGADA','AGUARDANDO_CEP','AGUARDANDO_CTPS','PROCESSANDO_CTPS','REVISAO_DOCUMENTAL','PENDENTE_APROVACAO_RECRUTADOR','AGUARDANDO_ESCOLHA_HORARIO','ENTREVISTA_AGENDADA','NAO_APTO_NESTA_VAGA','PAUSADO_ATENDIMENTO_HUMANO']);
        if (!staticStages.has(String(candidate.etapa || ''))) issues.push({ categoria:'ETAPA_FORA_DO_FLUXO_ESTATICO', gravidade:'ALTA', titulo:'Etapa incompatível com o Chatbot Estático V1', descricao:`A candidatura está marcada como fluxo estático, mas usa a etapa ${candidate.etapa || 'vazia'}.`, evidencia:{ etapa:candidate.etapa, fluxo_versao:candidate.fluxo_versao }, comportamento_esperado:'Usar somente etapas publicadas na máquina de estados V1.', sugestao_correcao:'Normalizar a etapa pelo painel ou enviar o candidato para resgate.', anchor:`static-stage-${candidate.id}` });
        const storedCtps = documents.some((doc) => String(doc.tipo || '').toUpperCase()==='CTPS' && String(doc.status_processamento || '').toUpperCase()!=='ERRO');
        const ctpsWithoutRawFile = documents.find((doc) => String(doc.tipo || '').toUpperCase()==='CTPS' && doc.arquivo_armazenado !== true);
        if (ctpsWithoutRawFile) issues.push({ categoria:'CTPS_SEM_ARQUIVO_BRUTO', gravidade:'CRITICA', titulo:'CTPS registrada sem PDF armazenado', descricao:'O documento aparece no banco, mas o arquivo bruto não está disponível para reprocessamento.', evidencia:{ documento:ctpsWithoutRawFile }, comportamento_esperado:'Salvar o PDF bruto antes de OCR, classificação ou análise.', sugestao_correcao:'Solicitar novo PDF ao candidato e revisar a etapa de armazenamento.', anchor:`static-ctps-raw-${ctpsWithoutRawFile.id}` });
        if (String(candidate.etapa)==='PROCESSANDO_CTPS' && !storedCtps) issues.push({ categoria:'PROCESSAMENTO_SEM_CTPS_ARMAZENADA', gravidade:'CRITICA', titulo:'Processamento iniciado sem CTPS armazenada', descricao:'A candidatura está processando CTPS, mas não existe documento CTPS recuperável no banco.', evidencia:{ etapa:candidate.etapa, documentos:documents.map(d=>({id:d.id,tipo:d.tipo,status:d.status_processamento,arquivo_armazenado:d.arquivo_armazenado})) }, comportamento_esperado:'Somente iniciar OCR depois do armazenamento confirmado.', sugestao_correcao:'Retornar para AGUARDANDO_CTPS e solicitar novo PDF.', anchor:`static-processing-no-file-${candidate.id}` });
        if (String(candidate.etapa)==='AGUARDANDO_CTPS' && storedCtps) issues.push({ categoria:'ETAPA_NAO_AVANCOU_APOS_CTPS', gravidade:'CRITICA', titulo:'CTPS armazenada, mas candidatura continua aguardando CTPS', descricao:'Existe CTPS no banco e a etapa não avançou para processamento, revisão ou resultado.', evidencia:{ etapa:candidate.etapa, documentos:documents.map(d=>({id:d.id,tipo:d.tipo,status:d.status_processamento,arquivo_armazenado:d.arquivo_armazenado})) }, comportamento_esperado:'Armazenar primeiro e avançar deterministicamente após o recebimento.', sugestao_correcao:'Reprocessar o documento ou enviar para resgate.', anchor:`static-ctps-stage-${candidate.id}` });
        const pendingReview = ['REVISAO_DOCUMENTAL','PENDENTE_APROVACAO_RECRUTADOR'].includes(String(candidate.etapa));
        if (pendingReview && candidate.revisao_pendente !== true) issues.push({ categoria:'REVISAO_NAO_REGISTRADA', gravidade:'ALTA', titulo:'Etapa de revisão sem pendência registrada', descricao:'O candidato está aguardando decisão humana, mas revisao_pendente não está ativa.', evidencia:{ etapa:candidate.etapa,revisao_tipo:candidate.revisao_tipo }, comportamento_esperado:'Toda pausa para decisão humana deve gerar registro em candidato_revisoes.', sugestao_correcao:'Criar ou reconstruir a revisão pelo documento armazenado.', anchor:`static-review-${candidate.id}` });
        const promisedSchedule = iaMessages.some((m)=>/vou (consultar|verificar).*(horario|opco)|novas opcoes disponiveis/i.test(auditNormalizeText(m.mensagem)));
        const hasOfferedOptions = messages.some((m)=>String(m.quem).toUpperCase()==='IA' && /1\s*[—-].*\d{1,2}:\d{2}/s.test(String(m.mensagem||'')));
        if (promisedSchedule && !hasOfferedOptions && !interviews.length) issues.push({ categoria:'PROMESSA_AGENDA_SEM_RETORNO', gravidade:'CRITICA', titulo:'Horários prometidos sem opções reais', descricao:'Foi enviada promessa de consulta, mas não há opções reais nem entrevista criada.', evidencia:{ etapa:candidate.etapa }, comportamento_esperado:'Nunca terminar a execução com promessa; enviar opções do Google Calendar ou erro explícito.', sugestao_correcao:'Enviar o candidato para resgate e revisar o subworkflow de agenda.', anchor:`static-calendar-promise-${candidate.id}` });
      }

      const activeInterviews = interviews.filter((item) => String(item.status || '').toUpperCase() === 'AGENDADA');
      if (activeInterviews.length > 1) {
        issues.push({ categoria: 'ENTREVISTA_DUPLICADA', gravidade: 'CRITICA', titulo: 'Mais de uma entrevista ativa',
          descricao: `Existem ${activeInterviews.length} entrevistas com status AGENDADA para o mesmo candidato.`,
          evidencia: { entrevistas: activeInterviews }, comportamento_esperado: 'Manter somente uma entrevista ativa por candidatura.',
          sugestao_correcao: 'Revisar idempotência da agenda e cancelar duplicidades.', anchor: `interview-duplicate-${candidate.id}` });
      }
      for (const interview of activeInterviews) {
        if (!String(interview.meet_link || interview.google_event_url || '').trim()) {
          issues.push({ categoria: 'ENTREVISTA_SEM_LINK', gravidade: 'ALTA', titulo: 'Entrevista agendada sem link',
            descricao: 'A entrevista está ativa, mas não possui link do Google Meet ou URL do evento.', evidencia: { entrevista: interview },
            comportamento_esperado: 'Persistir um link válido antes de confirmar ao candidato.',
            sugestao_correcao: 'Revisar retorno do Google Calendar e persistência do evento.', anchor: `interview-link-${interview.id}` });
        }
        const inicioEntrevista = new Date(interview.inicio);
        const fimEntrevista = new Date(interview.fim);
        const criadaEm = new Date(interview.created_at);
        if (!Number.isNaN(inicioEntrevista.getTime()) && !Number.isNaN(criadaEm.getTime()) && inicioEntrevista <= criadaEm) {
          issues.push({ categoria: 'ENTREVISTA_NO_PASSADO', gravidade: 'CRITICA', titulo: 'Entrevista criada para horário passado',
            descricao: 'O início da entrevista não é posterior ao momento em que ela foi registrada.', evidencia: { entrevista: interview },
            comportamento_esperado: 'Oferecer somente horários futuros e revalidar imediatamente antes da criação.',
            sugestao_correcao: 'Revisar timezone e janela de busca da agenda.', anchor: `interview-past-${interview.id}` });
        }
        const configuredDuration = Number(candidate.entrevista_duracao_minutos || 0);
        const actualDuration = (!Number.isNaN(inicioEntrevista.getTime()) && !Number.isNaN(fimEntrevista.getTime()))
          ? Math.round((fimEntrevista - inicioEntrevista) / 60000) : null;
        if (configuredDuration > 0 && actualDuration !== null && actualDuration !== configuredDuration) {
          issues.push({ categoria: 'DURACAO_ENTREVISTA_DIVERGENTE', gravidade: 'MEDIA', titulo: 'Duração da entrevista diferente da vaga',
            descricao: `A entrevista dura ${actualDuration} minutos, mas a vaga está configurada para ${configuredDuration}.`,
            evidencia: { entrevista: interview, duracao_configurada: configuredDuration, duracao_real: actualDuration },
            comportamento_esperado: 'Criar o evento com a duração configurada na vaga.',
            sugestao_correcao: 'Revisar o cálculo do fim do slot.', anchor: `interview-duration-${interview.id}` });
        }
      }

      const allowedTimes = Array.isArray(candidate.entrevista_horarios) ? candidate.entrevista_horarios : [];
      const allowedDays = Array.isArray(candidate.entrevista_dias_semana) ? candidate.entrevista_dias_semana.map(Number) : [];
      for (const interview of interviews.filter((item) => String(item.status).toUpperCase() === 'AGENDADA')) {
        const date = new Date(interview.inicio);
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
        const dayName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date);
        const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
        if ((allowedTimes.length && !allowedTimes.includes(time)) || (allowedDays.length && !allowedDays.includes(dayMap[dayName]))) {
          issues.push({ categoria: 'ENTREVISTA_FORA_PREFERENCIA', gravidade: 'CRITICA', titulo: 'Entrevista fora dos horários permitidos',
            descricao: `A entrevista foi agendada para ${time}, fora das preferências configuradas na vaga.`,
            evidencia: { entrevista: interview, horarios_permitidos: allowedTimes, dias_permitidos: allowedDays },
            comportamento_esperado: 'Oferecer e reservar somente horários configurados na vaga e livres no Google Calendar.',
            sugestao_correcao: 'Revisar o subworkflow de agenda e a segunda validação antes de criar o evento.', anchor: `interview-${interview.id}` });
        }
      }

      try {
        const canUseAiAudit = AUDITORIA_IA_MAX_CONVERSAS > 0
          && aiAuditedConversations < AUDITORIA_IA_MAX_CONVERSAS
          && messages.filter((item) => String(item.quem).toUpperCase() === 'USUARIO').length >= 2
          && iaMessages.length >= 2;
        const aiIssues = canUseAiAudit
          ? await callAiAudit(candidate, messages, candidate.vaga_dados || { id: candidate.vaga_id, titulo: candidate.vaga_nome }, documents)
          : [];
        if (canUseAiAudit && AUDITORIA_IA_WEBHOOK_URL) aiAuditedConversations += 1;
        for (const issue of aiIssues) {
          const category = String(issue.categoria || '').toUpperCase();
          if (![
            'PERGUNTA_IGNORADA','RESPOSTA_FORA_CONTEXTO','INFORMACAO_INVENTADA','CONTRADICAO',
            'INSTRUCAO_CONFUSA','NAO_RECONHECEU_DOCUMENTO','PERGUNTA_FORA_DA_ETAPA',
            'RESPOSTA_INCOMPLETA','OPCAO_INVALIDA_NAO_REPETIDA','SOLICITOU_MULTIPLAS_PENDENCIAS',
            'CONFIRMACAO_IGNORADA','ENCERRAMENTO_NAO_RESPEITADO',
          'PERGUNTA_REPETIDA','RESPOSTA_REDUNDANTE','PROMESSA_NAO_CUMPRIDA',
          'INSTRUCAO_CONFUSA','CONDUCAO_EXCESSIVAMENTE_LONGA','RESPOSTA_FRIA_EM_REPROVACAO'
          ].includes(category)) continue;
          issues.push({ categoria: category, gravidade: ['CRITICA','ALTA','MEDIA','BAIXA'].includes(String(issue.gravidade).toUpperCase()) ? String(issue.gravidade).toUpperCase() : 'MEDIA',
            origem_deteccao: 'IA', confianca: Math.min(Math.max(Number(issue.confianca || 70), 0), 100),
            titulo: String(issue.titulo || 'Possível problema de conversação').slice(0, 220),
            descricao: String(issue.descricao || 'A auditora identificou um possível problema na conversa.'),
            evidencia: issue.evidencia || {}, comportamento_esperado: issue.comportamento_esperado || null,
            sugestao_correcao: issue.sugestao_correcao || null,
            mensagem_usuario_id: Number(issue.mensagem_usuario_id) || null,
            mensagem_ia_id: Number(issue.mensagem_ia_id) || null,
            anchor: `ai-${category}-${issue.mensagem_ia_id || issue.mensagem_usuario_id || auditNormalizeText(issue.descricao).slice(0,30)}` });
        }
      } catch (error) {
        console.warn('[AUDITORIA IA] Falha na análise subjetiva:', error.message);
      }

      for (const issue of issues) {
        await insertAuditIssue(client, runId, candidate, issue);
        totalIssues += 1;
        candidatesWithIssues.add(candidate.id);
      }
    }

    const counts = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE gravidade='CRITICA')::INTEGER AS criticos,
        COUNT(*) FILTER (WHERE gravidade='ALTA')::INTEGER AS altos,
        COUNT(*) FILTER (WHERE gravidade='MEDIA')::INTEGER AS medios,
        COUNT(*) FILTER (WHERE gravidade='BAIXA')::INTEGER AS baixos
      FROM auditoria_problemas WHERE auditoria_id=$1
    `, [runId]);
    const c = counts.rows[0] || {};
    const totalConversations = candidatesResult.rowCount;
    const scorePenalty = Number(c.criticos || 0) * 25 + Number(c.altos || 0) * 12 + Number(c.medios || 0) * 6 + Number(c.baixos || 0) * 2;
    const note = Math.max(0, Math.round((100 - Math.min(100, scorePenalty / Math.max(1, totalConversations))) * 100) / 100);
    const summary = `${totalConversations} conversa(s) analisada(s); ${totalIssues} alerta(s) detectado(s).`;
    const updated = await client.query(`
      UPDATE auditorias_conversas SET status='CONCLUIDA', total_conversas=$2,
        conversas_sem_alerta=$3, quantidade_criticos=$4, quantidade_altos=$5,
        quantidade_medios=$6, quantidade_baixos=$7, nota_qualidade=$8,
        resumo=$9, finished_at=NOW()
      WHERE id=$1 RETURNING *
    `, [runId, totalConversations, Math.max(0, totalConversations - candidatesWithIssues.size),
      Number(c.criticos || 0), Number(c.altos || 0), Number(c.medios || 0), Number(c.baixos || 0), note, summary]);
    return updated.rows[0];
  } catch (error) {
    if (runId) {
      await client.query(`UPDATE auditorias_conversas SET status='ERRO', erro=$2, finished_at=NOW() WHERE id=$1`, [runId, String(error.message || error)]).catch(() => {});
    }
    throw error;
  } finally { client.release(); }
}

app.get('/api/admin/auditoria', requireAdmin, async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim().toUpperCase();
    const severity = String(req.query.gravidade || '').trim().toUpperCase();
    const category = String(req.query.categoria || '').trim().toUpperCase();
    const search = String(req.query.busca || '').trim();
    const values = [];
    const filters = [];
    if (status && status !== 'TODOS') { values.push(status); filters.push(`p.status_revisao=$${values.length}`); }
    if (severity && severity !== 'TODAS') { values.push(severity); filters.push(`p.gravidade=$${values.length}`); }
    if (category && category !== 'TODAS') { values.push(category); filters.push(`p.categoria=$${values.length}`); }
    if (search) { values.push(`%${search}%`); filters.push(`(COALESCE(c.nome,'') ILIKE $${values.length} OR COALESCE(c.telefone,'') ILIKE $${values.length} OR p.titulo ILIKE $${values.length})`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [latest, issues, trends, categories] = await Promise.all([
      pool.query(`SELECT * FROM auditorias_conversas ORDER BY created_at DESC LIMIT 1`),
      pool.query(`
        SELECT p.*, c.nome AS candidato_nome, c.telefone, c.etapa, c.status AS candidato_status,
          v.titulo AS vaga_nome, a.created_at AS auditoria_created_at
        FROM auditoria_problemas p
        JOIN candidatos c ON c.id=p.candidato_id
        LEFT JOIN vagas v ON v.id=p.vaga_id
        LEFT JOIN auditorias_conversas a ON a.id=p.auditoria_id
        ${where}
        ORDER BY CASE p.gravidade WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
          p.created_at DESC LIMIT 300
      `, values),
      pool.query(`SELECT DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,
        COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE gravidade='CRITICA')::INTEGER AS criticos,
        COUNT(*) FILTER (WHERE gravidade='ALTA')::INTEGER AS altos
        FROM auditoria_problemas WHERE created_at >= NOW() - INTERVAL '14 days'
        GROUP BY 1 ORDER BY 1 ASC`),
      pool.query(`SELECT categoria, COUNT(*)::INTEGER AS quantidade
        FROM auditoria_problemas WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY categoria ORDER BY quantidade DESC, categoria ASC LIMIT 30`),
    ]);
    const summary = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE status_revisao IN ('NOVO','CONFIRMADO'))::INTEGER AS pendentes,
      COUNT(*) FILTER (WHERE gravidade='CRITICA' AND status_revisao IN ('NOVO','CONFIRMADO'))::INTEGER AS criticos,
      COUNT(*) FILTER (WHERE gravidade='ALTA' AND status_revisao IN ('NOVO','CONFIRMADO'))::INTEGER AS altos,
      COUNT(*) FILTER (WHERE gravidade='MEDIA' AND status_revisao IN ('NOVO','CONFIRMADO'))::INTEGER AS medios,
      COUNT(*) FILTER (WHERE gravidade='BAIXA' AND status_revisao IN ('NOVO','CONFIRMADO'))::INTEGER AS baixos
      FROM auditoria_problemas`);
    res.json({ sucesso: true, ultima_auditoria: latest.rows[0] || null,
      resumo: summary.rows[0] || {}, problemas: issues.rows, tendencias: trends.rows,
      categorias: categories.rows, ia_configurada: Boolean(AUDITORIA_IA_WEBHOOK_URL) });
  } catch (error) { next(error); }
});

app.post('/api/admin/auditoria/sincronizar', requireAdmin, async (req, res, next) => {
  try {
    const period = String(req.body?.periodo || '24H').toUpperCase();
    const end = new Date();
    let start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    if (period === 'HOJE') {
      const local = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(end) + 'T00:00:00-03:00');
      start = local;
    } else if (period === '7D') start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === 'DESDE_ULTIMA') {
      const last = await pool.query(`SELECT fim_periodo FROM auditorias_conversas WHERE status='CONCLUIDA' ORDER BY created_at DESC LIMIT 1`);
      if (last.rows[0]?.fim_periodo) start = new Date(last.rows[0].fim_periodo);
    } else if (period === 'PERSONALIZADO') {
      const customStart = new Date(req.body?.inicio);
      const customEnd = new Date(req.body?.fim);
      if (Number.isNaN(customStart.getTime()) || Number.isNaN(customEnd.getTime()) || customStart >= customEnd) {
        return res.status(400).json({ sucesso: false, erro: 'Período personalizado inválido.' });
      }
      start = customStart; end.setTime(customEnd.getTime());
    }
    const run = await executeHybridAudit({ start, end, origin: 'MANUAL', requestedBy: currentUserName(req) });
    res.json({ sucesso: true, mensagem: run.resumo || 'Auditoria concluída.', auditoria: run });
  } catch (error) { next(error); }
});


function auditExportPeriod(query = {}) {
  const period = String(query.periodo || 'ULTIMA').trim().toUpperCase();
  const now = new Date();
  let start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let end = now;
  if (period === 'HOJE') {
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    start = new Date(`${localDay}T00:00:00-03:00`);
  } else if (period === '7D') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === '30D') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (period === 'PERSONALIZADO') {
    start = new Date(query.inicio);
    end = new Date(query.fim);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      const error = new Error('Período personalizado inválido.');
      error.statusCode = 400;
      throw error;
    }
  }
  return { period, start, end };
}

function redactAuditText(value, candidate = {}) {
  let text = String(value ?? '');
  const replacements = [candidate.nome, candidate.telefone, candidate.cpf, candidate.cep]
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const item of replacements) text = text.replaceAll(item, '[DADO_REMOVIDO]');
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL_REMOVIDO]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF_REMOVIDO]')
    .replace(/(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]?\d{4}(?!\d)/g, '[TELEFONE_REMOVIDO]');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows, columns) {
  const header = columns.map(([key, label]) => csvCell(label || key)).join(',');
  const body = rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(',')).join('\n');
  return `\uFEFF${header}${body ? `\n${body}` : ''}`;
}


const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F),
    date: (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F),
  };
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = zipDosDateTime(new Date());

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name || 'arquivo.txt').replaceAll('\\', '/'), 'utf8');
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content ?? ''), 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const utf8Flag = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

app.get('/api/admin/auditoria/exportar.zip', requireAdmin, async (req, res, next) => {
  try {
    const scope = String(req.query.escopo || 'TODOS').trim().toUpperCase();
    const { period, start, end } = auditExportPeriod(req.query);
    let auditRun = null;
    if (period === 'ULTIMA') {
      const latest = await pool.query(`SELECT * FROM auditorias_conversas WHERE status='CONCLUIDA' ORDER BY created_at DESC LIMIT 1`);
      auditRun = latest.rows[0] || null;
      if (!auditRun) return res.status(404).json({ sucesso: false, erro: 'Nenhuma auditoria concluída para exportar.' });
      start.setTime(new Date(auditRun.inicio_periodo).getTime());
      end.setTime(new Date(auditRun.fim_periodo).getTime());
    }

    const candidateResult = await pool.query(`
      SELECT DISTINCT c.*, v.titulo AS vaga_nome, v.codigo AS vaga_codigo,
        v.idade_minima, v.idade_maxima, v.experiencia_minima_meses,
        v.entrevista_dias_semana, v.entrevista_horarios, v.entrevista_duracao_minutos
      FROM candidatos c
      LEFT JOIN vagas v ON v.id=c.vaga_id
      WHERE EXISTS (
        SELECT 1 FROM mensagens m WHERE m.candidato_id=c.id AND m.created_at >= $1 AND m.created_at < $2
      )
      ${scope === 'CONFIRMADOS' ? `AND EXISTS (SELECT 1 FROM auditoria_problemas ap WHERE ap.candidato_id=c.id AND ap.status_revisao='CONFIRMADO' AND ap.created_at >= $1 AND ap.created_at < $2)` : ''}
      ORDER BY c.id ASC
      LIMIT $3
    `, [start, end, AUDITORIA_MAX_CONVERSAS]);

    const candidateIds = candidateResult.rows.map((row) => Number(row.id));
    const aliases = new Map(candidateIds.map((id, index) => [id, `CANDIDATO-${String(index + 1).padStart(3, '0')}`]));
    const candidatesById = new Map(candidateResult.rows.map((candidate) => [Number(candidate.id), candidate]));
    const redactAllCandidates = (value) => candidateResult.rows.reduce((text, candidate) => redactAuditText(text, candidate), String(value ?? ''));
    const [issuesResult, feedbackResult, messagesResult, documentsResult, eventsResult, interviewsResult] = candidateIds.length
      ? await Promise.all([
        pool.query(`SELECT p.* FROM auditoria_problemas p WHERE p.candidato_id = ANY($1::BIGINT[]) AND p.created_at >= $2 AND p.created_at < $3 ORDER BY p.created_at ASC`, [candidateIds, start, end]),
        pool.query(`SELECT f.* FROM auditoria_feedback f JOIN auditoria_problemas p ON p.id=f.problema_id WHERE p.candidato_id = ANY($1::BIGINT[]) AND f.created_at >= $2 AND f.created_at < $3 ORDER BY f.created_at ASC`, [candidateIds, start, end]),
        pool.query(`SELECT id,candidato_id,quem,mensagem,mensagem_id,contexto_snapshot,lote_resposta_id,origem_mensagem_id,created_at FROM mensagens WHERE candidato_id = ANY($1::BIGINT[]) AND created_at >= $2 AND created_at < $3 ORDER BY candidato_id,created_at,id`, [candidateIds, start, end]),
        pool.query(`SELECT id,candidato_id,tipo,titulo,nome_arquivo,mime_type,tamanho_bytes,status_processamento,classificacao_confianca,data_nascimento_extraida,resultado,created_at,processado_at FROM documentos WHERE candidato_id = ANY($1::BIGINT[]) ORDER BY candidato_id,created_at,id`, [candidateIds]),
        pool.query(`SELECT id,candidato_id,evento,descricao,created_at FROM eventos WHERE candidato_id = ANY($1::BIGINT[]) AND created_at >= $2 AND created_at < $3 ORDER BY candidato_id,created_at,id`, [candidateIds, start, end]),
        pool.query(`SELECT id,candidato_id,vaga_id,inicio,fim,status,created_at FROM entrevistas WHERE candidato_id = ANY($1::BIGINT[]) AND created_at >= $2 AND created_at < $3 ORDER BY candidato_id,created_at,id`, [candidateIds, start, end]),
      ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

    const byCandidate = (rows) => rows.reduce((map, row) => {
      const key = Number(row.candidato_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
      return map;
    }, new Map());
    const messagesByCandidate = byCandidate(messagesResult.rows);
    const documentsByCandidate = byCandidate(documentsResult.rows);
    const eventsByCandidate = byCandidate(eventsResult.rows);
    const interviewsByCandidate = byCandidate(interviewsResult.rows);
    const issuesByCandidate = byCandidate(issuesResult.rows);

    const conversations = candidateResult.rows.map((candidate) => {
      const alias = aliases.get(Number(candidate.id));
      const birth = candidate.data_nascimento ? new Date(candidate.data_nascimento) : null;
      const age = birth && !Number.isNaN(birth.getTime()) ? calculateAgeAt(candidate.data_nascimento, end) : null;
      return {
        candidato: {
          alias,
          status: candidate.status,
          etapa: candidate.etapa,
          vaga_codigo: candidate.vaga_codigo,
          vaga_nome: candidate.vaga_nome,
          criado_em: candidate.created_at,
          atualizado_em: candidate.updated_at,
          tem_cep_valido: /^\d{8}$/.test(String(candidate.cep || '').replace(/\D/g, '')),
          data_nascimento_informada: Boolean(candidate.data_nascimento),
          data_nascimento_origem: candidate.data_nascimento_origem || null,
          idade_calculada: age,
          idade_declarada: candidate.idade_declarada ?? null,
          idade_pre_validada: candidate.idade_pre_validada,
          idade_confirmada_documentalmente: candidate.idade_confirmada_documentalmente === true,
          idade_divergencia_documental: candidate.idade_divergencia_documental === true,
          idade_validada: candidate.idade_validada,
          sexo_informado: candidate.sexo || null,
          sexo_origem: candidate.sexo_origem || null,
          status_reprovacao_codigo: candidate.motivo_reprovacao_codigo || null,
          status_reprovacao_categoria: candidate.motivo_reprovacao_categoria || null,
          reprovacao_realocavel: candidate.reprovacao_realocavel,
          aprovado: candidate.aprovado,
          apresentacao_profissional_informada: Boolean(String(candidate.apresentacao_profissional || '').trim()),
        },
        configuracao_vaga: {
          idade_minima: candidate.idade_minima,
          idade_maxima: candidate.idade_maxima,
          experiencia_minima_meses: candidate.experiencia_minima_meses,
          entrevista_dias_semana: candidate.entrevista_dias_semana,
          entrevista_horarios: candidate.entrevista_horarios,
          entrevista_duracao_minutos: candidate.entrevista_duracao_minutos,
        },
        mensagens: (messagesByCandidate.get(Number(candidate.id)) || []).map((message) => ({
          id: message.id,
          quem: message.quem,
          mensagem: redactAuditText(message.mensagem, candidate),
          mensagem_id_presente: Boolean(message.mensagem_id),
          lote_resposta_id: message.lote_resposta_id || null,
          origem_mensagem_id_presente: Boolean(message.origem_mensagem_id),
          contexto_snapshot: message.contexto_snapshot || null,
          created_at: message.created_at,
        })),
        documentos: (documentsByCandidate.get(Number(candidate.id)) || []).map((document) => ({
          id: document.id,
          tipo: document.tipo,
          titulo: document.titulo,
          nome_arquivo: document.nome_arquivo ? '[ARQUIVO_PDF]' : null,
          mime_type: document.mime_type,
          tamanho_bytes: document.tamanho_bytes,
          status_processamento: document.status_processamento,
          classificacao_confianca: document.classificacao_confianca,
          possui_data_nascimento_extraida: Boolean(document.data_nascimento_extraida),
          resultado_resumido: document.resultado && typeof document.resultado === 'object' ? {
            status: document.resultado.status,
            classificacao: document.resultado.classificacao,
            aprovado: document.resultado.aprovado,
            motivo: document.resultado.motivo,
          } : null,
          created_at: document.created_at,
          processado_at: document.processado_at,
        })),
        eventos: (eventsByCandidate.get(Number(candidate.id)) || []).map((event) => ({
          id: event.id, evento: event.evento, descricao: redactAuditText(event.descricao, candidate), created_at: event.created_at,
        })),
        entrevistas: interviewsByCandidate.get(Number(candidate.id)) || [],
        problemas: (issuesByCandidate.get(Number(candidate.id)) || []).map((issue) => ({
          id: issue.id,
          candidato: alias,
          categoria: issue.categoria,
          gravidade: issue.gravidade,
          origem_deteccao: issue.origem_deteccao,
          confianca: issue.confianca,
          titulo: redactAuditText(issue.titulo, candidate),
          descricao: redactAuditText(issue.descricao, candidate),
          evidencia: JSON.parse(redactAuditText(JSON.stringify(issue.evidencia || {}), candidate)),
          comportamento_esperado: redactAuditText(issue.comportamento_esperado, candidate),
          sugestao_correcao: redactAuditText(issue.sugestao_correcao, candidate),
          status_revisao: issue.status_revisao,
          observacao_revisao: redactAuditText(issue.observacao_revisao, candidate),
          created_at: issue.created_at,
        })),
      };
    });

    const problems = issuesResult.rows.map((issue) => {
      const candidate = candidatesById.get(Number(issue.candidato_id)) || {};
      return {
        id: issue.id,
        candidato: aliases.get(Number(issue.candidato_id)),
        categoria: issue.categoria,
        gravidade: issue.gravidade,
        origem_deteccao: issue.origem_deteccao,
        confianca: issue.confianca,
        titulo: redactAuditText(issue.titulo, candidate),
        descricao: redactAuditText(issue.descricao, candidate),
        status_revisao: issue.status_revisao,
        comportamento_esperado: redactAuditText(issue.comportamento_esperado, candidate),
        sugestao_correcao: redactAuditText(issue.sugestao_correcao, candidate),
        observacao_revisao: redactAuditText(issue.observacao_revisao, candidate),
        created_at: issue.created_at,
      };
    });
    const feedback = feedbackResult.rows.map((row) => ({
      id: row.id, problema_id: row.problema_id, decisao: row.decisao,
      observacao: redactAllCandidates(row.observacao), revisado_por: row.revisado_por ? '[ADMIN]' : null, created_at: row.created_at,
    }));
    const summary = {
      versao: '9.3',
      gerado_em: new Date().toISOString(),
      periodo: { inicio: start.toISOString(), fim: end.toISOString(), selecao: period },
      escopo: scope,
      total_candidatos: conversations.length,
      total_mensagens: messagesResult.rowCount ?? messagesResult.rows.length,
      total_problemas: problems.length,
      problemas_por_gravidade: problems.reduce((acc, item) => { acc[item.gravidade] = (acc[item.gravidade] || 0) + 1; return acc; }, {}),
      problemas_por_categoria: problems.reduce((acc, item) => { acc[item.categoria] = (acc[item.categoria] || 0) + 1; return acc; }, {}),
      aviso_privacidade: 'Dados pessoais, documentos e credenciais não fazem parte desta exportação. Revise o conteúdo textual antes de compartilhar fora da equipe autorizada.',
    };

    const safeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const filename = `genesis-auditoria-${safeDate}.zip`;
    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    const zip = createZipBuffer([
      { name: 'resumo.json', content: JSON.stringify(summary, null, 2) },
      { name: 'conversas.json', content: JSON.stringify(conversations, null, 2) },
      { name: 'auditorias.json', content: JSON.stringify(problems, null, 2) },
      { name: 'problemas.csv', content: rowsToCsv(problems, [
        ['id','ID'],['candidato','Candidato'],['categoria','Categoria'],['gravidade','Gravidade'],['origem_deteccao','Origem'],['confianca','Confiança'],['titulo','Título'],['descricao','Descrição'],['status_revisao','Status'],['created_at','Criado em'],
      ]) },
      { name: 'feedback.csv', content: rowsToCsv(feedback, [
        ['id','ID'],['problema_id','Problema'],['decisao','Decisão'],['observacao','Observação'],['revisado_por','Revisado por'],['created_at','Criado em'],
      ]) },
      { name: 'configuracoes_vagas.json', content: JSON.stringify(conversations.map((item) => ({ candidato: item.candidato.alias, vaga: item.candidato.vaga_nome, configuracao: item.configuracao_vaga })), null, 2) },
      { name: 'LEIA-ME.txt', content: 'Pacote anonimizado da Auditoria Genesis IA V9.3. Não contém PDFs, CPF, telefone, CEP, nome civil ou credenciais.\\n' },
    ]);
    res.send(zip);
  } catch (error) { next(error); }
});

app.patch('/api/admin/auditoria/problemas/:id', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const status = String(req.body?.status || '').toUpperCase();
    const observation = String(req.body?.observacao || '').trim().slice(0, 4000) || null;
    if (!id || !['CONFIRMADO','FALSO_POSITIVO','CORRIGIDO','IGNORADO'].includes(status)) {
      return res.status(400).json({ sucesso: false, erro: 'Revisão inválida.' });
    }
    await client.query('BEGIN');
    const updated = await client.query(`UPDATE auditoria_problemas SET status_revisao=$2,
      revisado_por=$3, revisado_at=NOW(), observacao_revisao=$4, updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id, status, currentUserName(req), observation]);
    if (!updated.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ sucesso: false, erro: 'Alerta não encontrado.' }); }
    await client.query(`INSERT INTO auditoria_feedback (problema_id, decisao, observacao, revisado_por) VALUES ($1,$2,$3,$4)`, [id, status, observation, currentUserName(req)]);
    await client.query('COMMIT');
    res.json({ sucesso: true, mensagem: 'Revisão registrada.', problema: updated.rows[0] });
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} next(error); }
  finally { client.release(); }
});

app.get('/api/admin/auditoria/candidatos/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });
    const result = await pool.query(`SELECT * FROM auditoria_problemas WHERE candidato_id=$1 ORDER BY created_at DESC LIMIT 100`, [id]);
    const score = Math.max(0, 100 - result.rows.reduce((sum, issue) => sum + ({ CRITICA: 40, ALTA: 20, MEDIA: 10, BAIXA: 4 }[issue.gravidade] || 0), 0));
    res.json({ sucesso: true, nota: score, problemas: result.rows });
  } catch (error) { next(error); }
});

// Endpoint protegido para o workflow diário automático.
app.post('/api/internal/auditoria/sincronizar', async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.headers['x-auditoria-token'] || '');
    if (!AUDITORIA_INTERNAL_TOKEN || !safeEqual(token, AUDITORIA_INTERNAL_TOKEN)) {
      return res.status(401).json({ sucesso: false, erro: 'Token da auditoria inválido.' });
    }
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const run = await executeHybridAudit({ start, end, origin: 'AUTOMATICA', requestedBy: 'Workflow diário' });
    res.json({ sucesso: true, auditoria: run });
  } catch (error) { next(error); }
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

app.use((error, req, res, _next) => {
  console.error(error);

  const isGroupModeration = req.path.startsWith('/api/portal-publicacoes/grupos/');

  if (isGroupModeration && ['23514', '22P02', '42804'].includes(String(error?.code || ''))) {
    return res.status(409).json({
      sucesso: false,
      erro: 'O PostgreSQL ainda usa uma regra legada de status para grupos. Execute npm run migrate:panel no terminal deste serviço e tente novamente.',
      codigo: 'GRUPOS_STATUS_LEGADO',
    });
  }

  if (isGroupModeration && error?.code === '23502') {
    return res.status(409).json({
      sucesso: false,
      erro: 'A tabela de grupos possui uma coluna legada obrigatória sem valor padrão. Execute npm run migrate:panel e tente novamente.',
      codigo: 'GRUPOS_ESTRUTURA_LEGADA',
    });
  }

  if (error && error.code === '23505') {
    const constraint = String(error.constraint || '').toLowerCase();
    let message = 'Registro duplicado. Revise os dados informados.';
    if (constraint.includes('app_usuarios') || constraint.includes('usuario')) message = 'Esse usuário de acesso já existe.';
    else if (constraint.includes('candidato') || constraint.includes('telefone')) message = 'Já existe um candidato cadastrado com esse telefone.';
    else if (constraint.includes('prospeccao')) message = 'Esta empresa já existe na base de prospecção e não foi duplicada.';
    else if (constraint.includes('codigo')) message = 'Não foi possível gerar um código automático exclusivo. Tente salvar novamente.';
    return res.status(409).json({ sucesso: false, erro: message });
  }

  if (error && error.code === '23503') {
    return res.status(400).json({
      sucesso: false,
      erro: 'A empresa informada não existe ou está inválida.',
    });
  }

  if (error && ['42703', '42P01'].includes(String(error.code || ''))) {
    return res.status(500).json({
      sucesso: false,
      erro: isGroupModeration
        ? 'A estrutura de grupos está incompleta. Execute npm run migrate:panel no terminal do painel.'
        : 'A estrutura do PostgreSQL está incompleta. Execute as migrações anteriores e faça o redeploy.',
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
    await ensureBootstrapAdmin();
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
