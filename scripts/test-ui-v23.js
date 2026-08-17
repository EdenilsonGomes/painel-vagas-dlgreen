'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const css = read('public/experience-v23.css');
const client = read('public/experience-v23.js');
const server = read('lib/notifications-v23.js');

for (const id of ['notificationCenterButton','notificationCenterPanel','candidateFiltersButton','candidateFiltersPopover']) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} deve existir no HTML`);
}
assert.match(css, /prefers-reduced-motion/, 'A camada visual deve respeitar movimento reduzido.');
assert.match(css, /@media \(max-width: 640px\)/, 'A camada visual deve incluir tratamento mobile.');
assert.match(client, /marcar-todas-lidas/, 'O cliente deve suportar marcar todas como lidas.');
assert.match(client, /navigator|clipboard|copyFeedback/, 'O cliente deve preservar feedback de cópia.');
assert.match(server, /painel_notificacoes_lidas/, 'A API deve persistir o estado de leitura.');
assert.doesNotMatch(client, /Chris Thompson|Alex Design Lead|PR #42|Product Design Sync/, 'Dados fictícios das referências não podem entrar no painel.');

console.log('UI V23 validada: notificações, filtros, cópia, responsividade e dados reais.');
