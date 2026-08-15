'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const app = read('public/app.js');
const css = read('public/v21-workspace.css');
const server = read('server.js');
const handoff = read('lib/atendimentos-v16.js');

for (const id of ['recruitmentNavGroup', 'conversationsNavGroup', 'commercialNavGroup', 'administrationNavGroup']) {
  assert.match(index, new RegExp(`id="${id}"`), `Navegação contextual ausente: ${id}`);
}

for (const id of ['reviewDetailPane', 'reviewDecisionPane', 'reviewDecisionContent', 'reviewSearchInput']) {
  assert.match(index, new RegExp(`id="${id}"`), `Workspace de revisões incompleto: ${id}`);
}

assert.match(index, /data-mobile-view="reviews"/, 'Revisões não está acessível na navegação mobile.');
assert.match(css, /grid-template-columns:\s*minmax\(290px,\s*330px\)/, 'Layout desktop de três painéis ausente.');
assert.match(css, /data-review-mobile-pane="queue"/, 'Fluxo mobile fila → detalhe → decisão ausente.');
assert.match(css, /grid-template-columns:\s*22px\s+38px/, 'Checkbox não está reservado na lateral da fila.');
assert.doesNotMatch(css, /\.review-queue-check\s*\{[^}]*position:\s*absolute/s, 'Checkbox voltou a usar posicionamento absoluto.');

for (const decision of ['ENCERRAR', 'ATENDER_HUMANO', 'DEVOLVER_IA', 'LIBERAR_EQUIPE', 'APROVAR', 'NAO_APROVAR']) {
  assert.match(app, new RegExp(`${decision}:`), `Impacto explícito ausente para ${decision}.`);
}

assert.match(app, /destino:decision === 'DEVOLVER_IA' \? 'IA' : 'HUMANO'/, 'Handoff não diferencia retorno à IA e liberação para equipe.');
assert.match(app, /Sem mensagem e sem alteração da IA/, 'Ação “Já resolvido” não deixa o impacto claro.');
assert.match(app, /Pode retomar o fluxo e enviar mensagem/, 'Aprovação não avisa sobre possível acionamento do chatbot.');
assert.match(app, /data-document-preview/, 'Documento não abre no visualizador interno do painel.');
assert.match(css, /\.review-document-card/, 'Resumo responsivo do documento ausente no detalhe da revisão.');

assert.match(server, /decisao='ENCERRADO_SEM_ACAO'/, 'Backend não preserva o encerramento sem ação.');
assert.match(server, /mensagem_enviada:false,workflow_disparado:false/, 'Encerramento seguro perdeu as garantias de não envio.');
assert.match(handoff, /if\(!\['IA','HUMANO'\]\.includes\(destination\)\)/, 'Destino do handoff não está validado.');
assert.match(server, /ia_atendimento_ativo,c\.ia_pausada_em,c\.ia_pausa_motivo/, 'API de revisões não informa o estado atual da IA.');

console.log('V21 validado: navegação contextual, workspace responsivo e decisões seguras de revisão.');
