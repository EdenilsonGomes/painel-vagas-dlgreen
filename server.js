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
    res.set('WWW-Authenticate', 'Basic realm="Painel de Vagas", charset="UTF-8"');
    return res.status(401).send('Autenticação necessária.');
  }

  let decoded = '';
  try {
    decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="Painel de Vagas", charset="UTF-8"');
    return res.status(401).send('Credenciais inválidas.');
  }

  const separatorIndex = decoded.indexOf(':');
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
    res.set('WWW-Authenticate', 'Basic realm="Painel de Vagas", charset="UTF-8"');
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
  codigo: z.string().trim().min(2).max(50).transform((value) => value.toUpperCase()),
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

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
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
        c.updated_at,
        v.codigo AS vaga_codigo,
        COALESCE(v.titulo, c.vaga) AS vaga_nome,
        v.status AS vaga_status
      FROM candidatos c
      LEFT JOIN vagas v ON v.id = c.vaga_id
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
        e.nome AS empresa_nome
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
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
      SELECT v.*, e.nome AS empresa_nome
      FROM vagas v
      JOIN empresas e ON e.id = v.empresa_id
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
  try {
    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    const v = parsed.data;
    const result = await pool.query(`
      INSERT INTO vagas (
        empresa_id, codigo, titulo, cargo, descricao, cidade, estado, bairro,
        endereco_referencia, tipo_contrato, modalidade, escala, horario, salario,
        beneficios, escolaridade_minima, experiencia_minima_meses,
        aceita_sem_experiencia, requisitos_obrigatorios, requisitos_desejaveis,
        quantidade_vagas, formulario_url, status, data_inicio, data_encerramento
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25
      )
      RETURNING *
    `, [
      v.empresa_id, v.codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.beneficios, v.escolaridade_minima,
      v.experiencia_minima_meses, v.aceita_sem_experiencia,
      v.requisitos_obrigatorios, v.requisitos_desejaveis, v.quantidade_vagas,
      v.formulario_url, v.status, v.data_inicio, v.data_encerramento,
    ]);

    res.status(201).json({
      sucesso: true,
      mensagem: 'Vaga cadastrada com sucesso.',
      vaga: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/vagas/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID inválido.' });

    const parsed = vacancySchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);

    const v = parsed.data;
    const result = await pool.query(`
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
        requisitos_obrigatorios = $19,
        requisitos_desejaveis = $20,
        quantidade_vagas = $21,
        formulario_url = $22,
        status = $23,
        data_inicio = $24,
        data_encerramento = $25,
        updated_at = NOW()
      WHERE id = $26
      RETURNING *
    `, [
      v.empresa_id, v.codigo, v.titulo, v.cargo, v.descricao, v.cidade,
      v.estado, v.bairro, v.endereco_referencia, v.tipo_contrato, v.modalidade,
      v.escala, v.horario, v.salario, v.beneficios, v.escolaridade_minima,
      v.experiencia_minima_meses, v.aceita_sem_experiencia,
      v.requisitos_obrigatorios, v.requisitos_desejaveis, v.quantidade_vagas,
      v.formulario_url, v.status, v.data_inicio, v.data_encerramento, id,
    ]);

    if (!result.rowCount) {
      return res.status(404).json({ sucesso: false, erro: 'Vaga não encontrada.' });
    }

    res.json({
      sucesso: true,
      mensagem: 'Vaga atualizada com sucesso.',
      vaga: result.rows[0],
    });
  } catch (error) {
    next(error);
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
    return res.status(409).json({
      sucesso: false,
      erro: 'Já existe uma vaga com esse código para esta empresa.',
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
      console.log(`Painel de vagas iniciado na porta ${PORT}.`);
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
