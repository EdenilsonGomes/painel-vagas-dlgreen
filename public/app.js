'use strict';

const state = {
  activeView: 'dashboard',
  dashboard: null,
  vacancies: [],
  vacancyStatus: 'TODAS',
  companies: [],
  candidates: [],
  candidateSummary: { total: 0, em_processo: 0, aprovados: 0, em_admissao: 0, contratados: 0, reprovados: 0 },
  candidateStatus: 'TODOS',
  candidateMode: 'table',
  selectedCandidateId: null,
  selectedCandidate: null,
  selectedCandidateExtras: { notes: [], tasks: [], tags: [], selectedTags: [] },
  interviews: [],
  interviewPeriod: 'PROXIMAS',
  documents: [],
  documentType: 'TODOS',
  monitoring: null,
  promotion: null,
  searchTimer: null,
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
  GERANDO_OPCOES_ENTREVISTA: 'Gerando opções de entrevista',
  ESCOLHENDO_HORARIO: 'Escolhendo horário',
  AGUARDANDO_ENTREVISTA: 'Aguardando entrevista',
  ENTREVISTA_AGENDADA: 'Entrevista agendada',
  EM_ADMISSAO: 'Em admissão',
  REPROVADO_POS_ENTREVISTA: 'Reprovado após entrevista',
  CONTRATADO: 'Contratado',
  ENCERRADO: 'Encerrado',
};

const statusLabels = {
  NOVO: 'Novo',
  EM_PROCESSO: 'Em processo',
  APROVADO: 'Aprovado na triagem',
  EM_ADMISSAO: 'Em admissão',
  REPROVADO: 'Reprovado',
  CONTRATADO: 'Contratado',
  ENCERRADO: 'Encerrado',
};

const vacancyStatusLabels = {
  ATIVA: 'Ativa',
  RASCUNHO: 'Rascunho',
  PAUSADA: 'Pausada',
  ENCERRADA: 'Encerrada',
};

const viewMeta = {
  dashboard: ['OPERAÇÃO', 'Visão geral', 'Funil, entrevistas e resultados da operação de recrutamento.', '+ Nova vaga'],
  vacancies: ['OPORTUNIDADES', 'Vagas', 'Crie, duplique, divulgue e acompanhe o desempenho das vagas.', '+ Nova vaga'],
  candidates: ['PESSOAS', 'Candidatos', 'Acompanhe cada candidato em tabela ou pipeline.', '+ Novo candidato'],
  interviews: ['AGENDA', 'Entrevistas', 'Compromissos, horários e links do Google Meet.', 'Atualizar agenda'],
  documents: ['ARQUIVOS', 'Documentos', 'CTPS, currículos e PDFs que precisam de revisão.', 'Atualizar arquivos'],
  monitoring: ['OBSERVABILIDADE', 'Monitoramento', 'Entradas, erros e sinais de saúde da automação.', 'Atualizar monitoramento'],
};

const el = Object.fromEntries([
  'sidebar', 'mobileMenuButton', 'pageEyebrow', 'pageTitle', 'pageSubtitle',
  'globalSearchButton', 'refreshCurrentViewButton', 'primaryActionButton',
  'dashboardUpdatedAt', 'dashboardHealthText', 'kpiActiveCandidates', 'kpiActiveVacancies',
  'kpiInterviewsToday', 'kpiApprovedTriage', 'kpiAdmission', 'kpiHired',
  'dashboardFunnel', 'dashboardInterviews',
  'vacancyStatusSegments', 'vacancySearchInput', 'vacancyKpiActive', 'vacancyKpiInterested',
  'vacancyKpiInProcess', 'vacancyKpiApproved', 'vacanciesLoading', 'vacanciesEmpty',
  'vacanciesTableWrapper', 'vacanciesTableBody', 'candidateStatusSegments', 'candidateSearchInput',
  'candidateTableMode', 'candidateKanbanMode', 'candidateKpiTotal', 'candidateKpiProcess',
  'candidateKpiApproved', 'candidateKpiAdmission', 'candidateKpiHired', 'candidateKpiRejected', 'candidateTableContainer', 'candidateKanbanContainer',
  'candidatesLoading', 'candidatesEmpty', 'candidatesTableWrapper', 'candidatesTableBody',
  'interviewPeriodSegments', 'interviewsList', 'documentTypeSegments', 'documentSearchInput',
  'documentsList', 'monitorKpiEntries', 'monitorKpiUnlinked', 'monitorKpiErrors', 'monitorKpiDocs',
  'monitorKpiFollowups', 'monitorKpiPromotions', 'monitorAlertCount', 'monitorAlerts',
  'monitorErrors', 'monitorHealth', 'monitorLogs', 'monitorRecentCandidates', 'monitorActivity',
  'monitorFollowups', 'monitorPromotions', 'globalSearchDialog', 'globalSearchInput',
  'closeGlobalSearchButton', 'globalSearchResults', 'vacancyDialog', 'vacancyForm',
  'vacancyDialogTitle', 'vacancyId', 'empresa_id', 'generateVacancyAiButton', 'closeVacancyDialogButton',
  'cancelVacancyButton', 'saveVacancyButton', 'vacancyFormError', 'possui_insalubridade',
  'insalubrityFields', 'aiVacancyDialog', 'closeAiVacancyButton', 'cancelAiVacancyButton',
  'applyAiVacancyButton', 'aiVacancyLoading', 'aiVacancyContent', 'aiVacancyError',
  'aiPreviewDescricao', 'aiPreviewCargos', 'aiPreviewCbos', 'aiPreviewObrigatorios',
  'aiPreviewDesejaveis', 'promotionDialog', 'promotionTitle', 'closePromotionButton',
  'promotionWhatsappText', 'promotionFacebookText', 'copyWhatsappPromotionButton',
  'copyFacebookPromotionButton', 'promotionPrimaryImage', 'promotionDetailsImage',
  'detailsPreviewCard', 'downloadPrimaryPromotionButton', 'downloadDetailsPromotionButton',
  'candidateDrawer', 'closeCandidateDrawerButton', 'candidateDrawerTitle', 'candidateDrawerSubtitle',
  'candidateDrawerLoading', 'candidateDrawerContent', 'candidateAvatar', 'candidateName',
  'candidatePhone', 'candidateLabels', 'candidateWhatsappButton', 'deleteCandidateButton',
  'candidateVacancy', 'candidateStage', 'candidateCep', 'candidateInterview', 'candidateMeetLink',
  'candidateTriageSection', 'candidateTriage', 'candidateExperiences', 'candidateRejectionSection',
  'candidateRejectionReason', 'candidateRejectionObservation', 'candidatePresentationSection',
  'candidatePresentation', 'candidatePersonalitySection', 'candidatePersonality',
  'candidatePersonalityTags', 'candidateStatusSelect', 'candidateStageSelect', 'updateCandidateButton',
  'postInterviewDecisionSection', 'postInterviewDecision', 'postInterviewReasonField', 'postInterviewReason',
  'postInterviewObservation', 'savePostInterviewDecisionButton',
  'candidateDocuments', 'candidateTimeline', 'candidateTagSelector', 'saveCandidateTagsButton',
  'candidateNoteInput', 'addCandidateNoteButton', 'candidateNotes', 'candidateTaskTitle',
  'candidateTaskPriority', 'candidateTaskDue', 'addCandidateTaskButton', 'candidateTasks',
  'newCandidateDialog', 'newCandidateForm', 'closeNewCandidateButton', 'cancelNewCandidateButton',
  'saveNewCandidateButton', 'newCandidateVacancy', 'newCandidateError',
  'currentUserName', 'currentUserAvatar', 'logoutButton', 'toast',
].map((id) => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function safeText(value, fallback = 'Não informado') {
  return hasValue(value) ? String(value).trim() : fallback;
}

function formatDate(value, options = {}) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: options.dateOnly ? 'short' : 'short',
    ...(options.dateOnly ? {} : { timeStyle: 'short' }),
  }).format(date);
}

function formatTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value || 'Não informado';
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 'A combinar';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(number) + '%';
}

function formatFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Tamanho não informado';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

function initials(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.slice(0, 2) || '?').toUpperCase();
}

function showToast(message, type = 'success') {
  el.toast.textContent = String(message || 'Concluído.');
  el.toast.className = `toast ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 3500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    window.location.replace('/login');
    throw new Error('Sua sessão expirou.');
  }
  if (!response.ok) {
    const details = Array.isArray(body.detalhes) ? body.detalhes.map((item) => `${item.campo}: ${item.mensagem}`).join(' | ') : '';
    throw new Error([body.erro || `Erro HTTP ${response.status}`, details].filter(Boolean).join(' — '));
  }
  return body;
}

function emptyState(title, description = '') {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ''}</div>`;
}

function badgeClass(status) {
  const value = String(status || '').toUpperCase();
  if (['ATIVA', 'APROVADO', 'EM_ADMISSAO', 'CONTRATADO', 'AGENDADA', 'CONCLUIDA'].includes(value)) return 'badge-active';
  if (['NOVO', 'EM_PROCESSO', 'PENDENTE', 'EM_ANDAMENTO'].includes(value)) return 'badge-process';
  if (['REPROVADO', 'ENCERRADA', 'CANCELADA', 'AUSENTE'].includes(value)) return 'badge-rejected';
  return 'badge-neutral';
}

function setView(name) {
  state.activeView = name;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  const meta = viewMeta[name] || viewMeta.dashboard;
  el.pageEyebrow.textContent = meta[0];
  el.pageTitle.textContent = meta[1];
  el.pageSubtitle.textContent = meta[2];
  el.primaryActionButton.textContent = meta[3];
  el.sidebar.classList.remove('open');
  loadCurrentView();
}

async function loadCurrentView(force = false) {
  try {
    if (state.activeView === 'dashboard') await loadDashboard(force);
    if (state.activeView === 'vacancies') await loadVacancies(force);
    if (state.activeView === 'candidates') await loadCandidates(force);
    if (state.activeView === 'interviews') await loadInterviews(force);
    if (state.activeView === 'documents') await loadDocuments(force);
    if (state.activeView === 'monitoring') await loadMonitoring(force);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadDashboard() {
  const data = await api('/api/dashboard');
  state.dashboard = data;
  renderDashboard();
}

function renderDashboard() {
  const data = state.dashboard || {};
  const metrics = data.metricas || {};
  el.dashboardUpdatedAt.textContent = `Atualizado em ${formatDate(data.atualizado_em)}`;
  el.kpiActiveCandidates.textContent = Number(metrics.em_processo || 0);
  el.kpiActiveVacancies.textContent = Number(metrics.vagas_ativas || 0);
  el.kpiInterviewsToday.textContent = Number(metrics.entrevistas_hoje || 0);
  el.kpiApprovedTriage.textContent = Number(metrics.aprovados_triagem || 0);
  el.kpiAdmission.textContent = Number(metrics.em_admissao || 0);
  el.kpiHired.textContent = Number(metrics.contratados || 0);

  const funnelRows = data.funil || [];
  const normalized = funnelRows.map((row) => ({
    label: stageLabels[row.etapa] || String(row.etapa || 'Sem etapa').replaceAll('_', ' '),
    count: Number(row.quantidade || 0),
  }));
  const max = Math.max(1, ...normalized.map((item) => item.count));
  el.dashboardFunnel.innerHTML = normalized.length ? normalized.map((item) => `
    <div class="funnel-row"><span>${escapeHtml(item.label)}</span><div class="funnel-bar"><i style="width:${Math.max(item.count ? 7 : 0, item.count / max * 100)}%"></i></div><strong>${item.count}</strong></div>
  `).join('') : emptyState('Nenhum processo ativo', 'Novos candidatos aparecerão no funil.');

  const interviews = data.proximas_entrevistas || [];
  el.dashboardInterviews.innerHTML = interviews.length ? interviews.map((item) => `
    <button class="compact-item" data-action="open-candidate" data-id="${item.candidato_id}" type="button">
      <span class="compact-avatar">${escapeHtml(formatTime(item.inicio))}</span>
      <span><strong>${escapeHtml(item.candidato_nome)}</strong><small>${escapeHtml(item.vaga_nome)}</small></span>
      <time>${escapeHtml(formatDate(item.inicio, { dateOnly: true }))}</time>
    </button>
  `).join('') : emptyState('Nenhuma entrevista futura', 'Os próximos agendamentos aparecerão aqui.');
}

async function resolveAlert(key) {
  await api('/api/alertas/resolver', { method: 'POST', body: JSON.stringify({ chave: key }) });
  showToast('Alerta resolvido.');
  await loadMonitoring(true);
}

async function loadCompanies() {
  if (state.companies.length) return;
  const data = await api('/api/empresas');
  state.companies = data.empresas || [];
  el.empresa_id.innerHTML = state.companies.map((company) => `<option value="${company.id}">${escapeHtml(company.nome)}</option>`).join('');
}

async function loadVacancies() {
  const data = await api('/api/vagas');
  state.vacancies = data.vagas || [];
  renderVacancies();
}

function filteredVacancies() {
  const q = String(el.vacancySearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  return state.vacancies.filter((vacancy) => {
    const statusMatches = state.vacancyStatus === 'TODAS' || vacancy.status === state.vacancyStatus;
    const haystack = [vacancy.codigo, vacancy.titulo, vacancy.cargo, vacancy.bairro, vacancy.cidade, vacancy.horario].join(' ').toLocaleLowerCase('pt-BR');
    return statusMatches && (!q || haystack.includes(q));
  });
}

function renderVacancies() {
  const vacancies = filteredVacancies();
  el.vacanciesLoading.classList.add('hidden');
  el.vacancyKpiActive.textContent = state.vacancies.filter((v) => v.status === 'ATIVA').length;
  el.vacancyKpiInterested.textContent = state.vacancies.reduce((sum, v) => sum + Number(v.total_interessados || 0), 0);
  el.vacancyKpiInProcess.textContent = state.vacancies.reduce((sum, v) => sum + Number(v.candidatos_em_processo || 0), 0);
  el.vacancyKpiApproved.textContent = state.vacancies.reduce((sum, v) => sum + Number(v.candidatos_aprovados || 0), 0);

  if (!vacancies.length) {
    el.vacanciesEmpty.classList.remove('hidden');
    el.vacanciesTableWrapper.classList.add('hidden');
    return;
  }
  el.vacanciesEmpty.classList.add('hidden');
  el.vacanciesTableWrapper.classList.remove('hidden');

  el.vacanciesTableBody.innerHTML = vacancies.map((v) => {
    const location = [v.bairro, v.cidade, v.estado].filter(Boolean).join(' · ') || 'Local não informado';
    const schedule = [v.escala ? `Escala ${v.escala}` : '', v.horario || 'Horário a confirmar'].filter(Boolean).join(' · ');
    const insalubrity = v.possui_insalubridade ? `<span class="insalubrity-chip">Insalubridade ${escapeHtml(formatPercent(v.percentual_insalubridade) || 'ativa')}</span>` : '';
    return `
      <tr>
        <td><div class="primary-cell"><strong>${escapeHtml(v.titulo)}</strong><span>${escapeHtml(v.codigo)} · ${escapeHtml(v.empresa_nome || '')}</span></div></td>
        <td><div class="schedule-lines"><strong>${escapeHtml(location)}</strong><small>${escapeHtml(schedule)}</small></div></td>
        <td><div class="remuneration-lines"><strong>${escapeHtml(formatMoney(v.salario))}</strong>${insalubrity}</div></td>
        <td><div class="metric-chips"><span class="metric-chip">Interessados ${Number(v.total_interessados || 0)}</span><span class="metric-chip">Processo ${Number(v.candidatos_em_processo || 0)}</span><span class="metric-chip good">Aprovados ${Number(v.candidatos_aprovados || 0)}</span><span class="metric-chip bad">Reprovados ${Number(v.candidatos_reprovados || 0)}</span></div></td>
        <td><span class="badge ${badgeClass(v.status)}">${escapeHtml(vacancyStatusLabels[v.status] || v.status)}</span></td>
        <td>${escapeHtml(formatDate(v.updated_at))}</td>
        <td><div class="row-actions"><button data-vacancy-action="edit" data-id="${v.id}">Editar</button><button data-vacancy-action="duplicate" data-id="${v.id}">Duplicar</button><button class="primary" data-vacancy-action="promote" data-id="${v.id}">Divulgar</button>${v.status === 'ATIVA' ? `<button data-vacancy-action="status" data-status="PAUSADA" data-id="${v.id}">Pausar</button>` : `<button data-vacancy-action="status" data-status="ATIVA" data-id="${v.id}">Ativar</button>`}</div></td>
      </tr>`;
  }).join('');
}

function vacancyById(id) {
  return state.vacancies.find((vacancy) => String(vacancy.id) === String(id));
}

async function openVacancyById(id) {
  let vacancy = vacancyById(id);
  if (!vacancy) {
    const result = await api(`/api/vagas/${encodeURIComponent(id)}`);
    vacancy = result.vaga;
    if (vacancy) {
      const exists = state.vacancies.some((item) => String(item.id) === String(vacancy.id));
      if (!exists) state.vacancies.push(vacancy);
    }
  }
  if (!vacancy) throw new Error('Vaga não encontrada.');
  return openVacancyDialog(vacancy);
}

async function openVacancyDialog(vacancy = null, duplicate = false) {
  await loadCompanies();
  el.vacancyForm.reset();
  el.vacancyFormError.classList.add('hidden');
  el.vacancyId.value = duplicate ? '' : vacancy?.id || '';
  el.vacancyDialogTitle.textContent = duplicate ? `Duplicar ${vacancy?.codigo || 'vaga'}` : vacancy ? `Editar ${vacancy.codigo}` : 'Nova vaga';

  const defaults = {
    empresa_id: state.companies[0]?.id || '', status: 'RASCUNHO', estado: 'SP', modalidade: 'Presencial',
    quantidade_vagas: 1, experiencia_minima_meses: 0, exigir_experiencia_compativel: true,
  };
  const source = vacancy ? { ...vacancy } : defaults;
  if (duplicate) {
    source.status = 'RASCUNHO';
    source.data_inicio = null;
    source.data_encerramento = null;
  }

  Object.entries(source).forEach(([key, value]) => {
    const input = el.vacancyForm.elements[key];
    if (!input) return;
    if (input.type === 'checkbox') input.checked = value === true || value === 'true';
    else if (input.type === 'date' && value) input.value = String(value).slice(0, 10);
    else input.value = value ?? '';
  });
  el.possui_insalubridade.checked = Boolean(source.possui_insalubridade);
  toggleInsalubrityFields();
  el.vacancyDialog.showModal();
}

function toggleInsalubrityFields() {
  el.insalubrityFields.classList.toggle('hidden', !el.possui_insalubridade.checked);
  if (!el.possui_insalubridade.checked) {
    el.vacancyForm.elements.percentual_insalubridade.value = '';
    el.vacancyForm.elements.observacao_insalubridade.value = '';
  }
}

function vacancyFormPayload() {
  const data = new FormData(el.vacancyForm);
  return {
    empresa_id: data.get('empresa_id'), titulo: data.get('titulo'), cargo: data.get('cargo'),
    descricao: data.get('descricao'), cidade: data.get('cidade'), estado: data.get('estado'),
    bairro: data.get('bairro'), endereco_referencia: data.get('endereco_referencia'),
    tipo_contrato: data.get('tipo_contrato'), modalidade: data.get('modalidade'), escala: data.get('escala'),
    horario: data.get('horario'), salario: data.get('salario'), beneficios: data.get('beneficios'),
    possui_insalubridade: el.possui_insalubridade.checked,
    percentual_insalubridade: data.get('percentual_insalubridade'),
    observacao_insalubridade: data.get('observacao_insalubridade'),
    escolaridade_minima: data.get('escolaridade_minima'), experiencia_minima_meses: data.get('experiencia_minima_meses'),
    aceita_sem_experiencia: data.get('aceita_sem_experiencia') === 'on',
    exigir_experiencia_compativel: data.get('exigir_experiencia_compativel') === 'on',
    cargos_compativeis: data.get('cargos_compativeis'), cbos_compativeis: data.get('cbos_compativeis'),
    requisitos_obrigatorios: data.get('requisitos_obrigatorios'), requisitos_desejaveis: data.get('requisitos_desejaveis'),
    quantidade_vagas: data.get('quantidade_vagas'), formulario_url: data.get('formulario_url'), status: data.get('status'),
    data_inicio: data.get('data_inicio'), data_encerramento: data.get('data_encerramento'),
  };
}

async function saveVacancy(event) {
  event.preventDefault();
  el.saveVacancyButton.disabled = true;
  el.vacancyFormError.classList.add('hidden');
  try {
    const id = el.vacancyId.value;
    const payload = vacancyFormPayload();
    const result = await api(id ? `/api/vagas/${id}` : '/api/vagas', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    el.vacancyDialog.close();
    showToast(result.mensagem || 'Vaga salva.');
    await loadVacancies(true);
  } catch (error) {
    el.vacancyFormError.textContent = error.message;
    el.vacancyFormError.classList.remove('hidden');
  } finally {
    el.saveVacancyButton.disabled = false;
  }
}

async function changeVacancyStatus(id, status) {
  const result = await api(`/api/vagas/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  showToast(result.mensagem || 'Status atualizado.');
  await loadVacancies(true);
}

async function generateVacancyWithAi() {
  const payload = vacancyFormPayload();
  if (!safeText(payload.titulo, '') && !safeText(payload.cargo, '')) {
    showToast('Informe pelo menos o título ou cargo antes de usar a IA.', 'error');
    return;
  }
  el.aiVacancyLoading.classList.remove('hidden');
  el.aiVacancyContent.classList.add('hidden');
  el.aiVacancyError.classList.add('hidden');
  el.aiVacancyDialog.showModal();
  try {
    const result = await api('/api/ia/vagas/gerar', { method: 'POST', body: JSON.stringify({ acao: 'GERAR_TODOS', vaga: payload }) });
    const suggestion = result.sugestoes || {};
    el.aiPreviewDescricao.value = suggestion.descricao || '';
    el.aiPreviewCargos.value = suggestion.cargos_compativeis || '';
    el.aiPreviewCbos.value = suggestion.cbos_compativeis || '';
    el.aiPreviewObrigatorios.value = suggestion.requisitos_obrigatorios || '';
    el.aiPreviewDesejaveis.value = suggestion.requisitos_desejaveis || '';
    el.aiVacancyLoading.classList.add('hidden');
    el.aiVacancyContent.classList.remove('hidden');
  } catch (error) {
    el.aiVacancyLoading.classList.add('hidden');
    el.aiVacancyError.textContent = error.message;
    el.aiVacancyError.classList.remove('hidden');
  }
}

function applyAiSuggestions() {
  const mapping = {
    descricao: el.aiPreviewDescricao.value,
    cargos_compativeis: el.aiPreviewCargos.value,
    cbos_compativeis: el.aiPreviewCbos.value,
    requisitos_obrigatorios: el.aiPreviewObrigatorios.value,
    requisitos_desejaveis: el.aiPreviewDesejaveis.value,
  };
  Object.entries(mapping).forEach(([key, value]) => { if (hasValue(value)) el.vacancyForm.elements[key].value = value; });
  el.aiVacancyDialog.close();
  showToast('Sugestões aplicadas para revisão.');
}

async function openPromotion(id) {
  const vacancy = vacancyById(id);
  el.promotionTitle.textContent = vacancy ? `Divulgar ${vacancy.titulo}` : 'Material da vaga';
  el.promotionDialog.showModal();
  el.promotionWhatsappText.value = 'Gerando...';
  el.promotionFacebookText.value = 'Gerando...';
  try {
    const data = await api(`/api/vagas/${id}/divulgacao`, { method: 'POST', body: '{}' });
    state.promotion = data.divulgacao;
    el.promotionWhatsappText.value = state.promotion.whatsapp_texto || '';
    el.promotionFacebookText.value = state.promotion.facebook_texto || '';
    el.promotionPrimaryImage.src = state.promotion.imagem_data_url || '';
    el.promotionDetailsImage.src = state.promotion.imagem_detalhes_data_url || '';
    el.detailsPreviewCard.classList.toggle('hidden', !state.promotion.imagem_detalhes_data_url);
  } catch (error) {
    el.promotionDialog.close();
    showToast(error.message, 'error');
  }
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value); showToast('Texto copiado.'); }
  catch { window.prompt('Copie o texto abaixo:', value); }
}

async function downloadSvgAsPng(dataUrl, filename) {
  if (!dataUrl) return showToast('Imagem indisponível.', 'error');
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', .95));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  showToast('Imagem baixada em PNG.');
}

async function loadCandidates() {
  const data = await api('/api/candidatos');
  state.candidates = data.candidatos || [];
  state.candidateSummary = data.resumo || state.candidateSummary;
  renderCandidates();
}

function candidateMatches(candidate) {
  const q = String(el.candidateSearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  const status = String(candidate.status || '').toUpperCase();
  const statusMatch = state.candidateStatus === 'TODOS'
    || (state.candidateStatus === 'EM_PROCESSO' && ['NOVO', 'EM_PROCESSO'].includes(status))
    || (state.candidateStatus === 'APROVADO' && status === 'APROVADO')
    || status === state.candidateStatus;
  const haystack = [candidate.nome, candidate.telefone, candidate.vaga_nome, candidate.vaga_codigo, candidate.etapa].join(' ').toLocaleLowerCase('pt-BR');
  return statusMatch && (!q || haystack.includes(q));
}

function renderCandidates() {
  const candidates = state.candidates.filter(candidateMatches);
  const summary = state.candidateSummary || {};
  el.candidateKpiTotal.textContent = summary.total || 0;
  el.candidateKpiProcess.textContent = summary.em_processo || 0;
  el.candidateKpiApproved.textContent = summary.aprovados || 0;
  el.candidateKpiAdmission.textContent = summary.em_admissao || 0;
  el.candidateKpiHired.textContent = summary.contratados || 0;
  el.candidateKpiRejected.textContent = summary.reprovados || 0;
  el.candidatesLoading.classList.add('hidden');

  renderCandidateTable(candidates);
  renderCandidateKanban(candidates);
}

function renderCandidateTable(candidates) {
  if (!candidates.length) {
    el.candidatesEmpty.classList.remove('hidden');
    el.candidatesTableWrapper.classList.add('hidden');
    return;
  }
  el.candidatesEmpty.classList.add('hidden');
  el.candidatesTableWrapper.classList.remove('hidden');
  el.candidatesTableBody.innerHTML = candidates.map((c) => {
    const docs = Number(c.quantidade_documentos || 0);
    const interview = c.entrevista_inicio ? `${formatDate(c.entrevista_inicio)}` : 'Não agendada';
    return `<tr>
      <td><div class="primary-cell"><strong>${escapeHtml(c.nome || 'Nome não informado')}</strong><span>${escapeHtml(formatPhone(c.telefone))}</span></div></td>
      <td><div class="primary-cell"><strong>${escapeHtml(c.vaga_nome || c.vaga_legacy || 'Não vinculada')}</strong><span>${escapeHtml(c.vaga_codigo || 'Sem código')}</span></div></td>
      <td><span class="badge ${badgeClass(c.status)}">${escapeHtml(statusLabels[c.status] || c.status || 'Não informado')}</span><div class="primary-cell"><span>${escapeHtml(stageLabels[c.etapa] || c.etapa || 'Etapa não informada')}</span></div></td>
      <td><button class="text-button" data-candidate-action="open" data-id="${c.id}" type="button">${docs} arquivo(s)</button></td>
      <td>${escapeHtml(interview)}</td>
      <td>${escapeHtml(formatDate(c.updated_at))}</td>
      <td><div class="row-actions"><button class="primary" data-candidate-action="open" data-id="${c.id}">Abrir</button><a href="https://wa.me/${String(c.telefone || '').replace(/\D/g,'')}" target="_blank">WhatsApp</a></div></td>
    </tr>`;
  }).join('');
}

function kanbanGroup(candidate) {
  if (candidate.status === 'REPROVADO') return 'rejected';
  if (candidate.status === 'CONTRATADO') return 'hired';
  if (candidate.status === 'EM_ADMISSAO') return 'admission';
  if (['ENTREVISTA_AGENDADA', 'AGUARDANDO_ENTREVISTA'].includes(candidate.etapa)) return 'interview';
  if (candidate.status === 'APROVADO') return 'approved';
  if (['AGUARDANDO_CTPS_CEP', 'AGUARDANDO_CTPS', 'AGUARDANDO_CEP', 'ANALISANDO_DOCUMENTOS'].includes(candidate.etapa)) return 'documents';
  if (candidate.etapa === 'ESCOLHENDO_VAGA') return 'vacancy';
  return 'new';
}

function renderCandidateKanban(candidates) {
  const columns = [
    ['new', 'Novos'], ['vacancy', 'Escolhendo vaga'], ['documents', 'Documentos'],
    ['approved', 'Aprovados na triagem'], ['interview', 'Entrevista'], ['admission', 'Em admissão'],
    ['hired', 'Contratados'], ['rejected', 'Reprovados'],
  ];
  el.candidateKanbanContainer.innerHTML = columns.map(([key, title]) => {
    const items = candidates.filter((candidate) => kanbanGroup(candidate) === key);
    return `<article class="kanban-column"><header class="kanban-head">${escapeHtml(title)}<span>${items.length}</span></header><div class="kanban-cards">${items.map((candidate) => `
      <article class="kanban-card" data-candidate-action="open" data-id="${candidate.id}"><strong>${escapeHtml(candidate.nome || 'Nome não informado')}</strong><span>${escapeHtml(candidate.vaga_nome || candidate.vaga_legacy || 'Sem vaga')}</span><small>${escapeHtml(stageLabels[candidate.etapa] || candidate.etapa || '')}</small></article>
    `).join('') || '<div class="empty-state compact">Nenhum candidato</div>'}</div></article>`;
  }).join('');
}

function setCandidateMode(mode) {
  state.candidateMode = mode;
  el.candidateTableMode.classList.toggle('active', mode === 'table');
  el.candidateKanbanMode.classList.toggle('active', mode === 'kanban');
  el.candidateTableContainer.classList.toggle('hidden', mode !== 'table');
  el.candidateKanbanContainer.classList.toggle('hidden', mode !== 'kanban');
}

async function openCandidate(id) {
  state.selectedCandidateId = Number(id);
  el.candidateDrawer.showModal();
  el.candidateDrawerLoading.classList.remove('hidden');
  el.candidateDrawerContent.classList.add('hidden');
  try {
    const [details, notes, tasks, tags] = await Promise.all([
      api(`/api/candidatos/${id}/detalhes`),
      api(`/api/candidatos/${id}/notas`),
      api(`/api/candidatos/${id}/tarefas`),
      api(`/api/candidatos/${id}/etiquetas`),
    ]);
    state.selectedCandidate = details.candidato;
    state.selectedCandidateExtras = { notes: notes.notas || [], tasks: tasks.tarefas || [], tags: tags.etiquetas || [], selectedTags: tags.selecionadas || [] };
    renderCandidateDrawer(details);
    el.candidateDrawerLoading.classList.add('hidden');
    el.candidateDrawerContent.classList.remove('hidden');
  } catch (error) {
    el.candidateDrawerLoading.innerHTML = emptyState('Não foi possível carregar', error.message);
  }
}

function renderCandidateDrawer(details) {
  const c = details.candidato;
  const phoneDigits = String(c.telefone || '').replace(/\D/g, '');
  const tags = state.selectedCandidateExtras.selectedTags || [];
  el.candidateDrawerTitle.textContent = c.nome || `Candidato #${c.id}`;
  el.candidateDrawerSubtitle.textContent = `${statusLabels[c.status] || c.status || 'Sem status'} · ${stageLabels[c.etapa] || c.etapa || 'Sem etapa'}`;
  el.candidateAvatar.textContent = initials(c.nome || c.telefone);
  el.candidateName.textContent = c.nome || 'Nome não informado';
  el.candidatePhone.textContent = formatPhone(c.telefone);
  el.candidatePhone.href = phoneDigits ? `https://wa.me/${phoneDigits}` : '#';
  el.candidateWhatsappButton.href = phoneDigits ? `https://wa.me/${phoneDigits}` : '#';
  el.candidateLabels.innerHTML = tags.map((tag) => `<span class="tag" style="color:${escapeHtml(tag.cor)};background:${escapeHtml(tag.cor)}18">${escapeHtml(tag.nome)}</span>`).join('');
  el.candidateVacancy.textContent = c.vaga_nome || c.vaga || 'Não vinculada';
  el.candidateStage.textContent = `${statusLabels[c.status] || c.status || 'Sem status'} · ${stageLabels[c.etapa] || c.etapa || 'Sem etapa'}`;
  el.candidateCep.textContent = c.cep || 'Não informado';
  el.candidateInterview.textContent = c.entrevista_inicio ? formatDate(c.entrevista_inicio) : 'Não agendada';
  const meet = c.entrevista_meet_link || c.entrevista_google_event_url;
  el.candidateMeetLink.classList.toggle('hidden', !meet);
  el.candidateMeetLink.href = meet || '#';
  el.candidateTriage.textContent = c.observacao_triagem || c.motivo_reprovacao || 'Ainda não analisado.';

  const experiences = Array.isArray(c.experiencias_ctps) ? c.experiencias_ctps : [];
  el.candidateExperiences.innerHTML = experiences.length ? experiences.map((item) => `
    <article class="experience-item"><div><strong>${escapeHtml(item.cargo || 'Cargo não informado')}</strong><span>${escapeHtml(item.empregador || 'Empregador não informado')}</span><small>${escapeHtml(item.periodo || 'Período não informado')} · ${escapeHtml(item.cbo ? `CBO ${item.cbo}` : 'CBO não informado')}</small></div><span class="badge ${item.compativel ? 'badge-approved' : 'badge-neutral'}">${item.compativel ? 'Compatível' : 'Não compatível'}</span></article>
  `).join('') : '<div class="empty-state compact">Nenhum vínculo válido extraído.</div>';

  const rejected = String(c.status || '').toUpperCase() === 'REPROVADO';
  el.candidateRejectionSection.classList.toggle('hidden', !rejected);
  el.candidateRejectionReason.textContent = c.motivo_reprovacao_pos_entrevista || c.motivo_reprovacao || 'A reprovação foi registrada sem motivo detalhado.';
  el.candidateRejectionObservation.textContent = c.observacao_decisao_pos_entrevista || c.observacao_triagem || 'Sem observação complementar.';

  el.candidatePresentationSection.classList.toggle('hidden', !hasValue(c.apresentacao_profissional));
  el.candidatePresentation.textContent = c.apresentacao_profissional || '';
  const profileTags = Array.isArray(c.personalidade_tags) ? c.personalidade_tags.filter(Boolean) : [];
  const hasProfile = hasValue(c.personalidade_resumo) || profileTags.length;
  el.candidatePersonalitySection.classList.toggle('hidden', !hasProfile);
  el.candidatePersonality.textContent = c.personalidade_resumo || '';
  el.candidatePersonalityTags.innerHTML = profileTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  el.candidateStatusSelect.value = c.status || 'NOVO';
  el.candidateStageSelect.innerHTML = Object.entries(stageLabels).map(([value, label]) => `<option value="${value}" ${value === c.etapa ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  el.postInterviewDecision.value = c.etapa === 'REPROVADO_POS_ENTREVISTA' ? 'REPROVADO_POS_ENTREVISTA' : ['EM_ADMISSAO', 'CONTRATADO'].includes(c.status) ? c.status : '';
  el.postInterviewReason.value = c.motivo_reprovacao_pos_entrevista || '';
  el.postInterviewObservation.value = c.observacao_decisao_pos_entrevista || '';
  el.postInterviewReasonField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA');

  renderCandidateDocuments(details.documentos || []);
  renderCandidateTimeline(details.timeline || []);
  renderCandidateManagement();
  setDrawerTab('summary');
}

function renderCandidateDocuments(documents) {
  el.candidateDocuments.innerHTML = documents.length ? documents.map((doc) => `
    <article class="document-card"><div class="document-icon">PDF</div><div><strong>${escapeHtml(doc.titulo || doc.tipo || 'Documento')}</strong><span>${escapeHtml(doc.nome_arquivo || 'Arquivo')}</span><small>${escapeHtml(formatFileSize(doc.tamanho_bytes))} · ${escapeHtml(formatDate(doc.created_at))}</small></div><footer><span class="document-type ${String(doc.tipo || '').toLowerCase()}">${escapeHtml(doc.tipo || 'OUTRO')}</span>${doc.disponivel_download ? `<a class="button button-ghost" href="/api/documentos/${doc.id}/download">Baixar</a>` : '<span>Download indisponível</span>'}</footer></article>
  `).join('') : emptyState('Nenhum documento registrado.');
}

function renderCandidateTimeline(items) {
  el.candidateTimeline.innerHTML = items.length ? items.map((item) => `
    <article class="timeline-item"><span class="timeline-marker"></span><div class="timeline-card"><header><strong>${escapeHtml(item.titulo || item.tipo || 'Registro')}</strong><small>${escapeHtml(formatDate(item.created_at))}</small></header><p>${escapeHtml(item.descricao || 'Sem descrição')}</p></div></article>
  `).join('') : emptyState('Nenhum histórico encontrado.');
}

function renderCandidateManagement() {
  const extras = state.selectedCandidateExtras;
  const selectedIds = new Set((extras.selectedTags || []).map((tag) => Number(tag.id)));
  el.candidateTagSelector.innerHTML = (extras.tags || []).map((tag) => `<label class="checkbox-tag"><input type="checkbox" value="${tag.id}" ${selectedIds.has(Number(tag.id)) ? 'checked' : ''}><span>${escapeHtml(tag.nome)}</span></label>`).join('') || '<span>Nenhuma etiqueta cadastrada.</span>';
  el.candidateNotes.innerHTML = (extras.notes || []).length ? extras.notes.map((note) => `<article class="note-item"><p>${escapeHtml(note.nota)}</p><small>${escapeHtml(note.criado_por)} · ${escapeHtml(formatDate(note.created_at))}</small></article>`).join('') : '<div class="empty-state compact">Nenhuma nota interna.</div>';
  el.candidateTasks.innerHTML = (extras.tasks || []).length ? extras.tasks.map((task) => `<article class="task-item"><div><strong>${escapeHtml(task.titulo)}</strong><span>${escapeHtml(task.prioridade)}${task.vencimento ? ` · vence ${escapeHtml(formatDate(task.vencimento))}` : ''}</span><small>${escapeHtml(task.status)}</small></div>${!['CONCLUIDA','CANCELADA'].includes(task.status) ? `<button class="button button-ghost" data-task-action="complete" data-id="${task.id}" type="button">Concluir</button>` : ''}</article>`).join('') : '<div class="empty-state compact">Nenhuma tarefa criada.</div>';
}

function setDrawerTab(name) {
  document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.classList.toggle('active', button.dataset.drawerTab === name));
  document.querySelectorAll('.drawer-tab').forEach((section) => section.classList.toggle('hidden', section.id !== `drawer-tab-${name}`));
}

async function updateCandidate() {
  await api(`/api/candidatos/${state.selectedCandidateId}`, { method: 'PATCH', body: JSON.stringify({ status: el.candidateStatusSelect.value, etapa: el.candidateStageSelect.value }) });
  showToast('Candidato atualizado.');
  await loadCandidates(true);
  await openCandidate(state.selectedCandidateId);
}

async function savePostInterviewDecision() {
  const decisao = el.postInterviewDecision.value;
  const motivo = el.postInterviewReason.value;
  const observacao = el.postInterviewObservation.value.trim();
  if (!decisao) return showToast('Selecione uma decisão.', 'error');
  if (decisao === 'REPROVADO_POS_ENTREVISTA' && !motivo) return showToast('Informe o motivo da reprovação.', 'error');
  await api(`/api/candidatos/${state.selectedCandidateId}/decisao-pos-entrevista`, {
    method: 'POST', body: JSON.stringify({ decisao, motivo, observacao }),
  });
  showToast('Decisão após entrevista registrada.');
  await loadCandidates(true);
  await openCandidate(state.selectedCandidateId);
}

async function deleteCandidate() {
  if (!window.confirm('Remover este candidato e o histórico relacionado do banco?')) return;
  await api(`/api/candidatos/${state.selectedCandidateId}`, { method: 'DELETE' });
  el.candidateDrawer.close();
  showToast('Candidato removido.');
  await loadCandidates(true);
}

async function addCandidateNote() {
  const note = el.candidateNoteInput.value.trim();
  if (!note) return showToast('Digite uma nota.', 'error');
  await api(`/api/candidatos/${state.selectedCandidateId}/notas`, { method: 'POST', body: JSON.stringify({ nota: note }) });
  el.candidateNoteInput.value = '';
  const data = await api(`/api/candidatos/${state.selectedCandidateId}/notas`);
  state.selectedCandidateExtras.notes = data.notas || [];
  renderCandidateManagement();
  showToast('Nota adicionada.');
}

async function addCandidateTask() {
  const title = el.candidateTaskTitle.value.trim();
  if (!title) return showToast('Informe o título da tarefa.', 'error');
  await api(`/api/candidatos/${state.selectedCandidateId}/tarefas`, { method: 'POST', body: JSON.stringify({ titulo: title, prioridade: el.candidateTaskPriority.value, vencimento: el.candidateTaskDue.value || null }) });
  el.candidateTaskTitle.value = '';
  el.candidateTaskDue.value = '';
  const data = await api(`/api/candidatos/${state.selectedCandidateId}/tarefas`);
  state.selectedCandidateExtras.tasks = data.tarefas || [];
  renderCandidateManagement();
  showToast('Tarefa criada.');
}

async function completeTask(id) {
  await api(`/api/tarefas/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONCLUIDA' }) });
  const data = await api(`/api/candidatos/${state.selectedCandidateId}/tarefas`);
  state.selectedCandidateExtras.tasks = data.tarefas || [];
  renderCandidateManagement();
  showToast('Tarefa concluída.');
}

async function saveCandidateTags() {
  const ids = [...el.candidateTagSelector.querySelectorAll('input:checked')].map((input) => Number(input.value));
  await api(`/api/candidatos/${state.selectedCandidateId}/etiquetas`, { method: 'POST', body: JSON.stringify({ etiqueta_ids: ids }) });
  const data = await api(`/api/candidatos/${state.selectedCandidateId}/etiquetas`);
  state.selectedCandidateExtras.tags = data.etiquetas || [];
  state.selectedCandidateExtras.selectedTags = data.selecionadas || [];
  renderCandidateManagement();
  el.candidateLabels.innerHTML = state.selectedCandidateExtras.selectedTags.map((tag) => `<span class="tag" style="color:${escapeHtml(tag.cor)};background:${escapeHtml(tag.cor)}18">${escapeHtml(tag.nome)}</span>`).join('');
  showToast('Etiquetas atualizadas.');
}

async function loadInterviews() {
  const data = await api(`/api/entrevistas?periodo=${encodeURIComponent(state.interviewPeriod)}`);
  state.interviews = data.entrevistas || [];
  renderInterviews();
}

function renderInterviews() {
  if (!state.interviews.length) {
    el.interviewsList.innerHTML = emptyState('Nenhuma entrevista encontrada', 'Novos agendamentos aparecerão nesta agenda.');
    return;
  }
  let currentDay = '';
  el.interviewsList.innerHTML = state.interviews.map((item) => {
    const day = formatDate(item.inicio, { dateOnly: true });
    const header = day !== currentDay ? `<div class="interview-day">${escapeHtml(day)}</div>` : '';
    currentDay = day;
    const meet = item.meet_link || item.google_event_url;
    return `${header}<article class="interview-row"><div class="interview-time">${escapeHtml(formatTime(item.inicio))}</div><div><strong>${escapeHtml(item.candidato_nome)}</strong><span>${escapeHtml(item.vaga_nome)}</span><small>${escapeHtml(item.telefone ? formatPhone(item.telefone) : '')}</small></div><div><strong>${escapeHtml(item.vaga_escala ? `Escala ${item.vaga_escala}` : 'Escala não informada')}</strong><span>${escapeHtml(item.vaga_horario || 'Horário da vaga não informado')}</span></div><div class="interview-actions"><button class="button button-ghost" data-action="open-candidate" data-id="${item.candidato_id}" type="button">Candidato</button>${meet ? `<a class="button button-primary" href="${escapeHtml(meet)}" target="_blank">Abrir Meet</a>` : ''}</div></article>`;
  }).join('');
}

async function loadDocuments() {
  const data = await api(`/api/documentos?tipo=${encodeURIComponent(state.documentType)}`);
  state.documents = data.documentos || [];
  renderDocuments();
}

function renderDocuments() {
  const q = String(el.documentSearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  const docs = state.documents.filter((doc) => !q || [doc.candidato_nome, doc.telefone, doc.nome_arquivo, doc.vaga_nome].join(' ').toLocaleLowerCase('pt-BR').includes(q));
  el.documentsList.innerHTML = docs.length ? docs.map((doc) => `
    <article class="document-card"><div class="document-icon">PDF</div><div><strong>${escapeHtml(doc.nome_arquivo || 'Documento')}</strong><span>${escapeHtml(doc.candidato_nome)} · ${escapeHtml(doc.vaga_nome)}</span><small>${escapeHtml(formatFileSize(doc.tamanho_bytes))} · ${escapeHtml(formatDate(doc.created_at))}</small></div><footer><span class="document-type ${String(doc.tipo || '').toLowerCase()}">${escapeHtml(doc.tipo || 'OUTRO')}</span><div class="row-actions"><button data-action="open-candidate" data-id="${doc.candidato_id}" type="button">Candidato</button>${doc.disponivel_download ? `<a href="/api/documentos/${doc.id}/download">Baixar</a>` : ''}</div></footer></article>
  `).join('') : emptyState('Nenhum documento encontrado', 'Altere os filtros ou aguarde novos arquivos.');
}

async function loadMonitoring() {
  const data = await api('/api/monitoramento');
  state.monitoring = data;
  renderMonitoring();
}

function renderMonitoring() {
  const data = state.monitoring || {};
  const metrics = data.metricas || {};
  el.monitorKpiEntries.textContent = Number(metrics.entradas_24h || 0);
  el.monitorKpiUnlinked.textContent = Number(metrics.entradas_sem_candidato_24h || 0);
  el.monitorKpiErrors.textContent = Number(metrics.erros_pendentes || 0);
  el.monitorKpiDocs.textContent = Number(metrics.documentos_pendentes || 0);
  el.monitorKpiFollowups.textContent = Number(metrics.followups_24h || 0);
  el.monitorKpiPromotions.textContent = Number(metrics.divulgacoes_hoje || 0);

  const alerts = data.alertas || [];
  el.monitorAlertCount.textContent = alerts.length;
  el.monitorAlerts.innerHTML = alerts.length ? alerts.map((alert) => `
    <article class="action-card ${['CRITICO','ALTO'].includes(String(alert.severidade || '').toUpperCase()) ? 'high' : 'medium'}">
      <div class="action-icon">!</div><div class="action-copy"><strong>${escapeHtml(alert.titulo || 'Alerta')}</strong><span>${escapeHtml(alert.descricao || 'Ação pendente')}</span><small>${escapeHtml(formatDate(alert.created_at))}</small></div>
      <div class="action-buttons">${alert.candidato_id ? `<button data-action="open-candidate" data-id="${alert.candidato_id}" type="button">Abrir</button>` : ''}<button data-action="resolve-alert" data-key="${escapeHtml(alert.chave)}" type="button">Resolver</button></div>
    </article>
  `).join('') : emptyState('Operação em dia', 'Nenhum alerta administrativo pendente.');

  const errors = data.erros || [];
  el.monitorErrors.innerHTML = errors.length ? errors.map((error) => `
    <article class="monitor-error"><span class="monitor-error-icon">!</span><div><strong>${escapeHtml(error.workflow_nome || 'Workflow')} · ${escapeHtml(error.node_nome || 'Node não informado')}</strong><span>${escapeHtml(error.erro_mensagem)}</span><small>${escapeHtml(formatDate(error.created_at))}${error.telefone ? ` · ${escapeHtml(formatPhone(error.telefone))}` : ''}</small></div>${!error.resolvido ? `<button class="button button-ghost" data-monitor-action="resolve-error" data-id="${error.id}" type="button">Resolver</button>` : '<span class="badge badge-active">Resolvido</span>'}</article>
  `).join('') : emptyState('Nenhum erro registrado', 'As falhas dos workflows aparecerão aqui.');

  const health = [
    ['Última entrada do WhatsApp', metrics.ultima_entrada ? formatDate(metrics.ultima_entrada) : 'Sem registro'],
    ['Última resposta da IA', metrics.ultima_resposta_ia ? formatDate(metrics.ultima_resposta_ia) : 'Sem registro'],
    ['Último candidato criado', metrics.ultimo_candidato_criado ? formatDate(metrics.ultimo_candidato_criado) : 'Sem registro'],
    ['Última divulgação', metrics.ultima_divulgacao ? formatDate(metrics.ultima_divulgacao) : 'Sem registro'],
    ['Candidatos em análise', Number(metrics.candidatos_analisando || 0)],
    ['Erros nas últimas 24h', Number(metrics.erros_24h || 0)],
  ];
  el.monitorHealth.innerHTML = health.map(([label, value]) => `<div class="health-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

  const recent = data.candidatos_recentes || [];
  el.monitorRecentCandidates.innerHTML = recent.length ? recent.map((item) => `<button class="compact-item" data-action="open-candidate" data-id="${item.id}" type="button"><span class="compact-avatar">${escapeHtml(initials(item.nome || item.telefone))}</span><span><strong>${escapeHtml(item.nome || 'Nome não informado')}</strong><small>${escapeHtml(item.vaga_nome || 'Sem vaga')} · ${escapeHtml(statusLabels[item.status] || item.status || 'Novo')}</small></span><time>${escapeHtml(formatDate(item.updated_at, { dateOnly: true }))}</time></button>`).join('') : emptyState('Nenhum candidato registrado');

  const activity = data.atividades || [];
  el.monitorActivity.innerHTML = activity.length ? activity.map((item) => { const fields=Array.isArray(item.campos_alterados)?item.campos_alterados.filter(Boolean):[]; const subject=item.nome||item.telefone||`Candidato #${item.candidato_id||''}`; const action=item.acao==='ADICIONADO'?'Candidato adicionado':item.acao==='REMOVIDO'?'Candidato removido':'Cadastro atualizado'; return `<article class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(action)} · ${escapeHtml(subject)}</strong><small>${escapeHtml(formatDate(item.created_at))}${fields.length?` · Campos: ${escapeHtml(fields.slice(0,6).join(', '))}`:''}</small></div></article>`; }).join('') : emptyState('Sem atividade recente.');

  const followups = data.followups || [];
  el.monitorFollowups.innerHTML = followups.length ? followups.map((item) => `<button class="compact-item" data-action="open-candidate" data-id="${item.candidato_id}" type="button"><span class="compact-avatar">${Number(item.tentativa || 0)}</span><span><strong>${escapeHtml(item.candidato_nome)}</strong><small>${escapeHtml(stageLabels[item.etapa] || item.etapa)} · ${escapeHtml(item.status)}</small></span><time>${escapeHtml(formatDate(item.enviado_em, {dateOnly:true}))}</time></button>`).join('') : emptyState('Nenhum follow-up enviado.');

  const promotions = data.divulgacoes || [];
  el.monitorPromotions.innerHTML = promotions.length ? promotions.map((item) => `<div class="compact-item"><span class="compact-avatar">V</span><span><strong>${escapeHtml(item.vaga_titulo)}</strong><small>${escapeHtml(item.codigo)} · ${escapeHtml(item.status)}</small></span><time>${escapeHtml(formatDate(item.enviado_em, {dateOnly:true}))}</time></div>`).join('') : emptyState('Nenhuma divulgação registrada.');

  const logs = data.logs || [];
  el.monitorLogs.innerHTML = logs.length ? logs.map((log) => `<div class="log-row"><span>${escapeHtml(formatDate(log.created_at))}</span><span>${escapeHtml(log.telefone_extraido ? formatPhone(log.telefone_extraido) : 'Sem telefone')}</span><span>${escapeHtml(log.tipo_mensagem || 'Mensagem')}</span><span>${escapeHtml(log.candidato_nome || log.detalhe || log.status || 'Sem vínculo')}</span></div>`).join('') : emptyState('Nenhuma entrada registrada.');
}

async function resolveWorkflowError(id) {
  await api(`/api/workflow-erros/${id}/resolver`, { method: 'POST', body: '{}' });
  showToast('Erro marcado como resolvido.');
  await loadMonitoring(true);
}

function openGlobalSearch() {
  el.globalSearchDialog.showModal();
  el.globalSearchInput.value = '';
  el.globalSearchResults.innerHTML = '<div class="empty-state compact">Comece digitando um nome, telefone, vaga ou arquivo.</div>';
  setTimeout(() => el.globalSearchInput.focus(), 50);
}

async function runGlobalSearch() {
  clearTimeout(state.searchTimer);
  const q = el.globalSearchInput.value.trim();
  if (q.length < 2) {
    el.globalSearchResults.innerHTML = '<div class="empty-state compact">Digite pelo menos 2 caracteres.</div>';
    return;
  }
  state.searchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/busca-global?q=${encodeURIComponent(q)}`);
      const results = data.resultados || [];
      el.globalSearchResults.innerHTML = results.length ? results.map((item) => `
        <button class="search-result" data-search-type="${escapeHtml(item.tipo)}" data-id="${item.id}" data-candidate-id="${item.candidato_id || ''}" type="button"><span class="search-result-icon">${item.tipo === 'CANDIDATO' ? 'C' : item.tipo === 'VAGA' ? 'V' : 'D'}</span><span><strong>${escapeHtml(item.titulo)}</strong><span>${escapeHtml(item.subtitulo || '')}</span></span></button>
      `).join('') : emptyState('Nenhum resultado encontrado.');
    } catch (error) { el.globalSearchResults.innerHTML = emptyState('Erro na busca', error.message); }
  }, 250);
}

function handleDelegatedAction(event) {
  const target = event.target.closest('[data-action], [data-vacancy-action], [data-candidate-action], [data-task-action], [data-monitor-action], [data-go-view]');
  if (!target) return;
  if (target.dataset.goView) return setView(target.dataset.goView);
  if (target.dataset.action === 'open-candidate' || target.dataset.candidateAction === 'open') return openCandidate(target.dataset.id);
  if (target.dataset.action === 'resolve-alert') return resolveAlert(target.dataset.key);
  if (target.dataset.vacancyAction === 'edit') return openVacancyDialog(vacancyById(target.dataset.id));
  if (target.dataset.vacancyAction === 'duplicate') return openVacancyDialog(vacancyById(target.dataset.id), true);
  if (target.dataset.vacancyAction === 'promote') return openPromotion(target.dataset.id);
  if (target.dataset.vacancyAction === 'status') return changeVacancyStatus(target.dataset.id, target.dataset.status);
  if (target.dataset.taskAction === 'complete') return completeTask(target.dataset.id);
  if (target.dataset.monitorAction === 'resolve-error') return resolveWorkflowError(target.dataset.id);
}


async function openNewCandidateDialog() {
  await Promise.all([loadCompanies(), state.vacancies.length ? Promise.resolve() : loadVacancies()]);
  el.newCandidateForm.reset();
  el.newCandidateError.classList.add('hidden');
  el.newCandidateVacancy.innerHTML = '<option value="">Sem vaga vinculada</option>'
    + state.vacancies.filter((vacancy) => vacancy.status === 'ATIVA')
      .map((vacancy) => `<option value="${vacancy.id}">${escapeHtml(vacancy.titulo)} · ${escapeHtml(vacancy.codigo)}</option>`)
      .join('');
  el.newCandidateDialog.showModal();
}

async function saveNewCandidate(event) {
  event.preventDefault();
  el.saveNewCandidateButton.disabled = true;
  el.newCandidateError.classList.add('hidden');
  try {
    const data = new FormData(el.newCandidateForm);
    const result = await api('/api/candidatos', {
      method: 'POST',
      body: JSON.stringify({
        nome: data.get('nome'),
        telefone: data.get('telefone'),
        cep: data.get('cep'),
        vaga_id: data.get('vaga_id'),
        status: data.get('status'),
        etapa: data.get('etapa'),
      }),
    });
    el.newCandidateDialog.close();
    showToast(result.mensagem || 'Candidato adicionado.');
    await loadCandidates(true);
  } catch (error) {
    el.newCandidateError.textContent = error.message;
    el.newCandidateError.classList.remove('hidden');
  } finally {
    el.saveNewCandidateButton.disabled = false;
  }
}

function handlePrimaryAction() {
  if (state.activeView === 'vacancies' || state.activeView === 'dashboard') return openVacancyDialog();
  if (state.activeView === 'candidates') return openNewCandidateDialog();
  return loadCurrentView(true);
}

async function loadCurrentUser() {
  const data = await api('/api/auth/me');
  const name = data.usuario?.nome || data.usuario?.usuario || 'Recrutadora';
  el.currentUserName.textContent = name;
  el.currentUserAvatar.textContent = initials(name).slice(0, 1);
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  window.location.replace('/login');
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.addEventListener('click', handleDelegatedAction);
  el.mobileMenuButton.addEventListener('click', () => el.sidebar.classList.toggle('open'));
  el.logoutButton.addEventListener('click', logout);
  el.refreshCurrentViewButton.addEventListener('click', () => loadCurrentView(true));
  el.primaryActionButton.addEventListener('click', handlePrimaryAction);
  el.globalSearchButton.addEventListener('click', openGlobalSearch);
  el.closeGlobalSearchButton.addEventListener('click', () => el.globalSearchDialog.close());
  el.globalSearchInput.addEventListener('input', runGlobalSearch);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openGlobalSearch(); }
    if (event.key === 'Escape' && el.globalSearchDialog.open) el.globalSearchDialog.close();
  });
  el.globalSearchResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-type]');
    if (!button) return;
    el.globalSearchDialog.close();
    if (button.dataset.searchType === 'CANDIDATO') { setView('candidates'); openCandidate(button.dataset.id); }
    else if (button.dataset.searchType === 'VAGA') { setView('vacancies'); openVacancyById(button.dataset.id).catch((error) => showToast(error.message, 'error')); }
    else if (button.dataset.searchType === 'DOCUMENTO') { setView('documents'); if (button.dataset.candidateId) openCandidate(button.dataset.candidateId); }
  });

  el.vacancyStatusSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vacancy-status]'); if (!button) return;
    state.vacancyStatus = button.dataset.vacancyStatus;
    el.vacancyStatusSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderVacancies();
  });
  el.vacancySearchInput.addEventListener('input', renderVacancies);
  el.vacancyForm.addEventListener('submit', saveVacancy);
  el.closeVacancyDialogButton.addEventListener('click', () => el.vacancyDialog.close());
  el.cancelVacancyButton.addEventListener('click', () => el.vacancyDialog.close());
  el.possui_insalubridade.addEventListener('change', toggleInsalubrityFields);
  el.generateVacancyAiButton.addEventListener('click', generateVacancyWithAi);
  el.closeAiVacancyButton.addEventListener('click', () => el.aiVacancyDialog.close());
  el.cancelAiVacancyButton.addEventListener('click', () => el.aiVacancyDialog.close());
  el.applyAiVacancyButton.addEventListener('click', applyAiSuggestions);
  el.closePromotionButton.addEventListener('click', () => el.promotionDialog.close());
  el.copyWhatsappPromotionButton.addEventListener('click', () => copyText(el.promotionWhatsappText.value));
  el.copyFacebookPromotionButton.addEventListener('click', () => copyText(el.promotionFacebookText.value));
  el.downloadPrimaryPromotionButton.addEventListener('click', () => { if (state.promotion?.imagem_png_url) window.location.assign(state.promotion.imagem_png_url); else downloadSvgAsPng(state.promotion?.imagem_data_url, String(state.promotion?.nome_arquivo || 'vaga').replace(/\.svg$/i, '.png')); });
  el.downloadDetailsPromotionButton.addEventListener('click', () => { if (state.promotion?.imagem_detalhes_png_url) window.location.assign(state.promotion.imagem_detalhes_png_url); else downloadSvgAsPng(state.promotion?.imagem_detalhes_data_url, String(state.promotion?.nome_arquivo_detalhes || 'vaga-detalhes').replace(/\.svg$/i, '.png')); });

  el.candidateStatusSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-candidate-status]'); if (!button) return;
    state.candidateStatus = button.dataset.candidateStatus;
    el.candidateStatusSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderCandidates();
  });
  el.candidateSearchInput.addEventListener('input', renderCandidates);
  el.candidateTableMode.addEventListener('click', () => setCandidateMode('table'));
  el.candidateKanbanMode.addEventListener('click', () => setCandidateMode('kanban'));
  el.closeCandidateDrawerButton.addEventListener('click', () => el.candidateDrawer.close());
  document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.addEventListener('click', () => setDrawerTab(button.dataset.drawerTab)));
  el.updateCandidateButton.addEventListener('click', updateCandidate);
  el.postInterviewDecision.addEventListener('change', () => el.postInterviewReasonField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA'));
  el.savePostInterviewDecisionButton.addEventListener('click', savePostInterviewDecision);
  el.deleteCandidateButton.addEventListener('click', deleteCandidate);
  el.addCandidateNoteButton.addEventListener('click', addCandidateNote);
  el.addCandidateTaskButton.addEventListener('click', addCandidateTask);
  el.saveCandidateTagsButton.addEventListener('click', saveCandidateTags);
  el.newCandidateForm.addEventListener('submit', saveNewCandidate);
  el.closeNewCandidateButton.addEventListener('click', () => el.newCandidateDialog.close());
  el.cancelNewCandidateButton.addEventListener('click', () => el.newCandidateDialog.close());

  el.interviewPeriodSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-interview-period]'); if (!button) return;
    state.interviewPeriod = button.dataset.interviewPeriod;
    el.interviewPeriodSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadInterviews(true);
  });
  el.documentTypeSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-document-type]'); if (!button) return;
    state.documentType = button.dataset.documentType;
    el.documentTypeSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadDocuments(true);
  });
  el.documentSearchInput.addEventListener('input', renderDocuments);
}

async function init() {
  bindEvents();
  await loadCurrentUser();
  await Promise.allSettled([loadCompanies(), loadCandidates()]);
  await loadDashboard();
  setCandidateMode('table');
}

init().catch((error) => showToast(error.message, 'error'));
