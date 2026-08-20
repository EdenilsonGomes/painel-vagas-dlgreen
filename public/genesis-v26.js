'use strict';

/* Gênesis V26 — interações visuais aditivas, sem observação global do DOM. */
(() => {
  function openRow(event) {
    if (event.target.closest('input, button, a, details, summary, select, label')) return;
    const row = event.target.closest('#candidatesTableBody tr[data-candidate-row]');
    if (row) window.GenesisPanel?.openCandidate?.(row.dataset.candidateRow);
  }

  function openRowWithKeyboard(event) {
    if (!['Enter', ' '].includes(event.key) || event.target.matches('input, button, a, select')) return;
    const row = event.target.closest('#candidatesTableBody tr[data-candidate-row]');
    if (!row) return;
    event.preventDefault();
    window.GenesisPanel?.openCandidate?.(row.dataset.candidateRow);
  }

  function start() {
    document.body.classList.add('genesis-v26');
    document.body.dataset.designSystem = 'v26';
    document.getElementById('candidatesTableBody')?.addEventListener('click', openRow);
    document.getElementById('candidatesTableBody')?.addEventListener('keydown', openRowWithKeyboard);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
