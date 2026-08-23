'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ok = (value, message) => { if (!value) throw new Error(message); };

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/genesis-v31-consolidation.css');
const server = read('server.js');
const operations = read('lib/operations-v14.js');
const portal = read('portal-publicacoes.js');
const portalUi = read('public/portal-publicacoes.js');

ok(html.includes('data-view="sales"') && (html.match(/data-view="sales"/g) || []).length === 1, 'Sales deve ser a única entrada comercial.');
ok(html.includes('>Configurações</b>') && html.includes('>Saúde do sistema</b>'), 'Administração consolidada ausente.');
ok(html.includes('data-go-view="users"') && html.includes('data-go-view="audit"') && html.includes('data-go-view="documents"'), 'Subnavegação administrativa ausente.');
ok(!/view-(crm|prospecting|commercialChats|divulgacao|demos)/.test(html), 'Telas legadas continuam no HTML.');
ok(!/dashboardJourney|dashboard-command-layout/.test(html), 'Bloco redundante continua na Visão geral.');
ok(html.includes('id="dashboardPerformanceChart"') && html.includes('id="dashboardVacancyAttentionList"'), 'Análises da Visão geral ausentes.');
ok(html.includes('data-dashboard-period="7D"') && html.includes('data-dashboard-period="30D"'), 'Alternância de período da Visão geral ausente.');
ok(app.includes("dashboardPeriod: '30D'") && app.includes('drawDashboardPerformanceChart'), 'Comportamento analítico da Visão geral ausente.');
ok(server.includes('vagas_atencao:') && server.includes('candidaturas_periodo_anterior'), 'API da Visão geral não entrega análises e saúde das vagas.');
ok(app.includes("const legacyViewRedirects = { crm: 'sales'") && app.includes("divulgacao: 'vacancies'"), 'Links antigos devem redirecionar com segurança.');
ok(!/Genesis(?:Demos|CRM|Divulgacao|Prospecting)|loadCommercialChats/.test(app), 'Carregadores legados continuam ativos.');
ok(!/waha|qrcode|session\/qr|outreach|prospeccao/i.test(operations), 'Automação comercial WAHA continua no módulo operacional.');
ok(!/registerDemosV13|registerDivulgacaoV1/.test(server), 'Servidor ainda registra produtos removidos.');
ok(!/portal-publicacoes\/grupos|groupsEnabled/i.test(portal + portalUi), 'Portal de Grupos continua registrado.');
ok(css.includes('100dvh') && css.includes('overflow-x: hidden') && css.includes('@media (max-width: 720px)'), 'Contrato responsivo global incompleto.');
ok(css.includes('.admin-section-tabs') && css.includes('dialog.modal'), 'Configurações e modais não receberam cobertura responsiva.');
ok(css.includes('.dashboard-performance-panel') && css.includes('.dashboard-vacancy-attention-row'), 'Layout responsivo das análises da Visão geral ausente.');
ok((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, 'CSS V31 desbalanceado.');

console.log('V31: navegação consolidada, legado removido e cobertura responsiva global validados.');
