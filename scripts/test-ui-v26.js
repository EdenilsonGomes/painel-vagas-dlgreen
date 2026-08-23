'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ok = (condition, message) => { if (!condition) throw new Error(message); };

const html = read('public/index.html');
const app = read('public/app.js');
const v25 = read('public/genesis-v25-admin.js');
const v25Css = read('public/genesis-v25-admin.css');
const v23 = read('public/experience-v23.js');
const css = read('public/genesis-v26.css');
const js = read('public/genesis-v26.js');

ok(html.includes('/genesis-v26.css?v=2600') && html.includes('/genesis-v26.js?v=2600'), 'V26 deve ser carregada após V24/V25.');
ok(html.includes('id="candidateSelectAll"') && html.includes('id="candidateBulkBar"'), 'Seleção em massa deve existir na tabela.');
ok(html.includes('id="candidateBulkExport"') && html.includes('data-admin-only'), 'Exportação contextual deve permanecer restrita a ADMIN.');
['conversation', 'documents', 'timeline'].forEach((tab) => ok(html.includes(`data-drawer-quick-tab="${tab}"`), `Atalho ${tab} ausente no drawer.`));
ok(html.includes('data-go-view="interviews"'), 'Atalho Agendar deve abrir a agenda existente.');
ok(app.includes('selectedCandidateIds: new Set()'), 'Seleção deve usar estado único e persistente entre renders.');
ok(app.includes('baseCandidates.filter((candidate) => candidateMatches(candidate))'), 'Cards de status devem filtrar cada candidato sem repassar o índice como ignoreStatus.');
ok(!app.includes('baseCandidates.filter(candidateMatches)'), 'Filtro de status não pode receber o índice do Array.filter como ignoreStatus.');
ok(app.includes('enviar_mensagem: Boolean(options.enviarMensagem)'), 'Decisão deve enviar explicitamente a preferência de comunicação.');
ok(app.includes('id="reviewSendMessage" type="checkbox"') && !app.includes('id="reviewSendMessage" type="checkbox" checked'), 'Enviar mensagem deve iniciar desmarcado.');
ok(app.includes("'Salvar e enviar mensagem' : 'Salvar decisão'"), 'CTA deve refletir o estado da comunicação.');
ok(!/bodyObserver\s*=\s*new MutationObserver/.test(v25), 'V25 não pode observar o body inteiro.');
ok(!/reviewCommunicationV25|review-communication-v25/.test(v25 + v25Css), 'Código morto da comunicação V25 deve ser removido.');
ok(!/V23Clone|drafts:new Map/.test(v23), 'Filtros não devem depender de controles invisíveis clonados.');
ok(!html.includes('candidateKanbanContainer') && !html.includes('candidateKpiAdmission'), 'Elementos removidos da V26 não podem ficar escondidos no HTML.');
ok(!/new MutationObserver/.test(js), 'V26 não deve usar MutationObserver.');
ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'V26 deve reutilizar tokens V24, sem hardcodes de cor.');
ok(css.includes('@media (max-width: 640px)') && css.includes('html:not([data-theme="dark"])'), 'V26 deve contemplar mobile e light mode.');

console.log('V26: seleção/exportação ADMIN, drawer, Revisões sem mensagem por padrão e tokens V24 validados.');
