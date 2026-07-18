'use strict';

const state = {
  vacancies: [],
  companies: [],
  loading: false,
};

const elements = {
  newVacancyButton: document.querySelector('#newVacancyButton'),
  refreshButton: document.querySelector('#refreshButton'),
  searchInput: document.querySelector('#searchInput'),
  statusFilter: document.querySelector('#statusFilter'),
  loadingState: document.querySelector('#loadingState'),
  emptyState: document.querySelector('#emptyState'),
  tableWrapper: document.querySelector('#tableWrapper'),
  tableBody: document.querySelector('#vacanciesTableBody'),
  vacancyDialog: document.querySelector('#vacancyDialog'),
  vacancyForm: document.querySelector('#vacancyForm'),
  dialogTitle: document.querySelector('#dialogTitle'),
  vacancyId: document.querySelector('#vacancyId'),
  closeDialogButton: document.querySelector('#closeDialogButton'),
  cancelButton: document.querySelector('#cancelButton'),
  saveButton: document.querySelector('#saveButton'),
  formError: document.querySelector('#formError'),
  companySelect: document.querySelector('#empresa_id'),
  toast: document.querySelector('#toast'),
  statActive: document.querySelector('#statActive'),
  statDraft: document.querySelector('#statDraft'),
  statPaused: document.querySelector('#statPaused'),
  statClosed: document.querySelector('#statClosed'),
};

const statusLabels = {
  ATIVA: 'Ativa',
  RASCUNHO: 'Rascunho',
  PAUSADA: 'Pausada',
  ENCERRADA: 'Encerrada',
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

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', type === 'error');
  elements.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 4200);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshButton.disabled = isLoading;
  if (isLoading) {
    elements.loadingState.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    elements.tableWrapper.classList.add('hidden');
  } else {
    elements.loadingState.classList.add('hidden');
  }
}

function updateStats() {
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
    const matchesSearch = !search || haystack.includes(search);
    return matchesStatus && matchesSearch;
  });
}

function actionButtons(vacancy) {
  const buttons = [
    `<button class="button button-secondary button-small" type="button" data-action="edit" data-id="${vacancy.id}">Editar</button>`,
    `<button class="button button-secondary button-small" type="button" data-action="copy" data-id="${vacancy.id}">Copiar código</button>`,
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
  updateStats();

  if (vacancies.length === 0) {
    elements.tableWrapper.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.tableWrapper.classList.remove('hidden');

  elements.tableBody.innerHTML = vacancies.map((vacancy) => {
    const location = [vacancy.bairro, vacancy.cidade, vacancy.estado]
      .filter(Boolean)
      .join(' - ') || 'Não informado';

    return `
      <tr>
        <td><span class="code">${escapeHtml(vacancy.codigo)}</span></td>
        <td>
          <div class="vacancy-title">
            <strong>${escapeHtml(vacancy.titulo)}</strong>
            <span>${escapeHtml(vacancy.empresa_nome)} · ${escapeHtml(vacancy.quantidade_vagas)} vaga(s)</span>
          </div>
        </td>
        <td>${escapeHtml(location)}</td>
        <td>${escapeHtml(formatMoney(vacancy.salario))}</td>
        <td><span class="badge badge-${escapeHtml(vacancy.status)}">${escapeHtml(statusLabels[vacancy.status] || vacancy.status)}</span></td>
        <td><span class="muted">${escapeHtml(formatDate(vacancy.updated_at))}</span></td>
        <td><div class="actions">${actionButtons(vacancy)}</div></td>
      </tr>
    `;
  }).join('');
}

async function loadCompanies() {
  const result = await api('/api/empresas');
  state.companies = result.empresas;
  elements.companySelect.innerHTML = state.companies
    .map((company) => `<option value="${company.id}">${escapeHtml(company.nome)}</option>`)
    .join('');
}

async function loadVacancies() {
  setLoading(true);
  try {
    const result = await api('/api/vagas');
    state.vacancies = result.vagas;
    renderVacancies();
  } catch (error) {
    elements.emptyState.classList.remove('hidden');
    elements.emptyState.innerHTML = `<strong>Não foi possível carregar as vagas.</strong><span>${escapeHtml(error.message)}</span>`;
    showToast(error.message, 'error');
  } finally {
    setLoading(false);
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

  if (state.companies.length === 1) {
    elements.companySelect.value = String(state.companies[0].id);
  }
}

function fillForm(vacancy) {
  resetForm();
  elements.vacancyId.value = String(vacancy.id);
  elements.dialogTitle.textContent = `Editar ${vacancy.codigo}`;

  const fields = [
    'empresa_id', 'codigo', 'titulo', 'cargo', 'descricao', 'cidade', 'estado',
    'bairro', 'endereco_referencia', 'tipo_contrato', 'modalidade', 'escala',
    'horario', 'salario', 'beneficios', 'escolaridade_minima',
    'experiencia_minima_meses', 'requisitos_obrigatorios',
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

function formPayload() {
  const data = new FormData(elements.vacancyForm);
  return {
    empresa_id: data.get('empresa_id'),
    codigo: data.get('codigo'),
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
    await loadVacancies();
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

  const action = statusLabels[status] || status;
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

async function copyCode(id) {
  const vacancy = findVacancyById(id);
  if (!vacancy) {
    showToast('Não foi possível localizar a vaga selecionada.', 'error');
    return;
  }
  const text = `Olá, tenho interesse na vaga ${vacancy.codigo}.`;

  try {
    await navigator.clipboard.writeText(text);
    showToast('Mensagem com o código da vaga copiada.');
  } catch {
    showToast(`Copie esta mensagem: ${text}`);
  }
}

function handleTableClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === 'edit') openEditVacancy(id);
  if (action === 'status') changeStatus(id, button.dataset.status);
  if (action === 'copy') copyCode(id);
}

elements.newVacancyButton.addEventListener('click', openNewVacancy);
elements.refreshButton.addEventListener('click', loadVacancies);
elements.searchInput.addEventListener('input', renderVacancies);
elements.statusFilter.addEventListener('change', renderVacancies);
elements.vacancyForm.addEventListener('submit', saveVacancy);
elements.tableBody.addEventListener('click', handleTableClick);
elements.closeDialogButton.addEventListener('click', () => elements.vacancyDialog.close());
elements.cancelButton.addEventListener('click', () => elements.vacancyDialog.close());

elements.vacancyDialog.addEventListener('click', (event) => {
  if (event.target === elements.vacancyDialog) {
    elements.vacancyDialog.close();
  }
});

async function initialize() {
  try {
    await loadCompanies();
    await loadVacancies();
  } catch (error) {
    setLoading(false);
    showToast(error.message, 'error');
  }
}

initialize();
