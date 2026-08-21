'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const conversationButton = html.match(/<button[^>]*data-drawer-quick-tab="conversation"[^>]*>/)?.[0] || '';
const documentsButton = html.match(/<button[^>]*data-drawer-quick-tab="documents"[^>]*>/)?.[0] || '';
const documentsSection = html.match(/<section[^>]*id="drawer-tab-documents"[^>]*>/)?.[0] || '';
const timelineButton = html.match(/<button[^>]*data-drawer-quick-tab="timeline"[^>]*>/)?.[0] || '';
const adminButton = html.match(/<button[^>]*data-drawer-quick-tab="admin"[^>]*>/)?.[0] || '';

assert(conversationButton && !conversationButton.includes('data-admin-only'), 'Conversa deve ficar disponível para RECRUTADOR.');
assert(documentsButton && !documentsButton.includes('data-admin-only') && !documentsButton.includes('class="hidden"'), 'A aba Documentos deve ficar disponível para RECRUTADOR.');
assert(documentsSection && !documentsSection.includes('data-admin-only'), 'O conteúdo de Documentos deve ficar disponível para RECRUTADOR.');
assert(timelineButton.includes('data-admin-only'), 'Histórico deve continuar exclusivo de ADMIN.');
assert(adminButton.includes('data-admin-only'), 'Administração deve continuar exclusiva de ADMIN.');
assert(!css.includes('body[data-user-role="RECRUTADOR"] .drawer-tabs { display: none; }'), 'CSS não pode esconder as abas do recrutador.');
assert(/FROM documentos\s+WHERE candidato_id = \$1\s+ORDER BY created_at DESC, id DESC\s+LIMIT 200/.test(server), 'Detalhes do candidato devem carregar todos os documentos para usuário autenticado.');
assert(!server.includes("Este documento está disponível somente para administradores."), 'Download de documentos não deve bloquear RECRUTADOR por tipo.');

console.log('V15.1: RECRUTADOR possui Resumo + Conversa/Chat UI + Documentos; Histórico/Administração permanecem restritos.');
