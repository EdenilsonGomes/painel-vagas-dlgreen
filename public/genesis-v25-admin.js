'use strict';

/*
 * Gênesis V25.1 — Admin UX (fix travamento Revisões)
 * - Exportação de candidatos (ADMIN)
 * - Comunicação opcional ao concluir APROVAR / NÃO APROVAR em Revisões
 *
 * Camada aditiva. Não altera o fluxo padrão quando os novos controles não estão presentes.
 */
(() => {
  const API = window.GenesisPanel?.api
    ? (...args) => window.GenesisPanel.api(...args)
    : async (url, options = {}) => {
        const response = await fetch(url, {
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          ...options,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.erro || body.message || `HTTP ${response.status}`);
        return body;
      };

  const toast = (message, tone = 'success') => {
    if (window.GenesisPanel?.toast) return window.GenesisPanel.toast(message, tone);
    console[tone === 'error' ? 'error' : 'log'](message);
  };

  const isAdmin = () => String(document.body?.dataset?.userRole || '').toUpperCase() === 'ADMIN';

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const safeDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  };

  const fieldCatalog = [
    ['id', 'ID'],
    ['nome', 'Nome'],
    ['telefone', 'Telefone'],
    ['vaga_nome', 'Vaga'],
    ['status', 'Status'],
    ['etapa', 'Etapa'],
    ['updated_at', 'Última atividade'],
    ['created_at', 'Cadastro'],
    ['cep', 'CEP'],
    ['distancia_km', 'Distância da vaga (km)'],
    ['sexo', 'Sexo documental'],
    ['documentos', 'Documentos'],
    ['entrevista_inicio', 'Entrevista'],
    ['responsavel', 'Responsável'],
    ['motivo_reprovacao', 'Motivo da reprovação'],
  ];

  const defaultFields = new Set([
    'nome', 'telefone', 'vaga_nome', 'status', 'etapa',
    'updated_at', 'documentos', 'entrevista_inicio',
  ]);

  let exportCandidates = [];
  let selectedIds = new Set();

  function candidateValue(candidate, key) {
    switch (key) {
      case 'vaga_nome':
        return candidate.vaga_nome || candidate.vaga_legacy || candidate.vaga || '';
      case 'documentos': {
        const docs = [];
        if (candidate.tem_ctps) docs.push('CTPS');
        if (candidate.tem_curriculo) docs.push('Currículo');
        if (!docs.length && Number(candidate.quantidade_documentos || 0) > 0) {
          docs.push(`${Number(candidate.quantidade_documentos)} arquivo(s)`);
        }
        return docs.join(', ');
      }
      case 'responsavel':
        return candidate.atendimento_responsavel_nome
          || candidate.atendimento_humano_nome
          || candidate.recrutador_responsavel_nome
          || '';
      case 'motivo_reprovacao':
        return candidate.motivo_reprovacao_detalhe
          || candidate.motivo_reprovacao
          || candidate.motivo_reprovacao_codigo
          || '';
      case 'updated_at':
      case 'created_at':
      case 'entrevista_inicio':
        return safeDate(candidate[key]);
      case 'distancia_km':
        return candidate.distancia_km == null || candidate.distancia_km === ''
          ? ''
          : Number(candidate.distancia_km).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      default:
        return candidate[key] ?? '';
    }
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadCsv(candidates, fields) {
    const headers = fields.map((key) => fieldCatalog.find(([field]) => field === key)?.[1] || key);
    const rows = candidates.map((candidate) => fields.map((key) => csvCell(candidateValue(candidate, key))).join(';'));
    const content = '\uFEFFsep=;\r\n' + headers.map(csvCell).join(';') + '\r\n' + rows.join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `genesis-candidatos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function ensureExportDialog() {
    if (document.getElementById('candidateExportV25Dialog')) return;

    const dialog = document.createElement('dialog');
    dialog.id = 'candidateExportV25Dialog';
    dialog.className = 'modal candidate-export-v25-dialog';
    dialog.innerHTML = `
      <div class="candidate-export-v25-shell">
        <header class="candidate-export-v25-header">
          <div>
            <p class="eyebrow">ADMINISTRAÇÃO</p>
            <h2>Exportar candidatos</h2>
            <span>Escolha quem entra no arquivo e quais campos serão exportados.</span>
          </div>
          <button class="icon-button" data-v25-export-close type="button" aria-label="Fechar">×</button>
        </header>

        <div class="candidate-export-v25-body">
          <section class="candidate-export-v25-section">
            <div class="candidate-export-v25-section-head">
              <div><strong>1. Quem exportar</strong><small>Use os filtros da tela ou escolha pessoas específicas.</small></div>
            </div>
            <div class="candidate-export-v25-scope">
              <label><input name="candidateExportV25Scope" type="radio" value="SELECTED" checked><span><strong>Selecionados</strong><small>Somente os candidatos marcados abaixo</small></span></label>
              <label><input name="candidateExportV25Scope" type="radio" value="FILTERED"><span><strong>Todos os filtrados</strong><small>Os candidatos que aparecem na tabela atual</small></span></label>
              <label><input name="candidateExportV25Scope" type="radio" value="ALL"><span><strong>Todos os candidatos</strong><small>Ignora os filtros atuais</small></span></label>
            </div>

            <div id="candidateExportV25Selection" class="candidate-export-v25-selection">
              <div class="candidate-export-v25-selection-toolbar">
                <label class="inline-search"><span>⌕</span><input id="candidateExportV25Search" type="search" placeholder="Buscar candidato, telefone ou vaga"></label>
                <button id="candidateExportV25SelectVisible" class="button button-ghost compact" type="button">Selecionar visíveis</button>
                <button id="candidateExportV25Clear" class="button button-ghost compact" type="button">Limpar</button>
              </div>
              <div id="candidateExportV25List" class="candidate-export-v25-list"></div>
              <small id="candidateExportV25SelectedCount" class="candidate-export-v25-selected-count">0 selecionado(s)</small>
            </div>
          </section>

          <section class="candidate-export-v25-section">
            <div class="candidate-export-v25-section-head">
              <div><strong>2. O que incluir</strong><small>Campos desmarcados não entram no arquivo.</small></div>
              <div>
                <button id="candidateExportV25FieldsDefault" class="text-button" type="button">Padrão</button>
                <button id="candidateExportV25FieldsAll" class="text-button" type="button">Todos</button>
              </div>
            </div>
            <div id="candidateExportV25Fields" class="candidate-export-v25-fields">
              ${fieldCatalog.map(([key, label]) => `
                <label>
                  <input type="checkbox" data-v25-export-field="${escapeHtml(key)}" ${defaultFields.has(key) ? 'checked' : ''}>
                  <span>${escapeHtml(label)}</span>
                </label>
              `).join('')}
            </div>
          </section>

          <div class="candidate-export-v25-notice">
            <strong>Exportação administrativa</strong>
            <span>O arquivo contém dados pessoais de candidatos. Use somente para finalidade operacional autorizada.</span>
          </div>
        </div>

        <footer class="candidate-export-v25-footer">
          <span id="candidateExportV25Summary">Nenhum candidato selecionado.</span>
          <div>
            <button class="button button-ghost" data-v25-export-close type="button">Cancelar</button>
            <button id="candidateExportV25Download" class="button button-primary" type="button">Exportar CSV</button>
          </div>
        </footer>
      </div>
    `;
    document.body.appendChild(dialog);

    dialog.querySelectorAll('[data-v25-export-close]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.querySelectorAll('input[name="candidateExportV25Scope"]').forEach((radio) => {
      radio.addEventListener('change', syncExportScope);
    });
    document.getElementById('candidateExportV25Search').addEventListener('input', renderExportCandidateList);
    document.getElementById('candidateExportV25SelectVisible').addEventListener('click', () => {
      visibleExportCandidates().forEach((candidate) => selectedIds.add(String(candidate.id)));
      renderExportCandidateList();
    });
    document.getElementById('candidateExportV25Clear').addEventListener('click', () => {
      selectedIds.clear();
      renderExportCandidateList();
    });
    document.getElementById('candidateExportV25FieldsDefault').addEventListener('click', () => {
      dialog.querySelectorAll('[data-v25-export-field]').forEach((input) => {
        input.checked = defaultFields.has(input.dataset.v25ExportField);
      });
      updateExportSummary();
    });
    document.getElementById('candidateExportV25FieldsAll').addEventListener('click', () => {
      dialog.querySelectorAll('[data-v25-export-field]').forEach((input) => { input.checked = true; });
      updateExportSummary();
    });
    dialog.querySelectorAll('[data-v25-export-field]').forEach((input) => input.addEventListener('change', updateExportSummary));
    document.getElementById('candidateExportV25Download').addEventListener('click', runCandidateExport);
  }

  function visibleExportCandidates() {
    const query = String(document.getElementById('candidateExportV25Search')?.value || '')
      .trim().toLocaleLowerCase('pt-BR');
    if (!query) return exportCandidates;
    return exportCandidates.filter((candidate) => [
      candidate.nome,
      candidate.telefone,
      candidate.vaga_nome,
      candidate.vaga_legacy,
      candidate.vaga,
    ].join(' ').toLocaleLowerCase('pt-BR').includes(query));
  }

  function renderExportCandidateList() {
    const list = document.getElementById('candidateExportV25List');
    if (!list) return;
    const items = visibleExportCandidates();
    list.innerHTML = items.length ? items.map((candidate) => {
      const id = String(candidate.id);
      const checked = selectedIds.has(id);
      return `
        <label class="candidate-export-v25-person">
          <input type="checkbox" data-v25-candidate-id="${escapeHtml(id)}" ${checked ? 'checked' : ''}>
          <span class="candidate-export-v25-avatar">${escapeHtml(String(candidate.nome || candidate.telefone || '?').trim().charAt(0).toUpperCase())}</span>
          <span>
            <strong>${escapeHtml(candidate.nome || `Candidato #${candidate.id}`)}</strong>
            <small>${escapeHtml(candidate.vaga_nome || candidate.vaga_legacy || candidate.vaga || 'Sem vaga')} · ${escapeHtml(candidate.telefone || '')}</small>
          </span>
        </label>`;
    }).join('') : '<div class="empty-state compact">Nenhum candidato encontrado.</div>';

    list.querySelectorAll('[data-v25-candidate-id]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = String(input.dataset.v25CandidateId);
        if (input.checked) selectedIds.add(id); else selectedIds.delete(id);
        updateExportSummary();
      });
    });
    updateExportSummary();
  }

  function currentScope() {
    return document.querySelector('input[name="candidateExportV25Scope"]:checked')?.value || 'SELECTED';
  }

  function filteredCandidateIdsFromTable() {
    return new Set(
      [...document.querySelectorAll('#candidatesTableBody tr[data-candidate-row]')]
        .filter((row) => !row.hidden && getComputedStyle(row).display !== 'none')
        .map((row) => String(row.dataset.candidateRow))
    );
  }

  function candidatesForExport() {
    const scope = currentScope();
    if (scope === 'ALL') return exportCandidates;
    if (scope === 'FILTERED') {
      const visibleIds = filteredCandidateIdsFromTable();
      return exportCandidates.filter((candidate) => visibleIds.has(String(candidate.id)));
    }
    return exportCandidates.filter((candidate) => selectedIds.has(String(candidate.id)));
  }

  function selectedExportFields() {
    return [...document.querySelectorAll('[data-v25-export-field]:checked')]
      .map((input) => input.dataset.v25ExportField)
      .filter(Boolean);
  }

  function syncExportScope() {
    const selection = document.getElementById('candidateExportV25Selection');
    if (selection) selection.classList.toggle('is-disabled', currentScope() !== 'SELECTED');
    updateExportSummary();
  }

  function updateExportSummary() {
    const count = selectedIds.size;
    const countNode = document.getElementById('candidateExportV25SelectedCount');
    if (countNode) countNode.textContent = `${count} selecionado(s)`;

    const candidates = candidatesForExport();
    const fields = selectedExportFields();
    const summary = document.getElementById('candidateExportV25Summary');
    if (summary) summary.textContent = `${candidates.length} candidato(s) · ${fields.length} campo(s)`;
    const button = document.getElementById('candidateExportV25Download');
    if (button) button.disabled = !candidates.length || !fields.length;
  }

  async function openCandidateExport() {
    if (!isAdmin()) return toast('Exportação disponível somente para administradores.', 'error');
    ensureExportDialog();
    try {
      const result = await API('/api/candidatos');
      exportCandidates = Array.isArray(result.candidatos) ? result.candidatos : [];
      selectedIds = new Set();
      document.getElementById('candidateExportV25Search').value = '';
      document.querySelector('input[name="candidateExportV25Scope"][value="SELECTED"]').checked = true;
      renderExportCandidateList();
      syncExportScope();
      document.getElementById('candidateExportV25Dialog').showModal();
    } catch (error) {
      toast(error.message || 'Não foi possível carregar os candidatos para exportação.', 'error');
    }
  }

  function runCandidateExport() {
    if (!isAdmin()) return toast('Exportação disponível somente para administradores.', 'error');
    const candidates = candidatesForExport();
    const fields = selectedExportFields();
    if (!candidates.length) return toast('Selecione pelo menos um candidato.', 'error');
    if (!fields.length) return toast('Selecione pelo menos um campo.', 'error');
    downloadCsv(candidates, fields);
    document.getElementById('candidateExportV25Dialog')?.close();
    toast(`${candidates.length} candidato(s) exportado(s).`);
  }

  function ensureCandidateExportButton() {
    const view = document.getElementById('view-candidates');
    if (!view || document.getElementById('candidateExportV25Button')) return;

    const toolbarRight = view.querySelector('.candidate-toolbar .toolbar-right');
    if (!toolbarRight) return;

    const button = document.createElement('button');
    button.id = 'candidateExportV25Button';
    button.className = 'button button-ghost candidate-export-v25-button hidden';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">⇩</span><span>Exportar</span>';
    button.addEventListener('click', openCandidateExport);
    toolbarRight.appendChild(button);
    syncAdminVisibility();
  }

  function syncAdminVisibility() {
    document.getElementById('candidateExportV25Button')?.classList.toggle('hidden', !isAdmin());
  }

  function reviewCommunicationApplicable(decision) {
    return ['APROVAR', 'NAO_APROVAR'].includes(String(decision || '').toUpperCase());
  }

  function selectedReviewDecision() {
    return String(document.querySelector('input[name="reviewDecisionChoice"]:checked')?.value || '').toUpperCase();
  }

  function ensureReviewCommunicationControl() {
    const root = document.getElementById('reviewDecisionContent');
    if (!root) return;

    const decision = selectedReviewDecision();
    const existing = document.getElementById('reviewCommunicationV25');

    if (!reviewCommunicationApplicable(decision)) {
      existing?.remove();
      return;
    }

    if (!existing) {
      const note = root.querySelector('.review-decision-note');
      if (!note) return;

      const box = document.createElement('section');
      box.id = 'reviewCommunicationV25';
      box.className = 'review-communication-v25';
      box.innerHTML = `
        <div class="review-communication-v25-head">
          <div>
            <strong>Comunicação com o candidato</strong>
            <small>A decisão interna e o envio de mensagem são ações separadas.</small>
          </div>
          <label class="review-communication-v25-switch">
            <input id="reviewSendMessageV25" type="checkbox">
            <span>Enviar mensagem</span>
          </label>
        </div>
        <div id="reviewCommunicationV25State" class="review-communication-v25-state is-internal">
          <strong>Somente interno</strong>
          <span>Nenhuma mensagem será enviada ao candidato.</span>
        </div>`;
      note.after(box);
      box.querySelector('#reviewSendMessageV25').addEventListener('change', syncReviewCommunicationUi);
    }

    syncReviewCommunicationUi();
  }

  function syncReviewCommunicationUi() {
    const checkbox = document.getElementById('reviewSendMessageV25');
    const stateNode = document.getElementById('reviewCommunicationV25State');
    const button = document.getElementById('confirmReviewDecisionButton');
    if (!checkbox || !stateNode) return;

    const willSend = checkbox.checked;
    const nextMode = willSend ? 'send' : 'internal';

    // Evita loop de MutationObserver: só altera o DOM quando o estado realmente mudou.
    if (stateNode.dataset.mode !== nextMode) {
      stateNode.dataset.mode = nextMode;
      stateNode.classList.toggle('is-internal', !willSend);
      stateNode.classList.toggle('will-send', willSend);
      stateNode.innerHTML = willSend
        ? '<strong>WhatsApp</strong><span>O fluxo configurado poderá enviar a mensagem prevista ao candidato após salvar.</span>'
        : '<strong>Somente interno</strong><span>Nenhuma mensagem será enviada ao candidato.</span>';
    }

    if (button && reviewCommunicationApplicable(selectedReviewDecision())) {
      const nextLabel = willSend ? 'Salvar e enviar mensagem' : 'Salvar decisão';
      if (button.textContent !== nextLabel) button.textContent = nextLabel;
    }
  }

  async function handleReviewConfirmCapture(event) {
    const button = event.target.closest('[data-review-confirm]');
    if (!button) return;

    const decision = selectedReviewDecision();
    if (!reviewCommunicationApplicable(decision)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const selected = document.querySelector('.review-queue-item.selected[data-review-open]');
    const reviewId = Number(selected?.dataset?.reviewOpen || 0);
    if (!reviewId) return toast('Não foi possível identificar a revisão selecionada.', 'error');

    const note = String(document.getElementById('reviewDecisionNote')?.value || '').trim();
    const enviarMensagem = Boolean(document.getElementById('reviewSendMessageV25')?.checked);
    const actionLabel = decision === 'APROVAR' ? 'aprovação' : 'decisão negativa';
    const confirmationText = enviarMensagem
      ? `Salvar a ${actionLabel} e permitir a comunicação configurada com o candidato?`
      : `Salvar a ${actionLabel} somente internamente, sem enviar mensagem ao candidato?`;

    if (!window.confirm(confirmationText)) return;

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Salvando...';

    try {
      const defaultReasons = {
        APROVAR: 'Compatibilidade confirmada pelo recrutador.',
        NAO_APROVAR: 'Incompatibilidade operacional confirmada em revisão interna.',
      };
      const result = await API(`/api/revisoes/${reviewId}/decidir`, {
        method: 'POST',
        body: JSON.stringify({
          decisao: decision,
          motivo: note || defaultReasons[decision],
          enviar_mensagem: enviarMensagem,
        }),
      });

      const suffix = enviarMensagem
        ? ' A comunicação configurada foi liberada.'
        : ' Nenhuma mensagem foi enviada ao candidato.';
      toast((result.mensagem || 'Decisão registrada.') + suffix);

      if (typeof window.loadReviews === 'function') {
        await window.loadReviews(true);
      } else {
        document.getElementById('refreshCurrentViewButton')?.click();
      }
      window.GenesisPanel?.reloadCandidates?.(true);
    } catch (error) {
      toast(error.message || 'Não foi possível concluir a revisão.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
      setTimeout(ensureReviewCommunicationControl, 0);
    }
  }

  function watchReviewDecision() {
    const root = document.getElementById('reviewDecisionContent');
    if (!root || root.dataset.v25Observed === 'true') return;
    root.dataset.v25Observed = 'true';

    const observer = new MutationObserver(() => {
      queueMicrotask(ensureReviewCommunicationControl);
    });
    observer.observe(root, { childList: true, subtree: false });

    document.addEventListener('change', (event) => {
      if (event.target.matches('input[name="reviewDecisionChoice"]')) {
        setTimeout(ensureReviewCommunicationControl, 0);
      }
    });
    document.addEventListener('click', handleReviewConfirmCapture, true);
  }

  function boot() {
    ensureCandidateExportButton();
    watchReviewDecision();
    syncAdminVisibility();

    const bodyObserver = new MutationObserver(() => {
      ensureCandidateExportButton();
      watchReviewDecision();
      syncAdminVisibility();
    });
    bodyObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-user-role'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
