'use strict';

const state = {
  activeView: 'dashboard',
  dashboard: null,
  dashboardPeriod: '30D',
  vacancies: [],
  vacancyTemplates: [],
  selectedVacancyTemplateId: null,
  audit: null,
  selectedAuditProblem: null,
  auditSearchTimer: null,
  auditGroupMode: 'CANDIDATO',
  vacancyPeriod: '1D',
  vacancySummary: null,
  vacancyStatus: 'ATIVA',
  vacancyCompany: 'TODAS',
  vacancyLocation: 'TODOS',
  vacancyMode: 'table',
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
  candidateTalent: 'TODOS',
  candidateDistance: 'TODAS',
  candidateDistanceSort: 'RECENTES',
  candidateActivitySort: 'DESC',
  selectedCandidateIds: new Set(),
  selectedCandidateId: null,
  selectedCandidate: null,
  selectedCandidateExtras: { selectedTags: [] },
  interviews: [],
  interviewPeriod: 'TODAS',
  calendarCursor: new Date(),
  calendarSelectedDate: null,
  calendarMode: 'MONTH',
  reviews: [],
  reviewType: 'TODAS',
  selectedReviewId: null,
  reviewDecision: 'ENCERRAR',
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
  atendimentos: ['CONVERSAS', 'Chats', 'Todas as conversas em ordem de atividade, com leitura e atendimento no mesmo lugar.', 'Atualizar chats'],
  interviews: ['AGENDA', 'Entrevistas', 'Compromissos do processo seletivo sincronizados com o Google Calendar.', 'Atualizar agenda'],
  reviews: ['ATENDIMENTO', 'Revisões', 'Resolva exceções humanas com clareza sobre mensagens e estado da IA.', ''],
  documents: ['ADMINISTRAÇÃO', 'Saúde do sistema', 'Documentos técnicos e falhas que precisam de revisão.', 'Atualizar arquivos'],
  monitoring: ['ADMINISTRAÇÃO', 'Saúde do sistema', 'Saúde das integrações, falhas técnicas e recuperação da operação.', 'Atualizar monitoramento'],
  audit: ['ADMINISTRAÇÃO', 'Auditoria da IA', 'Valide estados, documentos, resgates e agendamentos do fluxo determinístico.', 'Sincronizar'],
  sales: ['COMERCIAL', 'Sales', 'Prospecção manual organizada, sem disparos automáticos.', ''],
  brands: ['ADMINISTRAÇÃO', 'Configurações', 'Identidade das empresas e preferências operacionais.', ''],
  publications: ['ADMINISTRAÇÃO', 'Portal de Vagas', 'Revise vagas recebidas e acompanhe as contas públicas.', ''],
  users: ['ADMINISTRAÇÃO', 'Configurações', 'Gerencie logins e permissões do time interno.', '+ Criar login'],
};

const el = Object.fromEntries([
  'sidebar', 'sidebarBackdrop', 'mobileMenuButton', 'themeToggleButton', 'mobileMoreButton', 'pageEyebrow', 'pageTitle', 'pageSubtitle',
  'globalSearchButton', 'refreshCurrentViewButton', 'primaryActionButton',
  'dashboardReviews', 'reviewPendingCount', 'reviewNavBadge', 'reviewTypeSegments', 'reviewSearchInput', 'reviewsList',
  'reviewDetailPane', 'reviewDetailContent', 'reviewDecisionPane', 'reviewDecisionContent',
  'calendarPrevButton', 'calendarTodayButton', 'calendarNextButton', 'calendarMonthLabel', 'calendarSelectedDayLabel', 'interviewCalendar', 'calendarViewMode',
  'dashboardUpdatedAt', 'kpiCandidatesActive', 'kpiActiveVacancies', 'kpiInterviewsToday', 'kpiHumanPending', 'kpiCritical', 'kpiDocumentFailures', 'kpiStaleCandidates',
  'dashboardPerformanceMetrics', 'dashboardPerformanceChart', 'dashboardVacancyAttentionList',
  'vacancyStatusSegments', 'vacancyPeriodSegments', 'vacancyStatusSelect', 'vacancyPeriodSelect', 'vacancyTableMode', 'vacancyKanbanMode', 'vacanciesKanbanContainer', 'vacancyActiveKpiCard', 'vacancySearchInput', 'vacancyCompanyFilter', 'vacancyLocationFilter', 'vacancyKpiActive', 'vacancyKpiInterested',
  'vacancyKpiInProcess', 'vacancyKpiApproved', 'vacancyKpiTop', 'vacancyKpiTopCount', 'vacanciesLoading', 'vacanciesEmpty',
  'vacanciesTableWrapper', 'vacanciesTableBody', 'candidateStatusSegments', 'candidatePeriodSegments', 'candidatePeriodSelect', 'candidateActivitySortButton', 'candidateSearchInput',
  'candidateFilterToggleButton', 'candidateFilterPanel', 'candidateVacancyFilter', 'candidateStageFilter', 'candidateDocumentFilter', 'candidateInterviewFilter', 'candidateSexFilter', 'candidateReallocationFilter', 'candidateDistanceFilter', 'candidateDistanceSort',
  'candidateKpiTotal', 'candidateKpiProcess',
  'candidateKpiApproved', 'candidateKpiHired', 'candidateKpiRejected', 'candidateTableContainer',
  'candidatesLoading', 'candidatesEmpty', 'candidatesTableWrapper', 'candidatesTableBody', 'sidebarLogoutButton',
  'interviewPeriodSegments', 'interviewsList', 'documentTypeSegments', 'documentSearchInput', 'documentAuditExportButton',
  'documentAuditExportDialog', 'documentAuditResult', 'documentAuditLimit', 'documentAuditVacancy', 'documentAuditStart', 'documentAuditEnd', 'closeDocumentAuditExportButton', 'cancelDocumentAuditExportButton', 'confirmDocumentAuditExportButton',
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
  'candidateVacancy', 'candidateStage', 'candidateCep', 'candidateDistance', 'candidateDistanceHint', 'candidateSex', 'candidateSexSource', 'candidateSexCompatibility', 'candidateInterview', 'candidateMeetLink',
  'candidateTriageSection', 'candidateTriage', 'candidateExperiences', 'candidateRejectionSection',
  'candidateRejectionReason', 'candidateRejectionObservation', 'candidateRejectionCategory', 'candidateReallocationStatus', 'candidatePresentationSection',
  'candidatePresentation', 'candidatePersonalitySection', 'candidatePersonality',
  'candidatePersonalityTags', 'candidateCtpsMetrics', 'candidateCtpsDocumentActions',
  'candidateStatusSelect', 'candidateStageSelect', 'updateCandidateButton', 'continueCandidateButton', 'candidateCorrectionReason', 'candidateCorrectionPreview',
  'candidateAiStatusBadge', 'candidateAiStatusText', 'toggleCandidateAiButton', 'reprocessCandidateCtpsButton',
  'openCtpsManualReviewButton', 'ctpsManualReviewDialog', 'ctpsManualReviewForm', 'ctpsManualReviewTitle', 'ctpsManualReviewSubtitle', 'ctpsManualReviewSummary', 'ctpsManualDecision', 'ctpsManualReasonField', 'ctpsManualReason', 'ctpsManualObservation', 'ctpsManualReallocatableField', 'ctpsManualReallocatable', 'ctpsManualNotify', 'closeCtpsManualReviewButton', 'cancelCtpsManualReviewButton', 'saveCtpsManualReviewButton',
  'adminRejectCandidateButton', 'adminCloseCandidateButton', 'adminReopenCandidateButton',
  'adminRejectCandidateForm', 'adminRejectReason', 'adminRejectObservation', 'adminRejectReallocatable', 'adminRejectSendMessage',
  'cancelAdminRejectButton', 'confirmAdminRejectButton',
  'postInterviewDecisionSection', 'postInterviewDecision', 'postInterviewReasonField', 'postInterviewReason', 'postInterviewReallocatableField', 'postInterviewReallocatable',
  'postInterviewObservation', 'savePostInterviewDecisionButton',
  'candidateConversation', 'candidateDocuments', 'candidateTimeline',
  'documentPreviewDialog', 'documentPreviewTitle', 'documentPreviewSubtitle', 'documentPreviewFrame', 'documentPreviewDownload', 'closeDocumentPreviewButton',
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
    { re: /(auxiliar de limpeza|limpeza|servicos gerais|serviços gerais|conservacao|conservação|faxina|higienizacao|higienização|asseio)/, cargo: 'Auxiliar de Limpeza', cargos: 'Auxiliar de Limpeza\nServente de Limpeza\nFaxineiro\nAgente de Limpeza\nAgente de Asseio e Conservação\nAgente de Higienização\nLimpador de Vidros\nLimpador de Fachadas\nAuxiliar de Serviços Gerais', cbos: '5143-20\n5143-05\n5143-15\n5142-25' },
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

function confirmAction({title='Confirmar ação',message='',detail='',confirmLabel='Confirmar',tone='primary',inputLabel='',inputValue='',inputRequired=false}={}) {
  let dialog=document.getElementById('genesisConfirmDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='genesisConfirmDialog';dialog.className='genesis-confirm-dialog';document.body.appendChild(dialog);}
  dialog.innerHTML=`<form method="dialog"><div class="genesis-confirm-icon ${tone}">${tone==='danger'?'!':'✓'}</div><div class="genesis-confirm-copy"><p class="eyebrow">CONFIRMAÇÃO</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${detail?`<div class="genesis-confirm-detail">${escapeHtml(detail)}</div>`:''}${inputLabel?`<label class="field"><span>${escapeHtml(inputLabel)}</span><textarea id="genesisConfirmInput" rows="3" maxlength="1000">${escapeHtml(inputValue)}</textarea></label>`:''}</div><footer><button value="cancel" class="button button-ghost" type="submit">Cancelar</button><button value="confirm" class="button ${tone==='danger'?'button-danger':'button-primary'}" type="submit">${escapeHtml(confirmLabel)}</button></footer></form>`;
  return new Promise((resolve)=>{
    const finish=(confirmed)=>{const value=String(dialog.querySelector('#genesisConfirmInput')?.value||'').trim();if(confirmed&&inputRequired&&!value){showToast(`Informe ${inputLabel.toLocaleLowerCase('pt-BR')}.`,'error');dialog.querySelector('#genesisConfirmInput')?.focus();return;}dialog.close();resolve({confirmed,value});};
    dialog.oncancel=(event)=>{event.preventDefault();finish(false);};
    dialog.querySelector('form').onsubmit=(event)=>{event.preventDefault();finish(event.submitter?.value==='confirm');};
    dialog.showModal();window.setTimeout(()=>dialog.querySelector('#genesisConfirmInput')?.focus(),50);
  });
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
  const legacyViewRedirects = { crm: 'sales', prospecting: 'sales', commercialChats: 'sales', demos: 'sales', divulgacao: 'vacancies' };
  name = legacyViewRedirects[name] || name;
  if (!currentUserIsAdmin() && ['audit', 'sales', 'publications', 'monitoring', 'documents', 'brands', 'users'].includes(name)) name = 'dashboard';
  state.activeView = name;
  document.body.dataset.activeView = name;
  const groupByView = {
    dashboard: 'recruitmentNavGroup', vacancies: 'recruitmentNavGroup', candidates: 'recruitmentNavGroup',
    interviews: 'recruitmentNavGroup',
    atendimentos: 'conversationsNavGroup', reviews: 'conversationsNavGroup',
    sales: 'commercialNavGroup',
    publications: 'administrationNavGroup', brands: 'administrationNavGroup', monitoring: 'administrationNavGroup', documents: 'administrationNavGroup', audit: 'administrationNavGroup', users: 'administrationNavGroup',
  };
  const activeGroup = document.getElementById(groupByView[name]);
  if (activeGroup) activeGroup.open = true;
  if (name === 'reviews') document.getElementById('view-reviews')?.setAttribute('data-review-mobile-pane', 'queue');
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  document.querySelectorAll('[data-mobile-view]').forEach((button) => button.classList.toggle('active', button.dataset.mobileView === name));
  const meta = viewMeta[name] || viewMeta.dashboard;
  el.pageEyebrow.textContent = meta[0];
  el.pageTitle.textContent = meta[1];
  el.pageSubtitle.textContent = meta[2];
  el.primaryActionButton.textContent = meta[3] || '';
  el.primaryActionButton.classList.toggle('hidden', !meta[3]);
  el.refreshCurrentViewButton?.classList.toggle('hidden', name === 'reviews');
  el.dashboardUpdatedAt?.classList.toggle('hidden', name !== 'dashboard');
  el.sidebar.classList.remove('open');
  window.scrollTo(0, 0);
  loadCurrentView();
}

async function loadCurrentView(force = false) {
  try {
    if (state.activeView === 'dashboard') await loadDashboard(force);
    if (state.activeView === 'vacancies') await loadVacancies(force);
    if (state.activeView === 'candidates') await loadCandidates(force);
    if (state.activeView === 'atendimentos') await window.GenesisConversationsV164?.load(force);
    if (state.activeView === 'interviews') await loadInterviews(force);
    if (state.activeView === 'reviews') await loadReviews(force);
    if (state.activeView === 'documents') await loadDocuments(force);
    if (state.activeView === 'monitoring') await loadMonitoring(force);
    if (state.activeView === 'audit') await loadAudit(force);
    if (state.activeView === 'brands') await window.GenesisOperationsV14?.loadBrands(force);
    if (state.activeView === 'publications') await window.GenesisPortalPublicacoes?.load(force);
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

function dashboardComparison(current, previous, inverse = false) {
  const value = Number(current || 0);
  const baseline = Number(previous || 0);
  if (!baseline) return { label: 'Sem base anterior', tone: 'neutral' };
  const variation = Math.round(((value - baseline) / baseline) * 100);
  const beneficial = inverse ? variation <= 0 : variation >= 0;
  return {
    label: `${variation > 0 ? '+' : ''}${variation}% vs. período anterior`,
    tone: beneficial ? 'positive' : 'negative',
  };
}

function renderDashboardPerformance(summary = {}) {
  if (!el.dashboardPerformanceMetrics) return;
  const metrics = [
    { value: Number(summary.novos || 0), label: 'novos candidatos', comparison: dashboardComparison(summary.novos, summary.novos_anterior) },
    { value: Number(summary.aprovados || 0), label: 'aprovados na triagem', comparison: dashboardComparison(summary.aprovados, summary.aprovados_anterior) },
    { value: Number(summary.entrevistas || 0), label: 'entrevistas', comparison: dashboardComparison(summary.entrevistas, summary.entrevistas_anterior) },
    { value: Number(summary.contratacoes || 0), label: 'contratações', comparison: dashboardComparison(summary.contratacoes, summary.contratacoes_anterior) },
    { value: `${Number(summary.primeira_analise_minutos || 0)} min`, label: 'primeira análise', comparison: { label: 'mediana do período', tone: 'neutral' } },
    { value: `${Number(summary.comparecimento || 0)}%`, label: 'comparecimento', comparison: { label: 'entrevistas realizadas', tone: 'neutral' } },
  ];
  el.dashboardPerformanceMetrics.innerHTML = metrics.map((item) => `<article><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span><small class="${item.comparison.tone}">${escapeHtml(item.comparison.label)}</small></article>`).join('');
}

function renderDashboardVacancies(items = []) {
  if (!el.dashboardVacancyAttentionList) return;
  if (!items.length) {
    el.dashboardVacancyAttentionList.innerHTML = emptyState('Nenhuma vaga ativa', 'As vagas que precisarem de atenção aparecerão aqui.');
    return;
  }
  el.dashboardVacancyAttentionList.innerHTML = items.map((item) => {
    const reviews = Number(item.revisoes_pendentes || 0);
    const unanswered = Number(item.sem_retorno || 0);
    const analysis = Number(item.em_analise || 0);
    const interviews = Number(item.entrevistas || 0);
    const stalledDays = Number(item.dias_sem_avanco || 0);
    const attention = reviews > 0 || unanswered > 0 || stalledDays >= 2 || analysis >= 15;
    const reason = reviews > 0
      ? `${reviews} aguardando análise`
      : unanswered > 0
        ? `${unanswered} sem retorno`
      : stalledDays >= 2
        ? `${stalledDays} dias sem avanço`
        : analysis > 0
          ? `${analysis} em análise`
          : interviews > 0 ? `${interviews} entrevistas agendadas` : 'Fluxo dentro do esperado';
    const lastAdvance = item.ultimo_avanco ? (stalledDays === 0 ? 'Hoje' : stalledDays === 1 ? 'Há 1 dia' : `Há ${stalledDays} dias`) : 'Sem avanço';
    return `<article class="dashboard-vacancy-attention-row ${attention ? 'attention' : 'healthy'}">
      <strong>${escapeHtml(item.vaga_nome || 'Vaga sem título')}</strong>
      <span class="dashboard-vacancy-reason"><i aria-hidden="true"></i>${escapeHtml(reason)}</span>
      <span data-label="Último avanço">${escapeHtml(lastAdvance)}</span>
      <span data-label="Responsável">${escapeHtml(item.responsavel || state.currentUser?.nome || 'Recrutamento')}</span>
      <button data-vacancy-action="view" data-id="${escapeHtml(item.id)}" type="button">Ver vaga</button>
    </article>`;
  }).join('');
}

function drawDashboardPerformanceChart(points = []) {
  const canvas = el.dashboardPerformanceChart;
  if (!canvas || !points.length) return;
  const wrapper = canvas.parentElement;
  const width = Math.max(280, Math.floor(wrapper.clientWidth || 900));
  const height = window.matchMedia('(max-width: 720px)').matches ? 210 : 250;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const dark = document.documentElement.dataset.theme === 'dark';
  const colors = { grid: dark ? '#24414a' : '#dce6e8', text: dark ? '#9eb0ba' : '#64748b', candidates: '#0ea89a', interviews: dark ? '#80a7c8' : '#173e67', hires: '#95a1aa', previous: dark ? '#5d7f88' : '#93a6ad' };
  const padding = { top: 18, right: 12, bottom: 30, left: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(5, ...points.flatMap((point) => [Number(point.candidaturas || 0), Number(point.entrevistas || 0), Number(point.contratacoes || 0), Number(point.candidaturas_periodo_anterior || 0)]));
  const roundedMaximum = Math.ceil(maximum / 5) * 5;
  context.clearRect(0, 0, width, height);
  context.font = '10px Inter, system-ui, sans-serif';
  context.fillStyle = colors.text;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let step = 0; step <= 4; step += 1) {
    const value = Math.round((roundedMaximum / 4) * step);
    const y = padding.top + chartHeight - (chartHeight * step / 4);
    context.beginPath();
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(value), padding.left - 8, y);
  }
  const xAt = (index) => padding.left + (points.length === 1 ? chartWidth / 2 : (chartWidth * index / (points.length - 1)));
  const yAt = (value) => padding.top + chartHeight - (Number(value || 0) / roundedMaximum) * chartHeight;
  const line = (key, color, dashed = false) => {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = key === 'candidaturas' ? 2.4 : 2;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.setLineDash(dashed ? [5, 5] : []);
    points.forEach((point, index) => {
      const x = xAt(index); const y = yAt(point[key]);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  };
  line('candidaturas_periodo_anterior', colors.previous, true);
  line('candidaturas', colors.candidates);
  line('entrevistas', colors.interviews);
  line('contratacoes', colors.hires);
  context.setLineDash([]);
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  labelIndexes.forEach((index) => {
    const date = new Date(`${String(points[index].dia).slice(0, 10)}T12:00:00`);
    context.fillText(new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date), xAt(index), height - 19);
  });
}

function renderDashboard() {
  const data = state.dashboard || {};
  const metrics = data.metricas || {};

  if (el.dashboardUpdatedAt) el.dashboardUpdatedAt.textContent = `Atualizado ${formatRelativeTime(data.atualizado_em)}`;
  if (el.kpiCandidatesActive) el.kpiCandidatesActive.textContent = Number(metrics.total_candidatos || 0);
  el.kpiActiveVacancies.textContent = Number(metrics.vagas_ativas || 0);
  el.kpiInterviewsToday.textContent = Number(metrics.entrevistas_hoje || 0);
  el.kpiHumanPending.textContent = Number(metrics.pendencias_humanas || 0);
  if (el.kpiDocumentFailures) el.kpiDocumentFailures.textContent = Number(metrics.documentos_falha || 0);
  if (el.kpiStaleCandidates) el.kpiStaleCandidates.textContent = Number(metrics.sem_resposta_2h || 0);
  if (el.kpiCritical) el.kpiCritical.textContent = Number(metrics.documentos_falha || 0) + Number(metrics.sem_resposta_2h || 0);

  document.querySelectorAll('[data-dashboard-period]').forEach((button) => button.classList.toggle('active', button.dataset.dashboardPeriod === state.dashboardPeriod));
  renderDashboardPerformance(data.desempenho?.resumo || {});
  renderDashboardVacancies(data.vagas_atencao || []);
  requestAnimationFrame(() => drawDashboardPerformanceChart(data.desempenho?.tendencia || []));
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
  if (el.vacancyCompanyFilter) el.vacancyCompanyFilter.innerHTML = `<option value="TODAS">Todas</option>${companies.map((item) => `<option value="${escapeHtml(item)}" ${item === state.vacancyCompany ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  if (el.vacancyLocationFilter) el.vacancyLocationFilter.innerHTML = `<option value="TODOS">Todos</option>${locations.map((item) => `<option value="${escapeHtml(item)}" ${item === state.vacancyLocation ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
}

function filteredVacancies() {
  const q = String(el.vacancySearchInput?.value || '').trim().toLocaleLowerCase('pt-BR');
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
  if (el.vacancyKpiTop) el.vacancyKpiTop.textContent = state.vacancySummary?.vaga_mais_escolhida_nome || 'Sem dados no período';
  const topCount = Number(state.vacancySummary?.vaga_mais_escolhida_quantidade || 0);
  if (el.vacancyKpiTopCount) el.vacancyKpiTopCount.textContent = `${topCount} escolha${topCount === 1 ? '' : 's'} em ${state.vacancyPeriod}`;

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
    el.vacanciesKanbanContainer?.classList.add('hidden');
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
  renderVacancyKanban(vacancies);
  setVacancyMode(state.vacancyMode);
}

function renderVacancyKanban(vacancies) {
  if (!el.vacanciesKanbanContainer) return;
  el.vacanciesKanbanContainer.innerHTML = vacancies.map((item) => {
    const op = vacancyOperationalData(item);
    const location = [item.bairro, item.cidade, item.estado].filter(Boolean).join(' · ') || 'Local não informado';
    return `<article class="vacancy-grid-card">
      <header><div><span class="badge ${badgeClass(item.status)}">${escapeHtml(vacancyStatusLabels[item.status] || item.status)}</span><small>${escapeHtml(item.codigo || '')}</small></div><button class="icon-button compact" data-vacancy-action="view" data-id="${item.id}" type="button" aria-label="Abrir ${escapeHtml(item.titulo || item.cargo)}"><span data-icon="chevron-right"></span></button></header>
      <button class="vacancy-grid-card-title" data-vacancy-action="view" data-id="${item.id}" type="button">${escapeHtml(item.titulo || item.cargo)}</button>
      <p>${escapeHtml(item.empresa_nome || 'Empresa não informada')}</p><span>${escapeHtml(location)}</span>
      <div class="vacancy-grid-card-metrics"><span><strong>${Number(item.total_interessados || 0)}</strong><small>Candidatos</small></span><span><strong>${Number(item.candidatos_novos || 0)}</strong><small>Novos</small></span><span><strong>${Number(item.candidatos_entrevista || 0)}</strong><small>Entrevistas</small></span></div>
      <footer class="${op.tone}"><span class="priority-icon">${op.icon}</span><strong>${escapeHtml(op.message)}</strong></footer>
    </article>`;
  }).join('');
}

function setVacancyMode(mode) {
  state.vacancyMode = ['kanban', 'cards'].includes(mode) ? 'cards' : 'table';
  el.vacancyTableMode?.classList.toggle('active', state.vacancyMode === 'table');
  el.vacancyKanbanMode?.classList.toggle('active', state.vacancyMode === 'cards');
  el.vacanciesTableWrapper?.classList.toggle('hidden', state.vacancyMode !== 'table');
  el.vacanciesKanbanContainer?.classList.toggle('hidden', state.vacancyMode !== 'cards');
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
  await window.GenesisGeoV1?.prepareVacancyDialog?.(vacancy, duplicate);
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
    let geoWarning = '';
    try {
      await window.GenesisGeoV1?.saveVacancyGeo?.(result.vaga.id);
    } catch (geoError) {
      geoWarning = geoError.message || 'Não foi possível atualizar o CEP da vaga.';
      console.warn('[GEO V1] Vaga principal salva; geolocalização pendente:', geoWarning);
    }
    el.vacancyDialog.close();
    showToast(geoWarning ? `${result.mensagem || 'Vaga salva.'} CEP: ${geoWarning}` : (result.mensagem || 'Vaga salva.'), geoWarning ? 'warning' : undefined);
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
  window.GenesisGeoV1?.afterCandidatesLoaded?.();
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
    candidateDistanceFilter: state.candidateDistance !== 'TODAS',
    candidateDistanceSort: state.candidateDistanceSort !== 'RECENTES',
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
    state.candidateDistance !== 'TODAS',
    state.candidateDistanceSort !== 'RECENTES',
  ].filter(Boolean).length;
  el.candidateFilterToggleButton.textContent = count ? `Filtros (${count})` : 'Filtros';
  el.candidateFilterToggleButton.classList.toggle('has-active-filters', count > 0);
}

function candidateMatches(candidate, ignoreStatus = false) {
  const q = String(el.candidateSearchInput.value || '').trim().toLocaleLowerCase('pt-BR');
  const status = String(candidate.status || '').toUpperCase();
  const statusMatch = ignoreStatus || state.candidateStatus === 'TODOS'
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
  const talentMatch = state.candidateTalent === 'TODOS'
    || (state.candidateTalent === 'ACEITOU' && candidate.banco_talentos_aceite === true)
    || (state.candidateTalent === 'NAO_ACEITOU' && candidate.banco_talentos_aceite === false);
  const hasDistance = candidate.distancia_km !== null && candidate.distancia_km !== undefined && candidate.distancia_km !== '' && Number.isFinite(Number(candidate.distancia_km));
  const distance = hasDistance ? Number(candidate.distancia_km) : null;
  const distanceMatch = state.candidateDistance === 'TODAS'
    || (state.candidateDistance === 'ATE_5' && hasDistance && distance <= 5)
    || (state.candidateDistance === 'ATE_10' && hasDistance && distance <= 10)
    || (state.candidateDistance === 'ATE_15' && hasDistance && distance <= 15)
    || (state.candidateDistance === 'ATE_25' && hasDistance && distance <= 25)
    || (state.candidateDistance === 'ATE_50' && hasDistance && distance <= 50)
    || (state.candidateDistance === 'ACIMA_50' && hasDistance && distance > 50)
    || (state.candidateDistance === 'INDISPONIVEL' && !hasDistance);
  const haystack = [candidate.nome, candidate.telefone, candidate.vaga_nome, candidate.vaga_codigo, candidate.etapa].join(' ').toLocaleLowerCase('pt-BR');
  return statusMatch && vacancyMatch && stageMatch && documentMatch && interviewMatch && sexMatch && reallocationMatch && talentMatch && distanceMatch && candidatePeriodMatches(candidate) && (!q || haystack.includes(q));
}

function renderCandidates() {
  const baseCandidates = state.candidates.filter((candidate) => candidateMatches(candidate, true));
  const candidates = baseCandidates.filter(candidateMatches);
  if (state.candidateDistanceSort === 'PROXIMIDADE') {
    candidates.sort((a, b) => {
      const va = a.distancia_km !== null && a.distancia_km !== undefined && a.distancia_km !== '' && Number.isFinite(Number(a.distancia_km));
      const vb = b.distancia_km !== null && b.distancia_km !== undefined && b.distancia_km !== '' && Number.isFinite(Number(b.distancia_km));
      const da = va ? Number(a.distancia_km) : null; const db = vb ? Number(b.distancia_km) : null;
      if (va && vb) return da - db;
      if (va) return -1;
      if (vb) return 1;
      return 0;
    });
  } else {
    const direction = state.candidateActivitySort === 'ASC' ? 1 : -1;
    candidates.sort((a, b) => direction * (new Date(a.updated_at || 0) - new Date(b.updated_at || 0)));
  }
  const count = (predicate) => baseCandidates.filter(predicate).length;
  el.candidateKpiTotal.textContent = baseCandidates.length;
  el.candidateKpiProcess.textContent = count((item) => ['NOVO', 'EM_PROCESSO'].includes(String(item.status || '').toUpperCase()));
  el.candidateKpiApproved.textContent = count((item) => String(item.status || '').toUpperCase() === 'APROVADO');
  el.candidateKpiHired.textContent = count((item) => String(item.status || '').toUpperCase() === 'CONTRATADO');
  el.candidateKpiRejected.textContent = count((item) => String(item.status || '').toUpperCase() === 'REPROVADO');
  document.querySelectorAll('[data-candidate-kpi-filter]').forEach((card) => card.classList.toggle('active-filter', card.dataset.candidateKpiFilter === state.candidateStatus));
  el.candidatesLoading.classList.add('hidden');

  updateCandidateFilterToggle();
  renderCandidateTable(candidates);
  syncCandidateBulkUi(candidates);
}

function syncCandidateBulkUi(visibleCandidates = state.candidates.filter(candidateMatches)) {
  const visibleIds = visibleCandidates.map((candidate) => String(candidate.id));
  const selectedVisible = visibleIds.filter((id) => state.selectedCandidateIds.has(id));
  const bar = document.getElementById('candidateBulkBar');
  const count = document.getElementById('candidateBulkCount');
  const selectAll = document.getElementById('candidateSelectAll');
  bar?.classList.toggle('hidden', state.selectedCandidateIds.size === 0);
  if (count) count.textContent = String(state.selectedCandidateIds.size);
  if (selectAll) {
    selectAll.checked = Boolean(visibleIds.length && selectedVisible.length === visibleIds.length);
    selectAll.indeterminate = Boolean(selectedVisible.length && selectedVisible.length < visibleIds.length);
  }
}

function candidateHumanServiceBadge(candidate) {
  const paused = candidate.ia_atendimento_ativo === false || candidate.atendimento_humano_ativo === true;
  if (!paused) return '';
  const who = String(candidate.ultima_mensagem_quem || '').toUpperCase();
  let text = 'Aguardando atendimento';
  let cls = 'badge-warning';
  if (candidate.atendimento_humano_ativo === true && ['USUARIO','CANDIDATO'].includes(who)) { text = 'Aguardando recrutador'; cls = 'badge-rejected'; }
  else if (candidate.atendimento_humano_ativo === true && ['RECRUTADOR','IA'].includes(who)) { text = 'Aguardando candidato'; cls = 'badge-approved'; }
  const owner = candidate.atendimento_responsavel_nome || candidate.atendimento_humano_nome || '';
  return `<span class="badge ${cls} ai-paused-mini atendimento-inline-status" title="${escapeHtml(owner ? `Responsável: ${owner}` : 'Sem responsável')}">${escapeHtml(text)}</span>`;
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
    const interviewClass = c.entrevista_inicio ? '' : ' pending';
    const lastActivity = formatRelativeTime(c.updated_at);
    const selected = state.selectedCandidateIds.has(String(c.id));
    return `<tr data-candidate-row="${c.id}" class="${selected ? 'is-selected' : ''}" tabindex="0" role="button" aria-label="Abrir perfil de ${escapeHtml(c.nome || 'candidato')}">
      <td class="candidate-select-column"><input data-candidate-select="${c.id}" type="checkbox" ${selected ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(c.nome || 'candidato')}"></td>
      <td><div class="candidate-person-cell"><span class="candidate-row-avatar">${escapeHtml(initials(c.nome || c.telefone))}</span><div class="candidate-person-copy"><strong>${escapeHtml(c.nome || 'Nome não informado')}</strong><span>${escapeHtml(formatPhone(c.telefone))}</span></div></div></td>
      <td><div class="candidate-vacancy-cell"><strong>${escapeHtml(c.vaga_nome || c.vaga_legacy || 'Não vinculada')}</strong><span>${escapeHtml(c.vaga_codigo || 'Sem código')}</span></div></td>
      <td><span class="candidate-stage-text">${escapeHtml(stageLabels[c.etapa] || c.etapa || 'Etapa não informada')}</span></td>
      <td><div class="candidate-status-stack"><span class="badge ${badgeClass(c.status)}">${escapeHtml(statusLabels[c.status] || c.status || 'Não informado')}</span>${candidateHumanServiceBadge(c)}</div></td>
      <td><span class="candidate-activity">${escapeHtml(lastActivity)}</span><small class="candidate-activity-detail">${docs} documento${docs === 1 ? '' : 's'} · ${escapeHtml(interview)}</small></td>
      <td><div class="candidate-row-actions"><button class="icon-button" data-candidate-action="open" data-id="${c.id}" type="button" aria-label="Abrir perfil">•••</button></div></td>
    </tr>`;
  }).join('');
}

async function openCandidate(id, initialTab = '') {
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
    if (initialTab) setDrawerTab(initialTab);
  } catch (error) {
    el.candidateDrawerLoading.innerHTML = emptyState('Não foi possível carregar', error.message);
  }
}

function updateCandidateDistanceSummary(candidate) {
  const candidateGeo = window.GenesisGeoV1?.renderCandidateDistance?.(candidate);
  if (el.candidateDistance) el.candidateDistance.textContent = candidateGeo?.km !== null && candidateGeo?.km !== undefined ? window.GenesisGeoV1.formatKm(candidateGeo.km) : 'Indisponível';
  if (el.candidateDistanceHint) {
    const geoStatus = candidateGeo?.geo?.geo_status;
    el.candidateDistanceHint.textContent = candidateGeo?.hint || (geoStatus === 'SEM_CEP_VAGA' ? 'Cadastre o CEP da vaga para calcular.' : geoStatus === 'SEM_CEP_CANDIDATO' ? 'Candidato sem CEP válido.' : geoStatus === 'SEM_VAGA' ? 'Candidato sem vaga vinculada.' : 'Distância aproximada ainda indisponível.');
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
  updateCandidateDistanceSummary(c);
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
  const talentDecided = c.banco_talentos_decidido_em != null;
  const talentAccepted = c.banco_talentos_aceite === true;
  document.getElementById('candidateTalentDecision').textContent = !talentDecided ? 'Ainda não respondeu' : talentAccepted ? 'Sim' : 'Não';
  document.getElementById('candidateTalentBadge').textContent = !talentDecided ? 'Sem decisão' : talentAccepted ? 'Aceitou' : 'Não aceitou';
  document.getElementById('candidateTalentMeta').textContent = talentDecided ? `${formatDate(c.banco_talentos_decidido_em)} · ${c.banco_talentos_origem || 'Origem não informada'}` : 'A Evelyn perguntará uma única vez após o processo, quando adequado.';
  document.getElementById('candidateTalentRevokeButton')?.classList.toggle('hidden', !isAdmin || !talentAccepted);
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
    ? `${latestCtps.disponivel_download ? `<button class="button button-ghost" data-document-preview="${latestCtps.id}" data-document-name="${escapeHtml(latestCtps.nome_exibicao || 'CTPS')}" type="button">👁 Visualizar CTPS</button><a class="button button-ghost" href="/api/documentos/${latestCtps.id}/download">⬇ Baixar</a>` : '<span class="helper-text">Arquivo da CTPS sem visualização disponível.</span>'}`
    : '<span class="helper-text">Nenhuma CTPS armazenada foi localizada.</span>';
  el.openCtpsManualReviewButton?.classList.toggle('hidden', !isAdmin || !latestCtps);

  const experiences = Array.isArray(c.experiencias_ctps) ? c.experiencias_ctps : [];
  el.candidateExperiences.innerHTML = experiences.length ? experiences.map((item) => {
    const matchClass = String(item.classificacao_match || '').toUpperCase();
    const isReview = matchClass === 'REVISAO' || item.revisao === true;
    const isCompatible = matchClass === 'COMPATIVEL' || (!matchClass && item.compativel === true);
    const matchLabel = isReview ? '⚠️ Revisão' : isCompatible ? '✅ Compatível' : '❌ Não compatível';
    const reason = item.motivo_match ? `<small class="ctps-match-reason">${escapeHtml(item.motivo_match)}</small>` : '';
    const days = Number(item.dias || 0);
    const daysText = days > 0 ? ` · ${days} dia${days === 1 ? '' : 's'}` : '';
    return `<article class="experience-item"><div><strong>${escapeHtml(item.cargo || 'Cargo não informado')}</strong><span>${escapeHtml(item.empregador || 'Empregador não informado')}</span><small>${escapeHtml(item.periodo || 'Período não informado')} · ${escapeHtml(item.cbo ? `CBO ${item.cbo}` : 'CBO não informado')}${escapeHtml(daysText)}</small>${reason}</div><span class="ctps-match-status ${isReview ? 'review' : isCompatible ? 'compatible' : 'incompatible'}">${matchLabel}</span></article>`;
  }).join('') : '<div class="empty-state compact">Nenhum vínculo válido extraído.</div>';

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
  renderCandidateDocuments(details.documentos || []);
  if (isAdmin) renderCandidateTimeline(details.timeline || []);
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
    <article class="document-card"><div class="document-icon">PDF</div><div><strong>${escapeHtml(doc.titulo || doc.tipo || 'Documento')}</strong><span>${escapeHtml(doc.nome_exibicao || doc.nome_arquivo || 'Arquivo')}</span><small>${escapeHtml(formatFileSize(doc.tamanho_bytes))} · ${escapeHtml(formatDate(doc.created_at))}</small></div><footer><span class="document-type ${String(doc.tipo || '').toLowerCase()}">${escapeHtml(doc.tipo || 'OUTRO')}</span>${doc.disponivel_download ? `<button class="button button-ghost" data-document-preview="${doc.id}" data-document-name="${escapeHtml(doc.nome_exibicao || doc.titulo || 'Documento')}" type="button">👁 Visualizar</button><a class="button button-ghost" href="/api/documentos/${doc.id}/download">⬇ Baixar</a>` : '<span>Arquivo indisponível</span>'}</footer></article>
  `).join('') : emptyState('Nenhum documento registrado.');
}

function openDocumentPreview(documentId, documentName = 'Documento') {
  if (!el.documentPreviewDialog || !el.documentPreviewFrame) return;
  const id = Number(documentId);
  if (!Number.isInteger(id) || id <= 0) return;
  const name = String(documentName || 'Documento');
  el.documentPreviewTitle.textContent = name;
  el.documentPreviewSubtitle.textContent = 'Visualização no painel · use Baixar somente se precisar salvar uma cópia.';
  el.documentPreviewFrame.src = `/api/documentos/${id}/visualizar`;
  el.documentPreviewFrame.title = `Visualização de ${name}`;
  el.documentPreviewDownload.href = `/api/documentos/${id}/download`;
  if (!el.documentPreviewDialog.open) el.documentPreviewDialog.showModal();
}

function closeDocumentPreview() {
  if (!el.documentPreviewDialog) return;
  if (el.documentPreviewFrame) el.documentPreviewFrame.src = 'about:blank';
  if (el.documentPreviewDialog.open) el.documentPreviewDialog.close();
}

function renderCandidateTimeline(items) {
  el.candidateTimeline.innerHTML = items.length ? items.map((item) => `
    <article class="timeline-item"><span class="timeline-marker"></span><div class="timeline-card"><header><strong>${escapeHtml(item.titulo || item.tipo || 'Registro')}</strong><small>${escapeHtml(formatDate(item.created_at))}</small></header><p>${escapeHtml(item.descricao || 'Sem descrição')}</p></div></article>
  `).join('') : emptyState('Nenhum histórico encontrado.');
}

function setDrawerTab(name) {
  document.querySelectorAll('[data-drawer-quick-tab]').forEach((button) => {
    const active = button.dataset.drawerQuickTab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
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
    const decision=await confirmAction({title:'Aplicar e continuar atendimento?',message:'A correção será salva e a IA retomará o atendimento.',detail:`Mensagem prevista: ${preview.mensagem_prevista}`,confirmLabel:'Aplicar e continuar'});
    if (!decision.confirmed) return;
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
    const decision=await confirmAction({title:'Pausar a IA?',message:'As mensagens continuarão registradas, mas a Evelyn não responderá.',confirmLabel:'Pausar IA',inputLabel:'Motivo da pausa',inputValue:'Atendimento assumido pelo recrutador'});if(!decision.confirmed)return;reason=decision.value;
  } else {const decision=await confirmAction({title:'Retomar atendimento automático?',message:'A Evelyn voltará a responder as próximas mensagens deste candidato.',confirmLabel:'Retomar IA'});if(!decision.confirmed)return;}

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
  const decision=await confirmAction({title:'Reprovar nesta vaga?',message:'A decisão será registrada no histórico do candidato.',detail:el.adminRejectSendMessage.checked?'O candidato será avisado.':'Nenhuma mensagem será enviada.',confirmLabel:'Confirmar reprovação',tone:'danger'});if(!decision.confirmed)return;
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
  const decision=await confirmAction({title:'Encerrar candidatura?',message:'A IA será pausada e a candidatura ficará encerrada.',detail:'Nenhuma mensagem será enviada ao candidato.',confirmLabel:'Encerrar candidatura',tone:'danger',inputLabel:'Motivo do encerramento',inputValue:'Candidatura encerrada administrativamente',inputRequired:true});
  if(!decision.confirmed)return;
  try { await runAdminCandidateAction('ENCERRAR', { observacao: decision.value }); }
  catch (error) { showToast(error.message || 'Não foi possível encerrar a candidatura.', 'error'); }
}

async function reopenCandidateAdministratively() {
  const decision=await confirmAction({title:'Reabrir candidatura?',message:'O fluxo automático será retomado a partir do menu inicial.',confirmLabel:'Reabrir e retomar'});
  if(!decision.confirmed)return;
  try { await runAdminCandidateAction('REABRIR'); }
  catch (error) { showToast(error.message || 'Não foi possível reabrir a candidatura.', 'error'); }
}

function syncCtpsManualReviewFields() {
  const rejected = el.ctpsManualDecision?.value === 'REPROVAR';
  el.ctpsManualReasonField?.classList.toggle('hidden', !rejected);
  el.ctpsManualReallocatableField?.classList.toggle('hidden', !rejected);
  if (!rejected && el.ctpsManualReason) el.ctpsManualReason.value = '';
}

function openCtpsManualReview() {
  if (!currentUserIsAdmin() || !state.selectedCandidate) return showToast('Ação disponível somente para administradores.', 'error');
  const c = state.selectedCandidate;
  const requiredMonths = Number(c.experiencia_minima_meses || 0);
  const provenDays = Number(c.maior_experiencia_compativel_dias || 0);
  const provenMonths = Math.floor(provenDays / 30);
  const matcher = String(c.ctps_matcher_version || c.matcher_version || '').trim();
  const historical = !matcher || !/V16[_\.]3|GENESIS_CTPS_MATCHER_V16_3|CTPS_LIMPEZA_V2/i.test(matcher);
  el.ctpsManualReviewTitle.textContent = `Revisar CTPS · ${c.nome || `Candidato #${c.id}`}`;
  el.ctpsManualReviewSubtitle.textContent = historical
    ? 'Este resultado pode ter sido produzido por uma regra anterior. A decisão manual não reprocessa o PDF.'
    : 'Confirme a decisão humana e escolha se o candidato deve ser avisado.';
  el.ctpsManualReviewSummary.innerHTML = `<article><span>Resultado registrado</span><strong>${c.aprovado === true ? '✅ Aprovado' : c.aprovado === false ? '❌ Reprovado' : '⚠️ Em análise'}</strong></article><article><span>Exigência da vaga</span><strong>${requiredMonths ? `${requiredMonths} mês(es)` : 'Sem mínimo'}</strong></article><article><span>Experiência considerada</span><strong>${provenDays ? `${provenMonths} mês(es) · ${provenDays} dias` : 'Não confirmada'}</strong></article>${historical ? '<p class="ctps-manual-history-warning">⚠️ Análise histórica: os ✅/❌ exibidos podem refletir a regra antiga até a CTPS ser reprocessada.</p>' : ''}`;
  el.ctpsManualDecision.value = '';
  el.ctpsManualReason.value = '';
  el.ctpsManualObservation.value = '';
  el.ctpsManualReallocatable.checked = true;
  el.ctpsManualNotify.checked = false;
  syncCtpsManualReviewFields();
  if (!el.ctpsManualReviewDialog.open) el.ctpsManualReviewDialog.showModal();
}

async function saveCtpsManualReview(event) {
  event?.preventDefault?.();
  const decisao = String(el.ctpsManualDecision?.value || '');
  const motivoCodigo = String(el.ctpsManualReason?.value || '');
  const observacao = String(el.ctpsManualObservation?.value || '').trim();
  if (!decisao) return showToast('Selecione a decisão manual da CTPS.', 'error');
  if (decisao === 'REPROVAR' && !motivoCodigo) return showToast('Selecione o motivo da reprovação.', 'error');
  if (decisao === 'REPROVAR' && motivoCodigo === 'OUTRO' && !observacao) return showToast('Descreva o motivo da reprovação.', 'error');
  const notify = Boolean(el.ctpsManualNotify?.checked);
  const decisionText = decisao === 'APROVAR' ? 'confirmar a aprovação' : 'reprovar o candidato pela CTPS';
  const notifyText = notify ? ' O candidato SERÁ avisado agora.' : ' Nenhuma mensagem será enviada ao candidato.';
  const confirmation=await confirmAction({title:'Confirmar decisão da CTPS?',message:`Deseja ${decisionText}?`,detail:notifyText.trim(),confirmLabel:'Confirmar decisão',tone:decisao==='REPROVAR'?'danger':'primary'});if(!confirmation.confirmed)return;
  el.saveCtpsManualReviewButton.disabled = true;
  try {
    const result = await api(`/api/admin/candidatos/${state.selectedCandidateId}/ctps/decisao-manual`, {
      method:'POST',
      body:JSON.stringify({
        decisao,
        motivo_codigo: motivoCodigo || null,
        observacao,
        realocavel: el.ctpsManualReallocatable?.checked !== false,
        enviar_mensagem: notify,
      }),
    });
    el.ctpsManualReviewDialog.close();
    if (result.aviso) showToast(result.aviso, 'error'); else showToast(result.mensagem || 'Decisão manual registrada.');
    await loadCandidates(true);
    const details = await api(`/api/candidatos/${state.selectedCandidateId}/detalhes`);
    state.selectedCandidate = details.candidato;
    renderCandidateDrawer(details);
    if (currentUserIsAdmin()) loadCandidateAudit(state.selectedCandidateId).catch(() => {});
  } catch (error) {
    showToast(error.message || 'Não foi possível registrar a decisão manual.', 'error');
  } finally {
    el.saveCtpsManualReviewButton.disabled = false;
  }
}

async function reprocessCandidateCtps() {
  const decision=await confirmAction({title:'Reprocessar última CTPS?',message:'A IA será retomada e o resultado será enviado automaticamente ao candidato.',confirmLabel:'Reprocessar CTPS'});if(!decision.confirmed)return;
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
  const decision=await confirmAction({title:'Remover candidato?',message:'O candidato e todo o histórico relacionado serão excluídos do banco.',detail:'Esta ação não pode ser desfeita.',confirmLabel:'Remover definitivamente',tone:'danger'});if(!decision.confirmed)return;
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
  const matchesType = (item) => type === 'TODAS'
    || item.tipo === type
    || (type === 'OUTRAS' && !['REVISAO_DOCUMENTAL','SUPORTE_FLUXO'].includes(item.tipo));
  const items = state.reviews.filter((item) => matchesType(item) && (!q || [item.candidato_nome,item.vaga_nome,item.titulo,item.motivo].join(' ').toLocaleLowerCase('pt-BR').includes(q)));
  el.reviewPendingCount.textContent = state.reviews.length;
  if (el.reviewNavBadge) {
    el.reviewNavBadge.textContent = String(state.reviews.length);
    el.reviewNavBadge.classList.toggle('hidden', !state.reviews.length);
  }
  document.querySelectorAll('[data-review-count]').forEach((node) => {
    const key = node.dataset.reviewCount;
    const count = key === 'TODAS'
      ? state.reviews.length
      : key === 'OUTRAS'
        ? state.reviews.filter((item) => !['REVISAO_DOCUMENTAL','SUPORTE_FLUXO'].includes(item.tipo)).length
        : state.reviews.filter((item) => item.tipo === key).length;
    node.textContent = String(count);
  });

  if (!items.some((item) => Number(item.id) === Number(state.selectedReviewId))) {
    state.selectedReviewId = items[0]?.id || null;
    state.reviewDecision = 'ENCERRAR';
  }

  const selected = items.find((item) => Number(item.id) === Number(state.selectedReviewId)) || null;
  el.reviewsList.innerHTML = items.length ? items.map((item) => reviewQueueItem(item, selected)).join('') : emptyState('Nenhuma pendência neste filtro', 'Casos claros seguem automaticamente pelo fluxo configurado.');
  renderReviewDetail(selected);
  renderReviewDecision(selected);
  window.GenesisOperationsV14?.updateReviewBatchToolbar();
}

function reviewQueueItem(item, selected) {
  const isCompatibility = item.tipo === 'INCOMPATIBILIDADE_SEXO';
  const waitMinutes = Math.max(0, Math.floor((Date.now() - new Date(item.created_at).getTime()) / 60000));
  const waitLabel = waitMinutes < 60 ? `${Math.max(1, waitMinutes)} min` : waitMinutes < 1440 ? `${Math.floor(waitMinutes / 60)} h` : `${Math.floor(waitMinutes / 1440)} d`;
  const urgency = waitMinutes >= 120 ? ['high','Alta'] : waitMinutes >= 30 ? ['medium','Média'] : ['low','Baixa'];
  const checkbox = isCompatibility
    ? `<label class="review-queue-check" title="Selecionar para decisão em lote"><input data-review-select type="checkbox" value="${item.id}" aria-label="Selecionar ${escapeHtml(item.candidato_nome)}"></label>`
    : '<span class="review-queue-check is-placeholder" aria-hidden="true"></span>';
  return `<article class="review-queue-item ${Number(item.id) === Number(selected?.id) ? 'selected' : ''}" data-review-open="${item.id}" role="button" tabindex="0" aria-pressed="${Number(item.id) === Number(selected?.id)}">
    ${checkbox}
    <span class="review-queue-avatar">${escapeHtml(initials(item.candidato_nome))}</span>
    <span class="review-queue-copy"><strong>${escapeHtml(item.candidato_nome)}</strong><span>${escapeHtml(reviewTypeLabel(item.tipo))}</span><small>${escapeHtml(item.vaga_nome || 'Sem vaga')}</small></span>
    <span class="review-queue-meta"><time>${escapeHtml(waitLabel)}</time><em class="review-urgency ${urgency[0]}">${urgency[1]}</em></span>
  </article>`;
}

function maskedReviewPhone(value) {
  const formatted = formatPhone(value);
  return formatted.replace(/(\d{4,5})-(\d{4})$/, '$1-••••');
}

function reviewAiMeta(item) {
  if (item?.atendimento_humano_ativo) return { label: `Humano · ${item.atendimento_humano_nome || 'equipe'}`, badge: 'badge-warning', detail: 'A IA permanece pausada durante o atendimento.' };
  if (item?.ia_atendimento_ativo === false) return { label: 'IA pausada', badge: 'badge-warning', detail: item.ia_pausa_motivo || 'Aguardando decisão humana.' };
  return { label: 'IA ativa', badge: 'badge-active', detail: 'O fluxo automático está liberado.' };
}

function renderReviewDetail(item) {
  if (!item) {
    el.reviewDetailContent.innerHTML = '<div class="empty-state"><strong>Selecione uma revisão</strong><span>Os dados do candidato e o motivo da pendência aparecerão aqui.</span></div>';
    return;
  }
  const ai = reviewAiMeta(item);
  const data = item.dados && typeof item.dados === 'object' ? item.dados : {};
  const months = Math.round(Number(item.experiencia_comprovada_dias || 0) / 30 * 10) / 10;
  const latestMessage = String(item.ultima_mensagem || '').trim();
  const documentId = item.documento_id || item.curriculo_id || null;
  const firstName = String(item.candidato_nome || 'Candidato').trim().split(/\s+/)[0];
  const documentName = item.documento_id ? `${firstName} - CTPS.pdf` : `${firstName} - Curriculo.pdf`;
  const documentCard = documentId ? `<section class="review-detail-section"><h4>Documento enviado</h4><article class="review-document-card"><span class="review-document-icon" data-icon="file" aria-hidden="true"></span><span><strong>${escapeHtml(item.documento_id ? 'CTPS para conferência' : 'Currículo do candidato')}</strong><small>${escapeHtml(documentName)}</small></span><div><button class="button button-ghost compact" data-document-preview="${documentId}" data-document-name="${escapeHtml(documentName)}" type="button">Visualizar</button><a class="button button-ghost compact" href="/api/documentos/${documentId}/download" target="_blank" rel="noopener">Baixar</a></div></article></section>` : '';
  const facts = [
    ['Etapa atual', stageLabels[item.etapa] || String(item.etapa || 'Não informada').replaceAll('_', ' ')],
    ['Tipo de revisão', reviewTypeLabel(item.tipo)],
    ['Responsável', item.atendimento_humano_nome || 'Não atribuído'],
    ['Última atividade', formatDate(item.ultima_mensagem_em || item.created_at)],
  ];
  if (item.tipo === 'EXCECAO_EXPERIENCIA') {
    facts.splice(2, 0, ['Experiência', `${months} de ${Number(item.experiencia_exigida_meses || 0)} meses`]);
  }
  if (data.cargo_vinculo_utilizado) facts.push(['Vínculo utilizado', data.cargo_vinculo_utilizado]);
  el.reviewDetailContent.innerHTML = `
    <header class="review-detail-header">
      <span class="review-detail-avatar">${escapeHtml(initials(item.candidato_nome))}</span>
      <div class="review-detail-identity"><h3>${escapeHtml(item.candidato_nome)}</h3><p>${escapeHtml(maskedReviewPhone(item.telefone))}</p><p>${escapeHtml(item.vaga_nome || 'Sem vaga vinculada')}</p><div class="review-state-line"><span class="badge ${ai.badge}">${escapeHtml(ai.label)}</span><small>${escapeHtml(ai.detail)}</small></div></div>
      <div class="review-detail-actions"><button class="button button-ghost review-mobile-back" data-review-mobile-pane="queue" type="button">Voltar</button><button class="button button-ghost" data-review-open-candidate="${item.candidato_id}" type="button">Ver perfil</button><button class="button button-primary review-mobile-decide" data-review-mobile-pane="decision" type="button">Concluir revisão</button></div>
    </header>
    <div class="review-detail-body">
      <section class="review-detail-section"><h4>Motivo da revisão</h4><div class="review-reason-block">${escapeHtml(item.motivo || item.titulo || 'Revisão humana solicitada.')}</div></section>
      <section class="review-detail-section"><h4>Linha do tempo</h4><div class="review-timeline">
        ${latestMessage ? `<article class="review-timeline-item"><span class="review-timeline-icon" data-icon="messages"></span><span class="review-timeline-copy"><strong>Última mensagem na conversa</strong><span>${escapeHtml(latestMessage)}</span></span><time>${escapeHtml(formatDate(item.ultima_mensagem_em))}</time></article>` : ''}
        <article class="review-timeline-item"><span class="review-timeline-icon" data-icon="clipboard-check"></span><span class="review-timeline-copy"><strong>Revisão humana criada</strong><span>${escapeHtml(reviewTypeLabel(item.tipo))}: ${escapeHtml(item.motivo || item.titulo || 'confirmação necessária')}</span></span><time>${escapeHtml(formatDate(item.created_at))}</time></article>
        <article class="review-timeline-item"><span class="review-timeline-icon" data-icon="activity"></span><span class="review-timeline-copy"><strong>${escapeHtml(ai.label)}</strong><span>${escapeHtml(ai.detail)}</span></span><time>${escapeHtml(formatDate(item.ia_pausada_em || item.atendimento_humano_assumido_em || item.created_at))}</time></article>
      </div></section>${documentCard}
      <section class="review-detail-section"><h4>Resumo de fatos</h4><div class="review-support-grid">${facts.map(([label,value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Não informado')}</strong></article>`).join('')}</div></section>
    </div>`;
}

function reviewDecisionOptions(item) {
  const isCompatibility = item.tipo === 'INCOMPATIBILIDADE_SEXO';
  const isDocument = item.tipo === 'REVISAO_DOCUMENTAL';
  const currentUserId = Number(state.currentUser?.id || 0);
  const canFinishHandoff = item.atendimento_humano_ativo === true
    && (currentUserIsAdmin() || Number(item.atendimento_humano_usuario_id || 0) === currentUserId);
  const options = [
    { value:'ENCERRAR', title:'Já resolvido — encerrar sem mensagem', description:'Encerra somente esta pendência. Candidato, etapa, IA e mensagens permanecem como estão.' },
    { value:'APROVAR', title:isCompatibility ? 'Manter no processo — aprovar exceção' : 'Aprovar e continuar', description:'Registra a aprovação. O fluxo configurado pode retomar e enviar a mensagem prevista para esta revisão.' },
    { value:'NAO_APROVAR', title:isCompatibility ? 'Confirmar incompatibilidade nesta vaga' : 'Não aprovar nesta vaga', description:'Registra a decisão negativa e pode acionar a mensagem configurada para o candidato.' },
  ];
  if (isDocument) options.splice(1, 0,
    { value:'REPROCESSAR', title:'Reprocessar o documento', description:'Mantém a revisão controlada enquanto uma nova análise técnica é solicitada.' },
    { value:'SOLICITAR_NOVO_PDF', title:'Solicitar um novo PDF', description:'Aciona a solicitação configurada para que o candidato envie outro arquivo.' },
  );
  if (!item.atendimento_humano_ativo) options.splice(1, 0, { value:'ATENDER_HUMANO', title:'Atender agora — manter IA pausada', description:'Atribui a conversa a você e mantém a IA pausada durante o atendimento.' });
  if (canFinishHandoff) options.splice(1, 0,
    { value:'DEVOLVER_IA', title:'Devolver à IA — salvar contexto e retomar', description:'Finaliza o atendimento humano e reativa a IA. Documentos pendentes podem voltar ao processamento.' },
    { value:'LIBERAR_EQUIPE', title:'Liberar para a equipe — manter IA pausada', description:'Remove o responsável atual e mantém a conversa disponível para outro recrutador, sem reativar a IA.' },
  );
  return options;
}

function reviewDecisionImpact(decision) {
  const impacts = {
    ENCERRAR: ['Sem mensagem e sem alteração da IA', 'Somente a pendência será encerrada.'],
    ATENDER_HUMANO: ['Sem mensagem automática', 'A IA será pausada e a conversa ficará atribuída a você.'],
    DEVOLVER_IA: ['A IA será reativada', 'Nenhuma mensagem imediata é enviada por esta ação; o fluxo volta a processar futuras interações.'],
    LIBERAR_EQUIPE: ['A IA continuará pausada', 'A conversa ficará sem responsável e disponível para a equipe.'],
    REPROCESSAR: ['Pode acionar processamento técnico', 'Nenhuma aprovação é registrada nesta ação.'],
    SOLICITAR_NOVO_PDF: ['Pode enviar mensagem ao candidato', 'Será utilizada a comunicação configurada para solicitar outro PDF.'],
    APROVAR: ['Pode retomar o fluxo e enviar mensagem', 'A ação exata é definida pela revisão e pelo Chatbot Estático.'],
    NAO_APROVAR: ['Pode enviar mensagem ao candidato', 'A decisão negativa será registrada para esta vaga.'],
  };
  return impacts[decision] || ['Revise antes de confirmar', 'A ação selecionada será registrada no histórico.'];
}

function renderReviewDecision(item) {
  if (!item) {
    el.reviewDecisionContent.innerHTML = '<div class="empty-state compact"><strong>Nenhuma revisão selecionada</strong><span>Escolha um item da fila para ver as decisões disponíveis.</span></div>';
    return;
  }
  const options = reviewDecisionOptions(item);
  if (!options.some((option) => option.value === state.reviewDecision)) state.reviewDecision = options[0].value;
  const impact = reviewDecisionImpact(state.reviewDecision);
  el.reviewDecisionContent.innerHTML = `
    <header class="review-decision-header"><div><h3>Concluir revisão</h3></div><button class="button button-ghost review-mobile-back" data-review-mobile-pane="detail" type="button">Voltar</button></header>
    <div class="review-decision-options">${options.map((option) => `<label class="review-decision-option"><input name="reviewDecisionChoice" type="radio" value="${option.value}" ${option.value === state.reviewDecision ? 'checked' : ''}><span><strong>${escapeHtml(option.title)}</strong></span></label>`).join('')}</div>
    <label class="review-decision-reason">Motivo<select id="reviewDecisionReason"><option value="">Selecione um motivo</option><option value="COMPATIBILIDADE_CONFIRMADA">Compatibilidade confirmada</option><option value="EXPERIENCIA_INSUFICIENTE">Experiência insuficiente para a vaga</option><option value="DOCUMENTO_INCONSISTENTE">Documento inconsistente</option><option value="REQUISITO_NAO_ATENDIDO">Requisito obrigatório não atendido</option><option value="OUTRO">Outro motivo</option></select></label>
    <label class="review-decision-note">Observação (opcional)<textarea id="reviewDecisionNote" maxlength="2000" placeholder="Registre apenas o contexto necessário para a equipe."></textarea></label>
    <label id="reviewCommunicationControl" class="review-communication-control ${['APROVAR','NAO_APROVAR'].includes(state.reviewDecision) ? '' : 'hidden'}"><input id="reviewSendMessage" type="checkbox"><span><strong>Enviar mensagem</strong><small>Desmarcado por padrão. A decisão interna será salva sem contato com o candidato.</small></span></label>
    <div id="reviewDecisionImpact" class="review-decision-impact"><strong>${escapeHtml(impact[0])}</strong><span>${escapeHtml(impact[1])}</span></div>
    <footer class="review-decision-footer"><button id="confirmReviewDecisionButton" class="button button-primary" data-review-confirm type="button">${escapeHtml(reviewDecisionPrimaryLabel(state.reviewDecision))}</button><button class="button button-ghost" data-review-mobile-pane="queue" type="button">Cancelar</button></footer>`;
}

function reviewDecisionPrimaryLabel(decision) {
  if (['APROVAR','NAO_APROVAR'].includes(decision)) return document.getElementById('reviewSendMessage')?.checked ? 'Salvar e enviar mensagem' : 'Salvar decisão';
  return ({ ENCERRAR:'Confirmar: já resolvido', ATENDER_HUMANO:'Iniciar atendimento', DEVOLVER_IA:'Salvar e devolver à IA', LIBERAR_EQUIPE:'Liberar para a equipe', REPROCESSAR:'Reprocessar documento', SOLICITAR_NOVO_PDF:'Solicitar novo PDF' })[decision] || 'Confirmar decisão';
}

function syncReviewDecisionUi(decision) {
  state.reviewDecision = decision;
  const impact = reviewDecisionImpact(decision);
  const impactNode = document.getElementById('reviewDecisionImpact');
  if (impactNode) impactNode.innerHTML = `<strong>${escapeHtml(impact[0])}</strong><span>${escapeHtml(impact[1])}</span>`;
  document.getElementById('reviewCommunicationControl')?.classList.toggle('hidden', !['APROVAR','NAO_APROVAR'].includes(decision));
  const sendMessage = document.getElementById('reviewSendMessage');
  if (sendMessage) sendMessage.checked = false;
  const button = document.getElementById('confirmReviewDecisionButton');
  if (button) button.textContent = reviewDecisionPrimaryLabel(decision);
}

function setReviewMobilePane(pane) {
  const view = document.getElementById('view-reviews');
  if (view && ['queue','detail','decision'].includes(pane)) view.dataset.reviewMobilePane = pane;
  if (pane !== 'decision') el.reviewDecisionPane?.classList.remove('is-open');
  if (pane === 'decision') el.reviewDecisionPane?.classList.add('is-open');
}

function selectReview(id) {
  state.selectedReviewId = Number(id) || null;
  state.reviewDecision = 'ENCERRAR';
  renderReviews();
  setReviewMobilePane('detail');
}

async function confirmSelectedReviewDecision() {
  const item = state.reviews.find((review) => Number(review.id) === Number(state.selectedReviewId));
  if (!item) return;
  const decision = state.reviewDecision;
  const note = String(document.getElementById('reviewDecisionNote')?.value || '').trim();
  const reasonSelect = document.getElementById('reviewDecisionReason');
  const reason = reasonSelect?.value ? String(reasonSelect.selectedOptions?.[0]?.textContent || '').trim() : '';
  const sendMessage = Boolean(document.getElementById('reviewSendMessage')?.checked);
  const impact = reviewDecisionImpact(decision);
  const confirmation = await confirmAction({ title: reviewDecisionPrimaryLabel(decision), message: impact[0], detail: impact[1], confirmLabel: reviewDecisionPrimaryLabel(decision), tone: decision === 'NAO_APROVAR' ? 'danger' : 'primary' });
  if (!confirmation.confirmed) return;
  if (decision === 'ATENDER_HUMANO') {
    const result = await api(`/api/atendimento/candidatos/${item.candidato_id}/assumir`, { method:'POST', body:'{}' });
    showToast(result.mensagem || 'Atendimento iniciado.');
    await Promise.allSettled([loadReviews(true), loadCandidates(true)]);
    setReviewMobilePane('detail');
    return;
  }
  if (['DEVOLVER_IA','LIBERAR_EQUIPE'].includes(decision)) {
    const result = await api(`/api/atendimento/candidatos/${item.candidato_id}/finalizar-handoff`, { method:'POST', body:JSON.stringify({ destino:decision === 'DEVOLVER_IA' ? 'IA' : 'HUMANO', resumo:note, dados_confirmados:{} }) });
    showToast(result.mensagem || 'Atendimento finalizado.');
    await Promise.allSettled([loadReviews(true), loadCandidates(true)]);
    setReviewMobilePane('queue');
    return;
  }
  const defaultReasons = { ENCERRAR:'Pendência já resolvida pela equipe.', APROVAR:'Compatibilidade confirmada pelo recrutador.', NAO_APROVAR:'Incompatibilidade operacional confirmada em revisão interna.', REPROCESSAR:'Reprocessamento solicitado pelo recrutador.', SOLICITAR_NOVO_PDF:'Novo PDF solicitado pelo recrutador.' };
  await decideReview(item.id, decision, { confirmed:true, motivo:[reason, note].filter(Boolean).join(' — ') || defaultReasons[decision], enviarMensagem:sendMessage });
  setReviewMobilePane('queue');
}

async function decideReview(id, decision, options = {}) {
  if(decision==='ENCERRAR'){
    if(!options.confirmed && !window.confirm('Encerrar somente esta pendência? O candidato, a vaga, a etapa e as mensagens não serão alterados.'))return;
    const result=await api(`/api/revisoes/${id}/encerrar`,{method:'POST',body:JSON.stringify({motivo:options.motivo || 'Pendência já revisada pela equipe.'})});
    showToast(result.mensagem||'Revisão encerrada.');await loadReviews(true);return;
  }
  const labels = { APROVAR: 'aprovar e continuar', NAO_APROVAR: 'não aprovar nesta vaga', REPROCESSAR: 'reprocessar o documento', SOLICITAR_NOVO_PDF: 'solicitar um novo PDF ao candidato' };
  const motivo = options.motivo ?? window.prompt(`Confirme o motivo para ${labels[decision] || decision}:`, decision === 'APROVAR' ? 'Necessidade operacional / experiência próxima do requisito' : '');
  if (motivo === null) return;
  const result = await api(`/api/revisoes/${id}/decidir`, { method: 'POST', body: JSON.stringify({ decisao: decision, motivo, enviar_mensagem: Boolean(options.enviarMensagem) }) });
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

function renderCalendarAgendaList() {
  const items = [...state.interviews].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  el.calendarSelectedDayLabel.textContent = 'Próximas entrevistas';
  el.interviewsList.innerHTML = items.length ? items.map((item) => {
    const meet = item.meet_link || item.google_event_url;
    return `<article class="calendar-agenda-item"><time>${escapeHtml(formatDate(item.inicio))}</time><div><strong>${escapeHtml(item.candidato_nome)}</strong><span>${escapeHtml(item.vaga_nome)}</span><small>${escapeHtml(item.telefone ? formatPhone(item.telefone) : '')}</small></div><div class="calendar-agenda-actions"><button class="button button-ghost" data-action="open-candidate" data-id="${item.candidato_id}" type="button">Candidato</button>${meet ? `<a class="button button-primary" href="${escapeHtml(meet)}" target="_blank" rel="noopener">Abrir Meet</a>` : '<span class="badge badge-warning">Sem link</span>'}</div></article>`;
  }).join('') : emptyState('Nenhuma entrevista agendada', 'Novos compromissos aparecerão aqui.');
}

function renderInterviews() {
  if (!state.calendarSelectedDate) state.calendarSelectedDate = localDateKey(new Date());
  const cursor = new Date(state.calendarCursor);
  cursor.setHours(12,0,0,0);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  el.calendarMonthLabel.textContent = state.calendarMode === 'DAY'
    ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${state.calendarSelectedDate}T12:00:00`))
    : state.calendarMode === 'LIST' ? 'Todas as entrevistas' : calendarMonthTitle(cursor);
  const selected = new Date(`${state.calendarSelectedDate || localDateKey(new Date())}T12:00:00`);
  const first = state.calendarMode === 'WEEK' ? new Date(selected) : new Date(year, month, 1, 12);
  const last = state.calendarMode === 'WEEK' ? new Date(selected) : new Date(year, month + 1, 0, 12);
  if (state.calendarMode === 'WEEK') { first.setDate(first.getDate() - first.getDay()); last.setTime(first.getTime()); last.setDate(last.getDate() + 6); }
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
  document.getElementById('view-interviews')?.setAttribute('data-calendar-mode', state.calendarMode);
  if (state.calendarMode === 'LIST') renderCalendarAgendaList(); else renderCalendarDayList(state.calendarSelectedDate);
}

function setCalendarMode(mode) {
  state.calendarMode = ['MONTH', 'DAY', 'WEEK', 'LIST'].includes(mode) ? mode : 'MONTH';
  el.calendarViewMode?.querySelectorAll('[data-calendar-mode]').forEach((button) => button.classList.toggle('active', button.dataset.calendarMode === state.calendarMode));
  renderInterviews();
}

function moveCalendarMonth(offset) {
  if (state.calendarMode === 'DAY' || state.calendarMode === 'WEEK') {
    const selected = new Date(`${state.calendarSelectedDate || localDateKey(new Date())}T12:00:00`);
    selected.setDate(selected.getDate() + offset * (state.calendarMode === 'WEEK' ? 7 : 1));
    state.calendarSelectedDate = localDateKey(selected);
    state.calendarCursor = selected;
    renderInterviews();
    return;
  }
  const date = new Date(state.calendarCursor);
  date.setDate(1); date.setMonth(date.getMonth()+offset); state.calendarCursor=date;
  const monthKey = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  if (!String(state.calendarSelectedDate || '').startsWith(monthKey)) state.calendarSelectedDate = localDateKey(date);
  renderInterviews();
}

async function openDocumentAuditExport() {
  if (!currentUserIsAdmin()) return showToast('Somente administradores podem exportar CTPS para auditoria.', 'error');
  if (!state.vacancies.length) await loadVacancies();
  const options = [...state.vacancies]
    .sort((left, right) => String(left.titulo || '').localeCompare(String(right.titulo || ''), 'pt-BR'))
    .map((vacancy) => `<option value="${vacancy.id}">${escapeHtml(vacancy.codigo ? `${vacancy.codigo} · ${vacancy.titulo}` : vacancy.titulo || `Vaga #${vacancy.id}`)}</option>`)
    .join('');
  el.documentAuditVacancy.innerHTML = `<option value="">Todas as vagas</option>${options}`;
  el.documentAuditExportDialog.showModal();
}

async function exportDocumentAudit() {
  const button = el.confirmDocumentAuditExportButton;
  const params = new URLSearchParams({
    resultado: el.documentAuditResult.value || 'TODOS',
    limite: el.documentAuditLimit.value || '25',
  });
  if (el.documentAuditVacancy.value) params.set('vaga_id', el.documentAuditVacancy.value);
  if (el.documentAuditStart.value) params.set('inicio', el.documentAuditStart.value);
  if (el.documentAuditEnd.value) params.set('fim', el.documentAuditEnd.value);

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Gerando ZIP...';
  try {
    const response = await fetch(`/api/admin/documentos/auditoria-ctps.zip?${params.toString()}`, {
      method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/zip, application/json' },
    });
    if (!response.ok) {
      let message = 'Não foi possível gerar a exportação.';
      try { const payload = await response.json(); message = payload.erro || payload.message || message; } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `genesis-auditoria-ctps-${new Date().toISOString().slice(0, 10)}.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    el.documentAuditExportDialog.close();
    showToast('ZIP de auditoria de CTPS gerado.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
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
  if(status==='REVISAO_CONCLUIDA'||(['REPROVADO','ENCERRADO','CONTRATADO'].includes(String(doc.candidato_status||'').toUpperCase())&&documentNeedsReviewReconciliation(doc)))return {label:'Revisão concluída',tone:'ok',detail:'Decisão do processo registrada'};
  if (['ERRO', 'ERRO_PROCESSAMENTO', 'INCONCLUSIVO'].includes(status)) return { label: 'Falha no processamento', tone: 'error', detail: 'Arquivo bruto preservado' };
  if (['REVISAO'].includes(status) || String(doc.tipo || '').toUpperCase() === 'PENDENTE_REVISAO') return { label: 'Aguardando revisão', tone: 'wait', detail: 'Decisão humana necessária' };
  if (['RECEBIDO', 'ARMAZENADO', 'PROCESSANDO', 'REPROCESSAMENTO_SOLICITADO', 'PENDENTE'].includes(status)) return { label: status === 'PROCESSANDO' ? 'Processando' : 'Aguardando processamento', tone: 'wait', detail: 'Arquivo armazenado' };
  return { label: 'Analisado', tone: 'ok', detail: String(doc.tipo || '').toUpperCase() === 'CURRICULO' ? 'Dados do currículo extraídos' : 'Análise concluída' };
}

async function startReviewService(candidateId) {
  const decision = await confirmAction({
    title: 'Iniciar atendimento humano?',
    message: 'A conversa será atribuída a você e a Evelyn ficará pausada enquanto o atendimento estiver em andamento.',
    detail: 'A revisão continuará pendente até você escolher uma decisão ou “Já revisado”.',
    confirmLabel: 'Iniciar atendimento',
  });
  if (!decision.confirmed) return;
  const result = await api(`/api/atendimento/candidatos/${candidateId}/assumir`, { method: 'POST', body: '{}' });
  showToast(result.mensagem || 'Atendimento iniciado.');
  await openCandidate(candidateId, 'conversation');
  await Promise.allSettled([loadReviews(), loadCandidates(true)]);
}

function documentNeedsReviewReconciliation(doc){const status=String(doc.status_processamento||'').toUpperCase();const type=String(doc.tipo||'').toUpperCase();return ['PENDENTE','PENDENTE_REVISAO'].includes(type)||['ERRO','ERRO_PROCESSAMENTO','INCONCLUSIVO','REVISAO','PENDENTE'].includes(status);}

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
    const searchMatches = !query || [doc.candidato_nome, doc.telefone, doc.nome_exibicao, doc.nome_arquivo, doc.vaga_nome].join(' ').toLocaleLowerCase('pt-BR').includes(query);
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
      const canMarkReviewed=currentUserIsAdmin()&&documentNeedsReviewReconciliation(doc);
      return `<article class="document-file-row">
        <span class="document-file-icon">PDF</span>
        <div><strong>${escapeHtml(doc.nome_exibicao || doc.nome_arquivo || doc.titulo || 'Documento')}</strong><small>${escapeHtml(formatFileSize(doc.tamanho_bytes))} · ${escapeHtml(formatDate(doc.created_at))}</small></div>
        <span class="document-file-status ${meta.tone}">${escapeHtml(meta.label)}</span>
        <small class="document-file-detail">${escapeHtml(meta.detail)}</small>
        <div class="document-file-actions">
          ${doc.disponivel_download ? `<button data-document-preview="${doc.id}" data-document-name="${escapeHtml(doc.nome_exibicao || doc.titulo || 'Documento')}" type="button">Visualizar</button><a href="/api/documentos/${doc.id}/download">Baixar</a>` : ''}
          ${canReprocess ? `<button data-document-reprocess="${candidateId}" type="button">Reprocessar</button>` : ''}
          ${canMarkReviewed ? `<button data-document-mark-reviewed="${doc.id}" type="button">Marcar analisado</button>` : ''}
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

async function markDocumentReviewed(documentId){const decision=await confirmAction({title:'Marcar documento como analisado?',message:'A pendência documental será encerrada sem alterar a decisão do candidato.',detail:'Nenhuma mensagem será enviada.',confirmLabel:'Marcar analisado'});if(!decision.confirmed)return;const result=await api(`/api/documentos/${documentId}/marcar-revisado`,{method:'POST',body:'{}'});showToast(result.mensagem||'Documento atualizado.');await loadDocuments();}

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
  const quickTab = event.target.closest('[data-drawer-quick-tab]');
  if (quickTab) return setDrawerTab(quickTab.classList.contains('active') ? 'summary' : quickTab.dataset.drawerQuickTab);
  const candidateSelect = event.target.closest('[data-candidate-select]');
  if (candidateSelect) {
    event.stopPropagation();
    const id = String(candidateSelect.dataset.candidateSelect);
    if (candidateSelect.checked) state.selectedCandidateIds.add(id); else state.selectedCandidateIds.delete(id);
    renderCandidates();
    return;
  }
  const target = event.target.closest('[data-action], [data-vacancy-action], [data-candidate-action], [data-monitor-action], [data-go-view], [data-dashboard-period], [data-audit-open], [data-audit-candidate-profile], [data-template-apply], [data-template-edit], [data-template-duplicate], [data-template-delete], [data-audit-toggle], [data-audit-rescue-candidate], [data-review-decision], [data-review-open], [data-review-open-candidate], [data-review-start-service], [data-review-mobile-pane], [data-review-confirm], [data-calendar-date], [data-dashboard-calendar-date], [data-document-toggle], [data-document-reprocess], [data-document-mark-reviewed]');
  if (!target) return;
  if (target.dataset.dashboardPeriod) {
    if (target.dataset.dashboardPeriod === state.dashboardPeriod) return;
    state.dashboardPeriod = target.dataset.dashboardPeriod;
    document.querySelectorAll('[data-dashboard-period]').forEach((button) => button.classList.toggle('active', button === target));
    loadDashboard(true).catch((error) => showToast(error.message, 'error'));
    return;
  }
  if (target.dataset.goView) {
    if (target.closest('#candidateDrawer')) el.candidateDrawer?.close();
    return setView(target.dataset.goView);
  }
  if (target.dataset.documentToggle) {
    const key = String(target.dataset.documentToggle);
    if (state.expandedDocumentCandidates.has(key)) state.expandedDocumentCandidates.delete(key);
    else state.expandedDocumentCandidates.add(key);
    renderDocuments();
    return;
  }
  if (target.dataset.documentReprocess) return reprocessDocumentCandidate(target.dataset.documentReprocess);
  if (target.dataset.documentMarkReviewed) return markDocumentReviewed(target.dataset.documentMarkReviewed);
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
  if (target.dataset.reviewOpen) {
    if (event.target.closest('[data-review-select]')) return;
    return selectReview(target.dataset.reviewOpen);
  }
  if (target.dataset.reviewOpenCandidate) return openCandidate(target.dataset.reviewOpenCandidate);
  if (target.dataset.reviewStartService) return startReviewService(target.dataset.reviewStartService);
  if (target.dataset.reviewMobilePane) return setReviewMobilePane(target.dataset.reviewMobilePane);
  if (target.hasAttribute('data-review-confirm')) return confirmSelectedReviewDecision();
  if (target.dataset.reviewDecision) return decideReview(target.dataset.id, target.dataset.reviewDecision);
  if (target.dataset.calendarDate) { state.calendarSelectedDate=target.dataset.calendarDate; renderInterviews(); return; }
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
  if (state.activeView === 'atendimentos') return window.GenesisConversationsV164?.load(true);
  if (state.activeView === 'audit') return syncAudit();
  if (state.activeView === 'reviews') return loadReviews(true);
  if (state.activeView === 'brands') return window.GenesisOperationsV14?.loadBrands(true);
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
  window.GenesisUIV18?.setUser?.(data.usuario || null);
  document.body.dataset.userRole = role;
  window.dispatchEvent(new CustomEvent('genesis:user-ready', { detail: { role } }));
  document.querySelectorAll('.nav-item[data-admin-only]').forEach((item) => item.classList.toggle('hidden', role !== 'ADMIN'));
  document.querySelectorAll('[data-admin-only]').forEach((item) => {
    if (item.classList.contains('nav-item')) return;
    if (item.classList.contains('view')) {
      if (role !== 'ADMIN') item.classList.add('hidden');
      return;
    }
    item.classList.toggle('hidden', role !== 'ADMIN');
  });
  if (role !== 'ADMIN' && ['audit', 'sales', 'publications', 'monitoring', 'documents', 'brands', 'users'].includes(state.activeView)) setView('dashboard');
}

async function logout() {
  el.logoutButton && (el.logoutButton.disabled = true);
  closeMobileSidebar();
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  try { sessionStorage.clear(); } catch {}
  window.location.assign(`/login?logout=${Date.now()}`);
}

function syncThemeUi() {
  const dark = document.documentElement.dataset.theme === 'dark';
  state.theme = dark ? 'dark' : 'light';
  if (el.themeToggleButton) {
    el.themeToggleButton.setAttribute('aria-checked', dark ? 'true' : 'false');
    el.themeToggleButton.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
    el.themeToggleButton.title = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
    el.themeToggleButton.dataset.themeState = dark ? 'dark' : 'light';
  }
  window.GenesisUIV18?.syncTheme?.(dark ? 'dark' : 'light');
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  localStorage.setItem('genesis_theme', next);
  syncThemeUi();
  if (state.activeView === 'dashboard') requestAnimationFrame(() => drawDashboardPerformanceChart(state.dashboard?.desempenho?.tendencia || []));
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
  window.addEventListener('genesis:geo-distances-updated', () => { if (state.activeView === 'candidates') renderCandidates(); if (state.selectedCandidate && el.candidateDrawer?.open) updateCandidateDistanceSummary(state.selectedCandidate); });
  let dashboardResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(dashboardResizeTimer);
    dashboardResizeTimer = setTimeout(() => {
      if (state.activeView === 'dashboard') drawDashboardPerformanceChart(state.dashboard?.desempenho?.tendencia || []);
    }, 120);
  });
  el.logoutButton.addEventListener('click', logout);
  el.sidebarLogoutButton?.addEventListener('click', logout);
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
    else if (button.dataset.searchType === 'DOCUMENTO') { setView('candidates'); if (button.dataset.candidateId) openCandidate(button.dataset.candidateId); }
  });

  el.vacancyPeriodSegments?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vacancy-period]'); if (!button) return;
    state.vacancyPeriod = button.dataset.vacancyPeriod;
    el.vacancyPeriodSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    loadVacancies(true);
  });

  el.vacancyStatusSegments?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vacancy-status]'); if (!button) return;
    state.vacancyStatus = button.dataset.vacancyStatus;
    el.vacancyStatusSegments.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
    renderVacancies();
  });
  el.vacancyStatusSelect?.addEventListener('change', (event) => { state.vacancyStatus = event.target.value; renderVacancies(); });
  el.vacancyPeriodSelect?.addEventListener('change', (event) => { state.vacancyPeriod = event.target.value; loadVacancies(true); });
  el.vacancyTableMode?.addEventListener('click', () => setVacancyMode('table'));
  el.vacancyKanbanMode?.addEventListener('click', () => setVacancyMode('cards'));
  el.vacancyActiveKpiCard?.addEventListener('click', () => { state.vacancyStatus = 'ATIVA'; if (el.vacancyStatusSelect) el.vacancyStatusSelect.value = 'ATIVA'; renderVacancies(); });
  el.vacancySearchInput?.addEventListener('input', renderVacancies);
  el.vacancyCompanyFilter?.addEventListener('change', (event) => {
    state.vacancyCompany = event.target.value;
    renderVacancies();
  });
  el.vacancyLocationFilter?.addEventListener('change', (event) => {
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
  el.calendarPrevButton?.addEventListener('click', () => moveCalendarMonth(-1));
  el.calendarNextButton?.addEventListener('click', () => moveCalendarMonth(1));
  el.calendarTodayButton?.addEventListener('click', () => { state.calendarCursor=new Date(); state.calendarSelectedDate=localDateKey(new Date()); renderInterviews(); });
  el.calendarViewMode?.addEventListener('click', (event) => { const button = event.target.closest('[data-calendar-mode]'); if (button) setCalendarMode(button.dataset.calendarMode); });
  el.reviewSearchInput?.addEventListener('input', renderReviews);
  el.reviewTypeSegments?.addEventListener('click', (event) => { const button=event.target.closest('[data-review-type]'); if(!button)return; state.reviewType=button.dataset.reviewType; el.reviewTypeSegments.querySelectorAll('button').forEach((item)=>item.classList.toggle('active',item===button)); renderReviews(); });
  el.reviewsList?.addEventListener('keydown', (event) => { const item=event.target.closest('[data-review-open]'); if(!item || !['Enter',' '].includes(event.key))return; event.preventDefault(); selectReview(item.dataset.reviewOpen); });
  document.addEventListener('change', (event) => { if (event.target.matches('input[name="reviewDecisionChoice"]')) syncReviewDecisionUi(event.target.value); });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'reviewSendMessage') {
      const button = document.getElementById('confirmReviewDecisionButton');
      if (button) button.textContent = reviewDecisionPrimaryLabel(state.reviewDecision);
    }
  });
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

  el.candidateStatusSegments?.addEventListener('click', (event) => {
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
  el.candidatePeriodSelect?.addEventListener('change', (event) => { state.candidatePeriod = event.target.value; renderCandidates(); });
  document.querySelectorAll('[data-candidate-kpi-filter]').forEach((card) => {
    const apply = () => { state.candidateStatus = card.dataset.candidateKpiFilter || 'TODOS'; renderCandidates(); };
    card.addEventListener('click', apply);
    card.addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); apply(); } });
  });
  el.candidateActivitySortButton?.addEventListener('click', () => {
    state.candidateActivitySort = state.candidateActivitySort === 'DESC' ? 'ASC' : 'DESC';
    const ascending = state.candidateActivitySort === 'ASC';
    el.candidateActivitySortButton.querySelector('span').textContent = ascending ? '↑' : '↓';
    el.candidateActivitySortButton.setAttribute('aria-label', `Ordenar por última atividade, ${ascending ? 'mais antigas' : 'mais recentes'} primeiro`);
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
  document.getElementById('candidateTalentFilter')?.addEventListener('change', (event) => { state.candidateTalent = event.target.value; renderCandidates(); });
  document.getElementById('candidateTalentRevokeButton')?.addEventListener('click', async () => { if (!state.selectedCandidateId || !confirm('Revogar o consentimento para novas oportunidades?')) return; await api(`/api/admin/candidatos/${state.selectedCandidateId}/banco-talentos`, { method:'PATCH', body:JSON.stringify({aceite:false}) }); showToast('Consentimento revogado.'); await loadCandidates(); await openCandidate(state.selectedCandidateId); });
  el.candidateDistanceFilter?.addEventListener('change', () => { state.candidateDistance = el.candidateDistanceFilter.value; el.candidateDistanceFilter.closest('details')?.removeAttribute('open'); renderCandidates(); });
  el.candidateDistanceSort?.addEventListener('change', () => { state.candidateDistanceSort = el.candidateDistanceSort.value; el.candidateDistanceSort.closest('details')?.removeAttribute('open'); renderCandidates(); });
  document.addEventListener('toggle', (event) => {
    const current = event.target.closest?.('.table-filter-menu');
    if (!current?.open) return;
    document.querySelectorAll('.table-filter-menu[open]').forEach((item) => { if (item !== current) item.removeAttribute('open'); });
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.table-filter-menu')) return;
    document.querySelectorAll('.table-filter-menu[open]').forEach((item) => item.removeAttribute('open'));
  });

  el.closeCandidateDrawerButton.addEventListener('click', () => el.candidateDrawer.close());
  document.getElementById('candidateSelectAll')?.addEventListener('change', (event) => {
    state.candidates.filter(candidateMatches).forEach((candidate) => {
      const id = String(candidate.id);
      if (event.target.checked) state.selectedCandidateIds.add(id); else state.selectedCandidateIds.delete(id);
    });
    renderCandidates();
  });
  document.getElementById('candidateBulkClear')?.addEventListener('click', () => { state.selectedCandidateIds.clear(); renderCandidates(); });
  document.getElementById('candidateBulkExport')?.addEventListener('click', () => window.GenesisV25?.openCandidateExport?.([...state.selectedCandidateIds]));
  el.updateCandidateButton?.addEventListener('click', () => updateCandidate('SOMENTE_CORRECAO'));
  el.continueCandidateButton?.addEventListener('click', () => updateCandidate('CORRIGIR_E_CONTINUAR'));
  el.toggleCandidateAiButton?.addEventListener('click', toggleCandidateAi);
  el.reprocessCandidateCtpsButton?.addEventListener('click', reprocessCandidateCtps);
  el.openCtpsManualReviewButton?.addEventListener('click', openCtpsManualReview);
  el.ctpsManualDecision?.addEventListener('change', syncCtpsManualReviewFields);
  el.ctpsManualReviewForm?.addEventListener('submit', saveCtpsManualReview);
  el.closeCtpsManualReviewButton?.addEventListener('click', () => el.ctpsManualReviewDialog.close());
  el.cancelCtpsManualReviewButton?.addEventListener('click', () => el.ctpsManualReviewDialog.close());
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
  el.documentAuditExportButton?.addEventListener('click', () => openDocumentAuditExport().catch((error) => showToast(error.message, 'error')));
  el.closeDocumentAuditExportButton?.addEventListener('click', () => el.documentAuditExportDialog.close());
  el.cancelDocumentAuditExportButton?.addEventListener('click', () => el.documentAuditExportDialog.close());
  el.confirmDocumentAuditExportButton?.addEventListener('click', exportDocumentAudit);
  el.closeDocumentPreviewButton?.addEventListener('click', closeDocumentPreview);
  el.documentPreviewDialog?.addEventListener('close', () => { if (el.documentPreviewFrame) el.documentPreviewFrame.src = 'about:blank'; });
  document.addEventListener('click', (event) => {
    const previewButton = event.target.closest('[data-document-preview]');
    if (previewButton) {
      event.preventDefault();
      openDocumentPreview(previewButton.dataset.documentPreview, previewButton.dataset.documentName || 'Documento');
    }
  });
}

window.GenesisApp = { api, showToast, escapeHtml, formatMoney, formatDate, formatPhone, badgeClass, emptyState, currentUserIsAdmin, state, setView, loadCurrentView };

async function init() {
  if (window.matchMedia('(max-width: 760px)').matches) {
    state.calendarMode = 'LIST';
    el.calendarViewMode?.querySelectorAll('[data-calendar-mode]').forEach((button) => button.classList.toggle('active', button.dataset.calendarMode === 'LIST'));
  }
  bindEvents();
  syncThemeUi();
  await loadCurrentUser();
  await Promise.allSettled([loadCompanies(), loadCandidates()]);
  await Promise.all([loadDashboard(), loadReviews()]);
}

init().catch((error) => showToast(error.message, 'error'));

