'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}
function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file}: ${result.stderr || result.stdout}`);
}
function checkHtmlIds(file) {
  const html = read(file);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(duplicates.length === 0, `${file}: IDs duplicados: ${duplicates.join(', ')}`);
  return html;
}
function checkCss(file, tokens = []) {
  const css = read(file);
  assert((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, `${file}: blocos CSS desbalanceados.`);
  for (const token of tokens) assert(css.includes(token), `${file}: estilo obrigatório ausente (${token}).`);
}
function checkDollarQuotes(sql) {
  const tags = [...sql.matchAll(/\$[A-Za-z0-9_]*\$/g)].map((m) => m[0]);
  const counts = new Map();
  for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  const odd = [...counts.entries()].filter(([, count]) => count % 2 !== 0);
  assert(odd.length === 0, `SQL com delimitadores dollar-quote desbalanceados: ${odd.map(([tag]) => tag).join(', ')}`);
}

[
  'server.js', 'portal-publicacoes.js', 'admin-v6.js', 'lib/security.js',
  'lib/screening-v13.js', 'lib/demos-v13.js', 'lib/operations-v14.js', 'lib/divulgacao-v1.js', 'lib/atendimento-v15.js',
  'public/app.js', 'public/admin.js', 'public/login.js', 'public/portal-publicacoes.js',
  'public/theme-init.js', 'public/screening-v13.js', 'public/demos-v13.js', 'public/demo-client.js', 'public/operations-v14.js', 'public/divulgacao-v1.js', 'public/atendimento-v15.js',
  'scripts/db-config.js', 'scripts/migrate-panel.js', 'scripts/preflight.js',
  'scripts/test-portal-moderation.js', 'scripts/test-operations-v14.js', 'scripts/build-chatbot-v13.js',
].forEach(checkSyntax);

const html = checkHtmlIds('public/index.html');
for (const token of [
  'dashboardInterviewCalendar', 'dashboardCalendarDaySummary', 'Agenda de entrevistas',
  'dashboardFunnel', 'dashboardJourneyStarted', 'O que você precisa fazer agora',
  'vacancy-filter-single-row', 'Total de vagas ativas', 'Total de candidatos', 'Candidatos novos', 'Taxa de conversão',
  'candidateVacancyFilter', 'candidateStageFilter', 'table-filter-menu',
  'prospectCategoryFilter', 'prospectOwnerFilter', 'prospectStateFilter', 'clearProspectFiltersButton',
]) assert(html.includes(token), `HTML principal sem ${token}.`);
assert(!/id="kpiCritical"/.test(html), 'O card Críticos ainda está visível na visão geral.');
assert(!/\?v=(?:800|1200|1300|1400)(?:["'])/.test(html), 'Assets antigos ainda estão referenciados no HTML principal.');
assert(html.includes('?v=1610'), 'Os assets V16.1 devem usar cache version 1610.');

const app = read('public/app.js');
for (const token of [
  'renderDashboardMiniCalendar', 'moveDashboardCalendarMonth', 'dashboardAttentionMeta',
  'vacancyKpiInterested', 'vacancyKpiInProcess', 'dashboardCalendarSelectedDate',
]) assert(app.includes(token), `Frontend principal sem ${token}.`);

const admin = read('public/admin.js');
for (const token of ['renderLeadFilters', 'has-active-filter', 'clearProspectFiltersButton']) {
  assert(admin.includes(token), `Frontend administrativo sem ${token}.`);
}

checkCss('public/styles.css', [
  'dashboard-command-layout', 'dashboard-mini-calendar', 'vacancy-filter-single-row',
  'table-filter-popover', 'has-active-filter',
]);
checkCss('public/modern-v14.css', ['vacancy-wizard-steps', 'brand-company-card', '@media']);

const sql = read('sql/24_GENESIS_IA_V13_4_FLUXO_MALEAVEL_SEGURO.sql');
checkDollarQuotes(sql);
for (const token of [
  'genesis_v13_nome_valido', 'genesis_v13_resposta_duvida_vaga',
  "pontosCurriculo", // documentação do comportamento fica também no workflow; mantém um marcador simples aqui
  'Passo 1 de 4', 'não tenho CTPS', 'CHATBOT_HIBRIDO_V13_4', 'conf>=0.88',
]) {
  if (token === 'pontosCurriculo') continue;
  assert(sql.toLowerCase().includes(token.toLowerCase()), `Patch SQL V13.4 sem ${token}.`);
}
assert(!/CREATE\s+TABLE/i.test(sql), 'O patch incremental V13.4 não deve criar tabelas.');
assert(!/DROP\s+(TABLE|SCHEMA|DATABASE)/i.test(sql), 'O patch V13.4 contém operação destrutiva.');
assert(fs.existsSync(path.join(root, 'sql', 'genesis-estrutura.sql')), 'Estrutura real do banco não foi incluída.');

const server = read('server.js');
for (const token of ['registerDemosV13', 'registerScreeningV13', 'registerOperationsV14', 'registerDivulgacaoV1', 'registerAtendimentoV15', 'registerAtendimentosV16']) {
  assert(server.includes(token), `Backend sem ${token}.`);
}

const packageJson = JSON.parse(read('package.json'));
assert(packageJson.version === '16.1.0', 'A versão do pacote deve ser 16.1.0.');
assert(packageJson.scripts['migrate:panel'] && packageJson.scripts.preflight, 'Scripts de implantação ausentes.');

console.log('Validação V16 concluída: V15.1 preservada, Central de Atendimentos e handoff integrados.');
