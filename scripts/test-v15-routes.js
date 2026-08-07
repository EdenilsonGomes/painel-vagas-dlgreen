'use strict';
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return { urlencoded: () => (_req, _res, next) => next?.() };
  return originalLoad.call(this, request, parent, isMain);
};
const { registerAtendimentoV15 } = require('../lib/atendimento-v15');
const routes = [];
const app = {
  get(path, ...handlers) { routes.push(['GET', path, handlers.length]); },
  post(path, ...handlers) { routes.push(['POST', path, handlers.length]); },
  patch(path, ...handlers) { routes.push(['PATCH', path, handlers.length]); },
  use(path, ...handlers) { routes.push(['USE', path, handlers.length]); },
};
const noop = (_req, _res, next) => next?.();
registerAtendimentoV15({
  app,
  pool: {},
  requireLogin: noop,
  requireAdmin: noop,
  currentUserName: () => 'Teste',
  wahaBaseUrl: '',
  wahaApiKey: '',
  chatbotSession: 'whats_junior',
  panelBaseUrl: 'https://painel.example',
  triggerManualCandidateMessage: async () => ({ enviado: true }),
  buildManualContinuationMessage: () => 'Mensagem prevista',
  entrevistaGestaoWebhookUrl: '',
  entrevistaGestaoWebhookToken: '',
  alertasAdminEnabled: false,
});
const expected = [
  ['GET','/entrevistas/acao/:token'],
  ['POST','/api/public/entrevistas/acao/:token/confirmar'],
  ['POST','/api/public/entrevistas/acao/:token/reagendar'],
  ['GET','/api/atendimento/candidatos/:id/conversa'],
  ['POST','/api/atendimento/candidatos/:id/assumir'],
  ['POST','/api/atendimento/candidatos/:id/devolver'],
  ['POST','/api/atendimento/candidatos/:id/mensagens'],
  ['PATCH','/api/atendimento/candidatos/:id/dados'],
  ['GET','/api/atendimento/candidatos/:id/correcao/preview'],
  ['POST','/api/atendimento/candidatos/:id/correcao'],
  ['POST','/api/atendimento/entrevistas/:id/confirmar'],
  ['POST','/api/atendimento/entrevistas/:id/reagendar'],
];
for (const [method,path] of expected) {
  if (!routes.some((r) => r[0] === method && r[1] === path)) throw new Error(`Rota ausente: ${method} ${path}`);
}
console.log(`Registro de rotas V15 aprovado: ${expected.length} rotas funcionais.`);
