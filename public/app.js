'use strict';

const state = {
  activeView: 'dashboard',
  dashboard: null,
  dashboardPeriod: '1D',
  vacancies: [],
  vacancyTemplates: [],
  selectedVacancyTemplateId: null,
  audit: null,
  selectedAuditProblem: null,
  auditSearchTimer: null,
  auditGroupMode: 'CANDIDATO',
  vacancyPeriod: '1D',
  vacancySummary: null,
  vacancyStatus: 'TODAS',
  companies: [],
  candidates: [],
  candidateSummary: { total: 0, em_processo: 0, aprovados: 0, em_admissao: 0, contratados: 0, reprovados: 0 },
  candidateStatus: 'TODOS',
  candidatePeriod: 'TODOS',
  candidateVacancy: 'TODAS',
  candidateStage: 'TODAS',
  candidateDocument: 'TODOS',
  candidateInterview: 'TODAS',
  candidateSex: 'TODOS',
  candidateReallocation: 'TODOS',
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
  currentUser: null,
  portalBaseUrl: '',
  theme: document.documentElement.dataset.theme || 'light',
};

const stageLabels = {
  PRIMEIRO_CONTATO: 'Primeiro contato',
  PERGUNTANDO_IDADE: 'Confirmando idade mínima',
  PERGUNTANDO_SEXO: 'Confirmando sexo informado',
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


const rejectionReasonLabels = Object.freeze({
  IDADE_MINIMA_NAO_ATENDIDA: ['IDADE', 'Idade abaixo da faixa desta vaga'],
  IDADE_MAXIMA_NAO_ATENDIDA: ['IDADE', 'Idade acima da faixa desta vaga'],
  EXPERIENCIA_DECLARADA_NAO_ATENDE: ['EXPERIÊNCIA', 'Candidato declarou não atender ao tempo mínimo da vaga'],
  EXPERIENCIA_INSUFICIENTE: ['EXPERIÊNCIA', 'Tempo de experiência comprovada abaixo do requisito'],
  EXPERIENCIA_NAO_COMPATIVEL: ['EXPERIÊNCIA', 'Experiência não compatível com esta oportunidade'],
  DOCUMENTO_INSUFICIENTE: ['DOCUMENTO', 'Documento insuficiente ou análise inconclusiva'],
  NAO_COMPARECEU_ENTREVISTA: ['ENTREVISTA', 'Não compareceu à entrevista'],
  DESISTIU_PROCESSO: ['DESISTÊNCIA', 'Desistiu do processo seletivo'],
  DISPONIBILIDADE_INCOMPATIVEL: ['DISPONIBILIDADE', 'Horário ou escala incompatível com esta vaga'],
  DESLOCAMENTO_INCOMPATIVEL: ['DISPONIBILIDADE', 'Local ou deslocamento incompatível com esta vaga'],
  EXPERIENCIA_NAO_CONFIRMADA_ENTREVISTA: ['EXPERIÊNCIA', 'Experiência exigida não foi confirmada na entrevista'],
  REQUISITO_NAO_CONFIRMADO_ENTREVISTA: ['REQUISITO', 'Requisito obrigatório específico não confirmado'],
  PERFIL_NAO_ADERENTE_VAGA: ['REQUISITO', 'Registro legado: perfil não aderente'],
  DOCUMENTACAO_PENDENTE: ['DOCUMENTO', 'Documentação obrigatória pendente'],
  OUTRO: ['OUTRO', 'Outro motivo'],
});

function candidateSexText(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'MASCULINO') return 'Masculino';
  if (normalized === 'FEMININO') return 'Feminino';
  return 'Não informado';
}

function sexSourceText(value) {
  const labels = { CTPS: 'CTPS', CURRICULO: 'Currículo', INFORMADA: 'Informado na conversa', MANUAL: 'Cadastro manual', IMPORTADA: 'Cadastro anterior' };
  return labels[String(value || '').toUpperCase()] || 'Fonte não registrada';
}

const viewMeta = {
  dashboard: ['OPERAÇÃO', 'Visão geral', 'Funil, entrevistas e resultados da operação de recrutamento.', '+ Nova vaga'],
  vacancies: ['OPORTUNIDADES', 'Vagas', 'Crie, duplique, divulgue e acompanhe o desempenho das vagas.', '+ Nova vaga'],
  candidates: ['PESSOAS', 'Candidatos', 'Acompanhe cada candidato em tabela ou pipeline.', '+ Novo candidato'],
  interviews: ['AGENDA', 'Entrevistas', 'Compromissos, horários e links do Google Meet.', 'Atualizar agenda'],
  documents: ['ARQUIVOS', 'Documentos', 'CTPS, currículos e PDFs que precisam de revisão.', 'Atualizar arquivos'],
  monitoring: ['OBSERVABILIDADE', 'Monitoramento', 'Entradas, erros e sinais de saúde da automação.', 'Atualizar monitoramento'],
  audit: ['ADMINISTRAÇÃO', 'Auditoria da IA', 'Identifique falhas objetivas e problemas de qualidade nas conversas da Evelyn.', 'Sincronizar'],
  prospecting: ['ADMINISTRAÇÃO', 'Prospecção', 'Busque empresas na Apify com limites rígidos de quantidade e orçamento.', 'Nova busca'],
  users: ['ADMINISTRAÇÃO', 'Usuários', 'Crie logins, defina permissões e controle os acessos ao painel.', '+ Criar login'],
};

const el = Object.fromEntries([
  'sidebar', 'sidebarBackdrop', 'mobileMenuButton', 'themeToggleButton', 'mobileMoreButton', 'pageEyebrow', 'pageTitle', 'pageSubtitle',
  'globalSearchButton', 'refreshCurrentViewButton', 'primaryActionButton',
  'dashboardUpdatedAt', 'dashboardHealthText', 'dashboardPeriodSegments', 'kpiMessagesReceived', 'kpiCandidatesPeriod', 'kpiTopVacancy', 'kpiTopVacancyCount', 'kpiMessagesPeriodLabel', 'kpiActiveCandidates', 'kpiActiveVacancies',
  'kpiInterviewsToday', 'kpiApprovedTriage', 'kpiAdmission', 'kpiHired',
  'dashboardFunnel', 'dashboardInterviews',
  'vacancyStatusSegments', 'vacancyPeriodSegments', 'vacancySearchInput', 'vacancyKpiActive', 'vacancyKpiInterested',
  'vacancyKpiInProcess', 'vacancyKpiApproved', 'vacancyKpiTop', 'vacancyKpiTopCount', 'vacanciesLoading', 'vacanciesEmpty',
  'vacanciesTableWrapper', 'vacanciesTableBody', 'candidateStatusSegments', 'candidatePeriodSegments', 'candidateSearchInput',
  'candidateFilterToggleButton', 'candidateFilterPanel', 'candidateVacancyFilter', 'candidateStageFilter', 'candidateDocumentFilter', 'candidateInterviewFilter', 'candidateSexFilter', 'candidateReallocationFilter', 'clearCandidateFiltersButton',
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
  'copyFacebookPromotionButton', 'promotionPrimaryImage', 'downloadPrimaryPromotionButton',
  'vacancyViewDialog', 'vacancyViewTitle', 'vacancyViewSubtitle', 'vacancyViewBadges', 'closeVacancyViewButton',
  'vacancyViewEditButton', 'vacancyViewPromoteButton', 'vacancyViewCandidatesButton', 'vacancyViewMobileCandidatesButton',
  'vacancyViewMeta', 'vacancyViewActions', 'vacancyViewFunnel', 'vacancyViewDescription', 'vacancyViewRequirements',
  'vacancyViewBenefits', 'vacancyViewPublication', 'vacancyViewActivity', 'vacancyViewSecondaryActions',
  'vacancyViewTabCandidates', 'vacancyViewTabPromotion', 'vacancyViewTabSettings',
  'candidateDrawer', 'closeCandidateDrawerButton', 'candidateDrawerTitle', 'candidateDrawerSubtitle',
  'candidateDrawerLoading', 'candidateDrawerContent', 'candidateAvatar', 'candidateName',
  'candidatePhone', 'candidateLabels', 'candidateWhatsappButton', 'deleteCandidateButton',
  'candidateVacancy', 'candidateStage', 'candidateCep', 'candidateSex', 'candidateSexSource', 'candidateSexCompatibility', 'candidateInterview', 'candidateMeetLink',
  'candidateTriageSection', 'candidateTriage', 'candidateExperiences', 'candidateRejectionSection',
  'candidateRejectionReason', 'candidateRejectionObservation', 'candidateRejectionCategory', 'candidateReallocationStatus', 'candidatePresentationSection',
  'candidatePresentation', 'candidatePersonalitySection', 'candidatePersonality',
  'candidatePersonalityTags', 'candidateStatusSelect', 'candidateStageSelect', 'updateCandidateButton',
  'candidateAiStatusBadge', 'candidateAiStatusText', 'toggleCandidateAiButton', 'reprocessCandidateCtpsButton',
  'manualContinueStatus', 'manualContinueStage', 'manualContinueMessage', 'manualContinueActivateAi',
  'manualContinueSendMessage', 'continueCandidateManuallyButton',
  'postInterviewDecisionSection', 'postInterviewDecision', 'postInterviewReasonField', 'postInterviewReason', 'postInterviewReallocatableField', 'postInterviewReallocatable',
  'postInterviewObservation', 'savePostInterviewDecisionButton',
  'candidateDocuments', 'candidateTimeline', 'candidateTagSelector', 'saveCandidateTagsButton',
  'candidateNoteInput', 'addCandidateNoteButton', 'candidateNotes', 'candidateTaskTitle',
  'candidateTaskPriority', 'candidateTaskDue', 'addCandidateTaskButton', 'candidateTasks',
  'newCandidateDialog', 'newCandidateForm', 'closeNewCandidateButton', 'cancelNewCandidateButton',
  'saveNewCandidateButton', 'newCandidateVacancy', 'newCandidateError',
  'vacancyTemplateSelect', 'applyVacancyTemplateButton', 'saveVacancyTemplateButton', 'manageVacancyTemplatesButton',
  'templateManagerDialog', 'closeTemplateManagerButton', 'createEmptyTemplateButton', 'templateManagerList',
  'auditSyncPeriod', 'auditCustomRange', 'auditCustomStart', 'auditCustomEnd', 'auditSyncButton', 'auditExportButton', 'auditExportDialog', 'auditExportPeriod', 'auditExportScope', 'auditExportCustomRange', 'auditExportStart', 'auditExportEnd', 'closeAuditExportButton', 'cancelAuditExportButton', 'confirmAuditExportButton', 'auditKpiConversations', 'auditKpiClean', 'auditKpiCritical', 'auditKpiHigh', 'auditKpiScore', 'auditLastSync',
  'auditTrendChart', 'auditTopCategories', 'auditResultCount', 'auditSeverityFilter', 'auditStatusFilter', 'auditGroupMode', 'auditSearchInput', 'auditLoading', 'auditEmpty', 'auditProblemsList',
  'auditProblemDialog', 'auditProblemTitle', 'auditProblemSubtitle', 'closeAuditProblemButton', 'openAuditCandidateProfileButton', 'auditProblemContent', 'auditReviewObservation',
  'candidateAuditSection', 'candidateAuditScore', 'candidateAuditSummary', 'candidateAuditProblems', 'openCandidateAuditButton',
  'currentUserName', 'currentUserAvatar', 'currentUserRole', 'vacancyEstimatedEarnings', 'logoutButton', 'toast',
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


function calculateDaysOpen(vacancy = {}) {
  const value = vacancy.data_inicio || vacancy.created_at || vacancy.updated_at;
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function inferVacancyProfile(title = '', description = '') {
  const source = `${title} ${description}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rules = [
    { re: /(auxiliar de limpeza|limpeza|servicos gerais|serviços gerais|conservacao|conservação|faxina)/, cargo: 'Auxiliar de Limpeza', cargos: 'Auxiliar de Limpeza\nAuxiliar de Serviços Gerais\nServente de Limpeza', cbos: '5143-20\n5143-25\n5143-10' },
    { re: /(porteiro|controlador de acesso|portaria)/, cargo: 'Porteiro', cargos: 'Porteiro\nControlador de Acesso', cbos: '5174-10\n5174-15' },
    { re: /(recepcionista|recepcao|recepção)/, cargo: 'Recepcionista', cargos: 'Recepcionista', cbos: '4221-05' },
    { re: /(administrativo|auxiliar administrativo|assistente administrativo)/, cargo: 'Assistente Administrativo', cargos: 'Assistente Administrativo\nAuxiliar Administrativo', cbos: '4110-10\n4110-05' },
    { re: /(cozinha|cozinheiro|auxiliar de cozinha|copeira|copeiro)/, cargo: 'Auxiliar de Cozinha', cargos: 'Auxiliar de Cozinha\nCopeiro\nCozinheiro', cbos: '5135-05\n5134-25\n5132-05' },
    { re: /(logistica|logística|estoque|almoxarife|expedicao|expedição)/, cargo: 'Auxiliar de Logística', cargos: 'Auxiliar de Logística\nAlmoxarife\nEstoquista', cbos: '4141-05\n4141-10\n4141-25' },
    { re: /(manutencao|manutenção|eletricista|encanador|predial)/, cargo: 'Oficial de Manutenção', cargos: 'Oficial de Manutenção\nTécnico de Manutenção', cbos: '9113-05\n3131-20\n9511-05' },
  ];
  return rules.find((rule) => rule.re.test(source)) || { cargo: title, cargos: title, cbos: '' };
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
  const openDialogs = Array.from(document.querySelectorAll('dialog[open]'));
  const topDialog = openDialogs.at(-1);

  // Elementos <dialog> abertos ficam na camada superior do navegador.
  // Um toast mantido fora do dialog pode ficar invisível atrás do painel lateral.
  if (topDialog && !topDialog.contains(el.toast)) {
    topDialog.appendChild(el.toast);
  } else if (!topDialog && el.toast.parentElement !== document.body) {
    document.body.appendChild(el.toast);
  }

  el.toast.textContent = String(message || 'Concluído.');
  el.toast.className = `toast ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.add('hidden'), 5000);
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
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === name));
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
    if (state.activeView === 'audit') await loadAudit(force);
    if (state.activeView === 'prospecting') await window.GenesisAdmin?.loadProspecting(force);
    if (state.activeView === 'users') await window.GenesisAdmin?.loadUsers(force);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadDashboard() {
  const data = await api(`/api/dashboard?periodo=${encodeURIComponent(state.dashboardPeriod)}`);
  state.dashboard = data;
  renderDashboard();
}

function renderDashboard() {
  const data = state.dashboard || {};
  const metrics = data.metricas || {};
  el.dashboardUpdatedAt.textContent = `Atualizado em ${formatDate(data.atualizado_em)}`;
  el.kpiMessagesReceived.textContent = Number(metrics.mensagens_recebidas_periodo || 0);
  el.kpiCandidatesPeriod.textContent = Number(metrics.candidatos_periodo || 0);
  el.kpiTopVacancy.textContent = metrics.vaga_mais_escolhida_nome || 'Sem dados no período';
  el.kpiTopVacancyCount.textContent = `${Number(metrics.vaga_mais_escolhida_quantidade || 0)} escolha${Number(metrics.vaga_mais_escolhida_quantidade || 0) === 1 ? '' : 's'}`;
  el.kpiMessagesPeriodLabel.textContent = state.dashboardPeriod === '1D' ? 'Hoje' : `Últimos ${state.dashboardPeriod.replace('D', '')} dias`;
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
  const data = await api(`/api/vagas?periodo=${encodeURIComponent(state.vacancyPeriod)}`);
  state.vacancies = data.vagas || [];
  state.portalBaseUrl = data.portal_base_url || state.portalBaseUrl || '';
  state.vacancySummary = data.resumo_periodo || null;
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

function vacancyOperationalData(v) {
  const novos = Number(v.candidatos_novos || 0);
  const analise = Number(v.candidatos_em_analise || v.candidatos_em_processo || 0);
  const entrevistas = Number(v.candidatos_entrevista || 0);
  const aprovados = Number(v.candidatos_aprovados || 0);
  const hoje = Number(v.entrevistas_hoje || 0);
  const last = v.ultima_movimentacao ? new Date(v.ultima_movimentacao) : null;
  const inactiveDays = last && !Number.isNaN(last.getTime()) ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000)) : calculateDaysOpen(v);
  if (v.status === 'RASCUNHO') return { tone: 'neutral', icon: '✎', message: 'Rascunho ainda não publicado', action: 'publish', label: 'Publicar vaga' };
  if (v.status === 'PAUSADA') return { tone: 'warning', icon: 'Ⅱ', message: 'Vaga pausada para novas candidaturas', action: 'status', status: 'ATIVA', label: 'Reativar vaga' };
  if (v.status === 'ENCERRADA') return { tone: 'neutral', icon: '✓', message: 'Processo seletivo encerrado', action: 'view', label: 'Consultar resumo' };
  if (analise > 0) return { tone: 'warning', icon: '◷', message: `${analise} candidato${analise === 1 ? '' : 's'} aguardando análise`, action: 'candidates', label: 'Analisar candidatos' };
  if (hoje > 0) return { tone: 'info', icon: '▣', message: `${hoje} entrevista${hoje === 1 ? '' : 's'} hoje`, action: 'interviews', label: 'Ver entrevistas' };
  if (inactiveDays >= 4 && novos + analise + entrevistas + aprovados === 0) return { tone: 'warning', icon: '!', message: `Sem candidatos há ${inactiveDays} dias`, action: 'view', label: 'Revisar vaga' };
  return { tone: 'success', icon: '✓', message: 'Nenhuma pendência importante', action: 'view', label: 'Abrir resumo' };
}

function renderVacancies() {
  const vacancies = filteredVacancies();
  el.vacanciesLoading.classList.add('hidden');
  const active = state.vacancies.filter((v) => v.status === 'ATIVA').length;
  const awaiting = state.vacancies.reduce((sum, v) => sum + Number(v.candidatos_em_analise || v.candidatos_em_processo || 0), 0);
  const interviewsToday = state.vacancies.reduce((sum, v) => sum + Number(v.entrevistas_hoje || 0), 0);
  const pending = state.vacancies.filter((v) => ['warning'].includes(vacancyOperationalData(v).tone)).length;
  el.vacancyKpiActive.textContent = active;
  el.vacancyKpiInterested.textContent = awaiting;
  el.vacancyKpiInProcess.textContent = interviewsToday;
  el.vacancyKpiApproved.textContent = pending;
  el.vacancyKpiTop.textContent = state.vacancySummary?.vaga_mais_escolhida_nome || 'Sem dados no período';
  const topCount = Number(state.vacancySummary?.vaga_mais_escolhida_quantidade || 0);
  el.vacancyKpiTopCount.textContent = `${topCount} escolha${topCount === 1 ? '' : 's'} em ${state.vacancyPeriod}`;

  const kpiCards = [
    [el.vacancyKpiActive, 'Vagas ativas', 'Oportunidades disponíveis'],
    [el.vacancyKpiInterested, 'Aguardando análise', 'Exigem ação do recrutador'],
    [el.vacancyKpiInProcess, 'Entrevistas hoje', 'Compromissos do dia'],
    [el.vacancyKpiApproved, 'Pendências', 'Vagas que merecem atenção'],
  ];
  kpiCards.forEach(([node, label, help]) => { const card = node?.closest('.kpi-card'); if (card) { card.querySelector('span').textContent = label; card.querySelector('small').textContent = help; } });

  if (!vacancies.length) {
    el.vacanciesEmpty.classList.remove('hidden');
    el.vacanciesTableWrapper.classList.add('hidden');
    return;
  }
  el.vacanciesEmpty.classList.add('hidden');
  el.vacanciesTableWrapper.classList.remove('hidden');

  el.vacanciesTableBody.innerHTML = vacancies.map((v) => {
    const location = [v.bairro, v.cidade, v.estado].filter(Boolean).join(' · ') || 'Local não informado';
    const op = vacancyOperationalData(v);
    const novos = Number(v.candidatos_novos || 0);
    const analise = Number(v.candidatos_em_analise || v.candidatos_em_processo || 0);
    const entrevistas = Number(v.candidatos_entrevista || 0);
    const aprovados = Number(v.candidatos_aprovados || 0);
    const portal = v.publicar_portal ? '<span class="portal-chip">Publicada</span>' : '<span class="portal-chip muted">Interna</span>';
    const portalLink = v.status === 'ATIVA' && v.publicar_portal && publicVacancyUrl(v) ? `<a class="vacancy-menu-link" href="${escapeHtml(publicVacancyUrl(v))}" target="_blank" rel="noopener">Abrir no portal</a>` : '';
    const primaryAction = op.action === 'status'
      ? `<button class="button button-primary vacancy-primary-action" data-vacancy-action="status" data-status="${op.status}" data-id="${v.id}" type="button">${op.label}</button>`
      : `<button class="button ${op.tone === 'success' ? 'button-ghost' : 'button-primary'} vacancy-primary-action" data-vacancy-action="${op.action}" data-id="${v.id}" type="button">${op.label}</button>`;
    return `<article class="vacancy-operational-card" data-status="${escapeHtml(v.status)}">
      <div class="vacancy-card-identity"><div class="vacancy-card-title-row"><button class="vacancy-title-button" data-vacancy-action="view" data-id="${v.id}" type="button">${escapeHtml(v.titulo)}</button><span class="badge ${badgeClass(v.status)}">${escapeHtml(vacancyStatusLabels[v.status] || v.status)}</span>${portal}</div><span>${escapeHtml(location)}</span><small>${escapeHtml(v.empresa_nome || v.codigo || 'Empresa não informada')}</small></div>
      <div class="vacancy-card-funnel" aria-label="Funil da vaga"><span><b>${novos}</b><small>Novos</small></span><span><b>${analise}</b><small>Análise</small></span><span><b>${entrevistas}</b><small>Entrevistas</small></span><span><b>${aprovados}</b><small>Aprovados</small></span></div>
      <div class="vacancy-card-priority ${op.tone}"><span class="priority-icon">${op.icon}</span><strong>${escapeHtml(op.message)}</strong></div>
      <div class="vacancy-card-actions">${primaryAction}<details class="vacancy-more"><summary aria-label="Mais ações">•••</summary><div class="vacancy-more-menu"><button data-vacancy-action="view" data-id="${v.id}" type="button">Resumo da vaga</button><button data-vacancy-action="edit" data-id="${v.id}" type="button">Editar</button><button data-vacancy-action="promote" data-id="${v.id}" type="button">Divulgar</button>${portalLink}<button data-vacancy-action="duplicate" data-id="${v.id}" type="button">Duplicar</button>${v.status === 'ATIVA' ? `<button data-vacancy-action="status" data-status="PAUSADA" data-id="${v.id}" type="button">Pausar</button>` : ''}<button class="danger" data-vacancy-action="delete" data-id="${v.id}" type="button">Excluir</button></div></details></div>
    </article>`;
  }).join('');
}

function slugifyPublicVacancy(value) {
  return String(value || 'vaga')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'vaga';
}
function publicVacancyUrl(vacancy) {
  if (!state.portalBaseUrl || !vacancy?.id) return '';
  return `${state.portalBaseUrl}/vagas/${vacancy.id}-${slugifyPublicVacancy(vacancy.titulo || vacancy.cargo)}`;
}

function vacancyById(id) {
  return state.vacancies.find((vacancy) => String(vacancy.id) === String(id));
}

async function openVacancyById(id) {
  let vacancy = vacancyById(id);
  if (!vacancy) {
    const result = await api(`/api/vagas/${encodeURIComponent(id)}`);
    state.portalBaseUrl = result.portal_base_url || state.portalBaseUrl || '';
    vacancy = result.vaga;
    if (vacancy) {
      const exists = state.vacancies.some((item) => String(item.id) === String(vacancy.id));
      if (!exists) state.vacancies.push(vacancy);
    }
  }
  if (!vacancy) throw new Error('Vaga não encontrada.');
  return openVacancyDialog(vacancy);
}

function numericFormValue(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function calculateApproximateGains(source = {}) {
  const salary = numericFormValue(source.salario);
  const vr = numericFormValue(source.vale_refeicao_valor);
  const va = numericFormValue(source.vale_alimentacao_valor);
  const attendance = numericFormValue(source.premio_assiduidade_valor);
  const other = numericFormValue(source.outros_beneficios_valor);
  const insalubrity = source.possui_insalubridade
    ? salary * (numericFormValue(source.percentual_insalubridade) / 100)
    : 0;
  return salary + vr + va + attendance + other + insalubrity;
}

function updateVacancyEarningsPreview() {
  if (!el.vacancyEstimatedEarnings || !el.vacancyForm) return;
  const data = new FormData(el.vacancyForm);
  const total = calculateApproximateGains({
    salario: data.get('salario'),
    vale_refeicao_valor: data.get('vale_refeicao_valor'),
    vale_alimentacao_valor: data.get('vale_alimentacao_valor'),
    premio_assiduidade_valor: data.get('premio_assiduidade_valor'),
    outros_beneficios_valor: data.get('outros_beneficios_valor'),
    possui_insalubridade: el.possui_insalubridade?.checked,
    percentual_insalubridade: data.get('percentual_insalubridade'),
  });
  el.vacancyEstimatedEarnings.textContent = total > 0 ? formatMoney(total) : 'R$ 0,00';
}

async function duplicateVacancy(id) {
  const vacancy = vacancyById(id);
  const label = vacancy?.titulo || 'esta vaga';
  if (!window.confirm(`Duplicar ${label} como rascunho?`)) return;
  const result = await api(`/api/vagas/${encodeURIComponent(id)}/duplicar`, { method: 'POST', body: '{}' });
  showToast(result.mensagem || 'Vaga duplicada.');
  await loadVacancies(true);
}


async function deleteVacancy(id) {
  const vacancy = vacancyById(id);
  const label = vacancy?.titulo || 'esta vaga';
  if (!window.confirm(`Deseja realmente excluir ${label}? Esta ação não poderá ser desfeita.`)) return;
  const result = await api(`/api/vagas/${encodeURIComponent(id)}`, { method: 'DELETE' });
  showToast(result.mensagem || 'Vaga excluída com sucesso.');
  await loadVacancies(true);
}

function splitVacancyItems(value) {
  return String(value || '').split(/\r?\n|;|\|/).map((item) => item.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
}

function openVacancyCandidates(vacancy) {
  el.vacancyViewDialog?.close();
  setView('candidates');
  if (el.candidateSearchInput) {
    el.candidateSearchInput.value = vacancy?.titulo || '';
    renderCandidates();
  }
}

async function openVacancyView(id) {
  const detail = await api(`/api/vagas/${encodeURIComponent(id)}`);
  const vacancy = detail.vaga || vacancyById(id);
  if (!vacancy) throw new Error('Vaga não encontrada.');
  state.selectedVacancy = vacancy;
  const location = [vacancy.bairro, vacancy.cidade, vacancy.estado].filter(Boolean).join(' · ') || 'Local não informado';
  const schedule = [vacancy.escala ? `Escala ${vacancy.escala}` : '', vacancy.horario || 'Horário a confirmar'].filter(Boolean).join(' · ');
  const novos = Number(vacancy.candidatos_novos || 0);
  const analise = Number(vacancy.candidatos_em_analise || vacancy.candidatos_em_processo || 0);
  const entrevistas = Number(vacancy.candidatos_entrevista || 0);
  const aprovados = Number(vacancy.candidatos_aprovados || 0);
  const hoje = Number(vacancy.entrevistas_hoje || 0);
  const total = Number(vacancy.total_interessados || 0);
  const op = vacancyOperationalData(vacancy);
  const requirements = splitVacancyItems(vacancy.requisitos_obrigatorios || vacancy.requisitos || vacancy.cargos_compativeis).slice(0, 5);
  const benefits = splitVacancyItems(vacancy.beneficios).slice(0, 7);
  if (vacancy.vale_transporte && !benefits.some(x => /transporte/i.test(x))) benefits.unshift('Vale-transporte');
  if (Number(vacancy.vale_refeicao_valor || 0) > 0 && !benefits.some(x => /refei/i.test(x))) benefits.push('Vale-refeição');
  if (Number(vacancy.vale_alimentacao_valor || 0) > 0 && !benefits.some(x => /alimenta/i.test(x))) benefits.push('Vale-alimentação');

  el.vacancyViewTitle.textContent = vacancy.titulo || 'Resumo da vaga';
  el.vacancyViewSubtitle.textContent = `${vacancy.codigo || 'Sem código'} · Atualizada ${formatDate(vacancy.updated_at)}`;
  el.vacancyViewBadges.innerHTML = `<span class="badge ${badgeClass(vacancy.status)}">${escapeHtml(vacancyStatusLabels[vacancy.status] || vacancy.status)}</span>${vacancy.publicar_portal ? '<span class="portal-chip">Publicada no portal</span>' : '<span class="portal-chip muted">Uso interno</span>'}`;
  el.vacancyViewMeta.innerHTML = `<span>⌖ ${escapeHtml(location)}</span><span>▣ ${escapeHtml(vacancy.empresa_nome || 'Empresa não informada')}</span><span>◷ ${escapeHtml(schedule)}</span><span>R$ ${escapeHtml(formatMoney(vacancy.salario).replace(/^R\$\s*/, ''))}</span><span>${calculateDaysOpen(vacancy)} dia(s) aberta</span>`;
  el.vacancyViewActions.innerHTML = `<button class="vacancy-next-action ${op.tone}" data-vacancy-action="${op.action}" ${op.status ? `data-status="${op.status}"` : ''} data-id="${vacancy.id}" type="button"><span>${op.icon}</span><div><strong>${escapeHtml(op.message)}</strong><small>${escapeHtml(op.label)}</small></div><b>›</b></button>${hoje > 0 ? `<button class="vacancy-next-action info" data-vacancy-action="interviews" data-id="${vacancy.id}" type="button"><span>▣</span><div><strong>${hoje} entrevista${hoje === 1 ? '' : 's'} hoje</strong><small>Confira a agenda</small></div><b>›</b></button>` : ''}`;
  el.vacancyViewFunnel.innerHTML = `<span><small>Novos</small><b>${novos}</b></span><span><small>Análise</small><b>${analise}</b></span><span><small>Entrevistas</small><b>${entrevistas}</b></span><span><small>Aprovados</small><b>${aprovados}</b></span>`;
  el.vacancyViewDescription.textContent = vacancy.descricao || 'Descrição ainda não informada. Edite a vaga para adicionar um resumo das atividades e do perfil esperado.';
  el.vacancyViewRequirements.innerHTML = requirements.length ? requirements.map(item => `<span><b>✓</b>${escapeHtml(item)}</span>`).join('') : '<span class="muted-copy">Nenhum requisito essencial informado.</span>';
  el.vacancyViewBenefits.innerHTML = benefits.length ? benefits.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join('') : '<span class="muted-copy">Benefícios não informados.</span>';
  el.vacancyViewPublication.innerHTML = `<span><small>Status no portal</small><strong>${vacancy.publicar_portal ? 'Publicada' : 'Não publicada'}</strong></span><span><small>Candidaturas recebidas</small><strong>${total}</strong></span><span><small>Dias aberta</small><strong>${calculateDaysOpen(vacancy)}</strong></span><span><small>Canal</small><strong>${escapeHtml(String(vacancy.canal_candidatura || 'WhatsApp Genesis').replaceAll('_',' '))}</strong></span>`;
  el.vacancyViewActivity.innerHTML = `<span><i class="${op.tone}">${op.icon}</i><div><strong>${escapeHtml(op.message)}</strong><small>Prioridade atual</small></div></span><span><i class="success">✓</i><div><strong>${total} candidatura${total === 1 ? '' : 's'} recebida${total === 1 ? '' : 's'}</strong><small>Desde a abertura da vaga</small></div></span><span><i class="info">↻</i><div><strong>Última atualização</strong><small>${escapeHtml(formatDate(vacancy.updated_at))}</small></div></span>`;
  el.vacancyViewSecondaryActions.innerHTML = `${vacancy.publicar_portal && publicVacancyUrl(vacancy) ? `<a href="${escapeHtml(publicVacancyUrl(vacancy))}" target="_blank" rel="noopener">Abrir no portal</a>` : ''}<button data-vacancy-action="duplicate" data-id="${vacancy.id}" type="button">Duplicar vaga</button>${vacancy.status === 'ATIVA' ? `<button data-vacancy-action="status" data-status="PAUSADA" data-id="${vacancy.id}" type="button">Pausar vaga</button>` : `<button data-vacancy-action="status" data-status="ATIVA" data-id="${vacancy.id}" type="button">Ativar vaga</button>`}`;
  const candidatesAction = () => openVacancyCandidates(vacancy);
  el.vacancyViewCandidatesButton.onclick = candidatesAction;
  el.vacancyViewMobileCandidatesButton.onclick = candidatesAction;
  el.vacancyViewEditButton.onclick = () => { el.vacancyViewDialog.close(); openVacancyDialog(vacancy); };
  el.vacancyViewPromoteButton.onclick = () => { el.vacancyViewDialog.close(); openPromotion(vacancy.id); };
  el.vacancyViewTabCandidates.onclick = candidatesAction;
  el.vacancyViewTabPromotion.onclick = () => { el.vacancyViewDialog.close(); openPromotion(vacancy.id); };
  el.vacancyViewTabSettings.onclick = () => { el.vacancyViewDialog.close(); openVacancyDialog(vacancy); };
  el.vacancyViewDialog.showModal();
}


function setCheckboxGroup(name, values) {
  const selected = new Set((Array.isArray(values) ? values : []).map(String));
  el.vacancyForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = selected.has(String(input.value)); });
}

async function loadVacancyTemplates(force = false) {
  if (state.vacancyTemplates.length && !force) return state.vacancyTemplates;
  const result = await api('/api/vagas-templates');
  state.vacancyTemplates = result.templates || [];
  if (el.vacancyTemplateSelect) {
    el.vacancyTemplateSelect.innerHTML = '<option value="">Começar do zero</option>' + state.vacancyTemplates.map((item) => `<option value="${item.id}">${escapeHtml(item.nome)}</option>`).join('');
  }
  renderTemplateManager();
  return state.vacancyTemplates;
}

function applyFormSource(source = {}) {
  Object.entries(source).forEach(([key, value]) => {
    const input = el.vacancyForm.elements[key];
    if (!input || typeof RadioNodeList !== 'undefined' && input instanceof RadioNodeList) return;
    if (input.type === 'checkbox') input.checked = value === true || value === 'true';
    else if (input.type === 'date' && value) input.value = String(value).slice(0, 10);
    else input.value = value ?? '';
  });
  setCheckboxGroup('entrevista_dias_semana', source.entrevista_dias_semana || [1,2,3,4,5]);
  setCheckboxGroup('entrevista_horarios', source.entrevista_horarios || ['09:00','10:00','14:00','15:00']);
  el.possui_insalubridade.checked = Boolean(source.possui_insalubridade);
  toggleInsalubrityFields();
  updateVacancyEarningsPreview();
}

function applyTemplateById(id) {
  const template = state.vacancyTemplates.find((item) => Number(item.id) === Number(id));
  if (!template) { showToast('Selecione um template válido.', 'error'); return; }
  const preserved = { status: el.vacancyForm.elements.status.value, empresa_id: el.vacancyForm.elements.empresa_id.value };
  applyFormSource({ ...(template.dados || {}), empresa_id: template.empresa_id || template.dados?.empresa_id || preserved.empresa_id, status: preserved.status || 'RASCUNHO' });
  if (el.vacancyTemplateSelect) el.vacancyTemplateSelect.value = String(template.id);
  showToast(`Template “${template.nome}” aplicado.`);
}

async function saveCurrentVacancyAsTemplate() {
  const suggested = el.vacancyForm.elements.titulo.value ? `${el.vacancyForm.elements.titulo.value} — modelo` : '';
  const name = window.prompt('Nome do template:', suggested);
  if (!name?.trim()) return;
  const payload = vacancyFormPayload();
  delete payload.status; delete payload.data_inicio; delete payload.data_encerramento;
  const result = await api('/api/vagas-templates', { method: 'POST', body: JSON.stringify({ nome: name.trim(), descricao: `Modelo criado a partir de ${payload.titulo || 'uma vaga'}.`, empresa_id: payload.empresa_id || null, dados: payload, ativo: true }) });
  showToast(result.mensagem || 'Template salvo.');
  await loadVacancyTemplates(true);
  if (result.template?.id) el.vacancyTemplateSelect.value = String(result.template.id);
}

function renderTemplateManager() {
  if (!el.templateManagerList) return;
  el.templateManagerList.innerHTML = state.vacancyTemplates.length ? state.vacancyTemplates.map((item) => `
    <article class="template-manager-item"><div><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(item.descricao || item.empresa_nome || 'Template de vaga')}</span><small>Atualizado ${escapeHtml(formatDate(item.updated_at))}</small></div><div><button class="button button-primary" data-template-apply="${item.id}" type="button">Usar</button><button class="button button-ghost" data-template-edit="${item.id}" type="button">Editar</button><button class="button button-ghost" data-template-duplicate="${item.id}" type="button">Duplicar</button><button class="button button-ghost danger-text" data-template-delete="${item.id}" type="button">Desativar</button></div></article>
  `).join('') : emptyState('Nenhum template salvo', 'Abra uma vaga e use “Salvar como template”.');
}

async function createEmptyVacancyTemplate() {
  const name = window.prompt('Nome do novo template:', 'Novo modelo de vaga');
  if (!name?.trim()) return;
  const description = window.prompt('Descrição do template:', 'Modelo vazio para preenchimento rápido.') ?? '';
  const result = await api('/api/vagas-templates', {
    method: 'POST',
    body: JSON.stringify({
      nome: name.trim(),
      descricao: description.trim() || null,
      empresa_id: state.companies[0]?.id || null,
      dados: {
        idade_minima: 25,
        idade_maxima: null,
        sexo: 'UNISSEX',
        modalidade: 'Presencial',
        quantidade_vagas: 1,
        experiencia_minima_meses: 0,
        exigir_experiencia_compativel: true,
        publicar_portal: true,
        canal_candidatura: 'WHATSAPP_GENESIS',
        entrevista_dias_semana: [1, 2, 3, 4, 5],
        entrevista_horarios: ['09:00', '10:00', '14:00', '15:00'],
        entrevista_duracao_minutos: 30,
        entrevista_busca_dias: 7,
        entrevista_evitar_feriados: true,
      },
      ativo: true,
    }),
  });
  showToast(result.mensagem || 'Template criado.');
  await loadVacancyTemplates(true);
}

async function editVacancyTemplate(id) {
  const template = state.vacancyTemplates.find((item) => Number(item.id) === Number(id));
  if (!template) return showToast('Template não encontrado.', 'error');
  const name = window.prompt('Nome do template:', template.nome || '');
  if (!name?.trim()) return;
  const description = window.prompt('Descrição do template:', template.descricao || '') ?? template.descricao ?? '';
  const result = await api(`/api/vagas-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      nome: name.trim(),
      descricao: description.trim() || null,
      empresa_id: template.empresa_id || null,
      dados: template.dados || {},
      ativo: true,
    }),
  });
  showToast(result.mensagem || 'Template atualizado.');
  await loadVacancyTemplates(true);
}

async function duplicateVacancyTemplate(id) {
  const template = state.vacancyTemplates.find((item) => Number(item.id) === Number(id));
  if (!template) return showToast('Template não encontrado.', 'error');
  const name = window.prompt('Nome da cópia:', `${template.nome} — cópia`);
  if (!name?.trim()) return;
  const result = await api('/api/vagas-templates', {
    method: 'POST',
    body: JSON.stringify({
      nome: name.trim(),
      descricao: template.descricao || `Cópia de ${template.nome}`,
      empresa_id: template.empresa_id || null,
      dados: template.dados || {},
      ativo: true,
    }),
  });
  showToast(result.mensagem || 'Template duplicado.');
  await loadVacancyTemplates(true);
}

async function deleteVacancyTemplate(id) {
  if (!window.confirm('Desativar este template? As vagas criadas com ele não serão alteradas.')) return;
  const result = await api(`/api/vagas-templates/${id}`, { method: 'DELETE' });
  showToast(result.mensagem || 'Template desativado.');
  await loadVacancyTemplates(true);
}

function auditSeverityLabel(value) { return ({ CRITICA: 'Crítica', ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' })[value] || value; }
function auditCategoryLabel(value) {
  return String(value || '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

const auditSeverityOrder = Object.freeze({ CRITICA: 4, ALTA: 3, MEDIA: 2, BAIXA: 1 });

function auditIssueRow(item, grouped = false) {
  return `
    <article class="audit-problem-row ${grouped ? 'is-grouped' : ''}" data-audit-open="${item.id}">
      <span class="audit-severity ${String(item.gravidade || '').toLowerCase()}">${escapeHtml(auditSeverityLabel(item.gravidade))}</span>
      <div class="audit-problem-main"><div><strong>${escapeHtml(item.titulo)}</strong><span class="badge ${item.origem_deteccao === 'IA' ? 'badge-process' : 'badge-neutral'}">${item.origem_deteccao === 'IA' ? `IA · ${Math.round(Number(item.confianca || 0))}%` : 'Regra objetiva'}</span></div><p>${escapeHtml(item.descricao)}</p><small>${grouped ? `${escapeHtml(auditCategoryLabel(item.categoria))} · ` : `${escapeHtml(item.candidato_nome || `Candidato #${item.candidato_id}`)} · ${escapeHtml(item.vaga_nome || 'Sem vaga')} · `}${escapeHtml(formatDate(item.created_at))}</small></div>
      <span class="audit-review-status">${escapeHtml(auditCategoryLabel(item.status_revisao))}<b>›</b></span>
    </article>`;
}

function groupAuditIssues(issues) {
  const groups = new Map();
  issues.forEach((item) => {
    const key = Number(item.candidato_id);
    if (!groups.has(key)) groups.set(key, {
      candidato_id: key,
      candidato_nome: item.candidato_nome || `Candidato #${key}`,
      vaga_nome: item.vaga_nome || 'Sem vaga',
      issues: [],
    });
    groups.get(key).issues.push(item);
  });
  return [...groups.values()].map((group) => {
    group.issues.sort((a, b) => (auditSeverityOrder[b.gravidade] || 0) - (auditSeverityOrder[a.gravidade] || 0) || new Date(b.created_at) - new Date(a.created_at));
    group.maxSeverity = group.issues[0]?.gravidade || 'BAIXA';
    group.criticalCount = group.issues.filter((item) => item.gravidade === 'CRITICA').length;
    group.highCount = group.issues.filter((item) => item.gravidade === 'ALTA').length;
    return group;
  }).sort((a, b) => (auditSeverityOrder[b.maxSeverity] || 0) - (auditSeverityOrder[a.maxSeverity] || 0) || b.issues.length - a.issues.length || a.candidato_nome.localeCompare(b.candidato_nome, 'pt-BR'));
}

function renderAuditCandidateGroup(group) {
  const countText = `${group.issues.length} alerta${group.issues.length === 1 ? '' : 's'}`;
  const riskParts = [];
  if (group.criticalCount) riskParts.push(`${group.criticalCount} crítico${group.criticalCount === 1 ? '' : 's'}`);
  if (group.highCount) riskParts.push(`${group.highCount} alto${group.highCount === 1 ? '' : 's'}`);
  return `
    <article class="audit-candidate-group">
      <header class="audit-candidate-group-head">
        <div class="audit-candidate-identity"><span class="audit-candidate-avatar">${escapeHtml(initials(group.candidato_nome))}</span><div><strong>${escapeHtml(group.candidato_nome)}</strong><span>${escapeHtml(group.vaga_nome)} · ${countText}${riskParts.length ? ` · ${riskParts.join(' · ')}` : ''}</span></div></div>
        <div class="audit-candidate-group-actions"><span class="audit-severity ${String(group.maxSeverity).toLowerCase()}">${escapeHtml(auditSeverityLabel(group.maxSeverity))}</span><button class="button button-ghost" data-audit-candidate-profile="${group.candidato_id}" type="button"><span>↗</span> Abrir perfil</button></div>
      </header>
      <div class="audit-candidate-issues">${group.issues.map((item) => auditIssueRow(item, true)).join('')}</div>
    </article>`;
}

async function loadAudit() {
  if (String(state.currentUser?.perfil || '').toUpperCase() !== 'ADMIN') return;
  el.auditLoading?.classList.remove('hidden');
  const params = new URLSearchParams({ status: el.auditStatusFilter?.value || 'NOVO', gravidade: el.auditSeverityFilter?.value || 'TODAS', busca: el.auditSearchInput?.value?.trim() || '' });
  const data = await api(`/api/admin/auditoria?${params}`);
  state.audit = data;
  renderAudit();
  el.auditLoading?.classList.add('hidden');
}

function renderAudit() {
  const data = state.audit || {};
  const run = data.ultima_auditoria || {};
  const summary = data.resumo || {};
  el.auditKpiConversations.textContent = Number(run.total_conversas || 0);
  el.auditKpiClean.textContent = Number(run.conversas_sem_alerta || 0);
  el.auditKpiCritical.textContent = Number(summary.criticos || run.quantidade_criticos || 0);
  el.auditKpiHigh.textContent = Number(summary.altos || run.quantidade_altos || 0);
  el.auditKpiScore.textContent = run.nota_qualidade === null || run.nota_qualidade === undefined ? '--' : Number(run.nota_qualidade).toFixed(0);
  el.auditLastSync.textContent = run.finished_at ? `Última sincronização: ${formatDate(run.finished_at)}` : 'Nenhuma sincronização concluída';
  const trends = data.tendencias || [];
  const max = Math.max(1, ...trends.map((item) => Number(item.total || 0)));
  el.auditTrendChart.innerHTML = trends.length ? trends.map((item) => `<div class="audit-trend-day"><div class="audit-trend-bars"><i class="critical" style="height:${Math.max(2, Number(item.criticos || 0) / max * 100)}%"></i><i class="high" style="height:${Math.max(2, Number(item.altos || 0) / max * 100)}%"></i><i style="height:${Math.max(3, Number(item.total || 0) / max * 100)}%"></i></div><span>${escapeHtml(new Date(`${item.dia}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}))}</span></div>`).join('') : emptyState('Sem histórico de alertas.');
  const categories = data.categorias || [];
  const maxCategory = Math.max(1, ...categories.map((item) => Number(item.quantidade || 0)));
  el.auditTopCategories.innerHTML = categories.length ? categories.map((item) => `<div><span><strong>${escapeHtml(auditCategoryLabel(item.categoria))}</strong><small>${item.quantidade} ocorrência(s)</small></span><i><b style="width:${Number(item.quantidade || 0) / maxCategory * 100}%"></b></i></div>`).join('') : emptyState('Nenhum problema acumulado.');
  const issues = data.problemas || [];
  const groups = groupAuditIssues(issues);
  const grouped = (el.auditGroupMode?.value || state.auditGroupMode) === 'CANDIDATO';
  state.auditGroupMode = grouped ? 'CANDIDATO' : 'ALERTA';
  el.auditResultCount.textContent = grouped
    ? `${issues.length} alerta${issues.length === 1 ? '' : 's'} em ${groups.length} candidato${groups.length === 1 ? '' : 's'}`
    : `${issues.length} alerta${issues.length === 1 ? '' : 's'}`;
  el.auditEmpty.classList.toggle('hidden', issues.length > 0);
  el.auditProblemsList.classList.toggle('is-grouped-view', grouped);
  el.auditProblemsList.innerHTML = grouped
    ? groups.map(renderAuditCandidateGroup).join('')
    : issues.map((item) => auditIssueRow(item, false)).join('');
}

async function syncAudit() {
  if (String(state.currentUser?.perfil || '').toUpperCase() !== 'ADMIN') return;
  el.auditSyncButton.disabled = true;
  el.auditSyncButton.innerHTML = '<span class="spin">↻</span> Analisando...';
  el.auditLoading.classList.remove('hidden');
  try {
    const payload = { periodo: el.auditSyncPeriod.value };
    if (payload.periodo === 'PERSONALIZADO') {
      if (!el.auditCustomStart.value || !el.auditCustomEnd.value) throw new Error('Informe o início e o fim do período personalizado.');
      payload.inicio = new Date(el.auditCustomStart.value).toISOString();
      payload.fim = new Date(el.auditCustomEnd.value).toISOString();
    }
    const result = await api('/api/admin/auditoria/sincronizar', { method: 'POST', body: JSON.stringify(payload) });
    showToast(result.mensagem || 'Auditoria concluída.');
    await loadAudit(true);
  } catch (error) { showToast(error.message, 'error'); }
  finally { el.auditSyncButton.disabled = false; el.auditSyncButton.innerHTML = '<span>↻</span> Sincronizar'; el.auditLoading.classList.add('hidden'); }
}


function auditLocalInputValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function openAuditExport() {
  if (String(state.currentUser?.perfil || '').toUpperCase() !== 'ADMIN') return;
  el.auditExportPeriod.value = 'ULTIMA';
  el.auditExportScope.value = 'TODOS';
  el.auditExportCustomRange.classList.add('hidden');
  const end = new Date();
  el.auditExportStart.value = auditLocalInputValue(new Date(end.getTime() - 7 * 86400000));
  el.auditExportEnd.value = auditLocalInputValue(end);
  el.auditExportDialog.showModal();
}

function toggleAuditExportRange() {
  el.auditExportCustomRange.classList.toggle('hidden', el.auditExportPeriod.value !== 'PERSONALIZADO');
}

function exportAudit() {
  const params = new URLSearchParams({ periodo: el.auditExportPeriod.value, escopo: el.auditExportScope.value });
  if (el.auditExportPeriod.value === 'PERSONALIZADO') {
    if (!el.auditExportStart.value || !el.auditExportEnd.value) return showToast('Informe o início e o fim da exportação.', 'error');
    params.set('inicio', new Date(el.auditExportStart.value).toISOString());
    params.set('fim', new Date(el.auditExportEnd.value).toISOString());
  }
  el.auditExportDialog.close();
  window.location.assign(`/api/admin/auditoria/exportar.zip?${params.toString()}`);
  showToast('A exportação anonimizada foi iniciada.');
}

function openAuditProblem(id) {
  const problem = (state.audit?.problemas || []).find((item) => Number(item.id) === Number(id));
  if (!problem) return;
  state.selectedAuditProblem = problem;
  el.auditProblemTitle.textContent = problem.titulo;
  el.auditProblemSubtitle.textContent = `${auditSeverityLabel(problem.gravidade)} · ${problem.candidato_nome || `Candidato #${problem.candidato_id}`}`;
  const evidence = problem.evidencia || {};
  el.auditProblemContent.innerHTML = `<div class="audit-detail-grid"><article><span>Categoria</span><strong>${escapeHtml(auditCategoryLabel(problem.categoria))}</strong></article><article><span>Origem</span><strong>${problem.origem_deteccao === 'IA' ? `IA auditora · ${Math.round(Number(problem.confianca || 0))}%` : 'Regra objetiva'}</strong></article></div><section><h3>Problema identificado</h3><p>${escapeHtml(problem.descricao)}</p></section>${problem.comportamento_esperado ? `<section class="expected-behavior"><h3>Comportamento esperado</h3><p>${escapeHtml(problem.comportamento_esperado)}</p></section>` : ''}${problem.sugestao_correcao ? `<section><h3>Possível correção</h3><p>${escapeHtml(problem.sugestao_correcao)}</p></section>` : ''}<section><h3>Evidência técnica</h3><pre>${escapeHtml(JSON.stringify(evidence, null, 2))}</pre></section>`;
  el.auditReviewObservation.value = problem.observacao_revisao || '';
  el.openAuditCandidateProfileButton.disabled = !Number(problem.candidato_id);
  el.auditProblemDialog.showModal();
}

async function openAuditCandidateProfile(candidateId = state.selectedAuditProblem?.candidato_id) {
  const id = Number(candidateId);
  if (!id) return showToast('Não foi possível identificar o candidato deste alerta.', 'error');
  if (el.auditProblemDialog?.open) el.auditProblemDialog.close();
  await openCandidate(id);
  setDrawerTab('timeline');
}

async function reviewAuditProblem(status) {
  const problem = state.selectedAuditProblem;
  if (!problem) return;
  const result = await api(`/api/admin/auditoria/problemas/${problem.id}`, { method: 'PATCH', body: JSON.stringify({ status, observacao: el.auditReviewObservation.value }) });
  el.auditProblemDialog.close();
  showToast(result.mensagem || 'Revisão registrada.');
  await loadAudit(true);
}

async function loadCandidateAudit(id) {
  const data = await api(`/api/admin/auditoria/candidatos/${id}`);
  const problems = data.problemas || [];
  el.candidateAuditSection.classList.remove('hidden');
  el.candidateAuditScore.textContent = `${Number(data.nota || 100)}/100`;
  el.candidateAuditSummary.textContent = problems.length ? `${problems.length} alerta(s) encontrado(s). Revise os apontamentos antes de concluir que houve um erro.` : 'Nenhum problema foi detectado nas auditorias realizadas.';
  el.candidateAuditProblems.innerHTML = problems.slice(0, 4).map((item) => `<button type="button" data-go-view="audit"><span class="audit-severity ${String(item.gravidade || '').toLowerCase()}">${escapeHtml(auditSeverityLabel(item.gravidade))}</span><b>${escapeHtml(item.titulo)}</b></button>`).join('');
  el.openCandidateAuditButton.onclick = () => { el.candidateDrawer.close(); setView('audit'); el.auditSearchInput.value = state.selectedCandidate?.nome || state.selectedCandidate?.telefone || ''; loadAudit(true); };
}

async function openVacancyDialog(vacancy = null, duplicate = false) {
  await Promise.all([loadCompanies(), loadVacancyTemplates()]);
  el.vacancyForm.reset();
  el.vacancyFormError.classList.add('hidden');
  el.vacancyId.value = duplicate ? '' : vacancy?.id || '';
  el.vacancyDialogTitle.textContent = duplicate ? `Duplicar ${vacancy?.codigo || 'vaga'}` : vacancy ? `Editar ${vacancy.codigo}` : 'Nova vaga';

  const defaults = {
    empresa_id: state.companies[0]?.id || '', status: 'RASCUNHO', estado: 'SP', modalidade: 'Presencial', sexo: 'UNISSEX',
    quantidade_vagas: 1, idade_minima: 25, idade_maxima: '', experiencia_minima_meses: 0, exigir_experiencia_compativel: true, publicar_portal: true, destaque_portal: false, canal_candidatura: 'WHATSAPP_GENESIS',
    entrevista_dias_semana: [1,2,3,4,5], entrevista_horarios: ['09:00','10:00','14:00','15:00'], entrevista_duracao_minutos: 30, entrevista_busca_dias: 7, entrevista_evitar_feriados: true,
  };
  const source = vacancy ? { ...vacancy } : defaults;
  if (duplicate) {
    source.status = 'RASCUNHO';
    source.data_inicio = null;
    source.data_encerramento = null;
    source.destaque_portal = false;
    source.portal_publicado_em = null;
  }

  Object.entries(source).forEach(([key, value]) => {
    const input = el.vacancyForm.elements[key];
    if (!input) return;
    if (typeof RadioNodeList !== 'undefined' && input instanceof RadioNodeList) return;
    if (input.type === 'checkbox') input.checked = value === true || value === 'true';
    else if (input.type === 'date' && value) input.value = String(value).slice(0, 10);
    else input.value = value ?? '';
  });
  setCheckboxGroup('entrevista_dias_semana', source.entrevista_dias_semana || [1,2,3,4,5]);
  setCheckboxGroup('entrevista_horarios', source.entrevista_horarios || ['09:00','10:00','14:00','15:00']);
  if (el.vacancyTemplateSelect) el.vacancyTemplateSelect.value = '';
  el.possui_insalubridade.checked = Boolean(source.possui_insalubridade);
  toggleInsalubrityFields();
  updateVacancyEarningsPreview();
  el.vacancyDialog.showModal();
}

function toggleInsalubrityFields() {
  el.insalubrityFields.classList.toggle('hidden', !el.possui_insalubridade.checked);
  if (!el.possui_insalubridade.checked) {
    el.vacancyForm.elements.percentual_insalubridade.value = '';
    el.vacancyForm.elements.observacao_insalubridade.value = '';
  }
  updateVacancyEarningsPreview();
}

function vacancyFormPayload() {
  const data = new FormData(el.vacancyForm);
  const titulo = data.get('titulo');
  const descricao = data.get('descricao');
  const profile = inferVacancyProfile(titulo, descricao);
  return {
    empresa_id: data.get('empresa_id'), titulo, cargo: profile.cargo || titulo, sexo: data.get('sexo') || 'UNISSEX',
    descricao, cidade: data.get('cidade'), estado: data.get('estado'),
    bairro: data.get('bairro'), endereco_referencia: data.get('endereco_referencia'),
    tipo_contrato: data.get('tipo_contrato'), modalidade: data.get('modalidade'), escala: data.get('escala'),
    horario: data.get('horario'), salario: data.get('salario'),
    vale_refeicao_valor: data.get('vale_refeicao_valor'), vale_alimentacao_valor: data.get('vale_alimentacao_valor'),
    premio_assiduidade_valor: data.get('premio_assiduidade_valor'), outros_beneficios_valor: data.get('outros_beneficios_valor'),
    vale_transporte_descricao: data.get('vale_transporte_descricao'), beneficios_observacao: data.get('beneficios_observacao'),
    beneficios: data.get('beneficios'),
    possui_insalubridade: el.possui_insalubridade.checked,
    percentual_insalubridade: data.get('percentual_insalubridade'),
    observacao_insalubridade: data.get('observacao_insalubridade'),
    escolaridade_minima: data.get('escolaridade_minima'), idade_minima: data.get('idade_minima') || 25, idade_maxima: data.get('idade_maxima') || null,
    entrevista_dias_semana: data.getAll('entrevista_dias_semana').map(Number),
    entrevista_horarios: data.getAll('entrevista_horarios').map(String),
    entrevista_duracao_minutos: data.get('entrevista_duracao_minutos') || 30, entrevista_busca_dias: data.get('entrevista_busca_dias') || 7,
    entrevista_evitar_feriados: data.get('entrevista_evitar_feriados') === 'on',
    experiencia_minima_meses: data.get('experiencia_minima_meses'),
    aceita_sem_experiencia: data.get('aceita_sem_experiencia') === 'on',
    exigir_experiencia_compativel: data.get('exigir_experiencia_compativel') === 'on',
    cargos_compativeis: data.get('cargos_compativeis') || profile.cargos || titulo, cbos_compativeis: profile.cbos || '',
    requisitos_obrigatorios: data.get('requisitos_obrigatorios'), requisitos_desejaveis: data.get('requisitos_desejaveis'),
    quantidade_vagas: data.get('quantidade_vagas'), formulario_url: '', status: data.get('status'),
    publicar_portal: data.get('publicar_portal') === 'on', destaque_portal: data.get('destaque_portal') === 'on',
    canal_candidatura: data.get('canal_candidatura') || 'WHATSAPP_GENESIS', whatsapp_candidatura: data.get('whatsapp_candidatura'),
    candidatura_url: data.get('candidatura_url'), candidatura_email: data.get('candidatura_email'), imagem_capa_url: data.get('imagem_capa_url'),
    seo_titulo: data.get('seo_titulo'), seo_descricao: data.get('seo_descricao'),
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
    const idadeMinima = Number(payload.idade_minima || 0);
    const idadeMaxima = payload.idade_maxima === null || payload.idade_maxima === '' ? null : Number(payload.idade_maxima);
    if (idadeMaxima !== null && idadeMaxima < idadeMinima) throw new Error('A idade máxima não pode ser menor que a idade mínima.');
    if (!payload.entrevista_dias_semana.length) throw new Error('Marque pelo menos um dia permitido para entrevistas.');
    if (!payload.entrevista_horarios.length) throw new Error('Marque pelo menos um horário permitido para entrevistas.');
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
  if (!safeText(payload.titulo, '')) {
    showToast('Informe o título da vaga antes de usar a IA.', 'error');
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
  populateCandidateFilters();
  renderCandidates();
}

function localDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function dateKeyOffset(days = 0) {
  const date = new Date(Date.now() + Number(days || 0) * 86400000);
  return localDateKey(date);
}

function candidatePeriodMatches(candidate) {
  if (state.candidatePeriod === 'TODOS') return true;
  const key = localDateKey(candidate.created_at || candidate.updated_at);
  if (!key) return false;
  if (state.candidatePeriod === 'HOJE') return key === dateKeyOffset(0);
  if (state.candidatePeriod === 'ONTEM') return key === dateKeyOffset(-1);
  const days = state.candidatePeriod === '7D' ? 7 : state.candidatePeriod === '30D' ? 30 : 0;
  if (!days) return true;
  const timestamp = new Date(candidate.created_at || candidate.updated_at).getTime();
  return Number.isFinite(timestamp) && timestamp >= Date.now() - days * 86400000;
}

function populateCandidateFilters() {
  if (!el.candidateVacancyFilter || !el.candidateStageFilter) return;
  const vacancyCurrent = state.candidateVacancy;
  const stageCurrent = state.candidateStage;
  const vacancies = [...new Map(state.candidates.filter((item) => item.vaga_id || item.vaga_nome || item.vaga_legacy).map((item) => [String(item.vaga_id || item.vaga_nome || item.vaga_legacy), { value: String(item.vaga_id || item.vaga_nome || item.vaga_legacy), label: item.vaga_nome || item.vaga_legacy || 'Vaga sem nome' }])).values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  const stages = [...new Set(state.candidates.map((item) => String(item.etapa || '')).filter(Boolean))].sort((a, b) => (stageLabels[a] || a).localeCompare(stageLabels[b] || b, 'pt-BR'));
  el.candidateVacancyFilter.innerHTML = '<option value="TODAS">Todas as vagas</option>' + vacancies.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('');
  el.candidateStageFilter.innerHTML = '<option value="TODAS">Todas as etapas</option>' + stages.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stageLabels[stage] || stage)}</option>`).join('');
  state.candidateVacancy = vacancies.some((item) => item.value === vacancyCurrent) ? vacancyCurrent : 'TODAS';
  state.candidateStage = stages.includes(stageCurrent) ? stageCurrent : 'TODAS';
  el.candidateVacancyFilter.value = state.candidateVacancy;
  el.candidateStageFilter.value = state.candidateStage;
}

function updateCandidateFilterToggle() {
  if (!el.candidateFilterToggleButton) return;
  const count = [
    state.candidateVacancy !== 'TODAS',
    state.candidateStage !== 'TODAS',
    state.candidateDocument !== 'TODOS',
    state.candidateInterview !== 'TODAS',
    state.candidateSex !== 'TODOS',
    state.candidateReallocation !== 'TODOS',
  ].filter(Boolean).length;
  el.candidateFilterToggleButton.textContent = count ? `Filtros (${count})` : 'Filtros';
  el.candidateFilterToggleButton.classList.toggle('has-active-filters', count > 0);
}

function candidateMatches(candidate) {
  const q = String(el.candidateSearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  const status = String(candidate.status || '').toUpperCase();
  const statusMatch = state.candidateStatus === 'TODOS'
    || (state.candidateStatus === 'EM_PROCESSO' && ['NOVO', 'EM_PROCESSO'].includes(status))
    || (state.candidateStatus === 'APROVADO' && status === 'APROVADO')
    || status === state.candidateStatus;
  const vacancyValue = String(candidate.vaga_id || candidate.vaga_nome || candidate.vaga_legacy || '');
  const vacancyMatch = state.candidateVacancy === 'TODAS' || vacancyValue === state.candidateVacancy;
  const stageMatch = state.candidateStage === 'TODAS' || String(candidate.etapa || '') === state.candidateStage;
  const hasDocs = Number(candidate.quantidade_documentos || 0) > 0;
  const documentMatch = state.candidateDocument === 'TODOS'
    || (state.candidateDocument === 'CTPS' && Boolean(candidate.tem_ctps))
    || (state.candidateDocument === 'CURRICULO' && Boolean(candidate.tem_curriculo))
    || (state.candidateDocument === 'PROCESSANDO' && Boolean(candidate.tem_documento_processando))
    || (state.candidateDocument === 'PENDENTE_REVISAO' && Boolean(candidate.tem_documento_pendente_revisao))
    || (state.candidateDocument === 'SEM_DOCUMENTOS' && !hasDocs);
  const interviewMatch = state.candidateInterview === 'TODAS'
    || (state.candidateInterview === 'AGENDADA' && Boolean(candidate.entrevista_inicio))
    || (state.candidateInterview === 'NAO_AGENDADA' && !candidate.entrevista_inicio);
  const normalizedSex = String(candidate.sexo || '').toUpperCase();
  const sexMatch = state.candidateSex === 'TODOS'
    || (state.candidateSex === 'MASCULINO' && normalizedSex === 'MASCULINO')
    || (state.candidateSex === 'FEMININO' && normalizedSex === 'FEMININO')
    || (state.candidateSex === 'NAO_INFORMADO' && !normalizedSex)
    || (state.candidateSex === 'REVISAO' && candidate.sexo_revisao_necessaria === true);
  const rejected = String(candidate.status || '').toUpperCase() === 'REPROVADO';
  const reallocationMatch = state.candidateReallocation === 'TODOS'
    || (state.candidateReallocation === 'REALOCAVEIS' && rejected && candidate.reprovacao_realocavel !== false)
    || (state.candidateReallocation === 'NAO_REALOCAVEIS' && rejected && candidate.reprovacao_realocavel === false);
  const haystack = [candidate.nome, candidate.telefone, candidate.vaga_nome, candidate.vaga_codigo, candidate.etapa].join(' ').toLocaleLowerCase('pt-BR');
  return statusMatch && vacancyMatch && stageMatch && documentMatch && interviewMatch && sexMatch && reallocationMatch && candidatePeriodMatches(candidate) && (!q || haystack.includes(q));
}

function renderCandidates() {
  const candidates = state.candidates.filter(candidateMatches);
  const count = (predicate) => candidates.filter(predicate).length;
  el.candidateKpiTotal.textContent = candidates.length;
  el.candidateKpiProcess.textContent = count((item) => ['NOVO', 'EM_PROCESSO'].includes(String(item.status || '').toUpperCase()));
  el.candidateKpiApproved.textContent = count((item) => String(item.status || '').toUpperCase() === 'APROVADO');
  el.candidateKpiAdmission.textContent = count((item) => String(item.status || '').toUpperCase() === 'EM_ADMISSAO');
  el.candidateKpiHired.textContent = count((item) => String(item.status || '').toUpperCase() === 'CONTRATADO');
  el.candidateKpiRejected.textContent = count((item) => String(item.status || '').toUpperCase() === 'REPROVADO');
  el.candidatesLoading.classList.add('hidden');

  updateCandidateFilterToggle();
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
      <td><span class="badge ${badgeClass(c.status)}">${escapeHtml(statusLabels[c.status] || c.status || 'Não informado')}</span>${c.ia_atendimento_ativo === false ? '<span class="badge badge-warning ai-paused-mini">IA pausada</span>' : ''}<div class="primary-cell"><span>${escapeHtml(stageLabels[c.etapa] || c.etapa || 'Etapa não informada')}</span></div></td>
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
    if (String(state.currentUser?.perfil || '').toUpperCase() === 'ADMIN') loadCandidateAudit(id).catch(() => {});
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
  el.candidateSex.textContent = candidateSexText(c.sexo);
  el.candidateSexSource.textContent = c.sexo_nao_informado ? 'Não informado após solicitação' : sexSourceText(c.sexo_origem);
  const vacancySex = String(c.vaga_sexo || 'UNISSEX').toUpperCase();
  if (vacancySex === 'UNISSEX') el.candidateSexCompatibility.textContent = 'Vaga unissex';
  else if (c.sexo_compativel_vaga === true) el.candidateSexCompatibility.textContent = 'Compatível';
  else if (c.sexo_compativel_vaga === false) el.candidateSexCompatibility.textContent = 'Revisão recomendada';
  else el.candidateSexCompatibility.textContent = 'Aguardando informação';
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
  const rejectionCode = String(c.motivo_reprovacao_codigo || '').toUpperCase();
  const reasonData = rejectionReasonLabels[rejectionCode] || [String(c.motivo_reprovacao_categoria || 'OUTRO').replaceAll('_', ' '), c.motivo_reprovacao_pos_entrevista || c.motivo_reprovacao_detalhe || c.motivo_reprovacao || 'A reprovação foi registrada sem motivo detalhado.'];
  el.candidateRejectionCategory.textContent = reasonData[0];
  el.candidateRejectionReason.textContent = reasonData[1];
  el.candidateRejectionObservation.textContent = c.motivo_reprovacao_detalhe || c.observacao_decisao_pos_entrevista || c.observacao_triagem || 'Sem observação complementar.';
  const realocavel = c.reprovacao_realocavel !== false;
  el.candidateReallocationStatus.className = `reallocation-status ${realocavel ? 'is-reallocatable' : 'is-not-reallocatable'}`;
  el.candidateReallocationStatus.innerHTML = realocavel
    ? '<strong>Perfil preservado para realocação</strong><span>O candidato pode ser considerado em outras vagas compatíveis.</span>'
    : '<strong>Realocação não recomendada neste registro</strong><span>Revise o histórico antes de uma nova candidatura.</span>';

  el.candidatePresentationSection.classList.toggle('hidden', !hasValue(c.apresentacao_profissional));
  el.candidatePresentation.textContent = c.apresentacao_profissional || '';
  const profileTags = Array.isArray(c.personalidade_tags) ? c.personalidade_tags.filter(Boolean) : [];
  const hasProfile = hasValue(c.personalidade_resumo) || profileTags.length;
  el.candidatePersonalitySection.classList.toggle('hidden', !hasProfile);
  el.candidatePersonality.textContent = c.personalidade_resumo || '';
  el.candidatePersonalityTags.innerHTML = profileTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

  el.candidateStatusSelect.value = c.status || 'NOVO';
  const protectedRejectionStages = new Set(['REPROVADO_PRE_TRIAGEM', 'REPROVADO_TRIAGEM', 'REPROVADO_POS_ENTREVISTA']);
  el.candidateStageSelect.innerHTML = Object.entries(stageLabels).map(([value, label]) => {
    const protectedStage = protectedRejectionStages.has(value);
    const suffix = value === 'REPROVADO_POS_ENTREVISTA' ? ' — use o bloco abaixo' : protectedStage ? ' — definido pela automação' : '';
    return `<option value="${value}" ${value === c.etapa ? 'selected' : ''} ${protectedStage ? 'disabled' : ''}>${escapeHtml(label + suffix)}</option>`;
  }).join('');
  const aiActive = c.ia_atendimento_ativo !== false;
  el.candidateAiStatusBadge.textContent = aiActive ? 'IA ativa' : 'IA pausada';
  el.candidateAiStatusBadge.className = `badge ${aiActive ? 'badge-approved' : 'badge-warning'}`;
  el.candidateAiStatusText.textContent = aiActive
    ? 'A Evelyn pode responder automaticamente às próximas mensagens deste candidato.'
    : `Atendimento humano ativo. A IA não responderá novas mensagens.${c.ia_pausa_motivo ? ` Motivo: ${c.ia_pausa_motivo}` : ''}`;
  el.toggleCandidateAiButton.textContent = aiActive ? 'Pausar IA' : 'Retomar IA';
  el.toggleCandidateAiButton.classList.toggle('button-danger', aiActive);
  el.toggleCandidateAiButton.classList.toggle('button-primary', !aiActive);
  el.manualContinueStatus.value = c.status || 'EM_PROCESSO';
  el.manualContinueStage.innerHTML = Object.entries(stageLabels).map(([value, label]) => `<option value="${value}" ${value === c.etapa ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  el.manualContinueMessage.value = '';
  el.manualContinueActivateAi.checked = true;
  el.manualContinueSendMessage.checked = true;

  el.postInterviewDecision.value = c.etapa === 'REPROVADO_POS_ENTREVISTA' ? 'REPROVADO_POS_ENTREVISTA' : ['EM_ADMISSAO', 'CONTRATADO'].includes(c.status) ? c.status : '';
  el.postInterviewReason.value = c.motivo_reprovacao_codigo || '';
  el.postInterviewReallocatable.checked = c.reprovacao_realocavel !== false;
  el.postInterviewObservation.value = c.observacao_decisao_pos_entrevista || '';
  el.postInterviewReasonField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA');
  el.postInterviewReallocatableField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA');

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

function focusPostInterviewDecision() {
  el.postInterviewDecision.value = 'REPROVADO_POS_ENTREVISTA';
  el.postInterviewReasonField.classList.remove('hidden');
  el.postInterviewDecisionSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => el.postInterviewReason.focus(), 250);
}

async function updateCandidate() {
  const status = el.candidateStatusSelect.value;
  const etapa = el.candidateStageSelect.value;

  if (status === 'REPROVADO' || etapa === 'REPROVADO_POS_ENTREVISTA') {
    focusPostInterviewDecision();
    showToast('Para reprovar após a entrevista, use “Resultado após entrevista”, informe o motivo e clique em “Registrar decisão”.', 'error');
    return;
  }

  el.updateCandidateButton.disabled = true;
  const originalText = el.updateCandidateButton.textContent;
  el.updateCandidateButton.textContent = 'Salvando...';
  try {
    await api(`/api/candidatos/${state.selectedCandidateId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, etapa }),
    });
    showToast('Candidato atualizado.');
    await loadCandidates(true);
    if (el.candidateDrawer.open) el.candidateDrawer.close();
    await openCandidate(state.selectedCandidateId);
  } catch (error) {
    showToast(error.message || 'Não foi possível atualizar o candidato.', 'error');
  } finally {
    el.updateCandidateButton.disabled = false;
    el.updateCandidateButton.textContent = originalText;
  }
}

async function savePostInterviewDecision() {
  const decisao = el.postInterviewDecision.value;
  const motivoCodigo = el.postInterviewReason.value;
  const observacao = el.postInterviewObservation.value.trim();
  const realocavel = el.postInterviewReallocatable.checked;

  if (!decisao) {
    el.postInterviewDecision.focus();
    return showToast('Selecione uma decisão.', 'error');
  }
  if (decisao === 'REPROVADO_POS_ENTREVISTA' && !motivoCodigo) {
    el.postInterviewReasonField.classList.remove('hidden');
    el.postInterviewReason.focus();
    return showToast('Selecione o motivo da reprovação antes de registrar.', 'error');
  }
  if (decisao === 'REPROVADO_POS_ENTREVISTA' && ['REQUISITO_NAO_CONFIRMADO_ENTREVISTA', 'OUTRO'].includes(motivoCodigo) && !observacao) {
    el.postInterviewObservation.focus();
    return showToast('Descreva o requisito ou contexto específico desta reprovação.', 'error');
  }

  el.savePostInterviewDecisionButton.disabled = true;
  const originalText = el.savePostInterviewDecisionButton.textContent;
  el.savePostInterviewDecisionButton.textContent = decisao === 'REPROVADO_POS_ENTREVISTA'
    ? 'Enviando reprovação...'
    : 'Registrando...';

  try {
    const result = await api(`/api/candidatos/${state.selectedCandidateId}/decisao-pos-entrevista`, {
      method: 'POST',
      body: JSON.stringify({ decisao, motivo_codigo: motivoCodigo, observacao, realocavel }),
    });

    if (result.aviso) showToast(result.aviso, 'error');
    else if (decisao === 'REPROVADO_POS_ENTREVISTA' && result.convite_grupo?.convite_incluido) showToast('Reprovação enviada com o link atual do grupo.');
    else if (decisao === 'REPROVADO_POS_ENTREVISTA' && result.convite_grupo?.ja_convidado) showToast('Reprovação enviada. O link não foi repetido porque já havia sido enviado.');
    else if (decisao === 'REPROVADO_POS_ENTREVISTA') showToast('Reprovação registrada e enviada ao candidato.');
    else showToast('Decisão após entrevista registrada.');

    await loadCandidates(true);
    if (el.candidateDrawer.open) el.candidateDrawer.close();
    await openCandidate(state.selectedCandidateId);
  } catch (error) {
    showToast(error.message || 'Não foi possível registrar a decisão.', 'error');
  } finally {
    el.savePostInterviewDecisionButton.disabled = false;
    el.savePostInterviewDecisionButton.textContent = originalText;
  }
}

async function toggleCandidateAi() {
  const candidate = state.selectedCandidate;
  if (!candidate) return;
  const activeNow = candidate.ia_atendimento_ativo !== false;
  let reason = '';
  if (activeNow) {
    reason = window.prompt('Motivo da pausa (opcional):', 'Atendimento assumido pelo recrutador') ?? '';
    if (!window.confirm('Pausar a IA para este candidato? As mensagens continuarão registradas, mas a Evelyn não responderá.')) return;
  } else if (!window.confirm('Retomar o atendimento automático da IA para este candidato?')) {
    return;
  }

  const button = el.toggleCandidateAiButton;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = activeNow ? 'Pausando...' : 'Retomando...';
  try {
    const result = await api(`/api/candidatos/${state.selectedCandidateId}/ia`, {
      method: 'POST',
      body: JSON.stringify({ ativo: !activeNow, motivo: reason }),
    });
    showToast(result.mensagem || 'Controle da IA atualizado.');
    await loadCandidates(true);
    if (el.candidateDrawer.open) el.candidateDrawer.close();
    await openCandidate(state.selectedCandidateId);
  } catch (error) {
    showToast(error.message || 'Não foi possível alterar o atendimento da IA.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function continueCandidateManually() {
  const status = el.manualContinueStatus.value;
  const etapa = el.manualContinueStage.value;
  const mensagem = el.manualContinueMessage.value.trim();
  const ativarIa = el.manualContinueActivateAi.checked;
  const enviarMensagem = el.manualContinueSendMessage.checked;

  const summary = [
    `Status: ${statusLabels[status] || status}`,
    `Etapa: ${stageLabels[etapa] || etapa}`,
    ativarIa ? 'A IA será retomada.' : 'A IA permanecerá pausada.',
    enviarMensagem ? 'Uma mensagem será enviada agora.' : 'Nenhuma mensagem será enviada agora.',
  ].join('\n');
  if (!window.confirm(`Confirmar continuação do atendimento?

${summary}`)) return;

  const button = el.continueCandidateManuallyButton;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Continuando...';
  try {
    const result = await api(`/api/candidatos/${state.selectedCandidateId}/continuar-atendimento`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        etapa,
        mensagem,
        ativar_ia: ativarIa,
        enviar_mensagem: enviarMensagem,
      }),
    });
    if (result.aviso) showToast(result.aviso, 'error');
    else showToast(result.mensagem || 'Atendimento continuado.');
    await loadCandidates(true);
    if (el.candidateDrawer.open) el.candidateDrawer.close();
    await openCandidate(state.selectedCandidateId);
  } catch (error) {
    showToast(error.message || 'Não foi possível continuar o atendimento.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function reprocessCandidateCtps() {
  if (!window.confirm('Reprocessar a última CTPS armazenada? A IA será retomada e o resultado será enviado automaticamente ao candidato.')) return;
  const button = el.reprocessCandidateCtpsButton;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando para análise...';
  try {
    const result = await api(`/api/candidatos/${state.selectedCandidateId}/reprocessar-ctps`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast(result.mensagem || 'CTPS enviada para reprocessamento.');
    await loadCandidates(true);
    if (el.candidateDrawer.open) el.candidateDrawer.close();
    await openCandidate(state.selectedCandidateId);
  } catch (error) {
    showToast(error.message || 'Não foi possível reprocessar a CTPS.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
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
  const target = event.target.closest('[data-action], [data-vacancy-action], [data-candidate-action], [data-task-action], [data-monitor-action], [data-go-view], [data-audit-open], [data-audit-candidate-profile], [data-template-apply], [data-template-edit], [data-template-duplicate], [data-template-delete]');
  if (!target) return;
  if (target.dataset.goView) return setView(target.dataset.goView);
  if (target.dataset.action === 'open-candidate' || target.dataset.candidateAction === 'open') return openCandidate(target.dataset.id);
  if (target.dataset.action === 'resolve-alert') return resolveAlert(target.dataset.key);
  if (target.dataset.vacancyAction === 'view') return openVacancyView(target.dataset.id);
  if (target.dataset.vacancyAction === 'candidates') { const vacancy = vacancyById(target.dataset.id) || state.selectedVacancy; return openVacancyCandidates(vacancy); }
  if (target.dataset.vacancyAction === 'interviews') { el.vacancyViewDialog?.close(); return setView('interviews'); }
  if (target.dataset.vacancyAction === 'publish') return openVacancyDialog(vacancyById(target.dataset.id));
  if (target.dataset.vacancyAction === 'edit') return openVacancyDialog(vacancyById(target.dataset.id));
  if (target.dataset.vacancyAction === 'duplicate') return duplicateVacancy(target.dataset.id);
  if (target.dataset.vacancyAction === 'delete') return deleteVacancy(target.dataset.id);
  if (target.dataset.vacancyAction === 'promote') return openPromotion(target.dataset.id);
  if (target.dataset.vacancyAction === 'status') return changeVacancyStatus(target.dataset.id, target.dataset.status);
  if (target.dataset.taskAction === 'complete') return completeTask(target.dataset.id);
  if (target.dataset.monitorAction === 'resolve-error') return resolveWorkflowError(target.dataset.id);
  if (target.dataset.auditCandidateProfile) return openAuditCandidateProfile(target.dataset.auditCandidateProfile);
  if (target.dataset.auditOpen) return openAuditProblem(target.dataset.auditOpen);
  if (target.dataset.templateApply) { applyTemplateById(target.dataset.templateApply); el.templateManagerDialog?.close(); return; }
  if (target.dataset.templateEdit) return editVacancyTemplate(target.dataset.templateEdit);
  if (target.dataset.templateDuplicate) return duplicateVacancyTemplate(target.dataset.templateDuplicate);
  if (target.dataset.templateDelete) return deleteVacancyTemplate(target.dataset.templateDelete);
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
  if (state.activeView === 'audit') return syncAudit();
  if (state.activeView === 'prospecting') return window.GenesisAdmin?.focusNewProspecting();
  if (state.activeView === 'users') return window.GenesisAdmin?.focusNewUser();
  return loadCurrentView(true);
}

async function loadCurrentUser() {
  const data = await api('/api/auth/me');
  state.currentUser = data.usuario || null;
  const name = data.usuario?.nome || data.usuario?.usuario || 'Recrutadora';
  const role = String(data.usuario?.perfil || 'RECRUTADOR').toUpperCase();
  el.currentUserName.textContent = name;
  el.currentUserAvatar.textContent = initials(name).slice(0, 1);
  if (el.currentUserRole) el.currentUserRole.textContent = role === 'ADMIN' ? 'Administrador' : 'Recrutador';
  document.querySelectorAll('.nav-item[data-admin-only]').forEach((item) => item.classList.toggle('hidden', role !== 'ADMIN'));
  document.querySelectorAll('[data-admin-only]').forEach((item) => { if (!item.classList.contains('nav-item')) item.classList.toggle('hidden', role !== 'ADMIN'); });
  if (role !== 'ADMIN' && ['audit', 'prospecting', 'users'].includes(state.activeView)) setView('dashboard');
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  window.location.replace('/login');
}

function syncThemeUi() {
  const dark = document.documentElement.dataset.theme === 'dark';
  state.theme = dark ? 'dark' : 'light';
  if (el.themeToggleButton) {
    el.themeToggleButton.querySelector('span').textContent = dark ? '☀' : '☾';
    el.themeToggleButton.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
    el.themeToggleButton.title = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
  }
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  localStorage.setItem('genesis_theme', next);
  syncThemeUi();
}
function closeMobileSidebar() { el.sidebar.classList.remove('open'); }

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.addEventListener('click', handleDelegatedAction);
  el.mobileMenuButton.addEventListener('click', () => el.sidebar.classList.toggle('open'));
  el.sidebarBackdrop?.addEventListener('click', closeMobileSidebar);
  el.mobileMoreButton?.addEventListener('click', () => el.sidebar.classList.add('open'));
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.mobileView)));
  el.themeToggleButton?.addEventListener('click', toggleTheme);
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

  el.dashboardPeriodSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dashboard-period]'); if (!button) return;
    state.dashboardPeriod = button.dataset.dashboardPeriod;
    el.dashboardPeriodSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadDashboard(true);
  });
  el.vacancyPeriodSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vacancy-period]'); if (!button) return;
    state.vacancyPeriod = button.dataset.vacancyPeriod;
    el.vacancyPeriodSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadVacancies(true);
  });

  el.vacancyStatusSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vacancy-status]'); if (!button) return;
    state.vacancyStatus = button.dataset.vacancyStatus;
    el.vacancyStatusSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderVacancies();
  });
  el.vacancySearchInput.addEventListener('input', renderVacancies);
  el.vacanciesTableBody.addEventListener('toggle', (event) => {
    const details = event.target.closest('.vacancy-more');
    if (!details?.open) return;
    el.vacanciesTableBody.querySelectorAll('.vacancy-more[open]').forEach((item) => { if (item !== details) item.removeAttribute('open'); });
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.vacancy-more')) return;
    document.querySelectorAll('.vacancy-more[open]').forEach((item) => item.removeAttribute('open'));
  });
  el.vacanciesTableBody.addEventListener('click', (event) => { if (event.target.closest('[data-vacancy-action], .vacancy-menu-link')) event.target.closest('.vacancy-more')?.removeAttribute('open'); });
  el.vacancyForm.addEventListener('submit', saveVacancy);
  el.applyVacancyTemplateButton?.addEventListener('click', () => applyTemplateById(el.vacancyTemplateSelect.value));
  el.saveVacancyTemplateButton?.addEventListener('click', saveCurrentVacancyAsTemplate);
  el.manageVacancyTemplatesButton?.addEventListener('click', async () => { await Promise.all([loadCompanies(), loadVacancyTemplates(true)]); el.templateManagerDialog.showModal(); });
  el.createEmptyTemplateButton?.addEventListener('click', createEmptyVacancyTemplate);
  el.closeTemplateManagerButton?.addEventListener('click', () => el.templateManagerDialog.close());
  el.auditSyncButton?.addEventListener('click', syncAudit);
  el.auditExportButton?.addEventListener('click', openAuditExport);
  el.auditExportPeriod?.addEventListener('change', toggleAuditExportRange);
  el.closeAuditExportButton?.addEventListener('click', () => el.auditExportDialog.close());
  el.cancelAuditExportButton?.addEventListener('click', () => el.auditExportDialog.close());
  el.confirmAuditExportButton?.addEventListener('click', exportAudit);
  el.auditSyncPeriod?.addEventListener('change', () => {
    const custom = el.auditSyncPeriod.value === 'PERSONALIZADO';
    el.auditCustomRange?.classList.toggle('hidden', !custom);
    if (custom && (!el.auditCustomStart.value || !el.auditCustomEnd.value)) {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const localValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      el.auditCustomStart.value = localValue(start);
      el.auditCustomEnd.value = localValue(end);
    }
  });
  el.auditSeverityFilter?.addEventListener('change', () => loadAudit(true));
  el.auditStatusFilter?.addEventListener('change', () => loadAudit(true));
  el.auditGroupMode?.addEventListener('change', () => { state.auditGroupMode = el.auditGroupMode.value; renderAudit(); });
  el.auditSearchInput?.addEventListener('input', () => { clearTimeout(state.auditSearchTimer); state.auditSearchTimer = setTimeout(() => loadAudit(true), 300); });
  el.closeAuditProblemButton?.addEventListener('click', () => el.auditProblemDialog.close());
  el.openAuditCandidateProfileButton?.addEventListener('click', () => openAuditCandidateProfile());
  document.querySelectorAll('[data-audit-review]').forEach((button) => button.addEventListener('click', () => reviewAuditProblem(button.dataset.auditReview)));
  el.closeVacancyDialogButton.addEventListener('click', () => el.vacancyDialog.close());
  el.cancelVacancyButton.addEventListener('click', () => el.vacancyDialog.close());
  el.possui_insalubridade.addEventListener('change', toggleInsalubrityFields);
  ['salario','vale_refeicao_valor','vale_alimentacao_valor','premio_assiduidade_valor','outros_beneficios_valor','percentual_insalubridade'].forEach((name) => el.vacancyForm.elements[name]?.addEventListener('input', updateVacancyEarningsPreview));
  el.generateVacancyAiButton.addEventListener('click', generateVacancyWithAi);
  el.closeAiVacancyButton.addEventListener('click', () => el.aiVacancyDialog.close());
  el.cancelAiVacancyButton.addEventListener('click', () => el.aiVacancyDialog.close());
  el.applyAiVacancyButton.addEventListener('click', applyAiSuggestions);
  el.closePromotionButton.addEventListener('click', () => el.promotionDialog.close());
  el.closeVacancyViewButton?.addEventListener('click', () => el.vacancyViewDialog.close());
  el.copyWhatsappPromotionButton.addEventListener('click', () => copyText(el.promotionWhatsappText.value));
  el.copyFacebookPromotionButton.addEventListener('click', () => copyText(el.promotionFacebookText.value));
  el.downloadPrimaryPromotionButton.addEventListener('click', () => { if (state.promotion?.imagem_png_url) window.location.assign(state.promotion.imagem_png_url); else downloadSvgAsPng(state.promotion?.imagem_data_url, String(state.promotion?.nome_arquivo || 'vaga').replace(/\.svg$/i, '.png')); });

  el.candidateStatusSegments.addEventListener('click', (event) => {
    const button = event.target.closest('[data-candidate-status]'); if (!button) return;
    state.candidateStatus = button.dataset.candidateStatus;
    el.candidateStatusSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderCandidates();
  });
  el.candidatePeriodSegments?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-candidate-period]'); if (!button) return;
    state.candidatePeriod = button.dataset.candidatePeriod;
    el.candidatePeriodSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderCandidates();
  });
  el.candidateSearchInput.addEventListener('input', renderCandidates);
  el.candidateFilterToggleButton?.addEventListener('click', () => {
    const opening = el.candidateFilterPanel.classList.contains('hidden');
    el.candidateFilterPanel.classList.toggle('hidden', !opening);
    el.candidateFilterToggleButton.setAttribute('aria-expanded', String(opening));
  });
  el.candidateVacancyFilter?.addEventListener('change', () => { state.candidateVacancy = el.candidateVacancyFilter.value; renderCandidates(); });
  el.candidateStageFilter?.addEventListener('change', () => { state.candidateStage = el.candidateStageFilter.value; renderCandidates(); });
  el.candidateDocumentFilter?.addEventListener('change', () => { state.candidateDocument = el.candidateDocumentFilter.value; renderCandidates(); });
  el.candidateInterviewFilter?.addEventListener('change', () => { state.candidateInterview = el.candidateInterviewFilter.value; renderCandidates(); });
  el.candidateSexFilter?.addEventListener('change', () => { state.candidateSex = el.candidateSexFilter.value; renderCandidates(); });
  el.candidateReallocationFilter?.addEventListener('change', () => { state.candidateReallocation = el.candidateReallocationFilter.value; renderCandidates(); });
  el.clearCandidateFiltersButton?.addEventListener('click', () => {
    state.candidateVacancy = 'TODAS'; state.candidateStage = 'TODAS'; state.candidateDocument = 'TODOS'; state.candidateInterview = 'TODAS'; state.candidateSex = 'TODOS'; state.candidateReallocation = 'TODOS';
    el.candidateVacancyFilter.value = 'TODAS'; el.candidateStageFilter.value = 'TODAS'; el.candidateDocumentFilter.value = 'TODOS'; el.candidateInterviewFilter.value = 'TODAS'; el.candidateSexFilter.value = 'TODOS'; el.candidateReallocationFilter.value = 'TODOS';
    el.candidateSearchInput.value = ''; updateCandidateFilterToggle(); renderCandidates();
  });
  el.candidateTableMode.addEventListener('click', () => setCandidateMode('table'));
  el.candidateKanbanMode.addEventListener('click', () => setCandidateMode('kanban'));
  el.closeCandidateDrawerButton.addEventListener('click', () => el.candidateDrawer.close());
  document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.addEventListener('click', () => setDrawerTab(button.dataset.drawerTab)));
  el.updateCandidateButton.addEventListener('click', updateCandidate);
  el.toggleCandidateAiButton.addEventListener('click', toggleCandidateAi);
  el.continueCandidateManuallyButton.addEventListener('click', continueCandidateManually);
  el.reprocessCandidateCtpsButton.addEventListener('click', reprocessCandidateCtps);
  el.postInterviewDecision.addEventListener('change', () => {
    const rejected = el.postInterviewDecision.value === 'REPROVADO_POS_ENTREVISTA';
    el.postInterviewReasonField.classList.toggle('hidden', !rejected);
    el.postInterviewReallocatableField.classList.toggle('hidden', !rejected);
  });
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

window.GenesisApp = { api, showToast, escapeHtml, formatMoney, formatDate, formatPhone, badgeClass, emptyState, state, setView, loadCurrentView };

async function init() {
  bindEvents();
  syncThemeUi();
  await loadCurrentUser();
  await Promise.allSettled([loadCompanies(), loadCandidates()]);
  await loadDashboard();
  setCandidateMode('table');
}

init().catch((error) => showToast(error.message, 'error'));
