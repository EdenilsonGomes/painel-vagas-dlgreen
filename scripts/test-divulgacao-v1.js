'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const required = [
  'lib/divulgacao-v1.js',
  'public/divulgacao-v1.js',
  'public/divulgacao-v1.css',
  'sql/25_GENESIS_IA_CENTRAL_DIVULGACAO_V1.sql',
  'scripts/migrate-divulgacao-v1.js',
  'scripts/preflight-divulgacao-v1.js',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Arquivo ausente: ${file}`);
}

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const marker of ['data-view="divulgacao"', 'id="view-divulgacao"', '/divulgacao-v1.js', '/divulgacao-v1.css']) {
  if (!html.includes(marker)) throw new Error(`Integração visual ausente: ${marker}`);
}

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
if (!server.includes('registerDivulgacaoV1')) throw new Error('Backend não registrado.');
if (server.indexOf('app.use(requireLogin)') > server.indexOf('registerDivulgacaoV1({')) {
  throw new Error('As rotas da Central precisam permanecer depois da autenticação do painel.');
}
if (!server.includes('divulgacaoSession: DIVULGACAO_WAHA_SESSION')) {
  throw new Error('A Central não está isolada em DIVULGACAO_WAHA_SESSION.');
}

const backend = fs.readFileSync(path.join(root, 'lib/divulgacao-v1.js'), 'utf8');
for (const marker of ['FOR UPDATE OF d SKIP LOCKED', "status='ENVIANDO'", 'DIVULGACAO_WHATSAPP_AUTOMATICO', "modo_envio='AUTOMATICO'", 'Retomado após interrupção']) {
  if (!backend.includes(marker)) throw new Error(`Proteção da fila ausente: ${marker}`);
}
if (backend.includes('CHATBOT_WAHA_SESSION')) throw new Error('O módulo de divulgação não pode depender da sessão do chatbot.');

const frontend = fs.readFileSync(path.join(root, 'public/divulgacao-v1.js'), 'utf8');
for (const marker of ['Fazer onboarding', 'Importar e continuar', 'Sincronizar grupos', 'Concluir onboarding']) {
  if (!frontend.includes(marker)) throw new Error(`Onboarding incompleto: ${marker}`);
}
for (const marker of ['divulgacao-channel-overview', 'Precisa publicar', 'Aguardando aprovação', 'destination-history', 'status-publicado', 'status-falha']) {
  if (!frontend.includes(marker) && !fs.readFileSync(path.join(root, 'public/divulgacao-v1.css'), 'utf8').includes(marker)) throw new Error(`Organização visual da divulgação ausente: ${marker}`);
}
if (frontend.includes('<section class="divulgacao-hero">')) throw new Error('Cabeçalho promocional antigo ainda ocupa o topo da Central.');
if (/on(?:click|submit|change|input)="/i.test(frontend)) throw new Error('Handler HTML inline incompatível com CSP.');

const sql = fs.readFileSync(path.join(root, 'sql/25_GENESIS_IA_CENTRAL_DIVULGACAO_V1.sql'), 'utf8');
for (const table of ['divulgacao_configuracoes', 'divulgacao_grupos', 'divulgacao_campanhas', 'divulgacao_campanha_destinos', 'divulgacao_cliques']) {
  if (!sql.includes(table)) throw new Error(`Tabela ausente: ${table}`);
}
for (const protectedTable of ['candidatos', 'mensagens', 'documentos', 'eventos', 'entrevistas']) {
  const destructive = new RegExp(`(?:ALTER|DROP|TRUNCATE|DELETE\\s+FROM)\\s+(?:TABLE\\s+)?(?:public\\.)?${protectedTable}\\b`, 'i');
  if (destructive.test(sql)) throw new Error(`A migration não pode modificar ${protectedTable}.`);
}

console.log('Validação estática da Central de Divulgação V1 aprovada.');
