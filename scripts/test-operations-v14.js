'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'operations-v14.js'), 'utf8');
const moduleApi = require('../lib/operations-v14');

assert.equal(typeof moduleApi.registerOperationsV14, 'function');
assert.match(source, /\/api\/empresas\/marcas/);
assert.match(source, /\/api\/minha-agenda/);
assert.match(source, /\/divulgacao\/gerar-ia/);
assert.doesNotMatch(source, /waha|qrcode|session\/qr|outreach|prospeccao/i);

console.log('Operações V14: marcas, agenda e artes preservadas; automação comercial legada removida.');
