'use strict';

const state = {
  activeView: 'dashboard',
  dashboard: null,
  dashboardPeriod: '1D',
  dashboardInterviews: [],
  dashboardCalendarCursor: new Date(),
  dashboardCalendarSelectedDate: null,
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
  vacancyCompany: 'TODAS',
  vacancyLocation: 'TODOS',
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
  selectedCandidateExtras: { selectedTags: [] },
  interviews: [],
  interviewPeriod: 'TODAS',
  calendarCursor: new Date(),
  calendarSelectedDate: null,
  reviews: [],
  reviewType: 'TODAS',
  documents: [],
  documentType: 'TODOS',
  expandedDocumentCandidates: new Set(),
  documentExpansionInitialized: false,
  monitoring: null,
  promotion: null,
  searchTimer: null,
  currentUser: null,
  portalBaseUrl: '',
  theme: document.documentElement.dataset.theme || 'light',
};

const stageLabels = {
  PRIMEIRO_CONTATO: 'Primeiro contato',
  AGUARDANDO_INTENCAO: 'Aguardando intenção',
  AGUARDANDO_ACAO_VAGA: 'Confirmando candidatura',
  DUVIDAS_GERAIS: 'Menu de dúvidas',
  DUVIDAS_VAGA: 'Dúvidas sobre a vaga',
  RECRUTADOR_MENU: 'Menu para recrutador',
  AGUARDANDO_NOME: 'Aguardando nome',
  PERGUNTAS_VAGA: 'Perguntas da vaga',
  AGUARDANDO_EXPERIENCIA: 'Aguardando experiência declarada',
  AGUARDANDO_TEMPO_DESLOCAMENTO: 'Aguardando tempo de deslocamento',
  AGUARDANDO_CONFIRMACAO_CHEGADA: 'Confirmando chegada ao posto',
  PROCESSANDO_CTPS: 'Processando CTPS',
  REVISAO_DOCUMENTAL: 'Revisão documental',
  PENDENTE_APROVACAO_RECRUTADOR: 'Decisão do recrutador',
  AGUARDANDO_ESCOLHA_HORARIO: 'Escolhendo horário no Google Calendar',
  NAO_APTO_NESTA_VAGA: 'Não apto nesta vaga',
  PAUSADO_ATENDIMENTO_HUMANO: 'Atendimento humano',

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

const adminStageValues = [
  'AGUARDANDO_INTENCAO',
  'ESCOLHENDO_VAGA',
  'AGUARDANDO_ACAO_VAGA',
  'AGUARDANDO_NOME',
  'PERGUNTAS_VAGA',
  'AGUARDANDO_EXPERIENCIA',
  'AGUARDANDO_TEMPO_DESLOCAMENTO',
  'AGUARDANDO_CONFIRMACAO_CHEGADA',
  'AGUARDANDO_CEP',
  'AGUARDANDO_CTPS',
  'PROCESSANDO_CTPS',
  'REVISAO_DOCUMENTAL',
  'PENDENTE_APROVACAO_RECRUTADOR',
  'AGUARDANDO_ESCOLHA_HORARIO',
  'ENTREVISTA_AGENDADA',
  'PAUSADO_ATENDIMENTO_HUMANO',
  'NAO_APTO_NESTA_VAGA',
  'EM_ADMISSAO',
  'CONTRATADO',
  'ENCERRADO',
];

function currentUserIsAdmin() {
  return String(state.currentUser?.perfil || '').toUpperCase() === 'ADMIN';
}

window.GenesisPanel = Object.assign(window.GenesisPanel || {}, {
  api: (...args) => api(...args),
  toast: (...args) => showToast(...args),
  openCandidate: (...args) => openCandidate(...args),
  reloadCandidates: (...args) => loadCandidates(...args),
  getCurrentUser: () => state.currentUser,
  getSelectedCandidateId: () => state.selectedCandidateId,
});

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
  INCOMPATIBILIDADE_OPERACIONAL_VAGA: ['REQUISITO', 'Incompatibilidade operacional desta oportunidade'],
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
  dashboard: ['OPERAÇÃO', 'Visão geral', 'O que exige ação agora, sem excesso de informação.', ''],
  vacancies: ['OPORTUNIDADES', 'Vagas', 'Crie, duplique, divulgue e acompanhe o desempenho das vagas.', '+ Nova vaga'],
  candidates: ['PESSOAS', 'Candidatos', 'Acompanhe cada candidato em tabela ou pipeline.', '+ Novo candidato'],
  interviews: ['AGENDA', 'Entrevistas', 'Compromissos do processo seletivo sincronizados com o Google Calendar.', 'Atualizar agenda'],
  reviews: ['DECISÃO HUMANA', 'Revisões', 'Exceções de experiência e documentos que precisam do recrutador.', 'Atualizar revisões'],
  documents: ['ARQUIVOS', 'Documentos', 'CTPS, currículos e PDFs que precisam de revisão.', 'Atualizar arquivos'],
  divulgacao: ['AQUISIÇÃO', 'Central de Divulgação', 'Facebook assistido e WhatsApp controlado, vinculados às vagas oficiais.', '+ Nova campanha'],
  monitoring: ['ADMINISTRAÇÃO', 'Monitoramento', 'Saúde das integrações, falhas técnicas e recuperação da operação.', 'Atualizar monitoramento'],
  audit: ['ADMINISTRAÇÃO', 'Auditoria da IA', 'Valide estados, documentos, resgates e agendamentos do fluxo determinístico.', 'Sincronizar'],
  prospecting: ['ADMINISTRAÇÃO', 'Prospecção', 'Busque empresas na Apify com limites rígidos de quantidade e orçamento.', 'Nova busca'],
  brands: ['WHITE-LABEL', 'Empresas e marcas', 'Configure a identidade que será aplicada às artes e canais de cada cliente.', ''],
  publications: ['CONTEÚDO', 'Portal e comunidades', 'Modere grupos e vagas recebidas e acompanhe as contas públicas.', ''],
  demos: ['COMERCIAL', 'Demonstrações', 'Crie testes isolados de 7 dias e acompanhe a ativação pelo WhatsApp.', '+ Nova demonstração'],
  users: ['ADMINISTRAÇÃO', 'Equipe e acessos', 'Gerencie logins e permissões do time interno.', '+ Criar login'],
};

const el = Object.fromEntries([
  'sidebar', 'sidebarBackdrop', 'mobileMenuButton', 'themeToggleButton', 'mobileMoreButton', 'pageEyebrow', 'pageTitle', 'pageSubtitle',
  'globalSearchButton', 'refreshCurrentViewButton', 'primaryActionButton',
  'dashboardReviews', 'reviewPendingCount', 'reviewTypeSegments', 'reviewSearchInput', 'reviewsList',
  'calendarPrevButton', 'calendarTodayButton', 'calendarNextButton', 'calendarMonthLabel', 'calendarSelectedDayLabel', 'interviewCalendar',
  'dashboardUpdatedAt', 'kpiActiveVacancies', 'kpiInterviewsToday', 'kpiHumanPending', 'kpiCritical', 'kpiDocumentFailures', 'kpiStaleCandidates',
  'dashboardAttention', 'dashboardFunnel', 'dashboardJourneyStarted', 'dashboardJourneyCtps', 'dashboardJourneyApproved', 'dashboardJourneyScheduled',
  'dashboardCalendarPrevButton', 'dashboardCalendarTodayButton', 'dashboardCalendarNextButton', 'dashboardCalendarMonthLabel', 'dashboardInterviewCalendar', 'dashboardCalendarDaySummary',
  'vacancyStatusSegments', 'vacancyPeriodSegments', 'vacancySearchInput', 'vacancyCompanyFilter', 'vacancyLocationFilter', 'vacancyKpiActive', 'vacancyKpiInterested',
  'vacancyKpiInProcess', 'vacancyKpiApproved', 'vacancyKpiTop', 'vacancyKpiTopCount', 'vacanciesLoading', 'vacanciesEmpty',
  'vacanciesTableWrapper', 'vacanciesTableBody', 'candidateStatusSegments', 'candidatePeriodSegments', 'candidateSearchInput',
  'candidateFilterToggleButton', 'candidateFilterPanel', 'candidateVacancyFilter', 'candidateStageFilter', 'candidateDocumentFilter', 'candidateInterviewFilter', 'candidateSexFilter', 'candidateReallocationFilter', 'clearCandidateFiltersButton',
  'candidateTableMode', 'candidateKanbanMode', 'candidateKpiTotal', 'candidateKpiProcess',
  'candidateKpiApproved', 'candidateKpiAdmission', 'candidateKpiHired', 'candidateKpiRejected', 'candidateTableContainer', 'candidateKanbanContainer',
  'candidatesLoading', 'candidatesEmpty', 'candidatesTableWrapper', 'candidatesTableBody',
  'interviewPeriodSegments', 'interviewsList', 'documentTypeSegments', 'documentSearchInput',
  'documentsList', 'documentsKpiCandidates', 'documentsKpiReview', 'documentsKpiFailures', 'documentsKpiToday', 'monitorKpiEntries', 'monitorKpiErrors', 'monitorKpiDocs',
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
  'candidatePhone', 'candidateLabels', 'editCandidateDataButton', 'deleteCandidateButton',
  'candidateVacancy', 'candidateStage', 'candidateCep', 'candidateSex', 'candidateSexSource', 'candidateSexCompatibility', 'candidateInterview', 'candidateMeetLink',
  'candidateTriageSection', 'candidateTriage', 'candidateExperiences', 'candidateRejectionSection',
  'candidateRejectionReason', 'candidateRejectionObservation', 'candidateRejectionCategory', 'candidateReallocationStatus', 'candidatePresentationSection',
  'candidatePresentation', 'candidatePersonalitySection', 'candidatePersonality',
  'candidatePersonalityTags', 'candidateCtpsMetrics', 'candidateCtpsDocumentActions',
  'candidateStatusSelect', 'candidateStageSelect', 'updateCandidateButton', 'continueCandidateButton', 'candidateCorrectionReason', 'candidateCorrectionPreview',
  'candidateAiStatusBadge', 'candidateAiStatusText', 'toggleCandidateAiButton', 'reprocessCandidateCtpsButton',
  'adminRejectCandidateButton', 'adminCloseCandidateButton', 'adminReopenCandidateButton',
  'adminRejectCandidateForm', 'adminRejectReason', 'adminRejectObservation', 'adminRejectReallocatable', 'adminRejectSendMessage',
  'cancelAdminRejectButton', 'confirmAdminRejectButton',
  'postInterviewDecisionSection', 'postInterviewDecision', 'postInterviewReasonField', 'postInterviewReason', 'postInterviewReallocatableField', 'postInterviewReallocatable',
  'postInterviewObservation', 'savePostInterviewDecisionButton',
  'candidateConversation', 'candidateDocuments', 'candidateTimeline',
  'newCandidateDialog', 'newCandidateForm', 'closeNewCandidateButton', 'cancelNewCandidateButton',
  'saveNewCandidateButton', 'newCandidateVacancy', 'newCandidateError',
  'vacancyTemplateSelect', 'applyVacancyTemplateButton', 'saveVacancyTemplateButton', 'manageVacancyTemplatesButton',
  'templateManagerDialog', 'closeTemplateManagerButton', 'createEmptyTemplateButton', 'templateManagerList',
  'auditSyncPeriod', 'auditCustomRange', 'auditCustomStart', 'auditCustomEnd', 'auditSyncButton', 'auditExportButton', 'auditExportDialog', 'auditExportPeriod', 'auditExportScope', 'auditExportCustomRange', 'auditExportStart', 'auditExportEnd', 'closeAuditExportButton', 'cancelAuditExportButton', 'confirmAuditExportButton', 'auditKpiConversations', 'auditKpiClean', 'auditKpiCritical', 'auditKpiHigh', 'auditKpiScore', 'auditLastSync',
  'auditTrendChart', 'auditTopCategories', 'auditResultCount', 'auditSeverityFilter', 'auditCategoryFilter', 'auditStatusFilter', 'auditGroupMode', 'auditSearchInput', 'auditLoading', 'auditEmpty', 'auditProblemsList',
  'auditProblemDialog', 'auditProblemTitle', 'auditProblemSubtitle', 'closeAuditProblemButton', 'openAuditCandidateProfileButton', 'sendAuditCandidateToRescueButton', 'auditProblemContent', 'auditReviewObservation',
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

function formatRelativeTime(value) {
  if (!value) return 'agora';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'agora';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days === 1 ? '' : 's'}`;
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
  if (!currentUserIsAdmin() && ['audit', 'prospecting', 'publications', 'monitoring', 'demos', 'brands', 'users'].includes(name)) name = 'dashboard';
  state.activeView = name;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === name));
  const meta = viewMeta[name] || viewMeta.dashboard;
  el.pageEyebrow.textContent = meta[0];
  el.pageTitle.textContent = meta[1];
  el.pageSubtitle.textContent = meta[2];
  el.primaryActionButton.textContent = meta[3] || '';
  el.primaryActionButton.classList.toggle('hidden', !meta[3]);
  el.dashboardUpdatedAt?.classList.toggle('hidden', name !== 'dashboard');
  el.sidebar.classList.remove('open');
  loadCurrentView();
}

async function loadCurrentView(force = false) {
  try {
    if (state.activeView === 'dashboard') await loadDashboard(force);
    if (state.activeView === 'vacancies') await loadVacancies(force);
    if (state.activeView === 'candidates') await loadCandidates(force);
    if (state.activeView === 'interviews') await loadInterviews(force);
    if (state.activeView === 'reviews') await loadReviews(force);
    if (state.activeView === 'documents') await loadDocuments(force);
    if (state.activeView === 'divulgacao') await window.GenesisDivulgacaoV1?.load(force);
    if (state.activeView === 'monitoring') await loadMonitoring(force);
    if (state.activeView === 'audit') await loadAudit(force);
    if (state.activeView === 'prospecting') await Promise.all([window.GenesisAdmin?.loadProspecting(force), window.GenesisOperationsV14?.loadProspectingSafety(force)]);
    if (state.activeView === 'brands') await window.GenesisOperationsV14?.loadBrands(force);
    if (state.activeView === 'publications') await window.GenesisPortalPublicacoes?.load(force);
    if (state.activeView === 'demos') await window.GenesisDemos?.load(force);
    if (state.activeView === 'users') await window.GenesisAdmin?.loadUsers(force);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadDashboard() {
  const [data, agenda] = await Promise.all([
    api('/api/dashboard?periodo=1D'),
    api('/api/entrevistas?periodo=TODAS&status=TODAS'),
  ]);
  state.dashboard = data;
  state.dashboardInterviews = agenda.entrevistas || [];
  if (!state.dashboardCalendarSelectedDate) state.dashboardCalendarSelectedDate = localDateKey(new Date());
  renderDashboard();
}

function dashboardAttentionMeta(item) {
  const type = String(item.tipo || '').toUpperCase();
  if (type === 'DOCUMENTOS_FALHA') return { icon: '!', tone: 'critical', title: `${Number(item.quantidade || 0)} documento(s) com falha`, description: 'Ação: abra Documentos, confira o arquivo e escolha revisar ou reprocessar.', action: 'Abrir documentos', view: 'documents' };
  if (type === 'REVISOES_PENDENTES') return { icon: '◇', tone: 'warning', title: `${Number(item.quantidade || 0)} decisão(ões) aguardando recrutador`, description: 'Ação: confirme se o candidato continua ou não nesta vaga.', action: 'Tomar decisão', view: 'reviews' };
  if (type === 'APROVADOS_SEM_HORARIO') return { icon: '◷', tone: '', title: `${Number(item.quantidade || 0)} aprovado(s) ainda sem entrevista`, description: 'Ação: abra o candidato e ajude na escolha de um horário de entrevista.', action: 'Agendar', candidateId: item.candidato_id };
  if (type === 'SEM_RESPOSTA') return { icon: '↻', tone: '', title: `${Number(item.quantidade || 0)} conversa(s) sem resposta há mais de 2 horas`, description: 'Ação: abra a conversa e verifique por que o atendimento não avançou.', action: 'Ver conversa', candidateId: item.candidato_id };
  return { icon: '✓', tone: 'success', title: 'Operação estável', description: 'Nenhuma ação do recrutador foi identificada neste momento.', action: 'Ver operação', view: 'monitoring' };
}

function renderDashboard() {
  const data = state.dashboard || {};
  const metrics = data.metricas || {};
  const movement = data.movimento_dia || {};

  if (el.dashboardUpdatedAt) el.dashboardUpdatedAt.textContent = `Atualizado ${formatRelativeTime(data.atualizado_em)}`;
  el.kpiActiveVacancies.textContent = Number(metrics.vagas_ativas || 0);
  el.kpiInterviewsToday.textContent = Number(metrics.entrevistas_hoje || 0);
  el.kpiHumanPending.textContent = Number(metrics.pendencias_humanas || 0);
  if (el.kpiDocumentFailures) el.kpiDocumentFailures.textContent = Number(metrics.documentos_falha || 0);
  if (el.kpiStaleCandidates) el.kpiStaleCandidates.textContent = Number(metrics.sem_resposta_2h || 0);
  if (el.kpiCritical) el.kpiCritical.textContent = Number(metrics.documentos_falha || 0) + Number(metrics.sem_resposta_2h || 0);

  const attention = data.atencao || [];
  const rows = attention.length ? attention : [{ tipo: 'OPERACAO_ESTAVEL', quantidade: 0 }];
  el.dashboardAttention.innerHTML = rows.slice(0, 5).map((item) => {
    const meta = dashboardAttentionMeta(item);
    const actionAttrs = meta.candidateId
      ? `data-action="open-candidate" data-id="${meta.candidateId}"`
      : `data-go-view="${meta.view || 'monitoring'}"`;
    const subject = [item.candidato_nome, item.vaga_nome].filter(Boolean).join(' · ');
    const time = item.referencia ? formatRelativeTime(item.referencia) : '';
    return `<article class="dashboard-attention-row ${meta.tone}">
      <span class="dashboard-attention-icon">${escapeHtml(meta.icon)}</span>
      <div><strong>${escapeHtml(meta.title)}</strong><span>${escapeHtml(meta.description)}</span>${subject || time ? `<small>${escapeHtml([subject, time].filter(Boolean).join(' · '))}</small>` : ''}</div>
      <button class="dashboard-attention-action" ${actionAttrs} type="button">${escapeHtml(meta.action)}</button>
    </article>`;
  }).join('');


  const funnel = (data.funil || []).filter((item) => Number(item.quantidade || 0) > 0).slice(0, 6);
  const funnelMax = Math.max(1, ...funnel.map((item) => Number(item.quantidade || 0)));
  el.dashboardFunnel.innerHTML = funnel.length ? funnel.map((item) => {
    const quantity = Number(item.quantidade || 0);
    const width = Math.max(8, Math.round((quantity / funnelMax) * 100));
    return `<div class="dashboard-funnel-row"><span>${escapeHtml(stageLabels[item.etapa] || String(item.etapa || '').replaceAll('_', ' '))}</span><div><i style="width:${width}%"></i></div><strong>${quantity}</strong></div>`;
  }).join('') : emptyState('Funil sem movimentação', 'Os candidatos ativos aparecerão aqui.');

  el.dashboardJourneyStarted.textContent = Number(movement.iniciaram || 0);
  el.dashboardJourneyCtps.textContent = Number(movement.ctps_recebidas || 0);
  el.dashboardJourneyApproved.textContent = Number(movement.aprovados || 0);
  el.dashboardJourneyScheduled.textContent = Number(movement.agendados || 0);
  renderDashboardMiniCalendar();
}

function dashboardInterviewItemsForDate(dateKey) {
  return state.dashboardInterviews
    .filter((item) => localDateKey(item.inicio) === dateKey)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

function renderDashboardCalendarDay(dateKey) {
  if (!el.dashboardCalendarDaySummary) return;
  const items = dashboardInterviewItemsForDate(dateKey);
  const date = new Date(`${dateKey}T12:00:00`);
  const label = Number.isNaN(date.getTime()) ? 'Dia selecionado' : new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date);
  el.dashboardCalendarDaySummary.innerHTML = `<div class="dashboard-calendar-day-title"><strong>${escapeHtml(label)}</strong><span>${items.length} entrevista${items.length === 1 ? '' : 's'}</span></div>` + (items.length ? items.slice(0, 2).map((item) => `
    <button class="dashboard-calendar-interview" data-action="open-candidate" data-id="${item.candidato_id}" type="button"><time>${escapeHtml(formatTime(item.inicio))}</time><span><strong>${escapeHtml(item.candidato_nome || 'Candidato')}</strong><small>${escapeHtml(item.vaga_nome || 'Vaga não informada')}</small></span></button>`).join('') : '<span class="dashboard-calendar-empty">Nenhuma entrevista neste dia.</span>');
}

function renderDashboardMiniCalendar() {
  if (!el.dashboardInterviewCalendar || !el.dashboardCalendarMonthLabel) return;
  const cursor = new Date(state.dashboardCalendarCursor);
  cursor.setHours(12, 0, 0, 0);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  el.dashboardCalendarMonthLabel.textContent = calendarMonthTitle(cursor);
  const first = new Date(year, month, 1, 12);
  const last = new Date(year, month + 1, 0, 12);
  const start = new Date(first); start.setDate(first.getDate() - first.getDay());
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
  const todayKey = localDateKey(new Date());
  const cells = [];
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const key = localDateKey(day);
    const quantity = dashboardInterviewItemsForDate(key).length;
    const classes = ['dashboard-mini-day'];
    if (day.getMonth() !== month) classes.push('outside');
    if (key === todayKey) classes.push('today');
    if (key === state.dashboardCalendarSelectedDate) classes.push('selected');
    if (quantity) classes.push('has-events');
    cells.push(`<button class="${classes.join(' ')}" data-dashboard-calendar-date="${key}" type="button"><span>${day.getDate()}</span>${quantity ? `<b>${quantity}</b>` : ''}</button>`);
  }
  el.dashboardInterviewCalendar.innerHTML = cells.join('');
  renderDashboardCalendarDay(state.dashboardCalendarSelectedDate || todayKey);
}

function moveDashboardCalendarMonth(offset) {
  const date = new Date(state.dashboardCalendarCursor);
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  state.dashboardCalendarCursor = date;
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (!String(state.dashboardCalendarSelectedDate || '').startsWith(monthKey)) state.dashboardCalendarSelectedDate = localDateKey(date);
  renderDashboardMiniCalendar();
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
  renderVacancyFilterOptions();
  renderVacancies();
}

function vacancyLocationValue(vacancy) {
  return [vacancy.cidade, vacancy.estado].filter(Boolean).join(' · ') || 'Não informado';
}

function renderVacancyFilterOptions() {
  const companies = [...new Set(state.vacancies.map((item) => String(item.empresa_nome || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'));
  const locations = [...new Set(state.vacancies.map(vacancyLocationValue).filter((item) => item !== 'Não informado'))]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'));

  if (!companies.includes(state.vacancyCompany)) state.vacancyCompany = 'TODAS';
  if (!locations.includes(state.vacancyLocation)) state.vacancyLocation = 'TODOS';
  el.vacancyCompanyFilter.innerHTML = `<option value="TODAS">Todas</option>${companies.map((item) => `<option value="${escapeHtml(item)}" ${item === state.vacancyCompany ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  el.vacancyLocationFilter.innerHTML = `<option value="TODOS">Todos</option>${locations.map((item) => `<option value="${escapeHtml(item)}" ${item === state.vacancyLocation ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
}

function filteredVacancies() {
  const q = String(el.vacancySearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  return state.vacancies.filter((vacancy) => {
    const statusMatches = state.vacancyStatus === 'TODAS' || vacancy.status === state.vacancyStatus;
    const companyMatches = state.vacancyCompany === 'TODAS' || String(vacancy.empresa_nome || '') === state.vacancyCompany;
    const locationMatches = state.vacancyLocation === 'TODOS' || vacancyLocationValue(vacancy) === state.vacancyLocation;
    const haystack = [vacancy.codigo, vacancy.titulo, vacancy.cargo, vacancy.bairro, vacancy.cidade, vacancy.horario].join(' ').toLocaleLowerCase('pt-BR');
    return statusMatches && companyMatches && locationMatches && (!q || haystack.includes(q));
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
  const totalCandidates = state.vacancies.reduce((sum, v) => sum + Number(v.total_interessados || 0), 0);
  const newCandidates = state.vacancies.reduce((sum, v) => sum + Number(v.candidatos_novos || 0), 0);
  const approvedCandidates = state.vacancies.reduce((sum, v) => sum + Number(v.candidatos_aprovados || 0), 0);
  const conversionRate = totalCandidates > 0 ? (approvedCandidates / totalCandidates) * 100 : 0;
  el.vacancyKpiActive.textContent = active;
  el.vacancyKpiInterested.textContent = totalCandidates;
  el.vacancyKpiInProcess.textContent = newCandidates;
  el.vacancyKpiApproved.textContent = `${conversionRate.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  el.vacancyKpiTop.textContent = state.vacancySummary?.vaga_mais_escolhida_nome || 'Sem dados no período';
  const topCount = Number(state.vacancySummary?.vaga_mais_escolhida_quantidade || 0);
  el.vacancyKpiTopCount.textContent = `${topCount} escolha${topCount === 1 ? '' : 's'} em ${state.vacancyPeriod}`;

  const kpiCards = [
    [el.vacancyKpiActive, 'Total de vagas ativas', 'Oportunidades disponíveis agora'],
    [el.vacancyKpiInterested, 'Total de candidatos', 'Pessoas vinculadas às vagas'],
    [el.vacancyKpiInProcess, 'Candidatos novos', 'Aguardando início ou análise'],
    [el.vacancyKpiApproved, 'Taxa de conversão', 'Aprovados sobre o total'],
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
  const critical = group.issues.filter((item) => item.gravidade === 'CRITICA').length;
  const high = group.issues.filter((item) => item.gravidade === 'ALTA').length;
  const riskParts = [critical ? `${critical} crítico(s)` : '', high ? `${high} alto(s)` : ''].filter(Boolean);
  const countText = `${group.issues.length} alerta${group.issues.length === 1 ? '' : 's'}`;
  return `
    <article class="audit-candidate-group is-collapsed" data-audit-group="${group.candidato_id}">
      <header class="audit-candidate-group-head">
        <button class="audit-group-toggle" data-audit-toggle="${group.candidato_id}" type="button" aria-expanded="false"><span class="audit-collapse-arrow">›</span><span class="audit-candidate-avatar">${escapeHtml(initials(group.candidato_nome))}</span><span class="audit-candidate-identity"><strong>${escapeHtml(group.candidato_nome)}</strong><small>${escapeHtml(group.vaga_nome)} · ${countText}${riskParts.length ? ` · ${riskParts.join(' · ')}` : ''}</small></span></button>
        <div class="audit-candidate-group-actions"><span class="audit-severity ${String(group.maxSeverity).toLowerCase()}">${escapeHtml(auditSeverityLabel(group.maxSeverity))}</span><button class="button button-rescue" data-audit-rescue-candidate="${group.candidato_id}" type="button">↻ Resgatar</button><button class="button button-ghost" data-audit-candidate-profile="${group.candidato_id}" type="button">↗ Perfil</button></div>
      </header>
      <div class="audit-candidate-issues">${group.issues.map((item) => auditIssueRow(item, true)).join('')}</div>
    </article>`;
}

async function loadAudit() {
  if (String(state.currentUser?.perfil || '').toUpperCase() !== 'ADMIN') return;
  el.auditLoading?.classList.remove('hidden');
  const params = new URLSearchParams({
    status: el.auditStatusFilter?.value || 'NOVO',
    gravidade: el.auditSeverityFilter?.value || 'TODAS',
    categoria: el.auditCategoryFilter?.value || 'TODAS',
    busca: el.auditSearchInput?.value?.trim() || ''
  });
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
  if (el.auditTrendChart) el.auditTrendChart.innerHTML = trends.length ? trends.map((item) => `<div class="audit-trend-day"><div class="audit-trend-bars"><i class="critical" style="height:${Math.max(2, Number(item.criticos || 0) / max * 100)}%"></i><i class="high" style="height:${Math.max(2, Number(item.altos || 0) / max * 100)}%"></i><i style="height:${Math.max(3, Number(item.total || 0) / max * 100)}%"></i></div><span>${escapeHtml(new Date(`${item.dia}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}))}</span></div>`).join('') : emptyState('Sem histórico de alertas.');
  const categories = data.categorias || [];
  if (el.auditCategoryFilter) {
    const selectedCategory = el.auditCategoryFilter.value || 'TODAS';
    el.auditCategoryFilter.innerHTML = '<option value="TODAS">Todas as categorias</option>'
      + categories.map((item) => `<option value="${escapeHtml(item.categoria)}">${escapeHtml(auditCategoryLabel(item.categoria))} (${Number(item.quantidade || 0)})</option>`).join('');
    el.auditCategoryFilter.value = categories.some((item) => item.categoria === selectedCategory) ? selectedCategory : 'TODAS';
  }
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
    quantidade_vagas: 1, idade_minima: 25, idade_maxima: '', experiencia_minima_meses: 0, experiencia_revisao_minima_meses: 0, permitir_experiencia_informal_revisao: false, chatbot_estatico_ativo: true, exigir_experiencia_compativel: true, publicar_portal: true, destaque_portal: false, canal_candidatura: 'WHATSAPP_GENESIS',
    entrevista_dias_semana: [1,2,3,4,5], entrevista_horarios: ['09:00','10:00','14:00','15:00'], entrevista_duracao_minutos: 30, entrevista_busca_dias: 7, entrevista_evitar_feriados: true,
    recrutador_responsavel_id: state.currentUser?.id || null, agenda_personalizada: false,
  };
  const source = vacancy ? { ...vacancy } : defaults;
  if (duplicate) {
    source.status = 'RASCUNHO';
    source.data_inicio = null;
    source.data_encerramento = null;
    source.destaque_portal = false;
    source.portal_publicado_em = null;
  }
  const experienceSelect = el.vacancyForm.elements.experiencia_minima_meses;
  const experienceValue = String(source.experiencia_minima_meses ?? 0);
  if (experienceSelect && ![...experienceSelect.options].some((option) => option.value === experienceValue)) {
    experienceSelect.add(new Option(`${experienceValue} meses (personalizado)`, experienceValue));
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
  await window.GenesisScreening?.load(vacancy?.id || null, { duplicate });
  await window.GenesisOperationsV14?.prepareVacancyDialog(source);
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
    empresa_id: data.get('empresa_id'), recrutador_responsavel_id: data.get('recrutador_responsavel_id') || null,
    agenda_personalizada: data.get('agenda_personalizada') === 'on', titulo, cargo: profile.cargo || titulo, sexo: data.get('sexo') || 'UNISSEX',
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
    experiencia_revisao_minima_meses: data.get('experiencia_revisao_minima_meses') || 0,
    permitir_experiencia_informal_revisao: data.get('permitir_experiencia_informal_revisao') === 'on',
    chatbot_estatico_ativo: data.get('chatbot_estatico_ativo') === 'on',
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
    window.GenesisScreening?.validate?.();
    const idadeMinima = Number(payload.idade_minima || 0);
    const idadeMaxima = payload.idade_maxima === null || payload.idade_maxima === '' ? null : Number(payload.idade_maxima);
    if (idadeMaxima !== null && idadeMaxima < idadeMinima) throw new Error('A idade máxima não pode ser menor que a idade mínima.');
    if (payload.agenda_personalizada && !payload.entrevista_dias_semana.length) throw new Error('Marque pelo menos um dia permitido para entrevistas.');
    if (payload.agenda_personalizada && !payload.entrevista_horarios.length) throw new Error('Marque pelo menos um horário permitido para entrevistas.');
    if (Number(payload.experiencia_revisao_minima_meses || 0) > Number(payload.experiencia_minima_meses || 0)) throw new Error('A faixa de análise humana não pode ser maior que a experiência exigida.');
    const result = await api(id ? `/api/vagas/${id}` : '/api/vagas', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    try {
      await window.GenesisScreening?.save(result.vaga.id);
    } catch (screeningError) {
      el.vacancyId.value = result.vaga.id;
      throw new Error(`A vaga foi salva, mas as perguntas não foram atualizadas. Corrija e clique em salvar novamente: ${screeningError.message}`);
    }
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
    el.promotionPrimaryImage.src = state.promotion.imagem_png_url || state.promotion.imagem_data_url || '';
    window.GenesisOperationsV14?.setPromotionContext(id, data);
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
  const activeMap = {
    candidateVacancyFilter: state.candidateVacancy !== 'TODAS',
    candidateStageFilter: state.candidateStage !== 'TODAS',
    candidateDocumentFilter: state.candidateDocument !== 'TODOS',
    candidateInterviewFilter: state.candidateInterview !== 'TODAS',
    candidateSexFilter: state.candidateSex !== 'TODOS',
    candidateReallocationFilter: state.candidateReallocation !== 'TODOS',
  };
  Object.entries(activeMap).forEach(([id, active]) => document.getElementById(id)?.closest('.table-filter-menu')?.classList.toggle('has-active-filter', active));
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
    return `<tr data-candidate-row="${c.id}" tabindex="0" role="button" aria-label="Abrir perfil de ${escapeHtml(c.nome || 'candidato')}">
      <td><div class="primary-cell"><strong>${escapeHtml(c.nome || 'Nome não informado')}</strong><span>${escapeHtml(formatPhone(c.telefone))}</span></div></td>
      <td><div class="primary-cell"><strong>${escapeHtml(c.vaga_nome || c.vaga_legacy || 'Não vinculada')}</strong><span>${escapeHtml(c.vaga_codigo || 'Sem código')}</span></div></td>
      <td><span class="badge ${badgeClass(c.status)}">${escapeHtml(statusLabels[c.status] || c.status || 'Não informado')}</span>${c.ia_atendimento_ativo === false ? '<span class="badge badge-warning ai-paused-mini">IA pausada</span>' : ''}<div class="primary-cell"><span>${escapeHtml(stageLabels[c.etapa] || c.etapa || 'Etapa não informada')}</span></div></td>
      <td><span>${docs} arquivo(s)</span></td>
      <td>${escapeHtml(interview)}</td>
      <td>${escapeHtml(formatDate(c.updated_at))}</td>
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
  document.getElementById('candidateScreeningSection')?.classList.add('hidden');
  try {
    const details = await api(`/api/candidatos/${id}/detalhes`);
    state.selectedCandidate = details.candidato;
    state.selectedCandidateExtras = { selectedTags: [] };
    renderCandidateDrawer(details);
    if (currentUserIsAdmin()) loadCandidateAudit(id).catch(() => {});
    window.GenesisScreening?.loadCandidate(id).catch(() => {});
    el.candidateDrawerLoading.classList.add('hidden');
    el.candidateDrawerContent.classList.remove('hidden');
  } catch (error) {
    el.candidateDrawerLoading.innerHTML = emptyState('Não foi possível carregar', error.message);
  }
}

function renderCandidateDrawer(details) {
  const c = details.candidato;
  const tags = state.selectedCandidateExtras.selectedTags || [];
  const isAdmin = currentUserIsAdmin();
  el.candidateDrawerTitle.textContent = c.nome || `Candidato #${c.id}`;
  el.candidateDrawerSubtitle.textContent = `${statusLabels[c.status] || c.status || 'Sem status'} · ${stageLabels[c.etapa] || c.etapa || 'Sem etapa'}`;
  el.candidateAvatar.textContent = initials(c.nome || c.telefone);
  el.candidateName.textContent = c.nome || 'Nome não informado';
  el.candidatePhone.textContent = formatPhone(c.telefone);
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
  const requiredMonths = Number(c.experiencia_minima_meses || 0);
  const provenDays = Number(c.maior_experiencia_compativel_dias || 0);
  const provenMonths = Math.floor(provenDays / 30);
  const remainingDays = Math.max(0, requiredMonths * 30 - provenDays);
  el.candidateCtpsMetrics.innerHTML = [
    `<article><span>Exigido pela vaga</span><strong>${requiredMonths ? `${requiredMonths} mês(es)` : 'Sem mínimo'}</strong></article>`,
    `<article><span>Comprovado</span><strong>${provenDays ? `${provenMonths} mês(es) · ${provenDays} dias` : 'Não confirmado'}</strong></article>`,
    `<article><span>Situação</span><strong>${c.revisao_pendente ? 'Decisão humana' : c.aprovado === true ? 'Aprovado' : remainingDays > 0 ? `Faltam ${remainingDays} dias` : 'Em análise'}</strong></article>`,
  ].join('');
  const ctpsDocuments = (details.documentos || []).filter((doc) => ['CTPS','PENDENTE','OUTRO'].includes(String(doc.tipo || '').toUpperCase()));
  const latestCtps = ctpsDocuments[0];
  el.candidateCtpsDocumentActions.innerHTML = latestCtps
    ? `${latestCtps.disponivel_download ? `<a class="button button-ghost" href="/api/documentos/${latestCtps.id}/download">Abrir CTPS armazenada</a>` : '<span class="helper-text">Arquivo da CTPS sem download disponível.</span>'}`
    : '<span class="helper-text">Nenhuma CTPS armazenada foi localizada.</span>';

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

  el.candidateStatusSelect.value = ['NOVO','EM_PROCESSO','APROVADO','EM_ADMISSAO','REPROVADO','CONTRATADO','ENCERRADO'].includes(c.status) ? c.status : 'EM_PROCESSO';
  el.candidateStageSelect.innerHTML = adminStageValues.map((value) => `<option value="${value}" ${value === c.etapa ? 'selected' : ''}>${escapeHtml(stageLabels[value] || value)}</option>`).join('');
  if (!adminStageValues.includes(c.etapa)) el.candidateStageSelect.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(c.etapa || 'AGUARDANDO_INTENCAO')}" selected>${escapeHtml(stageLabels[c.etapa] || c.etapa || 'Etapa atual')}</option>`);
  const aiActive = c.ia_atendimento_ativo !== false;
  el.candidateAiStatusBadge.textContent = aiActive ? 'IA ativa' : 'IA pausada';
  el.candidateAiStatusBadge.className = `badge ${aiActive ? 'badge-approved' : 'badge-warning'}`;
  el.candidateAiStatusText.textContent = aiActive
    ? 'A Evelyn pode responder automaticamente às próximas mensagens deste candidato.'
    : `A IA está pausada para este candidato.${c.ia_pausa_motivo ? ` Motivo: ${c.ia_pausa_motivo}` : ''}`;
  el.toggleCandidateAiButton.textContent = aiActive ? 'Pausar IA' : 'Retomar IA';
  el.toggleCandidateAiButton.classList.toggle('button-danger-soft', aiActive);
  el.toggleCandidateAiButton.classList.toggle('button-primary', !aiActive);
  const finalStatus = ['ENCERRADO','REPROVADO','CONTRATADO'].includes(String(c.status || '').toUpperCase());
  el.adminCloseCandidateButton.classList.toggle('hidden', finalStatus);
  el.adminReopenCandidateButton.classList.toggle('hidden', !['ENCERRADO','REPROVADO'].includes(String(c.status || '').toUpperCase()));
  el.adminRejectCandidateButton.classList.toggle('hidden', ['REPROVADO','ENCERRADO','CONTRATADO'].includes(String(c.status || '').toUpperCase()));
  el.adminRejectCandidateForm.classList.add('hidden');
  el.adminRejectReason.value = '';
  el.adminRejectObservation.value = '';
  el.adminRejectReallocatable.checked = true;
  el.adminRejectSendMessage.checked = false;

  el.postInterviewDecision.value = c.etapa === 'REPROVADO_POS_ENTREVISTA' ? 'REPROVADO_POS_ENTREVISTA' : ['EM_ADMISSAO', 'CONTRATADO'].includes(c.status) ? c.status : '';
  el.postInterviewReason.value = c.motivo_reprovacao_codigo || '';
  el.postInterviewReallocatable.checked = c.reprovacao_realocavel !== false;
  el.postInterviewObservation.value = c.observacao_decisao_pos_entrevista || '';
  el.postInterviewReasonField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA');
  el.postInterviewReallocatableField.classList.toggle('hidden', el.postInterviewDecision.value !== 'REPROVADO_POS_ENTREVISTA');

  renderCandidateConversation(details.conversa || []);
  if (isAdmin) {
    renderCandidateDocuments(details.documentos || []);
    renderCandidateTimeline(details.timeline || []);
  }
  setDrawerTab('summary');
  window.GenesisAtendimentoV15?.candidateLoaded?.(details, {
    isAdmin,
    user: state.currentUser,
    candidateId: Number(c.id),
  });
}

function renderCandidateConversation(messages) {
  el.candidateConversation.innerHTML = messages.length ? messages.map((item) => {
    const author = String(item.quem || '').toUpperCase();
    const incoming = ['USUARIO', 'CANDIDATO'].includes(author);
    const label = incoming ? 'Candidato' : (author === 'IA' ? 'Evelyn' : (item.autor_nome || 'Equipe Genesis'));
    const delivery = item.status_envio ? `<small class="message-delivery ${String(item.status_envio).toLowerCase()}">${escapeHtml(item.status_envio)}</small>` : '';
    return `<article class="conversation-message ${incoming ? 'incoming' : 'outgoing'}"><div><strong>${escapeHtml(label)}</strong><time>${escapeHtml(formatDate(item.created_at))}</time></div><p>${escapeHtml(item.mensagem || 'Mensagem sem conteúdo')}</p>${delivery}</article>`;
  }).join('') : emptyState('Nenhuma mensagem registrada', 'A conversa aparecerá aqui quando o atendimento começar.');
  el.candidateConversation.scrollTop = el.candidateConversation.scrollHeight;
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

function setDrawerTab(name) {
  document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.classList.toggle('active', button.dataset.drawerTab === name));
  document.querySelectorAll('.drawer-tab').forEach((section) => section.classList.toggle('hidden', section.id !== `drawer-tab-${name}`));
  window.GenesisAtendimentoV15?.tabChanged?.(name);
}

function focusPostInterviewDecision() {
  el.postInterviewDecision.value = 'REPROVADO_POS_ENTREVISTA';
  el.postInterviewReasonField.classList.remove('hidden');
  el.postInterviewDecisionSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => el.postInterviewReason.focus(), 250);
}

async function updateCandidate(mode = 'SOMENTE_CORRECAO') {
  const status = el.candidateStatusSelect.value;
  const etapa = el.candidateStageSelect.value;
  const motivo = String(el.candidateCorrectionReason?.value || '').trim();
  if (!motivo) return showToast('Informe o motivo da correção técnica.', 'error');
  if (status === 'REPROVADO' || etapa === 'REPROVADO_POS_ENTREVISTA') {
    focusPostInterviewDecision();
    return showToast('Para reprovar após a entrevista, use “Resultado após entrevista”.', 'error');
  }
  const continueFlow = mode === 'CORRIGIR_E_CONTINUAR';
  if (continueFlow) {
    const preview = await api(`/api/atendimento/candidatos/${state.selectedCandidateId}/correcao/preview?status=${encodeURIComponent(status)}&etapa=${encodeURIComponent(etapa)}`);
    const ok = window.confirm(`Aplicar a correção e continuar o atendimento?

Mensagem prevista:
${preview.mensagem_prevista}`);
    if (!ok) return;
  }
  const button = continueFlow ? el.continueCandidateButton : el.updateCandidateButton;
  const originalText = button.textContent; button.disabled = true; button.textContent = 'Aplicando...';
  try {
    const result = await api(`/api/atendimento/candidatos/${state.selectedCandidateId}/correcao`, { method:'POST', body:JSON.stringify({ status, etapa, motivo, modo:mode }) });
    showToast(result.mensagem || 'Correção aplicada.');
    await loadCandidates(true); if (el.candidateDrawer.open) el.candidateDrawer.close(); await openCandidate(state.selectedCandidateId);
  } catch (error) { showToast(error.message || 'Não foi possível aplicar a correção.', 'error'); }
  finally { button.disabled=false; button.textContent=originalText; }
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

function openAdminRejectForm() {
  el.adminRejectCandidateForm.classList.remove('hidden');
  el.adminRejectReason.focus();
  el.adminRejectCandidateForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeAdminRejectForm() {
  el.adminRejectCandidateForm.classList.add('hidden');
  el.adminRejectReason.value = '';
  el.adminRejectObservation.value = '';
}

async function runAdminCandidateAction(action, payload = {}) {
  if (!currentUserIsAdmin()) return showToast('Ação disponível somente para administradores.', 'error');
  const result = await api(`/api/admin/candidatos/${state.selectedCandidateId}/acao`, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
  if (result.aviso) showToast(result.aviso, 'error');
  else showToast(result.mensagem || 'Ação administrativa registrada.');
  await loadCandidates(true);
  if (el.candidateDrawer.open) el.candidateDrawer.close();
  await openCandidate(state.selectedCandidateId);
}

async function confirmAdminReject() {
  const motivoCodigo = el.adminRejectReason.value;
  const observacao = el.adminRejectObservation.value.trim();
  if (!motivoCodigo) return showToast('Selecione o motivo da reprovação.', 'error');
  if (motivoCodigo === 'OUTRO' && !observacao) return showToast('Descreva o motivo da reprovação.', 'error');
  if (!window.confirm('Confirmar a reprovação deste candidato nesta vaga?')) return;
  el.confirmAdminRejectButton.disabled = true;
  try {
    await runAdminCandidateAction('REPROVAR_VAGA', {
      motivo_codigo: motivoCodigo,
      observacao,
      realocavel: el.adminRejectReallocatable.checked,
      enviar_mensagem: el.adminRejectSendMessage.checked,
    });
  } catch (error) {
    showToast(error.message || 'Não foi possível reprovar o candidato.', 'error');
  } finally {
    el.confirmAdminRejectButton.disabled = false;
  }
}

async function closeCandidateAdministratively() {
  const motivo = window.prompt('Motivo do encerramento:', 'Candidatura encerrada administrativamente');
  if (motivo === null) return;
  if (!window.confirm('Encerrar esta candidatura? A IA será pausada e a etapa ficará encerrada.')) return;
  try { await runAdminCandidateAction('ENCERRAR', { observacao: motivo }); }
  catch (error) { showToast(error.message || 'Não foi possível encerrar a candidatura.', 'error'); }
}

async function reopenCandidateAdministratively() {
  if (!window.confirm('Reabrir esta candidatura e retomar o fluxo a partir do menu inicial?')) return;
  try { await runAdminCandidateAction('REABRIR'); }
  catch (error) { showToast(error.message || 'Não foi possível reabrir a candidatura.', 'error'); }
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

async function loadReviews() {
  const data = await api('/api/revisoes?status=PENDENTE');
  state.reviews = data.revisoes || [];
  renderReviews();
  renderDashboardReviews();
}

function reviewTypeLabel(value) {
  return ({ INCOMPATIBILIDADE_SEXO: 'Compatibilidade operacional', EXCECAO_EXPERIENCIA: 'Exceção de experiência', REVISAO_DOCUMENTAL: 'Revisão documental', SUPORTE_FLUXO: 'Suporte de fluxo', DIVERGENCIA_DADOS: 'Divergência de dados' })[value] || value;
}

function renderDashboardReviews() {
  if (!el.dashboardReviews) return;
  const items = state.reviews.slice(0,4);
  el.dashboardReviews.innerHTML = items.length ? items.map((item) => `<button class="review-dashboard-item" data-go-view="reviews" type="button"><span class="review-type-dot ${String(item.tipo || '').toLowerCase()}"></span><span><strong>${escapeHtml(item.candidato_nome)}</strong><small>${escapeHtml(reviewTypeLabel(item.tipo))} · ${escapeHtml(item.vaga_nome || 'Sem vaga')}</small></span><time>${escapeHtml(formatDate(item.created_at, {dateOnly:true}))}</time></button>`).join('') : emptyState('Nenhuma decisão pendente', 'Casos claros estão seguindo automaticamente.');
}

function renderReviews() {
  const q = String(el.reviewSearchInput?.value || '').trim().toLocaleLowerCase('pt-BR');
  const type = state.reviewType || 'TODAS';
  const items = state.reviews.filter((item) => (type === 'TODAS' || item.tipo === type) && (!q || [item.candidato_nome,item.vaga_nome,item.titulo,item.motivo].join(' ').toLocaleLowerCase('pt-BR').includes(q)));
  el.reviewPendingCount.textContent = state.reviews.length;
  el.reviewsList.innerHTML = items.length ? items.map((item) => {
    const months = Math.round(Number(item.experiencia_comprovada_dias || 0) / 30 * 10) / 10;
    const metrics = item.tipo === 'EXCECAO_EXPERIENCIA' ? `<div class="review-metrics"><span><b>${months}</b> meses comprovados</span><span><b>${Number(item.experiencia_exigida_meses || 0)}</b> meses exigidos</span></div>` : '';
    const data = item.dados && typeof item.dados === 'object' ? item.dados : {};
    const documentSummary = [data.cargo_vinculo_utilizado && `Cargo: ${data.cargo_vinculo_utilizado}`, data.periodo_vinculo_utilizado && `Período: ${data.periodo_vinculo_utilizado}`, data.maior_experiencia_compativel_texto && `Tempo: ${data.maior_experiencia_compativel_texto}`].filter(Boolean);
    const curriculumExperiences = Array.isArray(item.curriculo_resultado?.experiencias) ? item.curriculo_resultado.experiencias.length : 0;
    const support = documentSummary.length || curriculumExperiences ? `<div class="review-support">${documentSummary.map((line)=>`<span>${escapeHtml(line)}</span>`).join('')}${curriculumExperiences ? `<span>Currículo: ${curriculumExperiences} experiência(s) declarada(s)</span>` : ''}</div>` : '';
    const documentButton = item.documento_id ? `<a class="button button-ghost" href="/api/documentos/${item.documento_id}/download" target="_blank" rel="noopener">Abrir CTPS</a>` : '';
    const curriculumButton = item.curriculo_id ? `<a class="button button-ghost" href="/api/documentos/${item.curriculo_id}/download" target="_blank" rel="noopener">Abrir currículo</a>` : '';
    const reprocessButton = item.tipo === 'REVISAO_DOCUMENTAL' ? `<button class="button button-ghost" data-review-decision="REPROCESSAR" data-id="${item.id}" type="button">Reprocessar</button>` : '';
    const newPdfButton = item.tipo === 'REVISAO_DOCUMENTAL' ? `<button class="button button-ghost" data-review-decision="SOLICITAR_NOVO_PDF" data-id="${item.id}" type="button">Solicitar novo PDF</button>` : '';
    const isCompatibility = item.tipo === 'INCOMPATIBILIDADE_SEXO';
    const select = isCompatibility ? `<label class="review-select"><input data-review-select type="checkbox" value="${item.id}"> Selecionar para decisão em lote</label>` : '';
    const compatibility = isCompatibility ? `<div class="review-compatibility"><div><span>Documento</span><strong>${escapeHtml(candidateSexText(item.candidato_sexo))}</strong></div><b>≠</b><div><span>Requisito interno da vaga</span><strong>${escapeHtml(candidateSexText(item.vaga_sexo))}</strong></div></div>` : '';
    const approveLabel = isCompatibility ? 'Manter no processo' : 'Aprovar e continuar';
    const rejectLabel = isCompatibility ? 'Confirmar incompatibilidade' : 'Não aprovar nesta vaga';
    return `<article class="review-card">${select}<header><div><span class="review-kind">${escapeHtml(reviewTypeLabel(item.tipo))}</span><h3>${escapeHtml(item.candidato_nome)}</h3><p>${escapeHtml(item.vaga_nome || 'Sem vaga vinculada')}</p></div><time>${escapeHtml(formatDate(item.created_at))}</time></header>${compatibility}${metrics}${support}<p class="review-reason">${escapeHtml(item.motivo || item.titulo)}</p><footer>${documentButton}${curriculumButton}<button class="button button-primary" data-review-decision="APROVAR" data-id="${item.id}" type="button">${approveLabel}</button>${reprocessButton}${newPdfButton}<button class="button button-danger-soft" data-review-decision="NAO_APROVAR" data-id="${item.id}" type="button">${rejectLabel}</button></footer></article>`;
  }).join('') : emptyState('Nenhuma pendência neste filtro', 'Casos claros seguem automaticamente pelo Chatbot Estático V1.');
  window.GenesisOperationsV14?.updateReviewBatchToolbar();
}

async function decideReview(id, decision) {
  const labels = { APROVAR: 'aprovar e continuar', NAO_APROVAR: 'não aprovar nesta vaga', REPROCESSAR: 'reprocessar o documento', SOLICITAR_NOVO_PDF: 'solicitar um novo PDF ao candidato' };
  const motivo = window.prompt(`Confirme o motivo para ${labels[decision] || decision}:`, decision === 'APROVAR' ? 'Necessidade operacional / experiência próxima do requisito' : '');
  if (motivo === null) return;
  const result = await api(`/api/revisoes/${id}/decidir`, { method: 'POST', body: JSON.stringify({ decisao: decision, motivo }) });
  showToast(result.mensagem || 'Decisão registrada.');
  await loadReviews(true);
  await loadCandidates(true);
}

async function sendCandidateToRescue(candidateId, auditProblemId = null) {
  if (!window.confirm('Enviar este candidato para a fila de resgate? A etapa atual será preservada e a mensagem será preparada pelo fluxo estático.')) return;
  const result = await api(`/api/candidatos/${candidateId}/resgate`, { method: 'POST', body: JSON.stringify({ auditoria_problema_id: auditProblemId }) });
  showToast(result.mensagem || 'Candidato enviado para resgate.');
}

async function loadInterviews() {
  const data = await api('/api/entrevistas?periodo=TODAS&status=TODAS');
  state.interviews = data.entrevistas || [];
  if (!state.calendarSelectedDate) state.calendarSelectedDate = localDateKey(new Date());
  renderInterviews();
}

function calendarMonthTitle(date) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(date)
    .replace(/^./, (letter) => letter.toUpperCase());
}

function renderCalendarDayList(dateKey) {
  const items = state.interviews.filter((item) => localDateKey(item.inicio) === dateKey).sort((a,b) => new Date(a.inicio) - new Date(b.inicio));
  const date = new Date(`${dateKey}T12:00:00`);
  el.calendarSelectedDayLabel.textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(date).replace(/^./, (l) => l.toUpperCase());
  el.interviewsList.innerHTML = items.length ? items.map((item) => {
    const meet = item.meet_link || item.google_event_url;
    return `<article class="calendar-agenda-item"><time>${escapeHtml(formatTime(item.inicio))}</time><div><strong>${escapeHtml(item.candidato_nome)}</strong><span>${escapeHtml(item.vaga_nome)}</span><small>${escapeHtml(item.telefone ? formatPhone(item.telefone) : '')}</small></div><div class="calendar-agenda-actions"><button class="button button-ghost" data-action="open-candidate" data-id="${item.candidato_id}" type="button">Candidato</button>${meet ? `<a class="button button-primary" href="${escapeHtml(meet)}" target="_blank" rel="noopener">Abrir Meet</a>` : '<span class="badge badge-warning">Sem link</span>'}</div></article>`;
  }).join('') : emptyState('Nenhuma entrevista neste dia', 'Selecione outro dia no calendário.');
}

function renderInterviews() {
  const cursor = new Date(state.calendarCursor);
  cursor.setHours(12,0,0,0);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  el.calendarMonthLabel.textContent = calendarMonthTitle(cursor);
  const first = new Date(year, month, 1, 12);
  const last = new Date(year, month + 1, 0, 12);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));
  const todayKey = localDateKey(new Date());
  const cells = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate()+1)) {
    const key = localDateKey(d);
    const dayItems = state.interviews.filter((item) => localDateKey(item.inicio) === key).sort((a,b)=>new Date(a.inicio)-new Date(b.inicio));
    const classes = ['calendar-day'];
    if (d.getMonth() !== month) classes.push('outside');
    if (key === todayKey) classes.push('today');
    if (key === state.calendarSelectedDate) classes.push('selected');
    const events = dayItems.slice(0,3).map((item) => `<span class="calendar-event"><b>${escapeHtml(formatTime(item.inicio))}</b> ${escapeHtml(item.candidato_nome)}</span>`).join('');
    const more = dayItems.length > 3 ? `<small>+${dayItems.length-3} entrevista(s)</small>` : '';
    cells.push(`<button class="${classes.join(' ')}" data-calendar-date="${key}" type="button"><i>${d.getDate()}</i><div>${events}${more}</div></button>`);
  }
  el.interviewCalendar.innerHTML = cells.join('');
  renderCalendarDayList(state.calendarSelectedDate);
}

function moveCalendarMonth(offset) {
  const date = new Date(state.calendarCursor);
  date.setDate(1); date.setMonth(date.getMonth()+offset); state.calendarCursor=date;
  const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  if (!String(state.calendarSelectedDate || '').startsWith(monthKey)) state.calendarSelectedDate = localDateKey(date);
  renderInterviews();
}

async function loadDocuments() {
  const data = await api('/api/documentos?tipo=TODOS');
  state.documents = data.documentos || [];
  if (!state.documentExpansionInitialized && state.documents.length) {
    state.expandedDocumentCandidates.add(String(state.documents[0].candidato_id));
    state.documentExpansionInitialized = true;
  }
  renderDocuments();
}

function documentProcessingMeta(doc) {
  const status = String(doc.status_processamento || '').toUpperCase();
  if (['ERRO', 'ERRO_PROCESSAMENTO', 'INCONCLUSIVO'].includes(status)) return { label: 'Falha no processamento', tone: 'error', detail: 'Arquivo bruto preservado' };
  if (['REVISAO'].includes(status) || String(doc.tipo || '').toUpperCase() === 'PENDENTE_REVISAO') return { label: 'Aguardando revisão', tone: 'wait', detail: 'Decisão humana necessária' };
  if (['RECEBIDO', 'ARMAZENADO', 'PROCESSANDO', 'REPROCESSAMENTO_SOLICITADO', 'PENDENTE'].includes(status)) return { label: status === 'PROCESSANDO' ? 'Processando' : 'Aguardando processamento', tone: 'wait', detail: 'Arquivo armazenado' };
  return { label: 'Analisado', tone: 'ok', detail: String(doc.tipo || '').toUpperCase() === 'CURRICULO' ? 'Dados do currículo extraídos' : 'Análise concluída' };
}

function renderDocuments() {
  const query = String(el.documentSearchInput?.value || '').trim().toLocaleLowerCase('pt-BR');
  const selectedType = String(state.documentType || 'TODOS').toUpperCase();
  const filtered = state.documents.filter((doc) => {
    const meta = documentProcessingMeta(doc);
    const docType = String(doc.tipo || '').toUpperCase();
    const typeMatches =
      selectedType === 'TODOS'
      || (selectedType === 'CTPS' && docType === 'CTPS')
      || (selectedType === 'CURRICULO' && docType === 'CURRICULO')
      || (selectedType === 'FALHA' && meta.tone === 'error')
      || (selectedType === 'PENDENTE' && meta.tone === 'wait');
    const searchMatches = !query || [doc.candidato_nome, doc.telefone, doc.nome_arquivo, doc.vaga_nome].join(' ').toLocaleLowerCase('pt-BR').includes(query);
    return typeMatches && searchMatches;
  });

  const allGroups = new Map();
  state.documents.forEach((doc) => {
    const key = String(doc.candidato_id);
    if (!allGroups.has(key)) allGroups.set(key, []);
    allGroups.get(key).push(doc);
  });
  const reviewCandidates = new Set();
  const failedCandidates = new Set();
  let processedToday = 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  state.documents.forEach((doc) => {
    const meta = documentProcessingMeta(doc);
    if (meta.tone === 'wait') reviewCandidates.add(String(doc.candidato_id));
    if (meta.tone === 'error') failedCandidates.add(String(doc.candidato_id));
    if (doc.created_at && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(doc.created_at)) === today && meta.tone === 'ok') processedToday += 1;
  });
  el.documentsKpiCandidates.textContent = allGroups.size;
  el.documentsKpiReview.textContent = reviewCandidates.size;
  el.documentsKpiFailures.textContent = failedCandidates.size;
  el.documentsKpiToday.textContent = processedToday;

  const groups = new Map();
  filtered.forEach((doc) => {
    const key = String(doc.candidato_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  });

  el.documentsList.innerHTML = groups.size ? [...groups.entries()].map(([candidateId, docs]) => {
    docs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const first = docs[0];
    const expanded = state.expandedDocumentCandidates.has(candidateId);
    const chips = docs.slice(0, 4).map((doc) => {
      const meta = documentProcessingMeta(doc);
      const shortLabel = meta.label
        .replace('Falha no processamento', 'erro')
        .replace('Aguardando processamento', 'aguardando')
        .replace('Aguardando revisão', 'revisão')
        .replace('Analisado', 'analisado')
        .replace('Processando', 'processando');
      return `<span class="document-status-chip ${meta.tone}">${escapeHtml(doc.tipo || 'OUTRO')} · ${escapeHtml(shortLabel)}</span>`;
    }).join('');
    const files = expanded ? `<div class="document-candidate-files">${docs.map((doc) => {
      const meta = documentProcessingMeta(doc);
      const canReprocess = String(doc.tipo || '').toUpperCase() === 'CTPS' && ['error', 'wait'].includes(meta.tone);
      return `<article class="document-file-row">
        <span class="document-file-icon">PDF</span>
        <div><strong>${escapeHtml(doc.nome_arquivo || doc.titulo || 'Documento')}</strong><small>${escapeHtml(formatFileSize(doc.tamanho_bytes))} · ${escapeHtml(formatDate(doc.created_at))}</small></div>
        <span class="document-file-status ${meta.tone}">${escapeHtml(meta.label)}</span>
        <small class="document-file-detail">${escapeHtml(meta.detail)}</small>
        <div class="document-file-actions">
          ${doc.disponivel_download ? `<a href="/api/documentos/${doc.id}/download" target="_blank" rel="noopener">Visualizar</a>` : ''}
          ${canReprocess ? `<button data-document-reprocess="${candidateId}" type="button">Reprocessar</button>` : ''}
        </div>
      </article>`;
    }).join('')}</div>` : '';
    return `<article class="document-candidate-group ${expanded ? 'expanded' : ''}">
      <button class="document-candidate-header" data-document-toggle="${candidateId}" type="button" aria-expanded="${expanded}">
        <span class="document-candidate-avatar">${escapeHtml(initials(first.candidato_nome))}</span>
        <span class="document-candidate-name"><strong>${escapeHtml(first.candidato_nome)}</strong><small>${escapeHtml(formatPhone(first.telefone))} · ${escapeHtml(first.vaga_nome || 'Sem vaga')}</small></span>
        <span class="document-stage-chip">${escapeHtml(stageLabels[first.candidato_etapa] || first.candidato_etapa || 'Cadastro ativo')}</span>
        <span class="document-status-chips">${chips}</span>
        <span class="document-candidate-meta">${docs.length} arquivo${docs.length === 1 ? '' : 's'}<small>${escapeHtml(formatRelativeTime(first.created_at))}</small></span>
        <span class="document-chevron">${expanded ? '⌃' : '⌄'}</span>
      </button>
      ${files}
    </article>`;
  }).join('') : emptyState('Nenhum documento encontrado', 'Ajuste o filtro ou a busca.');
}

async function reprocessDocumentCandidate(candidateId) {
  if (!window.confirm('Reprocessar a CTPS armazenada deste candidato?')) return;
  const result = await api(`/api/candidatos/${candidateId}/reprocessar-ctps`, { method: 'POST', body: '{}' });
  showToast(result.mensagem || 'CTPS enviada para reprocessamento.');
  await loadDocuments();
}

async function loadMonitoring() {
  const data = await api('/api/monitoramento');
  state.monitoring = data;
  renderMonitoring();
}

function renderMonitoring() {
  const data = state.monitoring || {};
  const metrics = data.metricas || {};
  el.monitorKpiErrors.textContent = Number(metrics.erros_pendentes || 0);
  el.monitorKpiDocs.textContent = Number(metrics.documentos_pendentes || 0);
  el.monitorKpiFollowups.textContent = Number(metrics.followups_24h || 0);
  const errors = data.erros || [];
  el.monitorErrors.innerHTML = errors.length ? errors.map((error) => `<article class="monitor-error"><span class="monitor-error-icon">!</span><div><strong>${escapeHtml(error.workflow_nome || 'Workflow')} · ${escapeHtml(error.node_nome || 'Node não informado')}</strong><span>${escapeHtml(error.erro_mensagem)}</span><small>${escapeHtml(formatDate(error.created_at))}${error.telefone ? ` · ${escapeHtml(formatPhone(error.telefone))}` : ''}</small></div>${!error.resolvido ? `<button class="button button-ghost" data-monitor-action="resolve-error" data-id="${error.id}" type="button">Resolver</button>` : '<span class="badge badge-active">Resolvido</span>'}</article>`).join('') : emptyState('Nenhum erro registrado', 'As falhas dos workflows aparecerão aqui.');
  const health = [
    ['Última entrada do WhatsApp', metrics.ultima_entrada ? formatDate(metrics.ultima_entrada) : 'Sem registro'],
    ['Última resposta automática', metrics.ultima_resposta_ia ? formatDate(metrics.ultima_resposta_ia) : 'Sem registro'],
    ['Último candidato criado', metrics.ultimo_candidato_criado ? formatDate(metrics.ultimo_candidato_criado) : 'Sem registro'],
    ['Documentos em processamento', Number(metrics.candidatos_analisando || 0)],
    ['Erros nas últimas 24h', Number(metrics.erros_24h || 0)],
  ];
  el.monitorHealth.innerHTML = health.map(([label,value]) => `<div class="health-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const followups = data.followups || [];
  el.monitorFollowups.innerHTML = followups.length ? followups.map((item) => `<button class="compact-item" data-action="open-candidate" data-id="${item.candidato_id}" type="button"><span class="compact-avatar">${Number(item.tentativa || 0)}</span><span><strong>${escapeHtml(item.candidato_nome)}</strong><small>${escapeHtml(stageLabels[item.etapa] || item.etapa)} · ${escapeHtml(item.status)}</small></span><time>${escapeHtml(formatDate(item.enviado_em, {dateOnly:true}))}</time></button>`).join('') : emptyState('Nenhum follow-up enviado.');
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
  const target = event.target.closest('[data-action], [data-vacancy-action], [data-candidate-action], [data-monitor-action], [data-go-view], [data-audit-open], [data-audit-candidate-profile], [data-template-apply], [data-template-edit], [data-template-duplicate], [data-template-delete], [data-audit-toggle], [data-audit-rescue-candidate], [data-review-decision], [data-calendar-date], [data-dashboard-calendar-date], [data-document-toggle], [data-document-reprocess]');
  if (!target) return;
  if (target.dataset.goView) return setView(target.dataset.goView);
  if (target.dataset.documentToggle) {
    const key = String(target.dataset.documentToggle);
    if (state.expandedDocumentCandidates.has(key)) state.expandedDocumentCandidates.delete(key);
    else state.expandedDocumentCandidates.add(key);
    renderDocuments();
    return;
  }
  if (target.dataset.documentReprocess) return reprocessDocumentCandidate(target.dataset.documentReprocess);
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
  if (target.dataset.monitorAction === 'resolve-error') return resolveWorkflowError(target.dataset.id);
  if (target.dataset.auditCandidateProfile) return openAuditCandidateProfile(target.dataset.auditCandidateProfile);
  if (target.dataset.auditToggle) { const group=document.querySelector(`[data-audit-group="${target.dataset.auditToggle}"]`); if(group){ const collapsed=group.classList.toggle('is-collapsed'); target.setAttribute('aria-expanded', String(!collapsed)); } return; }
  if (target.dataset.auditRescueCandidate) return sendCandidateToRescue(target.dataset.auditRescueCandidate);
  if (target.dataset.reviewDecision) return decideReview(target.dataset.id, target.dataset.reviewDecision);
  if (target.dataset.calendarDate) { state.calendarSelectedDate=target.dataset.calendarDate; renderInterviews(); return; }
  if (target.dataset.dashboardCalendarDate) { state.dashboardCalendarSelectedDate=target.dataset.dashboardCalendarDate; renderDashboardMiniCalendar(); return; }
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
  if (state.activeView === 'vacancies') return openVacancyDialog();
  if (state.activeView === 'candidates') return openNewCandidateDialog();
  if (state.activeView === 'audit') return syncAudit();
  if (state.activeView === 'divulgacao') return window.GenesisDivulgacaoV1?.focusCreate();
  if (state.activeView === 'reviews') return loadReviews(true);
  if (state.activeView === 'prospecting') return window.GenesisAdmin?.focusNewProspecting();
  if (state.activeView === 'brands') return window.GenesisOperationsV14?.loadBrands(true);
  if (state.activeView === 'demos') return window.GenesisDemos?.focusCreate();
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
  document.body.dataset.userRole = role;
  document.querySelectorAll('.nav-item[data-admin-only]').forEach((item) => item.classList.toggle('hidden', role !== 'ADMIN'));
  document.querySelectorAll('[data-admin-only]').forEach((item) => {
    if (item.classList.contains('nav-item')) return;
    if (item.classList.contains('view')) {
      if (role !== 'ADMIN') item.classList.add('hidden');
      return;
    }
    item.classList.toggle('hidden', role !== 'ADMIN');
  });
  if (role !== 'ADMIN' && ['audit', 'prospecting', 'publications', 'monitoring', 'demos', 'brands', 'users'].includes(state.activeView)) setView('dashboard');
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
  el.vacancyCompanyFilter.addEventListener('change', (event) => {
    state.vacancyCompany = event.target.value;
    renderVacancies();
  });
  el.vacancyLocationFilter.addEventListener('change', (event) => {
    state.vacancyLocation = event.target.value;
    renderVacancies();
  });
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
  el.auditCategoryFilter?.addEventListener('change', () => loadAudit(true));
  el.auditStatusFilter?.addEventListener('change', () => loadAudit(true));
  el.auditGroupMode?.addEventListener('change', () => { state.auditGroupMode = el.auditGroupMode.value; renderAudit(); });
  el.auditSearchInput?.addEventListener('input', () => { clearTimeout(state.auditSearchTimer); state.auditSearchTimer = setTimeout(() => loadAudit(true), 300); });
  el.closeAuditProblemButton?.addEventListener('click', () => el.auditProblemDialog.close());
  el.sendAuditCandidateToRescueButton?.addEventListener('click', () => { const problem=state.selectedAuditProblem; if(problem) sendCandidateToRescue(problem.candidato_id, problem.id); });
  el.dashboardCalendarPrevButton?.addEventListener('click', () => moveDashboardCalendarMonth(-1));
  el.dashboardCalendarNextButton?.addEventListener('click', () => moveDashboardCalendarMonth(1));
  el.dashboardCalendarTodayButton?.addEventListener('click', () => { state.dashboardCalendarCursor = new Date(); state.dashboardCalendarSelectedDate = localDateKey(new Date()); renderDashboardMiniCalendar(); });
  el.calendarPrevButton?.addEventListener('click', () => moveCalendarMonth(-1));
  el.calendarNextButton?.addEventListener('click', () => moveCalendarMonth(1));
  el.calendarTodayButton?.addEventListener('click', () => { state.calendarCursor=new Date(); state.calendarSelectedDate=localDateKey(new Date()); renderInterviews(); });
  el.reviewSearchInput?.addEventListener('input', renderReviews);
  el.reviewTypeSegments?.addEventListener('click', (event) => { const button=event.target.closest('[data-review-type]'); if(!button)return; state.reviewType=button.dataset.reviewType; el.reviewTypeSegments.querySelectorAll('button').forEach((item)=>item.classList.toggle('active',item===button)); renderReviews(); });
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
  el.candidateVacancyFilter?.addEventListener('change', () => { state.candidateVacancy = el.candidateVacancyFilter.value; el.candidateVacancyFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateStageFilter?.addEventListener('change', () => { state.candidateStage = el.candidateStageFilter.value; el.candidateStageFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateDocumentFilter?.addEventListener('change', () => { state.candidateDocument = el.candidateDocumentFilter.value; el.candidateDocumentFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateInterviewFilter?.addEventListener('change', () => { state.candidateInterview = el.candidateInterviewFilter.value; el.candidateInterviewFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateSexFilter?.addEventListener('change', () => { state.candidateSex = el.candidateSexFilter.value; el.candidateSexFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateReallocationFilter?.addEventListener('change', () => { state.candidateReallocation = el.candidateReallocationFilter.value; el.candidateReallocationFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.clearCandidateFiltersButton?.addEventListener('click', () => {
    state.candidateVacancy = 'TODAS'; state.candidateStage = 'TODAS'; state.candidateDocument = 'TODOS'; state.candidateInterview = 'TODAS'; state.candidateSex = 'TODOS'; state.candidateReallocation = 'TODOS';
    el.candidateVacancyFilter.value = 'TODAS'; el.candidateStageFilter.value = 'TODAS'; el.candidateDocumentFilter.value = 'TODOS'; el.candidateInterviewFilter.value = 'TODAS'; el.candidateSexFilter.value = 'TODOS'; el.candidateReallocationFilter.value = 'TODOS';
    el.candidateSearchInput.value = ''; updateCandidateFilterToggle(); renderCandidates();
  });

  document.addEventListener('toggle', (event) => {
    const current = event.target.closest?.('.table-filter-menu');
    if (!current?.open) return;
    document.querySelectorAll('.table-filter-menu[open]').forEach((item) => { if (item !== current) item.removeAttribute('open'); });
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.table-filter-menu')) return;
    document.querySelectorAll('.table-filter-menu[open]').forEach((item) => item.removeAttribute('open'));
  });

  el.candidateTableMode.addEventListener('click', () => setCandidateMode('table'));
  el.candidateKanbanMode.addEventListener('click', () => setCandidateMode('kanban'));
  el.closeCandidateDrawerButton.addEventListener('click', () => el.candidateDrawer.close());
  document.querySelectorAll('[data-drawer-tab]').forEach((button) => button.addEventListener('click', () => setDrawerTab(button.dataset.drawerTab)));
  el.updateCandidateButton?.addEventListener('click', () => updateCandidate('SOMENTE_CORRECAO'));
  el.continueCandidateButton?.addEventListener('click', () => updateCandidate('CORRIGIR_E_CONTINUAR'));
  el.toggleCandidateAiButton?.addEventListener('click', toggleCandidateAi);
  el.reprocessCandidateCtpsButton?.addEventListener('click', reprocessCandidateCtps);
  el.adminRejectCandidateButton?.addEventListener('click', openAdminRejectForm);
  el.cancelAdminRejectButton?.addEventListener('click', closeAdminRejectForm);
  el.confirmAdminRejectButton?.addEventListener('click', confirmAdminReject);
  el.adminCloseCandidateButton?.addEventListener('click', closeCandidateAdministratively);
  el.adminReopenCandidateButton?.addEventListener('click', reopenCandidateAdministratively);
  el.postInterviewDecision.addEventListener('change', () => {
    const rejected = el.postInterviewDecision.value === 'REPROVADO_POS_ENTREVISTA';
    el.postInterviewReasonField.classList.toggle('hidden', !rejected);
    el.postInterviewReallocatableField.classList.toggle('hidden', !rejected);
  });
  el.savePostInterviewDecisionButton.addEventListener('click', savePostInterviewDecision);
  el.deleteCandidateButton?.addEventListener('click', deleteCandidate);
  el.newCandidateForm.addEventListener('submit', saveNewCandidate);
  el.closeNewCandidateButton.addEventListener('click', () => el.newCandidateDialog.close());
  el.cancelNewCandidateButton.addEventListener('click', () => el.newCandidateDialog.close());

  el.interviewPeriodSegments?.addEventListener('click', (event) => {
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

window.GenesisApp = { api, showToast, escapeHtml, formatMoney, formatDate, formatPhone, badgeClass, emptyState, currentUserIsAdmin, state, setView, loadCurrentView };

async function init() {
  bindEvents();
  syncThemeUi();
  await loadCurrentUser();
  await Promise.allSettled([loadCompanies(), loadCandidates()]);
  await Promise.all([loadDashboard(), loadReviews()]);
  setCandidateMode('table');
}

init().catch((error) => showToast(error.message, 'error'));
