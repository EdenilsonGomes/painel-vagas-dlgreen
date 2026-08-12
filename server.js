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
const { registerScreeningV13 } = require('./lib/screening-v13');
const { registerDemosV13 } = require('./lib/demos-v13');
const { registerOperationsV14 } = require('./lib/operations-v14');
const { registerDivulgacaoV1 } = require('./lib/divulgacao-v1');
const { registerAtendimentoV15 } = require('./lib/atendimento-v15');
const { registerAtendimentosV16 } = require('./lib/atendimentos-v16');
const { registerGeoV1 } = require('./lib/geo-v1');
const { registerCrmV1 } = require('./lib/crm-v1');
const { registerProspectingV20 } = require('./lib/prospecting-v20');

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
  console.warn('PORTAL_BASE_URL invÃ¡lida; imagens do portal usarÃ£o o placeholder local.');
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
const WAHA_BASE_URL = String(process.env.WAHA_BASE_URL || '').trim();
const WAHA_API_KEY = String(process.env.WAHA_API_KEY || '').trim();
const DIVULGACAO_WAHA_SESSION = String(process.env.DIVULGACAO_WAHA_SESSION || '').trim();
const DIVULGACAO_WHATSAPP_AUTOMATICO = String(process.env.DIVULGACAO_WHATSAPP_AUTOMATICO || 'false').toLowerCase() === 'true';
const ENTREVISTA_GESTAO_WEBHOOK_URL = String(process.env.ENTREVISTA_GESTAO_WEBHOOK_URL || '').trim();
const ENTREVISTA_GESTAO_WEBHOOK_TOKEN = String(process.env.ENTREVISTA_GESTAO_WEBHOOK_TOKEN || '').trim();
const ALERTAS_ADMIN_ENABLED = String(process.env.ALERTAS_ADMIN_ENABLED || 'false').toLowerCase() === 'true';
const HANDOFF_ANALYSIS_WEBHOOK_URL = String(process.env.HANDOFF_ANALYSIS_WEBHOOK_URL || '').trim();
const HANDOFF_ANALYSIS_WEBHOOK_TOKEN = String(process.env.HANDOFF_ANALYSIS_WEBHOOK_TOKEN || '').trim();
const HANDOFF_ANALYSIS_TIMEOUT_MS = Math.min(Math.max(Number(process.env.HANDOFF_ANALYSIS_TIMEOUT_MS || 20_000), 3_000), 60_000);
const DEMO_CHATBOT_WEBHOOK_URL = String(process.env.DEMO_CHATBOT_WEBHOOK_URL || CHATBOT_WEBHOOK_URL || '').trim();
function normalizePublicHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(undefined|null|false)$/i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}
const PANEL_URL_ENV = normalizePublicHttpUrl(process.env.PANEL_URL);
const PANEL_URL = PANEL_URL_ENV || normalizePublicHttpUrl(PUBLIC_BASE_URL);
const DEMO_TRIAL_DAYS = Math.min(Math.max(Number(process.env.DEMO_TRIAL_DAYS || 7), 1), 30);
const DEMO_MAX_ACTIVE = Math.min(Math.max(Number(process.env.DEMO_MAX_ACTIVE || 5), 1), 100);
const DEMO_EXPIRY_CHECK_MINUTES = Math.min(Math.max(Number(process.env.DEMO_EXPIRY_CHECK_MINUTES || 15), 1), 120);
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

if (process.env.PANEL_URL && !PANEL_URL_ENV) {
  console.warn(`[CONFIG] PANEL_URL invÃ¡lido ignorado: ${JSON.stringify(String(process.env.PANEL_URL))}. Use uma URL https:// completa.`);
}
if (ALERTAS_ADMIN_ENABLED && !PANEL_URL) {
  console.warn('[CONFIG] ALERTAS_ADMIN_ENABLED=true, mas PANEL_URL nÃ£o Ã© vÃ¡lido. Alertas com link ficarÃ£o retidos atÃ© a configuraÃ§Ã£o ser corrigida.');
}

if (!DATABASE_URL && (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD)) {
  console.error('ERRO: configure DATABASE_URL ou as variÃ¡veis PGHOST, PGDATABASE, PGUSER e PGPASSWORD.');
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
      frameAncestors: ["'self'"],
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
      aviso: 'REPROVACAO_WEBHOOK_URL ainda nÃ£o foi configurada no EasyPanel.',
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
      aviso: 'ATENDIMENTO_MANUAL_WEBHOOK_URL ainda nÃ£o foi configurada no EasyPanel.',
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
    throw new Error('CHATBOT_WEBHOOK_URL ainda nÃ£o foi configurada no EasyPanel.');
  }

  const phone = String(payload.telefone || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(phone)) {
    throw new Error('O telefone do candidato nÃ£o estÃ¡ em um formato vÃ¡lido para reprocessamento.');
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
  const hello = firstName ? `OlÃ¡, ${firstName}!` : 'OlÃ¡!';
  const vacancy = String(candidate?.vaga_nome || candidate?.vaga || 'vaga atual').trim();
  const status = String(candidate?.status || '').toUpperCase();
  const stage = String(candidate?.etapa || '').toUpperCase();

  if (status === 'REPROVADO' || ['REPROVADO_PRE_TRIAGEM', 'REPROVADO_TRIAGEM'].includes(stage)) {
    return `${hello} ApÃ³s a anÃ¡lise do seu perfil para a vaga ${vacancy}, neste momento nÃ£o serÃ¡ possÃ­vel continuar nesta oportunidade. Seus dados poderÃ£o ser considerados em futuras vagas compatÃ­veis.`;
  }
  if (status === 'CONTRATADO' || stage === 'CONTRATADO') {
    return `${hello} Seu processo foi concluÃ­do e vocÃª estÃ¡ registrado como contratado. A equipe seguirÃ¡ com as orientaÃ§Ãµes necessÃ¡rias.`;
  }
  if (status === 'EM_ADMISSAO' || ÷NôöÚ$z{-®éÜj×ö6öF–vòÀ¢fvöæöÖS¢6æF–FFRçfvöæöÖRÀ¢7&–FõöVÓ¢6æF–FFRæ7&VFVEöBÀ¢GVÆ—¦FõöVÓ¢6æF–FFRçWFFVEöBÀ¢FVÕö6W÷fÆ–Fó¢õåÆG³‡ÒBòçFW7B…7G&–ær†6æF–FFRæ6WÇÂrr’ç&WÆ6R‚õÄBörÂrr’’À¢FFöæ66–ÖVçFõö–æf÷&ÖF¢&ööÆVâ†6æF–FFRæFFöæ66–ÖVçFò’À¢FFöæ66–ÖVçFõö÷&–vVÓ¢6æF–FFRæFFöæ66–ÖVçFõö÷&–vVÒÇÂçVÆÂÀ¢–FFUö6Æ7VÆF¢vRÀ¢–FFUöFV6Æ&F¢6æF–FFRæ–FFUöFV6Æ&FóòçVÆÂÀ¢–FFU÷&U÷fÆ–FF¢6æF–FFRæ–FFU÷&U÷fÆ–FFÀ¢–FFUö6öæf—&ÖFöFö7VÖVçFÆÖVçFS¢6æF–FFRæ–FFUö6öæf—&ÖFöFö7VÖVçFÆÖVçFRÓÓÒG'VRÀ¢–FFUöF—fW&vVæ6–öFö7VÖVçFÃ¢6æF–FFRæ–FFUöF—fW&vVæ6–öFö7VÖVçFÂÓÓÒG'VRÀ¢–FFU÷fÆ–FF¢6æF–FFRæ–FFU÷fÆ–FFÀ¢6W†õö–æf÷&ÖFó¢6æF–FFRç6W†òÇÂçVÆÂÀ¢6W†õö÷&–vVÓ¢6æF–FFRç6W†õö÷&–vVÒÇÂçVÆÂÀ¢7FGW5÷&W&÷f6õö6öF–vó¢6æF–FFRæÖ÷F—fõ÷&W&÷f6õö6öF–vòÇÂçVÆÂÀ¢7FGW5÷&W&÷f6õö6FVv÷&–¢6æF–FFRæÖ÷F—fõ÷&W&÷f6õö6FVv÷&–ÇÂçVÆÂÀ¢&W&÷f6õ÷&VÆö6fVÃ¢6æF–FFRç&W&÷f6õ÷&VÆö6fVÂÀ¢&÷fFó¢6æF–FFRæ&÷fFòÀ¢&W6VçF6õ÷&öf—76–öæÅö–æf÷&ÖF¢&ööÆVâ…7G&–ær†6æF–FFRæ&W6VçF6õ÷&öf—76–öæÂÇÂrr’çG&–Ò‚’’À¢ÒÀ¢6öæf–wW&6õ÷fv¢°¢–FFUöÖ–æ–Ö¢6æF–FFRæ–FFUöÖ–æ–ÖÀ¢–FFUöÖ†–Ö¢6æF–FFRæ–FFUöÖ†–ÖÀ¢W‡W&–Væ6–öÖ–æ–ÖöÖW6W3¢6æF–FFRæW‡W&–Væ6–öÖ–æ–ÖöÖW6W2À¢VçG&Wf—7FöF–5÷6VÖæ¢6æF–FFRæVçG&Wf—7FöF–5÷6VÖæÀ¢VçG&Wf—7Fö†÷&&–÷3¢6æF–FFRæVçG&Wf—7Fö†÷&&–÷2À¢VçG&Wf—7FöGW&6õöÖ–çWF÷3¢6æF–FFRæVçG&Wf—7FöGW&6õöÖ–çWF÷2À¢ÒÀ¢ÖVç6vVç3¢†ÖW76vW4'”6æF–FFRævWB„çVÖ&W"†6æF–FFRæ–B’’ÇÂµÒ’æÖ‚†ÖW76vR’Óâ‡°¢–C¢ÖW76vRæ–BÀ¢VVÓ¢ÖW76vRçVVÒÀ¢ÖVç6vVÓ¢&VF7DVF—EFW‡B†ÖW76vRæÖVç6vVÒÂ6æF–FFR’À¢ÖVç6vVÕö–E÷&W6VçFS¢&ööÆVâ†ÖW76vRæÖVç6vVÕö–B’À¢Æ÷FU÷&W7÷7Fö–C¢ÖW76vRæÆ÷FU÷&W7÷7Fö–BÇÂçVÆÂÀ¢÷&–vVÕöÖVç6vVÕö–E÷&W6VçFS¢&ööÆVâ†ÖW76vRæ÷&–vVÕöÖVç6vVÕö–B’À¢6öçFW‡Fõ÷6æ6†÷C¢ÖW76vRæ6öçFW‡Fõ÷6æ6†÷BÇÂçVÆÂÀ¢7&VFVEöC¢ÖW76vRæ7&VFVEöBÀ¢Ò’’À¢Fö7VÖVçF÷3¢†Fö7VÖVçG4'”6æF–FFRævWB„çVÖ&W"†6æF–FFRæ–B’’ÇÂµÒ’æÖ‚†Fö7VÖVçB’Óâ‡°¢–C¢Fö7VÖVçBæ–BÀ¢F—ó¢Fö7VÖVçBçF—òÀ¢F—GVÆó¢Fö7VÖVçBçF—GVÆòÀ¢æöÖUö'V—fó¢Fö7VÖVçBææöÖUö'V—fòòu´%T•dõõDeÒr¢çVÆÂÀ¢Ö–ÖU÷G—S¢Fö7VÖVçBæÖ–ÖU÷G—RÀ¢FÖæ†õö'—FW3¢Fö7VÖVçBçFÖæ†õö'—FW2À¢7FGW5÷&ö6W76ÖVçFó¢Fö7VÖVçBç7FGW5÷&ö6W76ÖVçFòÀ¢6Æ76–f–66õö6öæf–æ6¢Fö7VÖVçBæ6Æ76–f–66õö6öæf–æ6À¢÷77V•öFFöæ66–ÖVçFõöW‡G&–F¢&ööÆVâ†Fö7VÖVçBæFFöæ66–ÖVçFõöW‡G&–F’À¢&W7VÇFFõ÷&W7VÖ–Fó¢Fö7VÖVçBç&W7VÇFFòbbG—VöbFö7VÖVçBç&W7VÇFFòÓÓÒvö&¦V7Brò°¢7FGW3¢Fö7VÖVçBç&W7VÇFFòç7FGW2À¢6Æ76–f–66ó¢Fö7VÖVçBç&W7VÇFFòæ6Æ76–f–66òÀ¢&÷fFó¢Fö7VÖVçBç&W7VÇFFòæ&÷fFòÀ¢Ö÷F—fó¢Fö7VÖVçBç&W7VÇFFòæÖ÷F—fòÀ¢Ò¢çVÆÂÀ¢7&VFVEöC¢Fö7VÖVçBæ7&VFVEöBÀ¢&ö6W76FõöC¢Fö7VÖVçBç&ö6W76FõöBÀ¢Ò’’À¢WfVçF÷3¢†WfVçG4'”6æF–FFRævWB„çVÖ&W"†6æF–FFRæ–B’’ÇÂµÒ’æÖ‚†WfVçB’Óâ‡°¢–C¢WfVçBæ–BÂWfVçFó¢WfVçBæWfVçFòÂFW67&–6ó¢&VF7DVF—EFW‡B†WfVçBæFW67&–6òÂ6æF–FFR’Â7&VFVEöC¢WfVçBæ7&VFVEöBÀ¢Ò’’À¢VçG&Wf—7F3¢–çFW'f–Ww4'”6æF–FFRævWB„çVÖ&W"†6æF–FFRæ–B’’ÇÂµÒÀ¢&ö&ÆVÖ3¢†—77VW4'”6æF–FFRævWB„çVÖ&W"†6æF–FFRæ–B’’ÇÂµÒ’æÖ‚†—77VR’Óâ‡°¢–C¢—77VRæ–BÀ¢6æF–FFó¢Æ–2À¢6FVv÷&–¢—77VRæ6FVv÷&–À¢w&f–FFS¢—77VRæw&f–FFRÀ¢÷&–vVÕöFWFV66ó¢—77VRæ÷&–vVÕöFWFV66òÀ¢6öæf–æ6¢—77VRæ6öæf–æ6À¢F—GVÆó¢&VF7DVF—EFW‡B†—77VRçF—GVÆòÂ6æF–FFR’À¢FW67&–6ó¢&VF7DVF—EFW‡B†—77VRæFW67&–6òÂ6æF–FFR’À¢Wf–FVæ6–¢¥4ôâç'6R‡&VF7DVF—EFW‡B„¥4ôâç7G&–æv–g’†—77VRæWf–FVæ6–ÇÂ·Ò’Â6æF–FFR’’À¢6ö×÷'FÖVçFõöW7W&Fó¢&VF7DVF—EFW‡B†—77VRæ6ö×÷'FÖVçFõöW7W&FòÂ6æF–FFR’À¢7VvW7Fõö6÷'&V6ó¢&VF7DVF—EFW‡B†—77VRç7VvW7Fõö6÷'&V6òÂ6æF–FFR’À¢7FGW5÷&Wf—6ó¢—77VRç7FGW5÷&Wf—6òÀ¢ö'6W'f6õ÷&Wf—6ó¢&VF7DVF—EFW‡B†—77VRæö'6W'f6õ÷&Wf—6òÂ6æF–FFR’À¢7&VFVEöC¢—77VRæ7&VFVEöBÀ¢Ò’’À¢Ó°¢Ò“° ¢6öç7B&ö&ÆV×2Ò—77VW5&W7VÇBç&÷w2æÖ‚†—77VR’Óâ°¢6öç7B6æF–FFRÒ6æF–FFW4'”–BævWB„çVÖ&W"†—77VRæ6æF–FFõö–B’’ÇÂ·Ó°¢&WGW&â°¢–C¢—77VRæ–BÀ¢6æF–FFó¢Æ–6W2ævWB„çVÖ&W"†—77VRæ6æF–FFõö–B’’À¢6FVv÷&–¢—77VRæ6FVv÷&–À¢w&f–FFS¢—77VRæw&f–FFRÀ¢÷&–vVÕöFWFV66ó¢—77VRæ÷&–vVÕöFWFV66òÀ¢6öæf–æ6¢—77VRæ6öæf–æ6À¢F—GVÆó¢&VF7DVF—EFW‡B†—77VRçF—GVÆòÂ6æF–FFR’À¢FW67&–6ó¢&VF7DVF—EFW‡B†—77VRæFW67&–6òÂ6æF–FFR’À¢7FGW5÷&Wf—6ó¢—77VRç7FGW5÷&Wf—6òÀ¢6ö×÷'FÖVçFõöW7W&Fó¢&VF7DVF—EFW‡B†—77VRæ6ö×÷'FÖVçFõöW7W&FòÂ6æF–FFR’À¢7VvW7Fõö6÷'&V6ó¢&VF7DVF—EFW‡B†—77VRç7VvW7Fõö6÷'&V6òÂ6æF–FFR’À¢ö'6W'f6õ÷&Wf—6ó¢&VF7DVF—EFW‡B†—77VRæö'6W'f6õ÷&Wf—6òÂ6æF–FFR’À¢7&VFVEöC¢—77VRæ7&VFVEöBÀ¢Ó°¢Ò“°¢6öç7BfVVF&6²ÒfVVF&6µ&W7VÇBç&÷w2æÖ‚‡&÷r’Óâ‡°¢–C¢&÷ræ–BÂ&ö&ÆVÖö–C¢&÷rç&ö&ÆVÖö–BÂFV6—6ó¢&÷ræFV6—6òÀ¢ö'6W'f6ó¢&VF7DÆÄ6æF–FFW2‡&÷ræö'6W'f6ò’Â&Wf—6Fõ÷÷#¢&÷rç&Wf—6Fõ÷÷"òu´DÔ”åÒr¢çVÆÂÂ7&VFVEöC¢&÷ræ7&VFVEöBÀ¢Ò’“°¢6öç7B7VÖÖ'’Ò°¢fW'6ó¢s’ã2rÀ¢vW&FõöVÓ¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢W&–öFó¢²–æ–6–ó¢7F'BçFô•4õ7G&–ær‚’Âf–Ó¢VæBçFô•4õ7G&–ær‚’Â6VÆV6ó¢W&–öBÒÀ¢W66÷ó¢66÷RÀ¢F÷FÅö6æF–FF÷3¢6öçfW'6F–öç2æÆVæwF‚À¢F÷FÅöÖVç6vVç3¢ÖW76vW5&W7VÇBç&÷t6÷VçBóòÖW76vW5&W7VÇBç&÷w2æÆVæwF‚À¢F÷FÅ÷&ö&ÆVÖ3¢&ö&ÆV×2æÆVæwF‚À¢&ö&ÆVÖ5÷÷%öw&f–FFS¢&ö&ÆV×2ç&VGV6R‚†62Â—FVÒ’Óâ²65¶—FVÒæw&f–FFUÒÒ†65¶—FVÒæw&f–FFUÒÇÂ’²²&WGW&â63²ÒÂ·Ò’À¢&ö&ÆVÖ5÷÷%ö6FVv÷&–¢&ö&ÆV×2ç&VGV6R‚†62Â—FVÒ’Óâ²65¶—FVÒæ6FVv÷&–ÒÒ†65¶—FVÒæ6FVv÷&–ÒÇÂ’²²&WGW&â63²ÒÂ·Ò’À¢f—6õ÷&—f6–FFS¢tFF÷2W76ö—2ÂFö7VÖVçF÷2R7&VFVæ6–—2ì:6òf¦VÒ'FRFW7FW‡÷'F:|:6òâ&Wf—6Rò6öçF\;¦FòFW‡GVÂçFW2FR6ö×'F–Æ†"f÷&FWV—RWF÷&—¦FârÀ¢Ó° ¢6öç7B6fTFFRÒæWr–çFÂäFFUF–ÖTf÷&ÖB‚vVâÔ4rÂ²F–ÖU¦öæS¢tÖW&–6õ6õõVÆòrÂ–V#¢vçVÖW&–2rÂÖöçFƒ¢s"ÖF–v—BrÂF“¢s"ÖF–v—BrÒ’æf÷&ÖB†æWrFFR‚’“°¢6öç7Bf–ÆVæÖRÒvVæW6—2ÖVF—F÷&–ÒG·6fTFFWÒç¦—°¢&W2ç7FGW2ƒ#“°¢&W2ç6WD†VFW"‚t6öçFVçBÕG—RrÂvÆ–6F–öâ÷¦—r“°¢&W2ç6WD†VFW"‚t6öçFVçBÔF—7÷6—F–öârÂGF6†ÖVçC²f–ÆVæÖSÒ"G¶f–ÆVæÖWÒ&“°¢&W2ç6WD†VFW"‚t66†RÔ6öçG&öÂrÂvæò×7F÷&Rr“°¢6öç7B¦—Ò7&VFU¦—'VffW"…°¢²æÖS¢w&W7VÖòæ§6öârÂ6öçFVçC¢¥4ôâç7G&–æv–g’‡7VÖÖ'’ÂçVÆÂÂ"’ÒÀ¢²æÖS¢v6öçfW'62æ§6öârÂ6öçFVçC¢¥4ôâç7G&–æv–g’†6öçfW'6F–öç2ÂçVÆÂÂ"’ÒÀ¢²æÖS¢vVF—F÷&–2æ§6öârÂ6öçFVçC¢¥4ôâç7G&–æv–g’‡&ö&ÆV×2ÂçVÆÂÂ"’ÒÀ¢²æÖS¢w&ö&ÆVÖ2æ77brÂ6öçFVçC¢&÷w5Fô77b‡&ö&ÆV×2Â°¢²v–BrÂt”BuÒÅ²v6æF–FFòrÂt6æF–FFòuÒÅ²v6FVv÷&–rÂt6FVv÷&–uÒÅ²vw&f–FFRrÂtw&f–FFRuÒÅ²v÷&–vVÕöFWFV66òrÂt÷&–vVÒuÒÅ²v6öæf–æ6rÂt6öæf–ì:vuÒÅ²wF—GVÆòrÂuL:×GVÆòuÒÅ²vFW67&–6òrÂtFW67&œ:|:6òuÒÅ²w7FGW5÷&Wf—6òrÂu7FGW2uÒÅ²v7&VFVEöBrÂt7&–FòVÒuÒÀ¢Ò’ÒÀ¢²æÖS¢vfVVF&6²æ77brÂ6öçFVçC¢&÷w5Fô77b†fVVF&6²Â°¢²v–BrÂt”BuÒÅ²w&ö&ÆVÖö–BrÂu&ö&ÆVÖuÒÅ²vFV6—6òrÂtFV6—<:6òuÒÅ²vö'6W'f6òrÂtö'6W'f:|:6òuÒÅ²w&Wf—6Fõ÷÷"rÂu&Wf—6Fò÷"uÒÅ²v7&VFVEöBrÂt7&–FòVÒuÒÀ¢Ò’ÒÀ¢²æÖS¢v6öæf–wW&6öW5÷fv2æ§6öârÂ6öçFVçC¢¥4ôâç7G&–æv–g’†6öçfW'6F–öç2æÖ‚†—FVÒ’Óâ‡²6æF–FFó¢—FVÒæ6æF–FFòæÆ–2Âfv¢—FVÒæ6æF–FFòçfvöæöÖRÂ6öæf–wW&6ó¢—FVÒæ6öæf–wW&6õ÷fvÒ’’ÂçVÆÂÂ"’ÒÀ¢²æÖS¢tÄT”ÔÔRçG‡BrÂ6öçFVçC¢u6÷FRæöæ–Ö—¦FòFVF—F÷&–vVæW6—2”c’ã2âì:6ò6öçL:–ÒDg2Â5bÂFVÆVföæRÂ4UÂæöÖR6—f–Â÷R7&VFVæ6–—2åÅÆârÒÀ¢Ò“°¢&W2ç6VæB‡¦—“°¢Ò6F6‚†W'&÷"’²æW‡B†W'&÷"“²Ğ§Ò“° ¦çF6‚‚rö’öFÖ–âöVF—F÷&–÷&ö&ÆVÖ2ó¦–BrÂ&WV—&TFÖ–âÂ7–æ2‡&WÂ&W2ÂæW‡B’Óâ°¢6öç7B6Æ–VçBÒv—BööÂæ6öææV7B‚“°¢G'’°¢6öç7B–BÒ'6T–B‡&Wç&×2æ–B“°¢6öç7B7FGW2Ò7G&–ær‡&Wæ&öG“òç7FGW2ÇÂrr’çFõWW$66R‚“°¢6öç7Bö'6W'fF–öâÒ7G&–ær‡&Wæ&öG“òæö'6W'f6òÇÂrr’çG&–Ò‚’ç6Æ–6RƒÂC’ÇÂçVÆÃ°¢–b‚–BÇÂ²t4ôäd•$ÔDòrÂtdÅ4õõõ4•D•dòrÂt4õ%$”t”DòrÂt”täõ$DòuÒæ–æ6ÇVFW2‡7FGW2’’°¢&WGW&â&W2ç7FGW2ƒC’æ§6öâ‡²7V6W76ó¢fÇ6RÂW'&ó¢u&Wf—<:6ò–çl:Æ–FârÒ“°¢Ğ¢v—B6Æ–VçBçVW'’‚t$Tt”âr“°¢6öç7BWFFVBÒv—B6Æ–VçBçVW'’†UDDRVF—F÷&–÷&ö&ÆVÖ24UB7FGW5÷&Wf—6óÒC"À¢&Wf—6Fõ÷÷#ÒC2Â&Wf—6FõöCÔäõr‚’Âö'6W'f6õ÷&Wf—6óÒCBÂWFFVEöCÔäõr‚¢t„U$R–CÒC$UEU$ä”är¦Â¶–BÂ7FGW2Â7W'&VçEW6W$æÖR‡&W’Âö'6W'fF–öåÒ“°¢–b‚WFFVBç&÷t6÷VçB’²v—B6Æ–VçBçVW'’‚u$ôÄÄ$4²r“²&WGW&â&W2ç7FGW2ƒCB’æ§6öâ‡²7V6W76ó¢fÇ6RÂW'&ó¢tÆW'Fì:6òVæ6öçG&FòârÒ“²Ğ¢v—B6Æ–VçBçVW'’†”å4U%B”åDòVF—F÷&–öfVVF&6²‡&ö&ÆVÖö–BÂFV6—6òÂö'6W'f6òÂ&Wf—6Fõ÷÷"’dÅTU2‚CÂC"ÂC2ÂCB–Â¶–BÂ7FGW2Âö'6W'fF–öâÂ7W'&VçEW6W$æÖR‡&W•Ò“°¢v—B6Æ–VçBçVW'’‚t4ôÔÔ•Br“°¢&W2æ§6öâ‡²7V6W76ó¢G'VRÂÖVç6vVÓ¢u&Wf—<:6ò&Vv—7G&FârÂ&ö&ÆVÖ¢WFFVBç&÷w5³ÒÒ“°¢Ò6F6‚†W'&÷"’²G'’²v—B6Æ–VçBçVW'’‚u$ôÄÄ$4²r“²Ò6F6‚·ÒæW‡B†W'&÷"“²Ğ¢f–æÆÇ’²6Æ–VçBç&VÆV6R‚“²Ğ§Ò“° ¦ævWB‚rö’öFÖ–âöVF—F÷&–ö6æF–FF÷2ó¦–BrÂ&WV—&TFÖ–âÂ7–æ2‡&WÂ&W2ÂæW‡B’Óâ°¢G'’°¢6öç7B–BÒ'6T–B‡&Wç&×2æ–B“°¢–b‚–B’&WGW&â&W2ç7FGW2ƒC’æ§6öâ‡²7V6W76ó¢fÇ6RÂW'&ó¢t”B–çl:Æ–FòârÒ“°¢6öç7B&W7VÇBÒv—BööÂçVW'’†4TÄT5B¢e$ôÒVF—F÷&–÷&ö&ÆVÖ2t„U$R6æF–FFõö–CÒCõ$DU"%’7&VFVEöBDU42Ä”Ô•BÂ¶–EÒ“°¢6öç7B66÷&RÒÖF‚æÖ‚ƒÂÒ&W7VÇBç&÷w2ç&VGV6R‚‡7VÒÂ—77VR’Óâ7VÒ²‡²5$•D”4¢CÂÅD¢#ÂÔTD”¢Â$•„¢BÕ¶—77VRæw&f–FFUÒÇÂ’Â’“°¢&W2æ§6öâ‡²7V6W76ó¢G'VRÂæ÷F¢66÷&RÂ&ö&ÆVÖ3¢&W7VÇBç&÷w2Ò“°¢Ò6F6‚†W'&÷"’²æW‡B†W'&÷"“²Ğ§Ò“° ¢òòVæGö–çB&÷FVv–Fò&òv÷&¶fÆ÷rFœ:&–òWFöÜ:F–6òà¦ç÷7B‚rö’ö–çFW&æÂöVF—F÷&–÷6–æ7&öæ—¦"rÂ7–æ2‡&WÂ&W2ÂæW‡B’Óâ°¢G'’°¢6öç7BFö¶VâÒ7G&–ær‡&Wæ&öG“òçFö¶VâÇÂ&Wæ†VFW'5²w‚ÖVF—F÷&–×Fö¶VâuÒÇÂrr“°¢–b‚TD•Dõ$”ô”åDU$äÅõDô´TâÇÂ6fTWVÂ‡Fö¶VâÂTD•Dõ$”ô”åDU$äÅõDô´Tâ’’°¢&WGW&â&W2ç7FGW2ƒC’æ§6öâ‡²7V6W76ó¢fÇ6RÂW'&ó¢uFö¶VâFVF—F÷&––çl:Æ–FòârÒ“°¢Ğ¢6öç7BVæBÒæWrFFR‚“°¢6öç7B7F'BÒæWrFFR†VæBævWEF–ÖR‚’Ò#B¢c¢c¢“°¢6öç7B'VâÒv—BW†V7WFT‡–'&–DVF—B‡²7F'BÂVæBÂ÷&–v–ã¢tUDôÔD”4rÂ&WVW7FVD'“¢uv÷&¶fÆ÷rFœ:&–òrÒ“°¢&W2æ§6öâ‡²7V6W76ó¢G'VRÂVF—F÷&–¢'VâÒ“°¢Ò6F6‚†W'&÷"’²æW‡B†W'&÷"“²Ğ§Ò“° ¦çW6R†W‡&W72ç7FF–2‡F‚æ¦ö–â…õöF—&æÖRÂwV&Æ–2r’Â°¢W‡FVç6–öç3¢²v‡FÖÂuÒÀ¢Ö„vS¢&ö6W72æVçbääôDUôTåbÓÓÒw&öGV7F–öâròsVÒr¢À§Ò’“° ¦çW6R‚‡&WÂ&W2ÂæW‡B’Óâ°¢–b‡&WæÖWF†öBÓÓÒttUBr’°¢&WGW&â&W2ç6VæDf–ÆR‡F‚æ¦ö–â…õöF—&æÖRÂwV&Æ–2rÂv–æFW‚æ‡FÖÂr’“°¢Ğ¢&WGW&âæW‡B‚“°§Ò“° ¦çW6R‚†W'&÷"Â&WÂ&W2ÂöæW‡B’Óâ°¢6öç6öÆRæW'&÷"†W'&÷"“° ¢–b†W'&÷#òææÖRÓÓÒuv†&WVW7DW'&÷"r’°¢&WGW&â&W2ç7FGW2„çVÖ&W"†W'&÷"ç7FGW2ÇÂS"’’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢W'&÷"æÖW76vRÇÂtì:6òfö’÷7<:×fVÂ6öæ6ÇV—"÷W&:|:6òæòt„ârÀ¢6öF–vó¢tDTÔõõt„ôU%$òrÀ¢Ò“°¢Ğ ¢6öç7B—4w&÷WÖöFW&F–öâÒ&WçF‚ç7F'G5v—F‚‚rö’÷÷'FÂ×V&Æ–66öW2öw'W÷2òr“°¢6öç7B—5÷'FÄÖöFW&F–öâÒ&WçF‚ç7F'G5v—F‚‚rö’÷÷'FÂ×V&Æ–66öW2òr“° ¢–b†—5÷'FÄÖöFW&F–öâbbW'&÷#òæ6öFRÓÓÒsC%‚r’°¢&WGW&â&W2ç7FGW2ƒS’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢t6öç7VÇFFRÖöFW&:|:6òW6,:&ÖWG&÷2–æ6ö×L:×fV—26öÒò÷7Fw&U5ÂâGVÆ—¦Rò–æVÂ&fW'<:6ò"ãã÷R7WW&–÷"ârÀ¢6öF–vó¢tÔôDU$4õõD•tTÕõ$ÔUE$õ2rÀ¢Ò“°¢Ğ ¢–b†—4w&÷WÖöFW&F–öâbb²s#3SBrÂs#%"rÂsC#ƒBuÒæ–æ6ÇVFW2…7G&–ær†W'&÷#òæ6öFRÇÂrr’’’°¢&WGW&â&W2ç7FGW2ƒC’’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢tò÷7Fw&U5Â–æFW6VÖ&Vw&ÆVvFFR7FGW2&w'W÷2âW†V7WFRçÒ'VâÖ–w&FS§æVÂæòFW&Ö–æÂFW7FR6W'fœ:vòRFVçFRæ÷fÖVçFRârÀ¢6öF–vó¢tu%Uõ5õ5DEU5ôÄTtDòrÀ¢Ò“°¢Ğ ¢–b†—4w&÷WÖöFW&F–öâbbW'&÷#òæ6öFRÓÓÒs#3S"r’°¢&WGW&â&W2ç7FGW2ƒC’’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢tF&VÆFRw'W÷2÷77V’VÖ6öÇVæÆVvFö'&–vL;7&–6VÒfÆ÷"G,:6òâW†V7WFRçÒ'VâÖ–w&FS§æVÂRFVçFRæ÷fÖVçFRârÀ¢6öF–vó¢tu%Uõ5ôU5E%UEU$ôÄTtDrÀ¢Ò“°¢Ğ ¢–b„çVÖ&W"æ—4–çFVvW"„çVÖ&W"†W'&÷#òç7FGW46öFR’’bbçVÖ&W"†W'&÷"ç7FGW46öFR’ãÒCbbçVÖ&W"†W'&÷"ç7FGW46öFR’Âc’°¢&WGW&â&W2ç7FGW2„çVÖ&W"†W'&÷"ç7FGW46öFR’’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢W'&÷"æÖW76vRÇÂtì:6òfö’÷7<:×fVÂ6öæ6ÇV—"÷W&:|:6òârÀ¢6öF–vó¢W'&÷"ææÖRÓÓÒtW‡FW&æÅ6W'f–6TW'&÷"ròu4U%d”4õôU…DU$äõõcBr¢tõU$4õõcBrÀ¢Ò“°¢Ğ ¢–b†W'&÷"bbW'&÷"æ6öFRÓÓÒs#3SRr’°¢6öç7B6öç7G&–çBÒ7G&–ær†W'&÷"æ6öç7G&–çBÇÂrr’çFôÆ÷vW$66R‚“°¢ÆWBÖW76vRÒu&Vv—7G&òGWÆ–6Fòâ&Wf—6R÷2FF÷2–æf÷&ÖF÷2âs°¢–b†6öç7G&–çBæ–æ6ÇVFW2‚v÷W7V&–÷2r’ÇÂ6öç7G&–çBæ–æ6ÇVFW2‚wW7V&–òr’’ÖW76vRÒtW76RW7\:&–òFR6W76ò¬:W†—7FRâs°¢VÇ6R–b†6öç7G&–çBæ–æ6ÇVFW2‚v6æF–FFòr’ÇÂ6öç7G&–çBæ–æ6ÇVFW2‚wFVÆVföæRr’’ÖW76vRÒt¬:W†—7FRVÒ6æF–FFò6F7G&Fò6öÒW76RFVÆVföæRâs°¢VÇ6R–b†6öç7G&–çBæ–æ6ÇVFW2‚w&÷7V66òr’’ÖW76vRÒtW7FV×&W6¬:W†—7FRæ&6RFR&÷7V<:|:6òRì:6òfö’GWÆ–6Fâs°¢VÇ6R–b†6öç7G&–çBæ–æ6ÇVFW2‚v6öF–vòr’’ÖW76vRÒtì:6òfö’÷7<:×fVÂvW&"VÒ<;6F–vòWFöÜ:F–6òW†6ÇW6—fòâFVçFR6Çf"æ÷fÖVçFRâs°¢&WGW&â&W2ç7FGW2ƒC’’æ§6öâ‡²7V6W76ó¢fÇ6RÂW'&ó¢ÖW76vRÒ“°¢Ğ ¢–b†W'&÷"bbW'&÷"æ6öFRÓÓÒs#3S2r’°¢&WGW&â&W2ç7FGW2ƒC’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢tV×&W6–æf÷&ÖFì:6òW†—7FR÷RW7L:–çl:Æ–FârÀ¢Ò“°¢Ğ ¢–b†W'&÷"bb²sC#s2rÂsC%uÒæ–æ6ÇVFW2…7G&–ær†W'&÷"æ6öFRÇÂrr’’’°¢&WGW&â&W2ç7FGW2ƒS’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢—4w&÷WÖöFW&F–öà¢òtW7G'WGW&FRw'W÷2W7L:–æ6ö×ÆWFâW†V7WFRçÒ'VâÖ–w&FS§æVÂæòFW&Ö–æÂFò–æVÂâp¢¢tW7G'WGW&Fò÷7Fw&U5ÂW7L:–æ6ö×ÆWFâW†V7WFR2Ö–w&:|;VW2çFW&–÷&W2Rf:vò&VFWÆ÷’ârÀ¢Ò“°¢Ğ ¢&WGW&â&W2ç7FGW2ƒS’æ§6öâ‡°¢7V6W76ó¢fÇ6RÀ¢W'&ó¢tW'&ò–çFW&æòâ6öç7VÇFR÷2Æöw2Fò6W'fœ:vòæòV7•æVÂârÀ¢Ò“°§Ò“° ¦7–æ2gVæ7F–öâ7F'B‚’°¢G'’°¢v—BööÂçVW'’‚u4TÄT5Br“°¢v—BVç7W&T&ö÷G7G&FÖ–â‚“°¢æÆ—7FVâ…õ%BÂsãããrÂ‚’Óâ°¢6öç6öÆRæÆör†vVæW6—2”–æ–6–Fòæ÷'FGµõ%GÒæ“°¢Ò“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚tì:6òfö’÷7<:×fVÂ6öæV7F"ò÷7Fw&U5Ã¢rÂW'&÷"“°¢&ö6W72æW†—Bƒ“°¢Ğ§Ğ ¦7–æ2gVæ7F–öâ6‡WFF÷vâ‡6–væÂ’°¢6öç6öÆRæÆör†G·6–væÇÒ&V6V&–FòâVæ6W'&æFòÆ–6:|:6òââæ“°¢v—BööÂæVæB‚“°¢&ö6W72æW†—Bƒ“°§Ğ §&ö6W72æöâ‚u4”uDU$ÒrÂ‚’Óâ6‡WFF÷vâ‚u4”uDU$Òr’“°§&ö6W72æöâ‚u4”t”åBrÂ‚’Óâ6‡WFF÷vâ‚u4”t”åBr’“° §7F'B‚“°