'use strict';

const assert = require('node:assert/strict');
const { registerPortalPublications } = require('../portal-publicacoes');

function createHarness(queryImpl) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    patch(path, ...handlers) { routes.set(`PATCH ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
  };
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : { rowCount: 1, rows: [{ id: params?.at(-1), status: params?.[0] }] };
    },
  };
  registerPortalPublications({
    app,
    pool,
    requireAdmin: (_req, _res, next) => next(),
    currentUserName: () => 'Teste',
    portalBaseUrl: '',
  });
  return { routes, queries };
}

async function invoke(handler, { id = '42', body = {} } = {}) {
  const output = { status: 200, body: null, error: null };
  const req = { params: { id }, body, user: { perfil: 'ADMIN' } };
  const res = {
    status(value) { output.status = value; return this; },
    json(value) { output.body = value; return this; },
  };
  await handler(req, res, (error) => { output.error = error; });
  return output;
}

async function main() {
  const approvedHarness = createHarness();
  const approvedHandler = approvedHarness.routes.get('PATCH /api/portal-publicacoes/grupos/:id').at(-1);
  const approved = await invoke(approvedHandler, {
    body: {
      status: 'approved',
      verified: false,
      featured: false,
      official: false,
      rejection_reason: '',
      moderation_note: 'Convite conferido.',
    },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.sucesso, true);
  assert.match(approvedHarness.queries[0].sql, /status=\$1::VARCHAR\(30\)/);
  assert.match(approvedHarness.queries[0].sql, /CASE WHEN \$1::VARCHAR\(30\)='approved'/);
  assert.deepEqual(approvedHarness.queries[0].params, [
    'approved', true, false, false, '', 'Convite conferido.', 42,
  ]);

  const invalidId = await invoke(approvedHandler, { id: 'abc', body: { status: 'approved' } });
  assert.equal(invalidId.status, 400);
  assert.match(invalidId.body.erro, /ID de grupo inválido/);

  const rejected = await invoke(approvedHandler, {
    body: { status: 'rejected', rejection_reason: 'não' },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.erro, /motivo da rejeição/i);

  const databaseError = Object.assign(new Error('check violation'), { code: '23514' });
  const failureHarness = createHarness(async () => { throw databaseError; });
  const failureHandler = failureHarness.routes.get('PATCH /api/portal-publicacoes/grupos/:id').at(-1);
  const failure = await invoke(failureHandler, { body: { status: 'approved' } });
  assert.equal(failure.error, databaseError);

  const jobHarness = createHarness();
  const jobHandler = jobHarness.routes.get('PATCH /api/portal-publicacoes/vagas/:id').at(-1);
  const approvedJob = await invoke(jobHandler, {
    body: { status: 'APROVADA', rejection_reason: '', moderation_note: '' },
  });
  assert.equal(approvedJob.status, 200);
  assert.equal(approvedJob.body.sucesso, true);
  assert.match(jobHarness.queries[0].sql, /status=\$1::VARCHAR\(30\)/);
  assert.match(jobHarness.queries[0].sql, /CASE WHEN \$1::VARCHAR\(30\)='APROVADA'/);

  console.log('Testes de moderação de grupos e vagas concluídos com sucesso.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
