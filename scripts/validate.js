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
['server.js','public/app.js','public/admin.js','public/login.js','public/theme-init.js'].forEach(checkSyntax);
const html = read('public/index.html');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `IDs duplicados no HTML: ${[...new Set(duplicates)].join(', ')}`);
['themeToggleButton','sidebarBackdrop','mobileMoreButton','vacancyForm','publicar_portal','canal_candidatura'].forEach((token) => assert(html.includes(token), `Elemento obrigatório ausente: ${token}`));
const server = read('server.js');
['publicar_portal','destaque_portal','canal_candidatura','portal_publicado_em'].forEach((token) => assert(server.includes(token), `Backend sem suporte a ${token}`));
const migration = read('sql/07_GENESIS_IA_PORTAL_PUBLICO_VAGAS_SEO_LEADS.sql');
['portal_leads_empresas','portal_eventos','definir_portal_publicado_em'].forEach((token) => assert(migration.includes(token), `Migração incompleta: ${token}`));
for (const dir of ['n8n']) {
  for (const file of fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith('.json'))) JSON.parse(read(`${dir}/${file}`));
}
console.log('Validação do painel concluída com sucesso.');
