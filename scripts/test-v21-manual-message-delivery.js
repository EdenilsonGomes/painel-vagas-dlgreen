'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const backend = read('lib/atendimento-v15.js');
const queueBackend = read('lib/atendimentos-v16.js');
const drawer = read('public/atendimento-v15.js');
const conversations = read('public/conversations-v16-4.js');
const floating = read('public/floating-chat-v16-3.js');
const server = read('server.js');

const sendRoute = backend.slice(
  backend.indexOf("app.post('/api/atendimento/candidatos/:id/mensagens'"),
  backend.indexOf("app.patch('/api/atendimento/candidatos/:id/dados'"),
);

assert.match(backend, /reconcileStaleManualMessages/, 'Mensagens manuais travadas não são reconciliadas.');
assert.match(backend, /created_at < NOW\(\)-INTERVAL '90 seconds'/, 'A reconciliação pode atingir um envio ainda ativo.');
assert.match(backend, /'reenvio_automatico',FALSE/, 'O backend não registra a proibição de reenvio automático.');
assert.doesNotMatch(
  backend.slice(backend.indexOf('async function reconcileStaleManualMessages'), backend.indexOf('let notificationWorkerBusy')),
  /triggerManualCandidateMessage/,
  'A reconciliação não pode reenviar mensagens antigas.',
);
assert.match(sendRoute, /'ENVIANDO'/, 'Novo envio não usa um estado transitório explícito.');
assert.doesNotMatch(sendRoute, /wahaRequest\('\\/api\\/sendText'/, 'A conversa humana ainda envia diretamente pelo WAHA.');
assert.match(sendRoute, /status_envio='ENVIADA'/, 'Confirmação do workflow não conclui o envio.');
assert.match(sendRoute, /status_envio='FALHA'/, 'Falha do workflow não encerra o envio.');

for (const [name, source, guard] of [
  ['perfil do candidato', drawer, /if \(local\.sendingMessage\) return/],
  ['central de conversas', conversations, /local\.selectedId \|\| local\.sendingMessage/],
  ['chat flutuante', floating, /if\(chat\.sending\)return/],
]) {
  assert.match(source, guard, `Proteção contra envio duplicado ausente em ${name}.`);
}

assert.match(queueBackend, /WHEN c\.atendimento_humano_solicitado IS TRUE THEN 'AGUARDANDO_ATENDIMENTO'/, 'Pedido de ajuda não é priorizado na fila.');
assert.match(queueBackend, /WHEN c\.ia_atendimento_ativo IS FALSE THEN 'IA_PAUSADA'/, 'Pausa da IA continua indistinguível de pedido de ajuda.');
assert.match(floating, /data-gfc-filter="ACAO"/, 'Menu flutuante não separa conversas que exigem ação.');
assert.match(floating, /data-gfc-filter="PAUSADAS"/, 'Menu flutuante não oferece a lista de IAs pausadas.');
assert.match(floating, /Pediu ajuda/, 'Motivo do candidato aparecer na fila não está visível.');
assert.match(floating, /Revisão pendente/, 'Revisões não são identificadas na lista de pausas.');
assert.match(server, /PANEL_RATE_LIMIT_MAX \|\| 2400/, 'Limite padrão continua insuficiente para a atualização normal do painel.');
assert.match(server, /PAINEL_LIMITE_TEMPORARIO/, 'HTTP 429 não possui resposta clara para a interface.');
assert.match(conversations, /POLL_LIST_MS = 30000/, 'Lista de conversas continua atualizando em excesso.');
assert.match(conversations, /activeView==='atendimentos'/, 'Conversas continuam consultando o servidor fora da tela ativa.');
assert.match(floating, /POLL_QUEUE_MS = 30000/, 'Fila flutuante continua atualizando em excesso.');
assert.match(drawer, /POLL_INTERVAL_MS = 8000/, 'Perfil do candidato continua consultando a conversa em excesso.');

console.log('V21 envio manual: estados finais, fila explicada e bloqueio de duplo clique validados.');
