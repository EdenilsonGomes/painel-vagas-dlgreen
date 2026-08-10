'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCep, fetchBrasilApiCep } = require('../lib/geo-v1');
const { leadStage, stageCanAdvance } = require('../lib/crm-v1');

async function main() {
  assert.equal(normalizeCep('04310-000'), '04310000');
  assert.equal(normalizeCep('03132000'), '03132000');
  assert.equal(normalizeCep('123'), null);

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      cep: '04310000', state: 'SP', city: 'São Paulo', neighborhood: 'Jabaquara', street: 'Rua de teste', service: 'mock',
      location: { type: 'Point', coordinates: { longitude: '-46.6401', latitude: '-23.6302' } },
    }),
  });
  const geo = await fetchBrasilApiCep('04310000', { fetchImpl: mockFetch, timeoutMs: 1000 });
  assert.equal(geo.ok, true);
  assert.equal(geo.status, 'OK');
  assert.equal(geo.data.estado, 'SP');
  assert.equal(geo.data.latitude, -23.6302);
  assert.equal(geo.data.longitude, -46.6401);

  assert.equal(leadStage({ status: 'NOVO' }), 'NOVO_LEAD');
  assert.equal(leadStage({ status: 'PRIMEIRO_CONTATO' }), 'CONTATADO');
  assert.equal(leadStage({ status: 'RESPONDEU' }), 'RESPONDEU');
  assert.equal(leadStage({ status: 'REUNIAO' }), 'DEMONSTRACAO');
  assert.equal(leadStage({ status: 'PROPOSTA' }), 'PROPOSTA');
  assert.equal(leadStage({ status: 'CLIENTE' }), 'GANHO');
  assert.equal(leadStage({ status: 'SEM_INTERESSE' }), 'PERDIDO');
  assert.equal(stageCanAdvance('CONTATADO', 'RESPONDEU'), true);
  assert.equal(stageCanAdvance('PROPOSTA', 'QUALIFICADO'), false);
  assert.equal(stageCanAdvance('GANHO', 'NOVO_LEAD'), false);

  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'sql', '29_GENESIS_IA_GEO_CRM_V1.sql'), 'utf8');

  for (const id of ['view-crm','crmTabContent','crmOpportunityDialog','crmNewOpportunityDialog','vacancyGeoCep','candidateDistanceFilter','candidateDistanceSort','candidateDistance']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `ID ausente: ${id}`);
  }
  assert.match(app, /GenesisGeoV1/);
  assert.match(app, /GenesisCRM/);
  assert.match(server, /registerGeoV1\(\{ app, pool \}\)/);
  assert.match(server, /registerCrmV1\(\{ app, pool, requireAdmin, currentUserName \}\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS geo_ceps/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_oportunidades/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i, 'Migration V19 não pode remover estruturas atuais.');
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+(candidatos|vagas)\b/i, 'V19 não deve alterar as tabelas centrais candidatos/vagas.');

  console.log('V19 Geo + CRM: testes unitários e guardrails aprovados.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
