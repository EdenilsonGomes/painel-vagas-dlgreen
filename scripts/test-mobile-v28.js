'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ok = (value, message) => { if (!value) throw new Error(message); };

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/genesis-v28-mobile.css');

for (const legacy of ['dashboard-funnel-panel', 'dashboard-attention-panel', 'dashboard-agenda-panel', 'dashboardFunnel', 'dashboardAttention', 'dashboardInterviewCalendar']) {
  ok(!html.includes(legacy), `Bloco redundante ainda existe no HTML: ${legacy}`);
  ok(!app.includes(legacy), `Código morto do dashboard ainda existe: ${legacy}`);
}
ok(!app.includes('dashboardAttentionMeta') && !app.includes('renderDashboardMiniCalendar'), 'Renderizadores removidos da Visão geral ainda existem.');
ok(app.includes("state.calendarMode = 'LIST'") && app.includes("matchMedia('(max-width: 760px)')"), 'Agenda deve iniciar em lista no celular.');
ok(html.lastIndexOf('genesis-v28-mobile.css') > html.lastIndexOf('genesis-v27.css'), 'A camada mobile V28 precisa ser a última folha de estilo.');
ok((html.match(/experience-v23\.css/g) || []).length === 1 && (html.match(/experience-v23\.js/g) || []).length === 1, 'Assets V23 duplicados.');
ok(css.includes('@media (max-width: 760px)') && css.includes('100dvh') && css.includes('overflow-x: clip'), 'Proteções mobile centrais ausentes.');
ok(css.includes('dialog.modal[open]') && css.includes('.candidate-filters-popover') && css.includes('#candidateDrawer[open]'), 'Modais, filtros e drawer não foram cobertos.');
ok(css.includes('data-active-view="atendimentos"') && css.includes('data-active-view="reviews"'), 'Workspaces de rolagem interna não foram cobertos.');
ok(css.includes('.calendar-controls') && css.includes('.document-file-row') && css.includes('.audit-filters') && css.includes('.portal-job-facts'), 'Páginas operacionais não receberam cobertura mobile completa.');
ok(css.includes('min-height: 44px') && !/#[0-9a-f]{3,8}\b/i.test(css), 'Alvos de toque ou uso dos tokens visuais divergente.');
ok(!css.includes('MutationObserver'), 'V28 não deve usar observadores amplos.');
console.log('V28: Visão geral simplificada e cobertura mobile transversal validadas.');
