'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');const releaseRoot=path.resolve(root,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');const ok=(c,m)=>{if(!c)throw new Error(m)};
function syntax(f){const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});ok(r.status===0,`${f}: ${r.stderr||r.stdout}`)}
['server.js','lib/atendimento-v15.js','public/atendimento-v15.js','scripts/migrate-v16_1.js','scripts/preflight-v16_1.js'].forEach(f=>{ok(fs.existsSync(path.join(root,f)),`Arquivo ausente: ${f}`);syntax(f)});
const pkg=JSON.parse(read('package.json'));ok(pkg.version==='16.1.0','Painel precisa estar na versão 16.1.0.');
const server=read('server.js'),at=read('lib/atendimento-v15.js'),html=read('public/index.html'),ui=read('public/atendimento-v15.js'),sql=read('sql/28_GENESIS_IA_V16_1_LINKS_MEET_REAGENDAMENTO.sql');
['normalizePublicHttpUrl','PANEL_URL_ENV'].forEach(x=>ok(server.includes(x),`server.js sem ${x}`));
['PANEL_URL inválido ou ausente','/e/:token','LISTAR_OPCOES_REAGENDAMENTO','/opcoes-reagendamento','Esse horário não está mais disponível'].forEach(x=>ok(at.includes(x),`atendimento-v15 sem ${x}`));
ok(html.indexOf('candidateInterviewManagement') < html.indexOf('drawer-tab-admin'),'Gestão de entrevista continua presa à aba Administração; recrutador não teria acesso pelo painel.');
['candidateRescheduleSlotsV15','loadRescheduleOptions','Disponível no Google Calendar'].forEach(x=>ok(ui.includes(x),`UI reagendamento sem ${x}`));
['meet_access_type','GEN_RANDOM_BYTES(16)',"'{{PANEL_URL}}/e/'"].forEach(x=>ok(sql.includes(x),`Migration 28 sem ${x}`));
ok(!/DROP\s+(TABLE|SCHEMA|DATABASE)/i.test(sql),'Migration 28 contém DROP destrutivo.');

function checkWorkflow(file, required){const full=path.join(releaseRoot,'n8n',file);ok(fs.existsSync(full),`Workflow ausente: ${file}`);const wf=JSON.parse(fs.readFileSync(full,'utf8'));const names=new Set();for(const n of wf.nodes||[]){ok(!names.has(n.name),`${file}: node duplicado ${n.name}`);names.add(n.name);if(n.type==='n8n-nodes-base.code'&&n.parameters?.jsCode){try{new Function(n.parameters.jsCode)}catch(e){throw new Error(`${file}: JS inválido em ${n.name}: ${e.message}`)}}}for(const [src,group] of Object.entries(wf.connections||{})){ok(names.has(src),`${file}: conexão parte de node ausente ${src}`);for(const outputs of Object.values(group||{}))for(const branch of outputs||[])for(const edge of branch||[])ok(names.has(edge.node),`${file}: conexão para node ausente ${edge.node}`)}const text=JSON.stringify(wf);for(const x of required)ok(text.includes(x),`${file} sem ${x}`);return wf;}
checkWorkflow('Genesis-IA-Gestao-Reagendamento-V15.json',['LISTAR_OPCOES_REAGENDAMENTO','Buscar compromissos para reagendamento','Calcular opções do reagendamento','Responder horários livres']);
const meet=checkWorkflow('Genesis-IA-Entrevistas-Google-Meet-V15-Alertas-Administradores.json',['meet.googleapis.com/v2/spaces','config.accessType','OPEN','googleCalendarOAuth2Api','meet_access_type']);
const openNode=(meet.nodes||[]).find(n=>n.name==='Deixar Google Meet aberto');ok(openNode?.parameters?.method==='PATCH','Node de Meet aberto não usa PATCH.');
console.log('Genesis IA V16.1: links robustos, Meet OPEN e reagendamento por horários livres validados estaticamente.');
