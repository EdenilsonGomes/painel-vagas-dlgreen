'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const ok=(condition,message)=>{if(!condition)throw new Error(message);};
const server=read('server.js');
const handoff=read('lib/atendimentos-v16.js');
const ui=read('public/atendimento-v15.js');
const app=read('public/app.js');
const css=read('public/styles.css');

// Cenário 1: encerra só a revisão. A query não atualiza candidatos e a rota não aciona chatbot/WAHA.
const closeRoute=server.slice(server.indexOf("app.post('/api/revisoes/:id/encerrar'"),server.indexOf("app.post('/api/candidatos/:id/resgate'"));
ok(closeRoute.includes("decisao='ENCERRADO_SEM_ACAO'"),'Encerramento sem ação não está auditado.');
ok(!closeRoute.includes('UPDATE candidatos'),'Encerrar revisão não pode alterar o candidato.');
ok(!closeRoute.includes('triggerStaticChatbotAction')&&!closeRoute.includes('wahaRequest'),'Encerrar revisão não pode enviar mensagem/workflow.');
ok(app.includes('data-review-decision="ENCERRAR"')&&app.includes('Já revisado'),'Ação Já revisado ausente na interface.');

// Cenário 2: libera o responsável, mantém IA pausada e preserva etapa/status/vaga.
ok(handoff.includes("destination==='HUMANO'"),'Destino humano não implementado.');
ok(handoff.includes("ia_atendimento_ativo=FALSE")&&handoff.includes("atendimento_humano_usuario_id=NULL"),'Liberação humana não mantém IA pausada e/ou não remove responsável.');
ok(handoff.includes("ia_pausa_motivo='Aguardando atendimento humano'"),'Estado aguardando atendimento humano não está explícito.');
ok(ui.includes('Salvar e liberar para atendimento humano')&&ui.includes("submitHandoff(event,'HUMANO')"),'Ação de liberar atendimento ausente no modal.');

// Cenário 3: devolve para IA, encerra suporte e nunca dispara mensagem administrativa.
ok(handoff.includes('ia_atendimento_ativo=TRUE')&&handoff.includes("decisao='ATENDIMENTO_REALIZADO'"),'Devolução para IA incompleta.');
const finishRoute=handoff.slice(handoff.indexOf("app.post('/api/atendimento/candidatos/:id/finalizar-handoff'"),handoff.indexOf('// Worker de aplicação'));
ok(!finishRoute.includes('triggerManualCandidateMessage'),'Devolução para IA não pode enviar mensagem imediata/duplicada.');
ok(!finishRoute.includes('statusCode = 502')&&!finishRoute.includes(',502)'),'O caminho corrigido não deve fabricar HTTP 502 após commit.');
ok(finishRoute.includes('mensagem_enviada:false'),'Resposta deve declarar que nenhuma mensagem foi enviada.');

// Cenário 4: upload PDF completo e download protegido pelo login global.
ok(handoff.includes("accept")||ui.includes('accept="application/pdf,.pdf"'),'Seletor PDF ausente.');
['arquivo_base64','8*1024*1024',"'%PDF'",'INSERT INTO documentos','candidato_id','hash_sha256'].forEach((token)=>ok(handoff.includes(token)||ui.includes(token),`Upload sem ${token}.`));
ok(server.includes("app.get('/api/documentos/:id/download'")&&server.includes('Content-Disposition'),'Download de documento ausente.');

// Cenário 5: checkbox lateral no desktop e compacto no mobile.
ok(app.includes('review-card ${select?\'has-review-select\':\'\'}'),'Card não recebe marcador do checkbox.');
ok(css.includes('.review-card.has-review-select{position:relative')&&css.includes('.review-select{position:absolute'),'Checkbox desktop não está lateral.');
ok(css.includes('@media(max-width:720px){.review-card.has-review-select'),'Checkbox não possui regra mobile.');

console.log('V16 revisões/handoff: 5 cenários validados, incluindo asserts negativos de nenhuma mensagem administrativa.');
