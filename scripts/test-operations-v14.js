'use strict';

const assert = require('node:assert/strict');
const { classifyInboundReply, personalizeTemplate, nextBusinessTime } = require('../lib/operations-v14');

assert.equal(classifyInboundReply('Olá, sim. Eu sou o responsável pelo RH.').type, 'HUMANA');
assert.equal(classifyInboundReply('Agradecemos o seu contato. Estamos fora do nosso horário de atendimento e responderemos em breve.').type, 'AUTOMATICA');
assert.equal(classifyInboundReply('Digite 1 para vendas ou 2 para atendimento').type, 'AUTOMATICA');
assert.equal(classifyInboundReply('Mensagem automática: recebemos sua mensagem e responderemos em breve.').type, 'AUTOMATICA');
assert.equal(classifyInboundReply('Aguarde um instante para ser atendido.').type, 'AUTOMATICA');
assert.equal(classifyInboundReply('Por favor, não envie mais mensagens para este número.').type, 'DESCADASTRO');
assert.equal(classifyInboundReply('').type, 'VAZIA');

assert.equal(
  personalizeTemplate('Olá {empresa}, aqui é {nome_sdr}. Atendemos {cidade}.', { empresa_nome: 'Acme', cidade: 'Campinas' }, 'Joana'),
  'Olá Acme, aqui é Joana. Atendemos Campinas.',
);

const saturday = new Date('2026-08-08T15:00:00.000Z');
const next = nextBusinessTime(saturday);
const local = new Date(next.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
assert.equal(local.getDay(), 1);
assert.equal(local.getHours(), 9);
assert.equal(local.getMinutes(), 0);

console.log('Testes V14 concluídos: classificação de respostas, descadastro, personalização e janela comercial.');
