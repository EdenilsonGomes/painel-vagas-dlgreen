'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflowV1File = 'n8n/Genesis-IA-Chatbot-Estatico-V1-Credenciais-Preservadas.json';
const workflowV13File = 'n8n/Genesis-IA-Chatbot-Hibrido-V13-Credenciais-Preservadas.json';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  assert(result.status === 0, `${file}: ${result.stderr || result.stdout}`);
}

function checkHtmlIds(file) {
  const html = read(file);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(duplicates.length === 0, `${file}: IDs duplicados: ${duplicates.join(', ')}`);
  return html;
}

function checkCss(file, requiredTokens = []) {
  const css = read(file);
  assert((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, `${file}: blocos desbalanceados.`);
  for (const token of requiredTokens) assert(css.includes(token), `${file}: estilo obrigatório ausente (${token}).`);
}

function credentialIds(workflow) {
  return new Set(workflow.nodes.flatMap((node) => Object.values(node.credentials || {}).map((credential) => credential.id)).filter(Boolean));
}

function validateWorkflow() {
  const workflowDir = path.join(root, 'n8n');
  if (!fs.existsSync(workflowDir)) {
    console.log('Validação do workflow ignorada no contêiner de produção: exports n8n ficam fora da imagem por segurança.');
    return;
  }
  const original = JSON.parse(read(workflowV1File));
  const workflow = JSON.parse(read(workflowV13File));
  const names = workflow.nodes.map((node) => node.name);
  const ids = workflow.nodes.map((node) => node.id);
  assert(new Set(names).size === names.length, 'Workflow V13 possui nomes de nós duplicados.');
  assert(new Set(ids).size === ids.length, 'Workflow V13 possui IDs de nós duplicados.');
  assert(workflow.active === false, 'Workflow V13 deve ser importado inativo para troca segura.');
  assert(names.length >= 60, 'Workflow V13 parece incompleto.');

  const requiredNodes = [
    'Webhook Chatbot Estático V1', 'Normalizar entrada', 'É áudio?', 'Baixar áudio do WAHA',
    'Validar áudio recebido', 'Transcrever áudio em português', 'Preparar interpretação V13',
    'Precisa interpretação da IA?', 'Interpretar resposta dentro das opções',
    'Normalizar interpretação segura', 'Processar conversa V13', 'Responder mídia não suportada',
  ];
  for (const name of requiredNodes) assert(names.includes(name), `Workflow V13 sem o nó ${name}.`);

  const nameSet = new Set(names);
  for (const [source, connection] of Object.entries(workflow.connections || {})) {
    assert(nameSet.has(source), `Workflow V13 possui conexão de origem inexistente: ${source}.`);
    for (const branches of Object.values(connection || {})) {
      for (const branch of branches || []) {
        for (const target of branch || []) assert(nameSet.has(target.node), `Conexão inválida: ${source} -> ${target.node}.`);
      }
    }
  }

  const originalWebhook = original.nodes.find((node) => node.type === 'n8n-nodes-base.webhook');
  const v13Webhook = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.webhook');
  assert(originalWebhook?.parameters?.path === v13Webhook?.parameters?.path, 'O caminho do webhook existente não foi preservado.');
  const originalCredentials = credentialIds(original);
  const v13Credentials = credentialIds(workflow);
  for (const id of originalCredentials) assert(v13Credentials.has(id), `A credencial existente ${id} deixou de ser referenciada.`);

  const serialized = JSON.stringify(workflow);
  for (const token of [
    'genesis_chatbot_v13_processar_texto', 'genesis_chatbot_v13_buffer_registrar',
    'genesis_chatbot_v13_preparar_interpretacao', "language\":\"pt", '25*1024*1024',
    "demoSession && (mime === 'application/pdf'", 'MIDIA_NAO_SUPORTADA',
  ]) assert(serialized.includes(token), `Proteção do workflow ausente: ${token}.`);
  assert(!workflow.nodes.some((node) => /analisar imagem|interpretar imagem/i.test(node.name)), 'Interpretação de imagens não deve estar ativa.');
}

[
  'server.js', 'portal-publicacoes.js', 'admin-v6.js', 'lib/security.js',
  'lib/screening-v13.js', 'lib/demos-v13.js',
  'public/app.js', 'public/admin.js', 'public/login.js', 'public/portal-publicacoes.js',
  'public/theme-init.js', 'public/screening-v13.js', 'public/demos-v13.js', 'public/demo-client.js',
  'scripts/db-config.js', 'scripts/migrate-panel.js', 'scripts/preflight.js',
  'scripts/test-portal-moderation.js', 'scripts/build-chatbot-v13.js',
].forEach(checkSyntax);

const html = checkHtmlIds('public/index.html');
const demoHtml = checkHtmlIds('public/demo.html');
for (const token of [
  'themeToggleButton', 'vacancyForm', 'candidateConversation', 'modern-v13.css',
  'view-demos', 'demoCreateForm', 'screeningQuestionsBuilder', 'candidateScreeningSection',
]) assert(html.includes(token), `HTML principal sem ${token}.`);
for (const token of ['demoConnectButton', 'demoQrImage', 'demoDisconnectButton', 'CTPS e currículo permanecem restritos a PDF']) {
  assert(demoHtml.includes(token), `Guia público da demonstração sem ${token}.`);
}
assert(!/\?v=(?:800|1200|1300)(?:["'])/.test(html), 'Assets antigos ainda estão referenciados no HTML principal.');

checkCss('public/modern-v12.css', ['group-moderation-workspace', 'candidate-conversation']);
checkCss('public/modern-v13.css', ['screening-question-card', 'demo-admin-grid', '@media']);
checkCss('public/demo.css', ['demo-activation-grid', 'demo-qr-frame', '@media']);

const server = read('server.js');
for (const token of [
  'registerDemosV13', 'registerScreeningV13', 'DEMO_CHATBOT_WEBHOOK_URL',
  'publicar_portal', 'PORTAL_IMAGE_ORIGIN', 'GRUPOS_STATUS_LEGADO',
]) assert(server.includes(token), `Backend sem ${token}.`);

const demos = read('lib/demos-v13.js');
for (const token of [
  "app.get('/demo.css'", "app.get('/demo-client.js'", "app.get('/assets/brand/genesis-mark.svg'",
  "wahaRequest('/api/sessions'", "wahaRequest('/api/sessions/start'", "mappedDemoStatus",
  'demos: result.rows.map(adminDemo)', 'demo: adminDemo(demo)', 'token_hash: _tokenHash',
]) assert(demos.includes(token), `Módulo de demonstrações sem proteção esperada: ${token}.`);

const screening = read('lib/screening-v13.js');
for (const token of ['Perguntas abertas não podem eliminar automaticamente', "max(30", 'vaga_triagem_versoes', 'PERGUNTAS_VAGA_ATUALIZADAS']) {
  assert(screening.includes(token), `API de triagem incompleta: ${token}.`);
}

const migration = read('sql/18_GENESIS_IA_V13_TRIAGEM_CONVERSACIONAL_DEMOS.sql');
for (const token of [
  'vaga_triagem_versoes', 'candidato_respostas_triagem', 'genesis_demos', 'genesis_demo_contatos',
  'genesis_chatbot_v13_processar_texto', 'genesis_v13_multiplas_opcoes',
  'PAUSADO_ATENDIMENTO_HUMANO', 'Fotos e capturas de tela não são aceitas',
  "PRIMARY KEY (session, telefone)", 'MIGRAÇÃO',
]) assert(migration.toUpperCase().includes(token.toUpperCase()), `Migração V13 incompleta: ${token}.`);
assert(!migration.includes("'^(2|NAO|N|NAO TENHO"), 'A regra ampla que confundia “não entendi” com “não” reapareceu.');

const envExample = read('.env.example');
for (const token of ['WAHA_BASE_URL=', 'WAHA_API_KEY=', 'DEMO_CHATBOT_WEBHOOK_URL=', 'DEMO_TRIAL_DAYS=7']) {
  assert(envExample.includes(token), `.env.example sem ${token}.`);
}

const packageJson = JSON.parse(read('package.json'));
assert(packageJson.version === '13.0.0', 'A versão do pacote deve ser 13.0.0.');
assert(packageJson.scripts['migrate:panel'] && packageJson.scripts.preflight, 'Scripts de deploy V13 ausentes.');

if (fs.existsSync(path.join(root, 'n8n'))) {
  for (const file of fs.readdirSync(path.join(root, 'n8n')).filter((name) => name.endsWith('.json'))) JSON.parse(read(`n8n/${file}`));
}
validateWorkflow();

console.log('Validação V13 concluída: painel, triagem, demonstrações, PDF, áudio e workflow estão consistentes.');
