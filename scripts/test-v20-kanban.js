'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const api=read('lib/prospecting-v20.js'),ui=read('public/prospecting-v20.js'),html=read('public/index.html'),css=read('public/prospecting-v20.css'),admin=read('admin-v6.js');
for(const stage of ['NOVO_LEAD','CONTATADO','RESPONDEU','QUALIFICADO','DEMONSTRACAO','PROPOSTA','NEGOCIACAO','GANHO','PERDIDO']){assert.match(api,new RegExp(stage));assert.match(ui,new RegExp(stage));}
assert.match(api,/etapa-crm',requireAdmin/);assert.match(api,/detalhes-v20',requireAdmin/);assert.match(api,/preparar-mensagem',requireAdmin/);
assert.match(api,/INSERT INTO crm_interacoes/);assert.match(api,/UPDATE crm_oportunidades SET etapa/);assert.match(api,/UPDATE prospeccao_leads SET status/);
assert.match(api,/prospeccao_envios/);assert.match(api,/contato_autorizado_origem/);assert.match(api,/FOR UPDATE/);assert.match(api,/BEGIN/);assert.match(api,/ROLLBACK/);
assert.match(admin,/COALESCE\(co\.etapa,'NOVO_LEAD'\) AS crm_etapa/);assert.match(html,/prospectingQueueMode/);assert.match(html,/prospectingKanbanMode/);assert.match(html,/prospectingLeadDialog/);
assert.match(ui,/dataTransfer\.setData/);assert.match(ui,/updateStage/);assert.match(ui,/mensagem_sugerida/);assert.match(ui,/navigator\.clipboard/);assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/overflow-x:auto/);
console.log('V20 Kanban: contratos de UI, CRM, histórico, fila e ADMIN aprovados.');
