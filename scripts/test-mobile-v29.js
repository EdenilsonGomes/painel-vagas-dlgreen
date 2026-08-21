'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ok = (value, message) => { if (!value) throw new Error(message); };

const html = read('public/index.html');
const css = read('public/genesis-v29-mobile.css');
const sales = read('public/genesis-v27.js');

ok(html.lastIndexOf('genesis-v29-mobile.css') > html.lastIndexOf('genesis-v28-mobile.css'), 'V29 precisa ser a última camada visual.');
ok((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, 'CSS V29 com blocos desbalanceados.');
for (const token of [
  '#vacancyDialog #vacancyForm', '#vacancyViewDialog', '.candidate-status-stack',
  '.notification-center-panel', '.conversation-center.chat-open-mobile', '.sales-kanban', '.theme-switch'
]) ok(css.includes(token), `Cobertura mobile ausente: ${token}`);
ok(css.includes('grid-template-rows: auto auto minmax(0, 1fr) auto'), 'Formulário de vaga não possui área interna rolável.');
ok(css.includes('dialog[open]:not(.genesis-confirm-dialog) > form'), 'Formulários modais gerais não possuem contrato mobile de rolagem.');
ok(css.includes('grid-template-columns: minmax(0, 1fr) !important') && css.includes('width: 100vw !important'), 'Chats não estão protegidos contra a coluna desktop residual.');
ok(css.includes('overflow-y: visible !important') && css.includes('touch-action: pan-x pan-y'), 'Kanban não preserva rolagem vertical e horizontal no toque.');
ok(!css.includes('MutationObserver'), 'V29 não deve usar observador amplo.');
ok(sales.includes('draggable="true"') && sales.includes('data-sales-drop-status'), 'Cards/colunas de Sales não expõem drag and drop.');
ok(sales.includes("addEventListener('pointerdown'") && sales.includes("addEventListener('drop'"), 'Arraste por toque e desktop não foi implementado.');
ok(sales.includes('suppressClickUntil'), 'Arraste pode abrir o modal acidentalmente.');
console.log('V29: lote mobile, chats e drag and drop de Sales validados.');
