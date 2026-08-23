'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file}: ${result.stderr || result.stdout}`);
}

function checkHtmlIds(file) {
  const html = read(file);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(!duplicates.length, `${file}: IDs duplicados: ${duplicates.join(', ')}`);
  return html;
}

function checkCss(file) {
  const css = read(file);
  assert((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, `${file}: blocos CSS desbalanceados.`);
}

[
  'server.js', 'portal-publicacoes.js', 'admin-v6.js', 'lib/security.js',
  'lib/screening-v13.js', 'lib/operations-v14.js', 'lib/atendimento-v15.js',
  'lib/sales-v27.js', 'lib/sales-enrichment.js', 'lib/talent-flows-v27.js',
  'public/app.js', 'public/admin.js', 'public/login.js', 'public/portal-publicacoes.js',
  'public/theme-init.js', 'public/screening-v13.js', 'public/operations-v14.js',
  'public/atendimento-v15.js', 'public/genesis-v27.js',
  'scripts/db-config.js', 'scripts/migrate-panel.js', 'scripts/preflight.js',
].forEach(checkSyntax);

const html = checkHtmlIds('public/index.html');
for (const token of [
  'data-view="sales"', 'id="view-sales"', 'id="candidateTalentBlock"', 'id="candidateTalentFilter"',
  'data-view="publications"', 'data-view="brands"', 'data-view="monitoring"',
  'data-go-view="documents"', 'data-go-view="audit"', 'genesis-v31-consolidation.css?v=3201',
  'id="dashboardPerformanceChart"', 'id="dashboardVacancyAttentionList"', 'data-dashboard-period="30D"',
]) assert(html.includes(token), `HTML principal sem ${token}.`);

for (const removed of [
  'id="view-crm"', 'id="view-prospecting"', 'id="view-commercialChats"', 'id="view-divulgacao"', 'id="view-demos"',
  'dashboardJourneyStarted', 'dashboard-funnel-panel', 'dashboard-agenda-panel', 'O que você precisa fazer agora',
  'prospectingConnectionDialog', 'outreachDialog', 'demoDetailsDialog', 'portalPublicationsGroups',
]) assert(!html.includes(removed), `Legado ainda presente no HTML: ${removed}.`);

for (const file of [
  'lib/demos-v13.js', 'lib/divulgacao-v1.js', 'lib/crm-v1.js', 'lib/prospecting-v20.js',
  'public/demos-v13.js', 'public/demo-client.js', 'public/demo.html', 'public/crm-v1.js',
  'public/prospecting-v20.js', 'public/divulgacao-v1.js', 'public/floating-chat-v16-3.js',
]) assert(!fs.existsSync(path.join(root, file)), `Arquivo legado não removido: ${file}.`);

['public/styles.css', 'public/genesis-v27.css', 'public/genesis-v28-mobile.css', 'public/genesis-v29-mobile.css', 'public/genesis-v30-sales.css', 'public/genesis-v31-consolidation.css'].forEach(checkCss);

console.log('Validação estrutural concluída: sintaxe, HTML, CSS e remoção do legado.');
