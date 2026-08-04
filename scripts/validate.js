'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function assert(condition, message) { if (!condition) throw new Error(message); }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file}: ${result.stderr || result.stdout}`);
}
[
  'server.js', 'portal-publicacoes.js', 'admin-v6.js',
  'public/app.js', 'public/admin.js', 'public/login.js', 'public/portal-publicacoes.js', 'public/theme-init.js',
  'scripts/db-config.js', 'scripts/migrate-panel.js', 'scripts/preflight.js', 'scripts/test-portal-moderation.js',
].forEach(checkSyntax);
const html = read('public/index.html');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `IDs duplicados no HTML: ${[...new Set(duplicates)].join(', ')}`);
['themeToggleButton','sidebarBackdrop','mobileMoreButton','vacancyForm','publicar_portal','canal_candidatura','kpiActiveVacancies','dashboardFunnel','vacancyCompanyFilter','vacancyLocationFilter','candidateConversation','modern-v12.css'].forEach((token) => assert(html.includes(token), `Elemento obrigatório ausente: ${token}`));
assert(!/\?v=(?:800|1200|1300)(?:["'])/.test(html), 'Assets antigos ainda estão referenciados no HTML principal.');
const server = read('server.js');
['publicar_portal','destaque_portal','canal_candidatura','portal_publicado_em'].forEach((token) => assert(server.includes(token), `Backend sem suporte a ${token}`));
['PORTAL_IMAGE_ORIGIN','conversa: conversaResult.rows.reverse()','GRUPOS_STATUS_LEGADO'].forEach((token) => assert(server.includes(token), `Correção V12 ausente no backend: ${token}`));
const migration = read('sql/07_GENESIS_IA_PORTAL_PUBLICO_VAGAS_SEO_LEADS.sql');
['portal_leads_empresas','portal_eventos','definir_portal_publicado_em'].forEach((token) => assert(migration.includes(token), `Migração incompleta: ${token}`));
const groupMigration = read('sql/17_PAINEL_V12_COMPATIBILIDADE_MODERACAO_GRUPOS.sql');
['gg_groups_status_check', "'approved'", "'rejected'", 'NOT VALID'].forEach((token) => assert(groupMigration.includes(token), `Migração V12 incompleta: ${token}`));
const modernCss = read('public/modern-v12.css');
assert((modernCss.match(/{/g) || []).length === (modernCss.match(/}/g) || []).length, 'Blocos desbalanceados em modern-v12.css.');
['group-moderation-workspace','candidate-conversation','dashboard-primary-kpis','@media (max-width: 620px)'].forEach((token) => assert(modernCss.includes(token), `Estilo V12 ausente: ${token}`));
const publicPortal = read('public/portal-publicacoes.js');
['renderGroupWorkspace','data-group-action="approved"','group-placeholder.svg','displayGroupDescription'].forEach((token) => assert(publicPortal.includes(token), `Moderação visual incompleta: ${token}`));
const packageJson = JSON.parse(read('package.json'));
assert(packageJson.version === '12.0.1', 'A versão do pacote deve ser 12.0.1.');
assert(packageJson.scripts['migrate:panel'] && packageJson.scripts.preflight, 'Scripts de deploy V12 ausentes.');
for (const dir of ['n8n']) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.json'))) JSON.parse(read(`${dir}/${file}`));
}
console.log('Validação do painel concluída com sucesso.');
