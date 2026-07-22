'use strict';

const state = {
  activeView: 'dashboard',
  dashboard: null,
  dashboardLoaded: false,
  vacancies: [],
  candidates: [],
  candidateSummary: {
    total: 0,
    em_processo: 0,
    aprovados: 0,
    reprovados: 0,
  },
  companies: [],
  vacanciesLoading: false,
  candidatesLoading: false,
  candidatesLoaded: false,
  selectedCandidateId: null,
  aiVacancyAction: null,
  aiVacancySuggestions: null,
};

const elements = {
  pageTitle: document.querySelector('#pageTitle'),
  pageSubtitle: document.querySelector('#pageSubtitle'),
  dashboardTab: document.querySelector('#dashboardTab'),
  dashboardView: document.querySelector('#dashboardView'),
  refreshDashboardButton: document.querySelector('#refreshDashboardButton'),
  dashboardLoading: document.querySelector('#dashboardLoading'),
  dashboardContent: document.querySelector('#dashboardContent'),
  dashboardUpdatedAt: document.querySelector('#dashboardUpdatedAt'),
  dashboardAlerts: document.querySelector('#dashboardAlerts'),
  dashboardAlertCount: document.querySelector('#dashboardAlertCount'),
  dashboardInterviews: document.querySelector('#dashboardInterviews'),
  dashboardRecentCandidates: document.querySelector('#dashboardRecentCandidates'),
  dashboardActivity: document.querySelector('#dashboardActivity'),
  dashTotalCandidates: document.querySelector('#dashTotalCandidates'),
  dashInProcess: document.querySelector('#dashInProcess'),
  dashActiveVacancies: document.querySelector('#dashActiveVacancies'),
  dashInterviews: document.querySelector('#dashInterviews'),
  dashUnlinked: document.querySelector('#dashUnlinked'),
  dashCtps: document.querySelector('#dashCtps'),
  dashCurriculos: document.querySelector('#dashCurriculos'),
  dashDocsReview: document.querySelector('#dashDocsReview'),
  vacanciesTab: document.querySelector('#vacanciesTab'),
  candidatesTab: document.querySelector('#candidatesTab'),
  vacanciesView: document.querySelector('#vacanciesView'),
  candidatesView: document.querySelector('#candidatesView'),
  newVacancyButton: document.querySelector('#newVacancyButton'),
  newCandidateButton: document.querySelector('#newCandidateButton'),
  generateVacancyAiButton: document.querySelector('#generateVacancyAiButton'),

  refreshButton: document.querySelector('#refreshButton'),
  searchInput: document.querySelector('#searchInput'),
  statusFilter: document.querySelector('#statusFilter'),
  loadingState: document.querySelector('#loadingState'),
  emptyState: document.querySelector('#emptyState'),
  tableWrapper: document.querySelector('#tableWrapper'),
  tableBody: document.querySelector('#vacanciesTableBody'),
  statActive: document.querySelector('#statActive'),
  statDraft: document.querySelector('#statDraft'),
  statPaused: document.querySelector('#statPaused'),
  statClosed: document.querySelector('#statClosed'),

  refreshCandidatesButton: document.querySelector('#refreshCandidatesButton'),
  candidateSearchInput: document.querySelector('#candidateSearchInput'),
  candidateStatusFilter: document.querySelector('#candidateStatusFilter'),
  candidatesLoadingState: document.querySelector('#candidatesLoadingState'),
  candidatesEmptyState: document.querySelector('#candidatesEmptyState'),
  candidatesTableWrapper: document.querySelector('#candidatesTableWrapper'),
  candidatesTableBody: document.querySelector('#candidatesTableBody'),
  statCandidatesTotal: document.querySelector('#statCandidatesTotal'),
  statCandidatesInProcess: document.querySelector('#statCandidatesInProcess'),
  statCandidatesApproved: document.querySelector('#statCandidatesApproved'),
  statCandidatesRejected: document.querySelector('#statCandidatesRejected'),
  candidateStatCards: document.querySelectorAll('[data-candidate-filter]'),

  candidateDialog: document.querySelector('#candidateDialog'),
  closeCandidateDialogButton: document.querySelector('#closeCandidateDialogButton'),
  deleteCandidateDetailsButton: document.querySelector('#deleteCandidateDetailsButton'),
  candidateDetailsLoading: document.querySelector('#candidateDetailsLoading'),
  candidateDetailsContent: document.querySelector('#candidateDetailsContent'),
  candidateDialogTitle: document.querySelector('#candidateDialogTitle'),
  detailCandidateName: document.querySelector('#detailCandidateName'),
  detailCandidatePhone: document.querySelector('#detailCandidatePhone'),
  detailCandidateVacancy: document.querySelector('#detailCandidateVacancy'),
  detailCandidateStage: document.querySelector('#detailCandidateStage'),
  detailCandidateCep: document.querySelector('#detailCandidateCep'),
  detailCandidateAverageStay: document.querySelector('#detailCandidateAverageStay'),
  detailCandidateValidJobs: document.querySelector('#detailCandidateValidJobs'),
  detailCandidateTriage: document.querySelector('#detailCandidateTriage'),
  candidateRejectionSection: document.querySelector('#candidateRejectionSection'),
  detailCandidateRejectionReason: document.querySelector('#detailCandidateRejectionReason'),
  detailCandidateRejectionObservation: document.querySelector('#detailCandidateRejectionObservation'),
  detailCandidateMissing: document.querySelector('#detailCandidateMissing'),
  detailCandidateExperiences: document.querySelector('#detailCandidateExperiences'),
  detailCandidateInterview: document.querySelector('#detailCandidateInterview'),
  detailCandidateMeet: document.querySelector('#detailCandidateMeet'),
  detailCandidatePresentation: document.querySelector('#detailCandidatePresentation'),
  detailCandidatePersonality: document.querySelector('#detailCandidatePersonality'),
  detailCandidateTags: document.querySelector('#detailCandidateTags'),
  candidateDocumentsEmpty: document.querySelector('#candidateDocumentsEmpty'),
  candidateDocumentsList: document.querySelector('#candidateDocumentsList'),
  candidateTimelineEmpty: document.querySelector('#candidateTimelineEmpty'),
  candidateTimeline: document.querySelector('#candidateTimeline'),

  candidateCreateDialog: document.querySelector('#candidateCreateDialog'),
  candidateCreateForm: document.querySelector('#candidateCreateForm'),
  closeCandidateCreateButton: document.querySelector('#closeCandidateCreateButton'),
  cancelCandidateCreateButton: document.querySelector('#cancelCandidateCreateButton'),
  saveCandidateButton: document.querySelector('#saveCandidateButton'),
  candidateCreateError: document.querySelector('#candidateCreateError'),
  candidateVacancySelect: document.querySelector('#candidate_vaga_id'),

  vacancyDialog: document.querySelector('#vacancyDialog'),
  vacancyForm: document.querySelector('#vacancyForm'),
  dialogTitle: document.querySelector('#dialogTitle'),
  vacancyId: document.querySelector('#vacancyId'),
  closeDialogButton: document.querySelector('#closeDialogButton'),
  cancelButton: document.querySelector('#cancelButton'),
  saveButton: document.querySelector('#saveButton'),
  formError: document.querySelector('#formError'),
  companySelect: document.querySelector('#empresa_id'),

  aiVacancyDialog: document.querySelector('#aiVacancyDialog'),
  aiVacancyDialogTitle: document.querySelector('#aiVacancyDialogTitle'),
  closeAiVacancyDialogButton: document.querySelector('#closeAiVacancyDialogButton'),
  cancelAiVacancyButton: document.querySelector('#cancelAiVacancyButton'),
  applyAiVacancyButton: document.querySelector('#applyAiVacancyButton'),
  aiVacancyLoading: document.querySelector('#aiVacancyLoading'),
  aiVacancyError: document.querySelector('#aiVacancyError'),
  aiVacancyPreview: document.querySelector('#aiVacancyPreview'),
  aiVacancyWarnings: document.querySelector('#aiVacancyWarnings'),
  aiPreviewDescricao: document.querySelector('#aiPreviewDescricao'),
  aiPreviewCargos: document.querySelector('#aiPreviewCargos'),
  aiPreviewCbos: document.querySelector('#aiPreviewCbos'),
  aiPreviewObrigatorios: document.querySelector('#aiPreviewObrigatorios'),
  aiPreviewDesejaveis: document.querySelector('#aiPreviewDesejaveis'),
  aiFieldButtons: document.querySelectorAll('[data-ai-action]'),

  promotionDialog: document.querySelector('#promotionDialog'),
  promotionDialogTitle: document.querySelector('#promotionDialogTitle'),
  closePromotionDialogButton: document.querySelector('#closePromotionDialogButton'),
  closePromotionFooterButton: document.querySelector('#closePromotionFooterButton'),
  promotionLoading: document.querySelector('#promotionLoading'),
  promotionContent: document.querySelector('#promotionContent'),
  promotionWhatsappText: document.querySelector('#promotionWhatsappText'),
  promotionFacebookText: document.querySelector('#promotionFacebookText'),
  promotionImagePreview: document.querySelector('#promotionImagePreview'),
  copyPromotionWhatsappButton: document.querySelector('#copyPromotionWhatsappButton'),
  copyPromotionFacebookButton: document.querySelector('#copyPromotionFacebookButton'),
  downloadPromotionImageButton: document.querySelector('#downloadPromotionImageButton'),

  toast: document.querySelector('#toast'),
};

const vacancyStatusLabels = {
  ATIVA: 'Ativa',
  RASCUNHO: 'Rascunho',
  PAUSADA: 'Pausada',
  ENCERRADA: 'Encerrada',
};

const candidateStatusLabels = {
  NOVO: 'Novo',
  EM_PROCESSO: 'Em processo',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  CONTRATADO: 'Contratado',
  ENCERRADO: 'Encerrado',
};

const stageLabels = {
  PRIMEIRO_CONTATO: 'Primeiro contato',
  PERGUNTANDO_EXPERIENCIA: 'Confirmando experiência',
  ESCOLHENDO_VAGA: 'Escolhendo vaga',
  AGUARDANDO_CTPS_CEP: 'Aguardando CTPS e CEP',
  AGUARDANDO_CTPS: 'Aguardando CTPS',
  AGUARDANDO_CEP: 'Aguardando CEP',
  ANALISANDO_DOCUMENTOS: 'Analisando documentos',
  APROVADO_TRIAGEM: 'Aprovado na triagem',
  REPROVADO_PRE_TRIAGEM: 'Reprovado na pré-triagem',
  REPROVADO_TRIAGEM: 'Reprovado na triagem',
  AGUARDANDO_APRESENTACAO: 'Aguardando apresentação',
  GERANDO_OPCOES_ENTREVISTA: 'Buscando horários',
  ESCOLHENDO_HORARIO: 'Escolhendo horário',
  AGUARDANDO_ENTREVISTA: 'Aguardando entrevista',
  ENTREVISTA_AGENDADA: 'Entrevista agendada',
  CONTRATADO: 'Contratado',
  ENCERRADO: 'Encerrado',
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const details = Array.isArray(body?.detalhes)
      ? body.detalhes.map((item) => `${item.campo}: ${item.mensagem}`).join('\n')
      : '';
    const message = [body?.erro || `Erro HTTP ${response.status}`, details]
      .filter(Boolean)
      .join('\n');
    throw new Error(message);
  }

  return body;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return 'Não informado';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Não informado';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(number);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatFileSize(value) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'Tamanho não informado';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const size = bytes / (1024 ** unitIndex);
  const formattedSize = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(size);

  return `${formattedSize} ${units[unitIndex]}`;
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits || 'Não informado';
}

async function copyTextToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    showToast(successMessage || 'Texto copiado.');
  } catch {
    window.prompt('Copie o conteúdo abaixo:', String(text || ''));
  }
}

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', type === 'error');
  elements.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
}

function switchView(view) {
  const validView = ['dashboard', 'vacancies', 'candidates'].includes(view) ? view : 'dashboard';
  state.activeView = validView;

  const dashboardActive = validView === 'dashboard';
  const vacanciesActive = validView === 'vacancies';
  const candidatesActive = validView === 'candidates';

  elements.dashboardView.classList.toggle('hidden', !dashboardActive);
  elements.vacanciesView.classList.toggle('hidden', !vacanciesActive);
  elements.candidatesView.classList.toggle('hidden', !candidatesActive);

  elements.dashboardTab.classList.toggle('active', dashboardActive);
  elements.vacanciesTab.classList.toggle('active', vacanciesActive);
  elements.candidatesTab.classList.toggle('active', candidatesActive);
  elements.dashboardTab.setAttribute('aria-selected', String(dashboardActive));
  elements.vacanciesTab.setAttribute('aria-selected', String(vacanciesActive));
  elements.candidatesTab.setAttribute('aria-selected', String(candidatesActive));

  elements.refreshDashboardButton.classList.toggle('hidden', !dashboardActive);
  elements.newVacancyButton.classList.toggle('hidden', !vacanciesActive);
  elements.newCandidateButton.classList.toggle('hidden', !candidatesActive);

  if (dashboardActive) {
    elements.pageTitle.textContent = 'Central de Recrutamento';
    elements.pageSubtitle.textContent = 'Prioridades, movimentações e entrevistas em uma visão operacional.';
    if (!state.dashboardLoaded) loadDashboard();
  } else if (vacanciesActive) {
    elements.pageTitle.textContent = 'Gestão de Vagas';
    elements.pageSubtitle.textContent = 'Configure vagas, requisitos, divulgação e compatibilidade profissional.';
  } else {
    elements.pageTitle.textContent = 'Gestão de Candidatos';
    elements.pageSubtitle.textContent = 'Acompanhe triagem, documentos, permanência profissional e entrevistas.';
    if (!state.candidatesLoaded) loadCandidates();
  }
}

function dashboardEmpty(message) {
  return `<div class="state-box compact">${escapeHtml(message)}</div>`;
}

function actionLabel(action) {
  return {
    ADICIONADO: 'Adicionado',
    MODIFICADO: 'Modificado',
    REMOVIDO: 'Removido',
  }[action] || action || 'Atualização';
}

function renderDashboard() {
  const data = state.dashboard || {};
  const metrics = data.metricas || {};
  const docs = data.documentos || {};

  elements.dashTotalCandidates.textContent = Number(metrics.total_candidatos || 0);
  elements.dashInProcess.textContent = Number(metrics.em_processo || 0);
  elements.dashActiveVacancies.textContent = Number(metrics.vagas_ativas || 0);
  elements.dashInterviews.textContent = Number(metrics.entrevistas_7_dias || 0);
  elements.dashUnlinked.textContent = Number(metrics.entradas_sem_candidato || 0);
  elements.dashCtps.textContent = Number(docs.ctps || 0);
  elements.dashCurriculos.textContent = Number(docs.curriculos || 0);
  elements.dashDocsReview.textContent = Number(docs.revisar || 0);
  elements.dashboardUpdatedAt.textContent = `Atualizado em ${formatDate(data.atualizado_em)}`;

  const alerts = data.alertas || [];
  elements.dashboardAlertCount.textContent = Number(data.total_alertas || alerts.length);
  elements.dashboardAlerts.innerHTML = alerts.length ? alerts.map((alert) => `
    <article class="alert-card alert-${escapeHtml(String(alert.severidade || 'MEDIO').toLowerCase())}" data-candidate-id="${escapeHtml(alert.candidato_id || '')}">
      <div class="alert-icon">!</div>
      <div class="alert-copy">
        <strong>${escapeHtml(alert.titulo || 'Alerta')}</strong>
        <span>${escapeHtml(alert.descricao || '')}</span>
        <small>${escapeHtml(formatDate(alert.created_at))}</small>
      </div>
      <div class="alert-actions">
        ${alert.candidato_id ? `<button class="link-button" type="button" data-dashboard-action="candidate" data-id="${escapeHtml(alert.candidato_id)}">Abrir</button>` : ''}
        <button class="link-button" type="button" data-dashboard-action="resolve" data-key="${escapeHtml(alert.chave)}">Resolver</button>
      </div>
    </article>
  `).join('') : dashboardEmpty('Nenhum alerta operacional pendente.');

  const interviews = data.proximas_entrevistas || [];
  elements.dashboardInterviews.innerHTML = interviews.length ? interviews.map((item) => `
    <button class="compact-row" type="button" data-dashboard-action="candidate" data-id="${escapeHtml(item.candidato_id)}">
      <span class="compact-row-icon">📅</span>
      <span><strong>${escapeHtml(item.candidato_nome)}</strong><small>${escapeHtml(item.vaga_nome)} · ${escapeHtml(formatDate(item.inicio))}</small></span>
    </button>
  `).join('') : dashboardEmpty('Nenhuma entrevista futura agendada.');

  const recent = data.candidatos_recentes || [];
  elements.dashboardRecentCandidates.innerHTML = recent.length ? recent.map((item) => `
    <button class="compact-row" type="button" data-dashboard-action="candidate" data-id="${escapeHtml(item.id)}">
      <span class="avatar-mini">${escapeHtml((item.nome || '?').slice(0, 1).toUpperCase())}</span>
      <span><strong>${escapeHtml(item.nome || 'Nome não informado')}</strong><small>${escapeHtml(item.vaga_nome)} · ${escapeHtml(candidateStatusLabels[item.status] || item.status || 'Novo')}</small></span>
    </button>
  `).join('') : dashboardEmpty('Nenhum candidato registrado.');

  const activities = data.atividades || [];
  elements.dashboardActivity.innerHTML = activities.length ? activities.map((item) => {
    const subject = item.nome || item.telefone || `Candidato #${item.candidato_id || ''}`;
    const changedFields = Array.isArray(item.campos_alterados)
      ? item.campos_alterados.filter((field) => hasContent(field)).slice(0, 6)
      : [];
    const meta = [formatDate(item.created_at), changedFields.length ? `Campos: ${changedFields.join(', ')}` : '']
      .filter(Boolean)
      .join(' · ');

    return `
      <article class="activity-item">
        <span class="activity-dot activity-${escapeHtml(String(item.acao || '').toLowerCase())}"></span>
        <div>
          <strong>${escapeHtml(actionLabel(item.acao))}: ${escapeHtml(subject)}</strong>
          <small>${escapeHtml(meta)}</small>
        </div>
      </article>
    `;
  }).join('') : dashboardEmpty('Ainda não existem registros de auditoria.');
}

async function loadDashboard() {
  elements.refreshDashboardButton.disabled = true;
  elements.dashboardLoading.classList.remove('hidden');
  elements.dashboardContent.classList.add('hidden');

  try {
    const result = await api('/api/dashboard');
    state.dashboard = result;
    state.dashboardLoaded = true;
    renderDashboard();
    elements.dashboardLoading.classList.add('hidden');
    elements.dashboardContent.classList.remove('hidden');
  } catch (error) {
    elements.dashboardLoading.innerHTML = `<strong>Não foi possível carregar a visão geral.</strong><span>${escapeHtml(error.message)}</span>`;
    showToast(error.message, 'error');
  } finally {
    elements.refreshDashboardButton.disabled = false;
  }
}

async function resolveDashboardAlert(key) {
  try {
    await api('/api/alertas/resolver', {
      method: 'POST',
      body: JSON.stringify({ chave: key }),
    });
    showToast('Alerta resolvido.');
    state.dashboardLoaded = false;
    await loadDashboard();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function handleDashboardClick(event) {
  const button = event.target.closest('[data-dashboard-action]');
  if (!button) return;
  if (button.dataset.dashboardAction === 'candidate') openCandidateDetails(button.dataset.id);
  if (button.dataset.dashboardAction === 'resolve') resolveDashboardAlert(button.dataset.key);
}

function setVacanciesLoading(isLoading) {
  state.vacanciesLoading = isLoading;
  elements.refreshButton.disabled = isLoading;
  if (isLoading) {
    elements.loadingState.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    elements.tableWrapper.classList.add('hidden');
  } else {
    elements.loadingState.classList.add('hidden');
  }
}

function setCandidatesLoading(isLoading) {
  state.candidatesLoading = isLoading;
  elements.refreshCandidatesButton.disabled = isLoading;
  if (isLoading) {
    elements.candidatesLoadingState.classList.remove('hidden');
    elements.candidatesEmptyState.classList.add('hidden');
    elements.candidatesTableWrapper.classList.add('hidden');
  } else {
    elements.candidatesLoadingState.classList.add('hidden');
  }
}

function updateVacancyStats() {
  const count = (status) => state.vacancies.filter((vacancy) => vacancy.status === status).length;
  elements.statActive.textContent = count('ATIVA');
  elements.statDraft.textContent = count('RASCUNHO');
  elements.statPaused.textContent = count('PAUSADA');
  elements.statClosed.textContent = count('ENCERRADA');
}

function filteredVacancies() {
  const status = elements.statusFilter.value;
  const search = elements.searchInput.value.trim().toLocaleLowerCase('pt-BR');

  return state.vacancies.filter((vacancy) => {
    const matchesStatus = status === 'TODAS' || vacancy.status === status;
    const haystack = [
      vacancy.codigo,
      vacancy.titulo,
      vacancy.cargo,
      vacancy.cidade,
      vacancy.bairro,
      vacancy.empresa_nome,
    ].join(' ').toLocaleLowerCase('pt-BR');
    return matchesStatus && (!search || haystack.includes(search));
  });
}

function vacancyActionButtons(vacancy) {
  const buttons = [
    `<button class="button button-secondary button-small" type="button" data-action="edit" data-id="${vacancy.id}">Editar</button>`,
    `<button class="button button-secondary button-small" type="button" data-action="duplicate" data-id="${vacancy.id}">Duplicar</button>`,
    `<button class="button button-secondary button-small" type="button" data-action="promote" data-id="${vacancy.id}">Divulgar</button>`,
  ];

  if (vacancy.status === 'ATIVA') {
    buttons.push(`<button class="button button-secondary button-small" type="button" data-action="status" data-status="PAUSADA" data-id="${vacancy.id}">Pausar</button>`);
    buttons.push(`<button class="button button-danger button-small" type="button" data-action="status" data-status="ENCERRADA" data-id="${vacancy.id}">Encerrar</button>`);
  } else if (vacancy.status === 'PAUSADA' || vacancy.status === 'RASCUNHO') {
    buttons.push(`<button class="button button-primary button-small" type="button" data-action="status" data-status="ATIVA" data-id="${vacancy.id}">Ativar</button>`);
    if (vacancy.status === 'PAUSADA') {
      buttons.push(`<button class="button button-danger button-small" type="button" data-action="status" data-status="ENCERRADA" data-id="${vacancy.id}">Encerrar</button>`);
    }
  } else if (vacancy.status === 'ENCERRADA') {
    buttons.push(`<button class="button button-primary button-small" type="button" data-action="status" data-status="ATIVA" data-id="${vacancy.id}">Reabrir</button>`);
  }

  return buttons.join('');
}

function renderVacancies() {
  const vacancies = filteredVacancies();
  updateVacancyStats();

  if (vacancies.length === 0) {
    elements.tableWrapper.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.tableWrapper.classList.remove('hidden');

  elements.tableBody.innerHTML = vacancies.map((vacancy) => {
    const location = joinNonEmpty([vacancy.bairro, vacancy.cidade, vacancy.estado], ' - ') || 'Não informado';
    const jobMeta = joinNonEmpty([vacancy.empresa_nome, `${Number(vacancy.quantidade_vagas || 0)} vaga(s)`]);

    return `
      <tr>
        <td><span class="code">${escapeHtml(vacancy.codigo)}</span></td>
        <td>
          <div class="primary-cell">
            <strong>${escapeHtml(vacancy.titulo)}</strong>
            <span>${escapeHtml(jobMeta)}</span>
            <div class="vacancy-candidate-stats" aria-label="Resumo dos candidatos desta vaga">
              <span class="vacancy-stat vacancy-stat-total">Interessados ${Number(vacancy.total_interessados || 0)}</span>
              <span class="vacancy-stat vacancy-stat-process">Em processo ${Number(vacancy.candidatos_em_processo || 0)}</span>
              <span class="vacancy-stat vacancy-stat-approved">Aprovados ${Number(vacancy.candidatos_aprovados || 0)}</span>
              <span class="vacancy-stat vacancy-stat-rejected">Reprovados ${Number(vacancy.candidatos_reprovados || 0)}</span>
            </div>
          </div>
        </td>
        <td>${escapeHtml(location)}</td>
        <td>${escapeHtml(formatMoney(vacancy.salario))}</td>
        <td><span class="badge badge-${escapeHtml(vacancy.status)}">${escapeHtml(vacancyStatusLabels[vacancy.status] || vacancy.status)}</span></td>
        <td><span class="muted">${escapeHtml(formatDate(vacancy.updated_at))}</span></td>
        <td><div class="actions">${vacancyActionButtons(vacancy)}</div></td>
      </tr>
    `;
  }).join('');
}

function candidateMatchesFilter(candidate, filter) {
  const status = String(candidate.status || '').toUpperCase();
  if (filter === 'TODOS') return true;
  if (filter === 'EM_PROCESSO') return status === 'NOVO' || status === 'EM_PROCESSO';
  if (filter === 'APROVADO') return status === 'APROVADO' || status === 'CONTRATADO';
  return status === filter;
}

function filteredCandidates() {
  const filter = elements.candidateStatusFilter.value;
  const search = elements.candidateSearchInput.value.trim().toLocaleLowerCase('pt-BR');

  return state.candidates.filter((candidate) => {
    const matchesStatus = candidateMatchesFilter(candidate, filter);
    const haystack = [
      candidate.nome,
      candidate.telefone,
      candidate.vaga_codigo,
      candidate.vaga_nome,
      candidate.vaga_legacy,
      candidate.status,
      candidate.etapa,
    ].join(' ').toLocaleLowerCase('pt-BR');
    return matchesStatus && (!search || haystack.includes(search));
  });
}

function updateCandidateStats() {
  elements.statCandidatesTotal.textContent = state.candidateSummary.total || 0;
  elements.statCandidatesInProcess.textContent = state.candidateSummary.em_processo || 0;
  elements.statCandidatesApproved.textContent = state.candidateSummary.aprovados || 0;
  elements.statCandidatesRejected.textContent = state.candidateSummary.reprovados || 0;
}

function candidateBadgeClass(status) {
  const safeStatuses = ['NOVO', 'EM_PROCESSO', 'APROVADO', 'REPROVADO', 'CONTRATADO', 'ENCERRADO'];
  return safeStatuses.includes(status) ? status : 'NEUTRO';
}

function renderCandidates() {
  const candidates = filteredCandidates();
  updateCandidateStats();

  if (candidates.length === 0) {
    elements.candidatesTableWrapper.classList.add('hidden');
    elements.candidatesEmptyState.classList.remove('hidden');
    return;
  }

  elements.candidatesEmptyState.classList.add('hidden');
  elements.candidatesTableWrapper.classList.remove('hidden');

  elements.candidatesTableBody.innerHTML = candidates.map((candidate) => {
    const status = String(candidate.status || '').toUpperCase();
    const vacancyName = candidate.vaga_nome || candidate.vaga_legacy || 'Não vinculada';
    const vacancyCode = candidate.vaga_codigo || (candidate.vaga_id ? `ID ${candidate.vaga_id}` : 'Sem código');
    const phoneDigits = String(candidate.telefone || '').replace(/\D/g, '');
    const phone = formatPhone(candidate.telefone);
    const phoneContent = phoneDigits
      ? `<a class="phone-link" href="https://wa.me/${escapeHtml(phoneDigits)}" target="_blank" rel="noopener noreferrer">${escapeHtml(phone)}</a>`
      : escapeHtml(phone);
    const personality = candidate.personalidade_resumo ? escapeHtml(candidate.personalidade_resumo) : 'Ainda não analisado';
    const triage = candidate.motivo_reprovacao || candidate.observacao_triagem || 'Sem observação';
    const documentsCount = Number(candidate.quantidade_documentos || 0);
    const interview = candidate.entrevista_inicio ? formatDate(candidate.entrevista_inicio) : 'Não agendada';

    return `
      <tr>
        <td><div class="primary-cell"><strong>${escapeHtml(candidate.nome || 'Nome não informado')}</strong><span>Candidato #${escapeHtml(candidate.id)}</span></div></td>
        <td>${phoneContent}</td>
        <td>${escapeHtml(candidate.cep || 'Não informado')}</td>
        <td><div class="primary-cell"><strong>${escapeHtml(vacancyName)}</strong><span>${escapeHtml(vacancyCode)}</span></div></td>
        <td><span class="badge badge-candidate-${candidateBadgeClass(status)}">${escapeHtml(candidateStatusLabels[status] || status || 'Não informado')}</span></td>
        <td>${escapeHtml(stageLabels[candidate.etapa] || candidate.etapa || 'Não informada')}</td>
        <td><div class="personality-preview" title="${escapeHtml(triage)}">${escapeHtml(triage)}</div></td>
        <td><div class="personality-preview" title="${personality}">${personality}</div></td>
        <td><button class="link-button" type="button" data-candidate-action="details" data-id="${escapeHtml(candidate.id)}">${documentsCount} ${documentsCount === 1 ? 'documento' : 'documentos'}</button></td>
        <td><span class="muted">${escapeHtml(interview)}</span></td>
        <td><span class="muted">${escapeHtml(formatDate(candidate.updated_at))}</span></td>
        <td class="row-actions">
          <button class="button button-small button-secondary" type="button" data-candidate-action="details" data-id="${escapeHtml(candidate.id)}">Detalhes</button>
          <button class="button button-small button-danger" type="button" data-candidate-action="delete" data-id="${escapeHtml(candidate.id)}">Remover</button>
        </td>
      </tr>`;
  }).join('');
}

function renderCandidateDocuments(documents) {
  if (!documents.length) {
    elements.candidateDocumentsEmpty.classList.remove('hidden');
    elements.candidateDocumentsList.innerHTML = '';
    return;
  }

  elements.candidateDocumentsEmpty.classList.add('hidden');
  elements.candidateDocumentsList.innerHTML = documents.map((document) => {
    const download = document.disponivel_download
      ? `<a class="button button-small button-primary" href="/api/documentos/${encodeURIComponent(document.id)}/download">Baixar</a>`
      : `<span class="muted">Download indisponível para arquivo antigo</span>`;

    return `
      <article class="document-item">
        <div>
          <div class="document-title-row"><strong>${escapeHtml(document.titulo || document.tipo || 'Documento')}</strong><span class="document-type document-type-${escapeHtml(String(document.tipo || 'OUTRO').toLowerCase())}">${escapeHtml(document.tipo || 'OUTRO')}</span></div>
          <span>${escapeHtml(document.nome_arquivo || 'Arquivo')} · ${escapeHtml(formatFileSize(document.tamanho_bytes))}</span>
          <span>Recebido em ${escapeHtml(formatDate(document.created_at))}</span>
        </div>
        ${download}
      </article>
    `;
  }).join('');
}

function renderCandidateTimeline(items) {
  if (!items.length) {
    elements.candidateTimelineEmpty.classList.remove('hidden');
    elements.candidateTimeline.innerHTML = '';
    return;
  }

  elements.candidateTimelineEmpty.classList.add('hidden');
  elements.candidateTimeline.innerHTML = items.map((item) => `
    <article class="timeline-item timeline-${escapeHtml(String(item.tipo || '').toLowerCase())}">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <strong>${escapeHtml(item.titulo || item.tipo || 'Registro')}</strong>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
        </div>
        <p>${escapeHtml(item.descricao || 'Sem descrição')}</p>
      </div>
    </article>
  `).join('');
}

function renderCandidateExperiences(experiences) {
  if (!Array.isArray(experiences) || !experiences.length) {
    elements.detailCandidateExperiences.innerHTML = '<div class="state-box compact">Nenhum vínculo válido extraído da CTPS.</div>';
    return;
  }
  elements.detailCandidateExperiences.innerHTML = experiences.map((experience) => `
    <article class="experience-card ${experience.compativel ? 'compatible' : ''}">
      <div><strong>${escapeHtml(experience.cargo || 'Cargo não informado')}</strong><span>${escapeHtml(experience.empregador || 'Empregador não informado')}</span></div>
      <div class="experience-meta"><span>${escapeHtml(experience.periodo || 'Período não informado')}</span><span>${escapeHtml(experience.tempo || '')}</span><span>${escapeHtml(experience.cbo ? `CBO ${experience.cbo}` : 'CBO não informado')}</span></div>
      <span class="badge ${experience.compativel ? 'badge-ATIVA' : 'badge-RASCUNHO'}">${experience.compativel ? 'Compatível' : 'Não compatível'}</span>
    </article>
  `).join('');
}

async function openCandidateDetails(id) {
  elements.candidateDetailsLoading.classList.remove('hidden');
  elements.candidateDetailsContent.classList.add('hidden');
  elements.candidateDialog.showModal();

  try {
    const result = await api(`/api/candidatos/${encodeURIComponent(id)}/detalhes`);
    const candidate = result.candidato;
    const phoneDigits = String(candidate.telefone || '').replace(/\D/g, '');
    const vacancyName = textOrFallback(candidate.vaga_nome || candidate.vaga, 'Não vinculada');
    const stageText = joinNonEmpty([
      candidateStatusLabels[candidate.status] || candidate.status || 'Status não informado',
      stageLabels[candidate.etapa] || candidate.etapa || 'Etapa não informada',
    ]);
    const validJobs = Number(candidate.quantidade_vinculos_validos || 0);
    const tags = Array.isArray(candidate.personalidade_tags)
      ? candidate.personalidade_tags.filter((tag) => hasContent(tag))
      : [];
    const meetUrl = candidate.entrevista_meet_link || candidate.entrevista_google_event_url;
    const rejected = String(candidate.status || '').toUpperCase() === 'REPROVADO';

    state.selectedCandidateId = candidate.id;

    elements.candidateDialogTitle.textContent = candidate.nome || `Candidato #${candidate.id}`;
    elements.detailCandidateName.textContent = textOrFallback(candidate.nome, 'Nome não informado');
    elements.detailCandidatePhone.textContent = formatPhone(candidate.telefone);
    elements.detailCandidatePhone.href = phoneDigits ? `https://wa.me/${phoneDigits}` : '#';
    elements.detailCandidateVacancy.textContent = vacancyName;
    elements.detailCandidateStage.textContent = stageText || 'Status não informado';
    elements.detailCandidateCep.textContent = textOrFallback(candidate.cep, 'Não informado');
    elements.detailCandidateAverageStay.textContent = textOrFallback(candidate.tempo_medio_empresas_texto, 'Não calculada');
    elements.detailCandidateValidJobs.textContent = validJobs
      ? `${validJobs} vínculo(s) válido(s) analisado(s)`
      : 'Nenhum vínculo válido encontrado na análise';
    elements.detailCandidateTriage.textContent = textOrFallback(
      candidate.observacao_triagem || candidate.motivo_reprovacao,
      'Ainda não analisado.',
    );

    elements.candidateRejectionSection.classList.toggle('hidden', !rejected);
    if (rejected) {
      elements.detailCandidateRejectionReason.textContent = textOrFallback(
        candidate.motivo_reprovacao,
        'A reprovação foi registrada sem um motivo detalhado.',
      );
      elements.detailCandidateRejectionObservation.textContent = textOrFallback(
        candidate.observacao_triagem,
        'Sem observação complementar da análise.',
      );
    }

    if (hasContent(candidate.tempo_faltante_experiencia)) {
      elements.detailCandidateMissing.textContent = `Tempo que faltou para o requisito: ${String(candidate.tempo_faltante_experiencia).trim()}.`;
      setHidden(elements.detailCandidateMissing, false);
    } else {
      elements.detailCandidateMissing.textContent = '';
      setHidden(elements.detailCandidateMissing, true);
    }

    renderCandidateExperiences(candidate.experiencias_ctps || []);

    elements.detailCandidatePresentation.textContent = textOrFallback(
      candidate.apresentacao_profissional,
      'Ainda não informado.',
    );

    elements.detailCandidatePersonality.textContent = textOrFallback(
      candidate.personalidade_resumo,
      'Ainda não analisado.',
    );

    if (tags.length) {
      elements.detailCandidateTags.innerHTML = tags
        .map((tag) => `<span class="profile-tag">${escapeHtml(tag)}</span>`)
        .join('');
      setHidden(elements.detailCandidateTags, false);
    } else {
      elements.detailCandidateTags.innerHTML = '';
      setHidden(elements.detailCandidateTags, true);
    }

    if (candidate.entrevista_inicio) {
      const interviewMeta = joinNonEmpty([
        formatDate(candidate.entrevista_inicio),
        candidate.vaga_horario ? `Horário de trabalho: ${candidate.vaga_horario}` : '',
      ]);
      elements.detailCandidateInterview.textContent = interviewMeta || formatDate(candidate.entrevista_inicio);
      if (meetUrl) {
        elements.detailCandidateMeet.href = meetUrl;
        setHidden(elements.detailCandidateMeet, false);
      } else {
        elements.detailCandidateMeet.href = '#';
        setHidden(elements.detailCandidateMeet, true);
      }
    } else {
      const plannedWorkSchedule = joinNonEmpty([
        candidate.vaga_escala ? `Escala ${candidate.vaga_escala}` : '',
        candidate.vaga_horario || '',
      ]);
      elements.detailCandidateInterview.textContent = plannedWorkSchedule || 'Não agendada';
      elements.detailCandidateMeet.href = '#';
      setHidden(elements.detailCandidateMeet, true);
    }

    renderCandidateDocuments(result.documentos || []);
    renderCandidateTimeline(result.timeline || []);

    elements.candidateDetailsLoading.classList.add('hidden');
    elements.candidateDetailsContent.classList.remove('hidden');
  } catch (error) {
    elements.candidateDetailsLoading.textContent = error.message;
    showToast(error.message, 'error');
  }
}

async function deleteCandidate(id) {
  const candidate = state.candidates.find(item => String(item.id) === String(id));
  const name = candidate?.nome || `candidato #${id}`;
  const confirmed = window.confirm(`Remover ${name} e todo o histórico do banco?\n\nEventos já criados no Google Calendar devem ser removidos manualmente.`);
  if (!confirmed) return;
  try {
    const result = await api(`/api/candidatos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (elements.candidateDialog.open) elements.candidateDialog.close();
    showToast([result.mensagem, result.aviso_calendar].filter(Boolean).join(' '));
    await loadCandidates();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function handleCandidateTableClick(event) {
  const button = event.target.closest('[data-candidate-action]');
  if (!button) return;
  if (button.dataset.candidateAction === 'details') openCandidateDetails(button.dataset.id);
  if (button.dataset.candidateAction === 'delete') deleteCandidate(button.dataset.id);
}

function openNewCandidate() {
  elements.candidateCreateForm.reset();
  elements.candidateCreateError.classList.add('hidden');
  elements.candidateVacancySelect.innerHTML = '<option value="">Sem vaga vinculada</option>' +
    state.vacancies.map(v => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.titulo)} — ${escapeHtml(v.codigo)}</option>`).join('');
  elements.candidateCreateDialog.showModal();
}

async function saveCandidate(event) {
  event.preventDefault();
  elements.candidateCreateError.classList.add('hidden');
  elements.saveCandidateButton.disabled = true;
  try {
    const data = new FormData(elements.candidateCreateForm);
    const result = await api('/api/candidatos', {
      method: 'POST',
      body: JSON.stringify({
        nome: data.get('nome'), telefone: data.get('telefone'), cep: data.get('cep'),
        vaga_id: data.get('vaga_id'), status: data.get('status'), etapa: data.get('etapa')
      })
    });
    elements.candidateCreateDialog.close();
    showToast(result.mensagem || 'Candidato adicionado.');
    await loadCandidates();
  } catch (error) {
    elements.candidateCreateError.textContent = error.message;
    elements.candidateCreateError.classList.remove('hidden');
  } finally {
    elements.saveCandidateButton.disabled = false;
  }
}

async function loadCompanies() {
  const result = await api('/api/empresas');
  state.companies = result.empresas;
  elements.companySelect.innerHTML = state.companies
    .map((company) => `<option value="${company.id}">${escapeHtml(company.nome)}</option>`)
    .join('');
}

async function loadVacancies() {
  setVacanciesLoading(true);
  try {
    const result = await api('/api/vagas');
    state.vacancies = result.vagas;
    renderVacancies();
  } catch (error) {
    elements.emptyState.classList.remove('hidden');
    elements.emptyState.innerHTML = `<strong>Não foi possível carregar as vagas.</strong><span>${escapeHtml(error.message)}</span>`;
    showToast(error.message, 'error');
  } finally {
    setVacanciesLoading(false);
  }
}

async function loadCandidates() {
  setCandidatesLoading(true);
  try {
    const result = await api('/api/candidatos');
    state.candidates = result.candidatos || [];
    state.candidateSummary = result.resumo || state.candidateSummary;
    state.candidatesLoaded = true;
    renderCandidates();
  } catch (error) {
    elements.candidatesEmptyState.classList.remove('hidden');
    elements.candidatesEmptyState.innerHTML = `<strong>Não foi possível carregar os candidatos.</strong><span>${escapeHtml(error.message)}</span>`;
    showToast(error.message, 'error');
  } finally {
    setCandidatesLoading(false);
  }
}


const aiActionConfig = {
  GERAR_TODOS: {
    title: 'Preencher campos da vaga com IA',
    fields: [
      'descricao',
      'cargos_compativeis',
      'cbos_compativeis',
      'requisitos_obrigatorios',
      'requisitos_desejaveis',
    ],
  },
  GERAR_DESCRICAO: {
    title: 'Gerar descrição da vaga',
    fields: ['descricao'],
  },
  SUGERIR_CARGOS: {
    title: 'Sugerir cargos compatíveis',
    fields: ['cargos_compativeis'],
  },
  SUGERIR_CBOS: {
    title: 'Sugerir CBOs compatíveis',
    fields: ['cbos_compativeis'],
  },
  GERAR_REQUISITOS_OBRIGATORIOS: {
    title: 'Gerar requisitos obrigatórios',
    fields: ['requisitos_obrigatorios'],
  },
  GERAR_REQUISITOS_DESEJAVEIS: {
    title: 'Gerar requisitos desejáveis',
    fields: ['requisitos_desejaveis'],
  },
};

const aiPreviewElements = {
  descricao: elements.aiPreviewDescricao,
  cargos_compativeis: elements.aiPreviewCargos,
  cbos_compativeis: elements.aiPreviewCbos,
  requisitos_obrigatorios: elements.aiPreviewObrigatorios,
  requisitos_desejaveis: elements.aiPreviewDesejaveis,
};

function vacancyPayloadForAi() {
  const form = elements.vacancyForm.elements;

  return {
    titulo: String(form.titulo?.value || '').trim(),
    cargo: String(form.cargo?.value || '').trim(),
    descricao: String(form.descricao?.value || '').trim(),
    cidade: String(form.cidade?.value || '').trim(),
    estado: String(form.estado?.value || '').trim(),
    bairro: String(form.bairro?.value || '').trim(),
    tipo_contrato: String(form.tipo_contrato?.value || '').trim(),
    modalidade: String(form.modalidade?.value || '').trim(),
    escala: String(form.escala?.value || '').trim(),
    horario: String(form.horario?.value || '').trim(),
    salario: form.salario?.value || null,
    beneficios: String(form.beneficios?.value || '').trim(),
    escolaridade_minima: String(form.escolaridade_minima?.value || '').trim(),
    experiencia_minima_meses: form.experiencia_minima_meses?.value || 0,
    aceita_sem_experiencia: Boolean(form.aceita_sem_experiencia?.checked),
    exigir_experiencia_compativel: Boolean(form.exigir_experiencia_compativel?.checked),
    cargos_compativeis: String(form.cargos_compativeis?.value || '').trim(),
    cbos_compativeis: String(form.cbos_compativeis?.value || '').trim(),
    requisitos_obrigatorios: String(form.requisitos_obrigatorios?.value || '').trim(),
    requisitos_desejaveis: String(form.requisitos_desejaveis?.value || '').trim(),
  };
}

function setAiVacancyLoading(isLoading) {
  elements.aiVacancyLoading.classList.toggle('hidden', !isLoading);
  elements.aiVacancyPreview.classList.toggle('hidden', isLoading);
  elements.applyAiVacancyButton.classList.toggle('hidden', isLoading);
  elements.generateVacancyAiButton.disabled = isLoading;
  elements.aiFieldButtons.forEach((button) => {
    button.disabled = isLoading;
  });
}

function showAiVacancyError(message) {
  elements.aiVacancyError.textContent = message;
  elements.aiVacancyError.classList.remove('hidden');
  elements.aiVacancyLoading.classList.add('hidden');
  elements.aiVacancyPreview.classList.add('hidden');
  elements.applyAiVacancyButton.classList.add('hidden');
}

function configureAiPreview(action, suggestions, warnings = []) {
  const config = aiActionConfig[action] || aiActionConfig.GERAR_TODOS;
  const visibleFields = new Set(config.fields);
  const cboDetails = Array.isArray(suggestions.cbo_detalhes) ? suggestions.cbo_detalhes : [];
  const cboSummary = cboDetails.length
    ? ` CBOs sugeridos: ${cboDetails.map((item) => `${item.codigo}${item.titulo ? ` — ${item.titulo}` : ''} (${item.confianca || 'MEDIA'})`).join('; ')}.`
    : '';

  elements.aiVacancyDialogTitle.textContent = config.title;
  elements.aiVacancyWarnings.textContent = (warnings.length
    ? warnings.join(' ')
    : 'Revise as sugestões antes de aplicá-las ao formulário.') + cboSummary;

  document.querySelectorAll('[data-ai-preview-field]').forEach((card) => {
    const field = card.dataset.aiPreviewField;
    const value = String(suggestions[field] ?? '').trim();
    const visible = visibleFields.has(field) && Boolean(value);
    card.classList.toggle('hidden', !visible);

    const checkbox = card.querySelector('[data-ai-apply-field]');
    if (checkbox) checkbox.checked = visible;
  });

  Object.entries(aiPreviewElements).forEach(([field, textarea]) => {
    textarea.value = String(suggestions[field] ?? '').trim();
  });

  const hasVisibleSuggestion = [...visibleFields].some(
    (field) => String(suggestions[field] ?? '').trim(),
  );

  if (!hasVisibleSuggestion) {
    throw new Error('A IA não retornou conteúdo para o campo solicitado.');
  }
}

async function generateVacancySuggestions(action) {
  const config = aiActionConfig[action];
  if (!config) return;

  const vaga = vacancyPayloadForAi();

  if (!vaga.titulo && !vaga.cargo) {
    showToast('Preencha pelo menos o título ou o cargo da vaga antes de usar a IA.', 'error');
    elements.vacancyForm.elements.titulo?.focus();
    return;
  }

  state.aiVacancyAction = action;
  state.aiVacancySuggestions = null;

  elements.aiVacancyDialogTitle.textContent = config.title;
  elements.aiVacancyError.classList.add('hidden');
  elements.aiVacancyError.textContent = '';
  elements.aiVacancyPreview.classList.add('hidden');
  elements.applyAiVacancyButton.classList.add('hidden');
  elements.aiVacancyLoading.classList.remove('hidden');

  if (!elements.aiVacancyDialog.open) {
    elements.aiVacancyDialog.showModal();
  }

  setAiVacancyLoading(true);

  try {
    const result = await api('/api/ia/vagas/gerar', {
      method: 'POST',
      body: JSON.stringify({ acao: action, vaga }),
    });

    const suggestions = result.sugestoes || {};
    configureAiPreview(action, suggestions, result.avisos || []);
    state.aiVacancySuggestions = suggestions;

    elements.aiVacancyLoading.classList.add('hidden');
    elements.aiVacancyPreview.classList.remove('hidden');
    elements.applyAiVacancyButton.classList.remove('hidden');
  } catch (error) {
    showAiVacancyError(error.message);
  } finally {
    setAiVacancyLoading(false);

    if (!state.aiVacancySuggestions) {
      elements.aiVacancyPreview.classList.add('hidden');
      elements.applyAiVacancyButton.classList.add('hidden');
    }
  }
}

function applyVacancyAiSuggestions() {
  const suggestions = state.aiVacancySuggestions;
  if (!suggestions) return;

  let applied = 0;

  document.querySelectorAll('[data-ai-apply-field]').forEach((checkbox) => {
    const field = checkbox.dataset.aiApplyField;
    if (!checkbox.checked) return;

    const value = String(suggestions[field] ?? '').trim();
    const input = elements.vacancyForm.elements[field];

    if (!input || !value) return;

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    applied += 1;
  });

  elements.aiVacancyDialog.close();

  if (applied) {
    showToast(`${applied} ${applied === 1 ? 'campo aplicado' : 'campos aplicados'} ao formulário. Revise antes de salvar.`);
  } else {
    showToast('Nenhuma sugestão foi selecionada.', 'error');
  }
}

function resetForm() {
  elements.vacancyForm.reset();
  elements.vacancyId.value = '';
  elements.dialogTitle.textContent = 'Nova vaga';
  elements.formError.textContent = '';
  elements.formError.classList.add('hidden');
  elements.vacancyForm.elements.estado.value = 'SP';
  elements.vacancyForm.elements.modalidade.value = 'Presencial';
  elements.vacancyForm.elements.status.value = 'RASCUNHO';
  elements.vacancyForm.elements.quantidade_vagas.value = '1';
  elements.vacancyForm.elements.experiencia_minima_meses.value = '0';
  elements.vacancyForm.elements.exigir_experiencia_compativel.checked = true;
  elements.saveButton.textContent = 'Salvar vaga';

  if (state.companies.length === 1) {
    elements.companySelect.value = String(state.companies[0].id);
  }
}

function fillForm(vacancy) {
  resetForm();
  elements.vacancyId.value = String(vacancy.id);
  elements.dialogTitle.textContent = `Editar ${vacancy.codigo}`;

  const fields = [
    'empresa_id', 'titulo', 'cargo', 'descricao', 'cidade', 'estado',
    'bairro', 'endereco_referencia', 'tipo_contrato', 'modalidade', 'escala',
    'horario', 'salario', 'beneficios', 'escolaridade_minima',
    'experiencia_minima_meses', 'cargos_compativeis', 'cbos_compativeis', 'requisitos_obrigatorios',
    'requisitos_desejaveis', 'quantidade_vagas', 'formulario_url', 'status',
    'data_inicio', 'data_encerramento',
  ];

  fields.forEach((field) => {
    const input = elements.vacancyForm.elements[field];
    if (!input) return;
    let value = vacancy[field] ?? '';
    if ((field === 'data_inicio' || field === 'data_encerramento') && value) {
      value = String(value).slice(0, 10);
    }
    input.value = value;
  });

  elements.vacancyForm.elements.aceita_sem_experiencia.checked = Boolean(vacancy.aceita_sem_experiencia);
  elements.vacancyForm.elements.exigir_experiencia_compativel.checked = vacancy.exigir_experiencia_compativel !== false;
}

function openNewVacancy() {
  resetForm();
  elements.vacancyDialog.showModal();
}

function findVacancyById(id) {
  return state.vacancies.find((item) => String(item.id) === String(id));
}

function openEditVacancy(id) {
  const vacancy = findVacancyById(id);
  if (!vacancy) {
    showToast('Não foi possível localizar a vaga selecionada.', 'error');
    return;
  }
  fillForm(vacancy);
  elements.vacancyDialog.showModal();
}

function openDuplicateVacancy(id) {
  const vacancy = findVacancyById(id);

  if (!vacancy) {
    showToast('Não foi possível localizar a vaga selecionada.', 'error');
    return;
  }

  // Reaproveita todos os dados úteis da vaga original, mas transforma
  // o formulário em um novo cadastro. O servidor criará outro código.
  fillForm(vacancy);
  elements.vacancyId.value = '';
  elements.dialogTitle.textContent = `Duplicar ${vacancy.titulo}`;
  elements.vacancyForm.elements.status.value = 'RASCUNHO';
  elements.vacancyForm.elements.data_inicio.value = '';
  elements.vacancyForm.elements.data_encerramento.value = '';
  elements.saveButton.textContent = 'Criar cópia';
  elements.formError.textContent = '';
  elements.formError.classList.add('hidden');
  elements.vacancyDialog.showModal();

  showToast('Cópia preparada. Ajuste endereço, horário ou outros dados antes de salvar.');
}

function formPayload() {
  const data = new FormData(elements.vacancyForm);
  return {
    empresa_id: data.get('empresa_id'),
    titulo: data.get('titulo'),
    cargo: data.get('cargo'),
    descricao: data.get('descricao'),
    cidade: data.get('cidade'),
    estado: data.get('estado'),
    bairro: data.get('bairro'),
    endereco_referencia: data.get('endereco_referencia'),
    tipo_contrato: data.get('tipo_contrato'),
    modalidade: data.get('modalidade'),
    escala: data.get('escala'),
    horario: data.get('horario'),
    salario: data.get('salario'),
    beneficios: data.get('beneficios'),
    escolaridade_minima: data.get('escolaridade_minima'),
    experiencia_minima_meses: data.get('experiencia_minima_meses'),
    aceita_sem_experiencia: elements.vacancyForm.elements.aceita_sem_experiencia.checked,
    exigir_experiencia_compativel: elements.vacancyForm.elements.exigir_experiencia_compativel.checked,
    cargos_compativeis: data.get('cargos_compativeis'),
    cbos_compativeis: data.get('cbos_compativeis'),
    requisitos_obrigatorios: data.get('requisitos_obrigatorios'),
    requisitos_desejaveis: data.get('requisitos_desejaveis'),
    quantidade_vagas: data.get('quantidade_vagas'),
    formulario_url: data.get('formulario_url'),
    status: data.get('status'),
    data_inicio: data.get('data_inicio'),
    data_encerramento: data.get('data_encerramento'),
  };
}

async function saveVacancy(event) {
  event.preventDefault();
  elements.formError.classList.add('hidden');
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = 'Salvando...';

  try {
    const id = Number(elements.vacancyId.value || 0);
    const result = await api(id ? `/api/vagas/${id}` : '/api/vagas', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(formPayload()),
    });

    elements.vacancyDialog.close();
    showToast(result.mensagem || 'Vaga salva com sucesso.');
    await Promise.all([loadVacancies(), state.candidatesLoaded ? loadCandidates() : Promise.resolve()]);
  } catch (error) {
    elements.formError.textContent = error.message;
    elements.formError.classList.remove('hidden');
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Salvar vaga';
  }
}

async function changeStatus(id, status) {
  const vacancy = findVacancyById(id);
  if (!vacancy) {
    showToast('Não foi possível localizar a vaga selecionada.', 'error');
    return;
  }

  const action = vacancyStatusLabels[status] || status;
  const confirmed = window.confirm(`Alterar a vaga ${vacancy.codigo} para "${action}"?`);
  if (!confirmed) return;

  try {
    const result = await api(`/api/vagas/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast(result.mensagem || 'Status alterado.');
    await loadVacancies();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function resetPromotionDialog() {
  elements.promotionWhatsappText.value = '';
  elements.promotionFacebookText.value = '';
  elements.promotionImagePreview.removeAttribute('src');
  elements.promotionImagePreview.alt = 'Prévia da arte de divulgação da vaga';
  elements.downloadPromotionImageButton.dataset.imageUrl = '';
  elements.downloadPromotionImageButton.dataset.filename = 'divulgacao-vaga.png';
}

function setPromotionLoading(isLoading) {
  elements.promotionLoading.classList.toggle('hidden', !isLoading);
  elements.promotionContent.classList.toggle('hidden', isLoading);
  elements.copyPromotionWhatsappButton.disabled = isLoading;
  elements.copyPromotionFacebookButton.disabled = isLoading;
}

async function openPromotionDialog(id) {
  const vacancy = findVacancyById(id);
  if (!vacancy) {
    showToast('Não foi possível localizar a vaga selecionada.', 'error');
    return;
  }

  resetPromotionDialog();
  elements.promotionDialogTitle.textContent = `Divulgar ${vacancy.codigo} · ${vacancy.titulo}`;
  setPromotionLoading(true);
  elements.promotionDialog.showModal();

  try {
    const result = await api(`/api/vagas/${id}/divulgacao`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const promo = result.divulgacao || {};
    elements.promotionWhatsappText.value = promo.whatsapp_texto || '';
    elements.promotionFacebookText.value = promo.facebook_texto || promo.whatsapp_texto || '';
    if (promo.imagem_data_url) {
      elements.promotionImagePreview.src = promo.imagem_data_url;
      elements.downloadPromotionImageButton.dataset.imageUrl = promo.imagem_data_url;
    }
    const baseFilename = String(promo.nome_arquivo || 'divulgacao-vaga.svg')
      .replace(/\.svg$/i, '');
    elements.downloadPromotionImageButton.dataset.filename = `${baseFilename}.png`;
    elements.promotionImagePreview.alt = `Arte da vaga ${vacancy.titulo}`;
    setPromotionLoading(false);
  } catch (error) {
    elements.promotionDialog.close();
    showToast(error.message, 'error');
  }
}

function closePromotionDialog() {
  elements.promotionDialog.close();
}

async function downloadPromotionPng() {
  const imageUrl = elements.downloadPromotionImageButton.dataset.imageUrl;

  if (!imageUrl) {
    showToast('A imagem ainda não está disponível.', 'error');
    return;
  }

  const image = new Image();

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Não foi possível preparar a imagem.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png', 0.95);
    });

    if (!blob) {
      throw new Error('Não foi possível converter a arte para PNG.');
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = elements.downloadPromotionImageButton.dataset.filename || 'divulgacao-vaga.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    showToast('Imagem PNG baixada.');
  } catch (error) {
    showToast(error.message || 'Não foi possível baixar a imagem.', 'error');
  }
}

function handleVacancyTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'edit') openEditVacancy(id);
  if (action === 'duplicate') openDuplicateVacancy(id);
  if (action === 'promote') openPromotionDialog(id);
  if (action === 'status') changeStatus(id, button.dataset.status);
}

function applyCandidateFilter(filter) {
  elements.candidateStatusFilter.value = filter;
  renderCandidates();
}

elements.dashboardTab.addEventListener('click', () => switchView('dashboard'));
elements.vacanciesTab.addEventListener('click', () => switchView('vacancies'));
elements.candidatesTab.addEventListener('click', () => switchView('candidates'));
elements.refreshDashboardButton.addEventListener('click', loadDashboard);
elements.dashboardContent.addEventListener('click', handleDashboardClick);
elements.newVacancyButton.addEventListener('click', openNewVacancy);
elements.newCandidateButton.addEventListener('click', openNewCandidate);
elements.generateVacancyAiButton.addEventListener('click', () => generateVacancySuggestions('GERAR_TODOS'));
elements.aiFieldButtons.forEach((button) => {
  button.addEventListener('click', () => generateVacancySuggestions(button.dataset.aiAction));
});
elements.refreshButton.addEventListener('click', loadVacancies);
elements.searchInput.addEventListener('input', renderVacancies);
elements.statusFilter.addEventListener('change', renderVacancies);
elements.vacancyForm.addEventListener('submit', saveVacancy);
elements.tableBody.addEventListener('click', handleVacancyTableClick);
elements.closeDialogButton.addEventListener('click', () => elements.vacancyDialog.close());
elements.cancelButton.addEventListener('click', () => elements.vacancyDialog.close());

elements.refreshCandidatesButton.addEventListener('click', loadCandidates);
elements.candidatesTableBody.addEventListener('click', handleCandidateTableClick);
elements.candidateSearchInput.addEventListener('input', renderCandidates);
elements.candidateStatusFilter.addEventListener('change', renderCandidates);
elements.candidateStatCards.forEach((card) => {
  const filter = card.dataset.candidateFilter;
  card.addEventListener('click', () => applyCandidateFilter(filter));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      applyCandidateFilter(filter);
    }
  });
});

elements.closeCandidateDialogButton.addEventListener('click', () => elements.candidateDialog.close());
elements.closePromotionDialogButton.addEventListener('click', closePromotionDialog);
elements.closePromotionFooterButton.addEventListener('click', closePromotionDialog);
elements.copyPromotionWhatsappButton.addEventListener('click', () => copyTextToClipboard(elements.promotionWhatsappText.value, 'Texto de WhatsApp copiado.'));
elements.copyPromotionFacebookButton.addEventListener('click', () => copyTextToClipboard(elements.promotionFacebookText.value, 'Texto de Facebook copiado.'));
elements.downloadPromotionImageButton.addEventListener('click', downloadPromotionPng);
elements.deleteCandidateDetailsButton.addEventListener('click', () => { if (state.selectedCandidateId) deleteCandidate(state.selectedCandidateId); });
elements.candidateCreateForm.addEventListener('submit', saveCandidate);
elements.closeCandidateCreateButton.addEventListener('click', () => elements.candidateCreateDialog.close());
elements.cancelCandidateCreateButton.addEventListener('click', () => elements.candidateCreateDialog.close());
elements.candidateDialog.addEventListener('click', (event) => {
  if (event.target === elements.candidateDialog) {
    elements.candidateDialog.close();
  }
});

elements.candidateCreateDialog.addEventListener('click', (event) => {
  if (event.target === elements.candidateCreateDialog) elements.candidateCreateDialog.close();
});

elements.closeAiVacancyDialogButton.addEventListener('click', () => elements.aiVacancyDialog.close());
elements.cancelAiVacancyButton.addEventListener('click', () => elements.aiVacancyDialog.close());
elements.applyAiVacancyButton.addEventListener('click', applyVacancyAiSuggestions);
elements.aiVacancyDialog.addEventListener('click', (event) => {
  if (event.target === elements.aiVacancyDialog) {
    elements.aiVacancyDialog.close();
  }
});

elements.vacancyDialog.addEventListener('click', (event) => {
  if (event.target === elements.vacancyDialog) {
    elements.vacancyDialog.close();
  }
});

async function initialize() {
  try {
    await loadCompanies();
    await loadVacancies();
    await loadDashboard();
    switchView('dashboard');
  } catch (error) {
    setVacanciesLoading(false);
    showToast(error.message, 'error');
  }
}

initialize();
