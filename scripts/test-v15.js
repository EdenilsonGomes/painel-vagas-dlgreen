'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const checkSyntax = (file) => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file}: ${result.stderr || result.stdout}`);
};

const required = [
  'lib/atendimento-v15.js',
  'public/atendimento-v15.js',
  'public/atendimento-v15.css',
  'sql/26_GENESIS_IA_ATENDIMENTO_HUMANO_ENTREVISTAS_V15.sql',
  'scripts/migrate-v15.js',
  'scripts/preflight-v15.js',
];
for (const file of required) assert(fs.existsSync(path.join(root, file)), `Arquivo ausente: ${file}`);

[
  'server.js', 'lib/atendimento-v15.js', 'public/app.js', 'public/atendimento-v15.js',
  'admin-v6.js', 'public/admin.js', 'scripts/migrate-v15.js', 'scripts/preflight-v15.js',
].forEach(checkSyntax);

const server = read('server.js');
for (const token of [
  'registerAtendimentoV15', 'ENTREVISTA_GESTAO_WEBHOOK_URL', 'ALERTAS_ADMIN_ENABLED',
  'candidato_dados_historico', 'candidato_estado_historico',
]) assert(server.includes(token), `Integração ausente no backend: ${token}`);

const moduleCode = read('lib/atendimento-v15.js');
for (const token of [
  "const finalMessage=`#${author}: ${content}`",
  "ON CONFLICT(client_message_id) DO NOTHING",
  "atendimento_humano_ativo=TRUE",
  "ia_atendimento_ativo=FALSE",
  "CORRIGIR_E_CONTINUAR",
  "SOMENTE_CORRECAO",
  "processOperationalNotification",
  "/api/atendimento/entrevistas/:id/reagendar",
]) assert(moduleCode.includes(token), `Módulo V15 sem proteção obrigatória: ${token}`);

const html = read('public/index.html');
for (const id of [
  'candidateConversation', 'candidateChatComposer', 'assumeCandidateChatButton',
  'returnCandidateChatButton', 'editCandidateDataButton', 'candidateInterviewManagement',
  'continueCandidateButton', 'candidateCorrectionPreview',
]) assert(html.includes(`id="${id}"`), `Interface V15 sem #${id}`);
assert(!html.includes('id="candidateWhatsappLink"'), 'O botão antigo de WhatsApp ainda existe no candidato.');
assert(!html.includes('id="candidateOpenWhatsappButton"'), 'O botão antigo Abrir WhatsApp ainda existe no drawer.');
assert(/\/atendimento-v15\.js\?v=\d+/.test(html), 'Asset JS de atendimento não está versionado.');
assert(/\/atendimento-v15\.css\?v=\d+/.test(html), 'Asset CSS de atendimento não está versionado.');

const app = read('public/app.js');
for (const token of [
  'data-candidate-row', "updateCandidate('SOMENTE_CORRECAO')",
  "updateCandidate('CORRIGIR_E_CONTINUAR')", 'GenesisAtendimentoV15?.candidateLoaded',
]) assert(app.includes(token), `Frontend principal sem integração V15: ${token}`);
assert(!/data-candidate-action="whatsapp"/.test(app), 'Ação antiga de WhatsApp ainda está na lista de candidatos.');

const chat = read('public/atendimento-v15.js');
for (const token of [
  'POLL_INTERVAL_MS = 5000', 'Assumir atendimento', 'Finalizar atendimento',
  'client_message_id', 'Editar dados do candidato', 'Propor novo horário',
]) assert(chat.includes(token), `Chat UI sem comportamento obrigatório: ${token}`);

const sql = read('sql/26_GENESIS_IA_ATENDIMENTO_HUMANO_ENTREVISTAS_V15.sql');
for (const token of [
  'genesis_v15_controle_entrada', 'entrevista_reagendamentos', 'entrevista_acao_tokens',
  'notificacoes_operacionais', 'trg_genesis_v15_entrevista_alerta',
  'trg_genesis_v15_revisao_alerta', 'atendimento_humano_ativo',
  "status='AGENDADA'", 'mensagens_client_message_id_uidx',
]) assert(sql.includes(token), `Migration V15 sem ${token}`);
assert(!/DROP\s+(TABLE|SCHEMA|DATABASE)/i.test(sql), 'Migration V15 contém operação destrutiva.');
assert((sql.match(/\$\$/g) || []).length % 2 === 0, 'Migration V15 possui dollar-quotes desbalanceados.');
assert(sql.includes('BEGIN;') && sql.includes('COMMIT;'), 'Migration V15 não está transacional.');

const pkg = JSON.parse(read('package.json'));
assert(Number(pkg.version.split('.')[0]) >= 15, 'Painel precisa preservar os recursos da V15.');
for (const command of ['migrate:v15', 'preflight:v15', 'test:v15']) assert(pkg.scripts[command], `Script ausente: ${command}`);

console.log('Validação estática Genesis IA V15 aprovada: pausa real, chat humano, correções, alertas e reagendamento estão presentes.');
