'use strict';

/*
 * Gênesis UI V24 — enriquecimento VISUAL apenas.
 * Não faz chamadas HTTP, não altera estado funcional e não muda regras do sistema.
 * A função deste arquivo é apenas adicionar classes semânticas aos elementos já
 * renderizados para que genesis-v24.css diferencie IA, humano, candidato e estados.
 */
(() => {
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  function classifyCandidateRow(row) {
    if (!(row instanceof HTMLElement)) return;
    row.classList.remove('gx24-success', 'gx24-warning', 'gx24-danger', 'gx24-human');
    const text = normalize(row.innerText);

    if (/REPROV|FALHA|ERRO/.test(text)) row.classList.add('gx24-danger');
    else if (/CONTRATADO|APROVADO NA TRIAGEM/.test(text)) row.classList.add('gx24-success');
    else if (/REVISAO|PENDENTE|AGUARDANDO|PROCESSANDO/.test(text)) row.classList.add('gx24-warning');

    if (/ATENDIMENTO HUMANO|AGUARDANDO RECRUTADOR|HUMANO/.test(text)) {
      row.classList.add('gx24-human');
    }
  }

  function classifyDrawerMessage(message) {
    if (!(message instanceof HTMLElement)) return;
    message.classList.remove('gx24-from-ai', 'gx24-from-human', 'gx24-from-candidate');

    if (message.classList.contains('incoming')) {
      message.classList.add('gx24-from-candidate');
      return;
    }

    const author = normalize(message.querySelector('strong')?.textContent);
    if (/EVELYN|\bIA\b/.test(author)) message.classList.add('gx24-from-ai');
    else message.classList.add('gx24-from-human');
  }

  function classifyCenterMessage(message) {
    if (!(message instanceof HTMLElement)) return;
    message.classList.remove('gx24-from-ai', 'gx24-from-human', 'gx24-from-candidate');

    if (message.classList.contains('incoming')) {
      message.classList.add('gx24-from-candidate');
      return;
    }

    if (message.classList.contains('ai')) {
      message.classList.add('gx24-from-ai');
      return;
    }

    const text = normalize(message.textContent);
    if (/EVELYN|IA GENESIS|IA GÊNESIS/.test(text)) message.classList.add('gx24-from-ai');
    else message.classList.add('gx24-from-human');
  }

  function applySemanticClasses(root = document) {
    root.querySelectorAll?.('#candidatesTableBody tr[data-candidate-row]').forEach(classifyCandidateRow);
    root.querySelectorAll?.('#candidateConversation .conversation-message').forEach(classifyDrawerMessage);
    root.querySelectorAll?.('#allChatsMessages .conversation-center-message').forEach(classifyCenterMessage);
  }

  function start() {
    document.body?.classList.add('genesis-v24');
    document.body?.setAttribute('data-design-system', 'v24');
    applySemanticClasses();

    const targets = [
      document.getElementById('candidatesTableBody'),
      document.getElementById('candidateConversation'),
      document.getElementById('allChatsMessages'),
      document.getElementById('candidateDrawer'),
    ].filter(Boolean);

    if (!targets.length) return;

    const observer = new MutationObserver((mutations) => {
      const roots = new Set();
      mutations.forEach((mutation) => {
        const node = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
        if (node) roots.add(node);
      });
      roots.forEach((root) => applySemanticClasses(root));
      applySemanticClasses();
    });

    targets.forEach((target) => observer.observe(target, { childList: true, subtree: true }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
