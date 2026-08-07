'use strict';

(() => {
  const app = () => window.GenesisApp;
  const $ = (id) => document.getElementById(id);
  const moneyUsd = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
  const quantityChoices = [10, 25, 50, 100];

  const state = {
    config: null,
    runs: [],
    leads: [],
    leadSummary: {},
    users: [],
    quantity: 25,
    leadStatus: 'TODOS',
    leadSearch: '',
    leadFilters: { categoria: '', estado: '', cidade: '', prioridade: '', responsavel: '', score_min: '', contato: '', resposta: '' },
    leadFilterOptions: { categorias: [], estados: [], cidades: [], responsaveis: [] },
    pollingTimer: null,
    bound: false,
  };

  const statusLabels = {
    PREPARANDO: 'Preparando', READY: 'Pronta', RUNNING: 'Em execução', SUCCEEDED: 'Concluída',
    FAILED: 'Falhou', 'TIMING-OUT': 'Finalizando por tempo', ABORTING: 'Interrompendo', ABORTED: 'Interrompida', 'TIMED-OUT': 'Tempo esgotado',
    NOVO: 'Novo', EM_ANALISE: 'Em análise', APROVADO_CONTATO: 'Aprovado para contato',
    PRIMEIRO_CONTATO: 'Primeiro contato', RESPONDEU: 'Respondeu', REUNIAO: 'Reunião',
    PROPOSTA: 'Proposta', CLIENTE: 'Cliente', DESCARTADO: 'Descartado', SEM_INTERESSE: 'Sem interesse',
    CONTATO_INVALIDO: 'Contato inválido', NAO_CONTATAR: 'Não contatar',
  };

  const pipelineOptions = [
    'NOVO','EM_ANALISE','APROVADO_CONTATO','PRIMEIRO_CONTATO','RESPONDEU','REUNIAO','PROPOSTA','CLIENTE','DESCARTADO','SEM_INTERESSE','CONTATO_INVALIDO','NAO_CONTATAR',
  ];

  function safe(value) { return app().escapeHtml(value ?? ''); }
  function toast(message, type = 'success') { app().showToast(message, type); }
  function fmtDate(value) { return value ? app().formatDate(value) : '—'; }
  function fmtPhone(value) { return value ? app().formatPhone(value) : 'Não informado'; }
  function isAdmin() { return String(app().state.currentUser?.perfil || '').toUpperCase() === 'ADMIN'; }

  function estimateCost(quantity = state.quantity) {
    const config = state.config || {};
    return Number(config.custo_estimado_inicio_usd || 0.007) + ((Number(quantity || 0) / 1000) * Number(config.custo_estimado_por_1000_usd || 1.5));
  }

  function updateQuantityUI(quantity) {
    const max = Number(state.config?.limite_maximo_execucao || 100);
    const allowed = quantityChoices.filter((value) => value <= max);
    state.quantity = allowed.includes(Number(quantity)) ? Number(quantity) : (allowed[0] || 10);
    document.querySelectorAll('[data-prospect-quantity]').forEach((button) => {
      const value = Number(button.dataset.prospectQuantity);
      button.disabled = value > max;
      button.classList.toggle('active', value === state.quantity);
    });
    const estimated = estimateCost(state.quantity);
    if ($('prospectingEstimate')) $('prospectingEstimate').textContent = moneyUsd(estimated);
    if ($('prospectingEstimateHelp')) {
      $('prospectingEstimateHelp').textContent = `Estimativa preventiva para até ${state.quantity} empresas. Sem enriquecimento de leads, redes sociais ou avaliações completas.`;
    }
  }

  function renderConfig() {
    const config = state.config || {};
    $('prospectingBudget').textContent = moneyUsd(config.orcamento_mensal_usd);
    $('prospectingUsed').textContent = moneyUsd(config.uso_mes_usd);
    $('prospectingBalance').textContent = moneyUsd(config.saldo_estimado_usd);
    $('prospectingImported').textContent = Number(config.leads_importados_mes || 0);
    $('prospectingRunsMonth').textContent = `${Number(config.execucoes_mes || 0)} execução${Number(config.execucoes_mes || 0) === 1 ? '' : 'ões'}`;

    $('prospectingMonthlyBudgetInput').value = Number(config.orcamento_mensal_usd || 5).toFixed(2);
    $('prospectingCostPerThousandInput').value = Number(config.custo_estimado_por_1000_usd || 1.5).toFixed(2);
    $('prospectingDefaultLimit').value = String(config.limite_padrao || 25);
    $('prospectingMaxLimit').value = String(config.limite_maximo_execucao || 100);
    $('prospectingEnabled').checked = Boolean(config.ativo);

    const badge = $('apifyConnectionBadge');
    if (badge) {
      badge.textContent = config.token_configurado ? 'Apify conectada' : 'Token pendente';
      badge.className = `badge ${config.token_configurado ? 'badge-active' : 'badge-rejected'}`;
    }
    updateQuantityUI(config.limite_padrao || state.quantity);
    $('startProspectingButton').disabled = !config.ativo || !config.token_configurado;
  }

  function runBadge(status) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'SUCCEEDED') return 'badge-active';
    if (['FAILED','ABORTED','TIMED-OUT'].includes(normalized)) return 'badge-rejected';
    if (['RUNNING','READY','PREPARANDO','ABORTING'].includes(normalized)) return 'badge-process';
    return 'badge-neutral';
  }

  function renderRuns() {
    const container = $('prospectingRunsList');
    if (!container) return;
    if (!state.runs.length) {
      container.innerHTML = app().emptyState('Nenhuma busca executada', 'Use 10 empresas no primeiro teste para medir o consumo real da sua conta.');
      return;
    }
    container.innerHTML = state.runs.map((run) => {
      const status = String(run.status || '').toUpperCase();
      const canSync = Boolean(run.apify_run_id) && !['FAILED','ABORTED','TIMED-OUT'].includes(status);
      const canAbort = Boolean(run.apify_run_id) && ['PREPARANDO','READY','RUNNING'].includes(status);
      return `<article class="admin-run-card">
        <div class="admin-run-main">
          <div class="admin-run-title"><strong>${safe(run.termo_busca)}</strong><span class="badge ${runBadge(status)}">${safe(statusLabels[status] || status)}</span></div>
          <p>${safe(run.localizacao)} · limite ${Number(run.quantidade_solicitada || 0)}</p>
          <div class="admin-run-stats">
            <span>Encontradas <b>${Number(run.quantidade_encontrada || 0)}</b></span>
            <span>Importadas <b>${Number(run.quantidade_importada || 0)}</b></span>
            <span>Duplicadas <b>${Number(run.quantidade_duplicada || 0)}</b></span>
            <span>Custo <b>${moneyUsd(run.custo_real_usd ?? run.custo_estimado_usd)}</b></span>
          </div>
          ${run.erro ? `<div class="inline-error">${safe(run.erro)}</div>` : ''}
          <small>Iniciada por ${safe(run.iniciado_por_nome || 'Administrador')} em ${safe(fmtDate(run.iniciado_at))}</small>
        </div>
        <div class="admin-run-actions">
          ${canSync ? `<button class="button button-ghost compact" data-admin-action="sync-run" data-id="${run.id}" type="button">Sincronizar</button>` : ''}
          ${canAbort ? `<button class="button button-danger compact" data-admin-action="abort-run" data-id="${run.id}" type="button">Interromper</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function scoreClass(score) {
    if (Number(score) >= 80) return 'score-high';
    if (Number(score) >= 60) return 'score-medium';
    return 'score-low';
  }

  function renderLeadSummary() {
    const summary = state.leadSummary || {};
    $('prospectLeadTotal').textContent = Number(summary.total || 0);
    $('prospectLeadNew').textContent = Number(summary.novos || 0);
    $('prospectLeadApproved').textContent = Number(summary.aprovados || 0);
    $('prospectLeadOpportunities').textContent = Number(summary.oportunidades || 0);
    $('prospectLeadClients').textContent = Number(summary.clientes || 0);
  }

  function renderLeads() {
    const tbody = $('prospectLeadsTableBody');
    if (!tbody) return;
    renderLeadSummary();
    if (!state.leads.length) {
      tbody.innerHTML = `<tr><td colspan="6">${app().emptyState('Nenhum prospecto encontrado', 'Execute uma busca ou altere os filtros.')}</td></tr>`;
      return;
    }
    tbody.innerHTML = state.leads.map((lead) => {
      const web = lead.website ? `<a class="text-link" href="${safe(lead.website)}" target="_blank" rel="noopener">Site</a>` : '';
      const maps = lead.google_maps_url ? `<a class="text-link" href="${safe(lead.google_maps_url)}" target="_blank" rel="noopener">Maps</a>` : '';
      const phoneDigits = String(lead.telefone_normalizado || '').replace(/\D+/g, '');
      const whatsapp = phoneDigits ? `<a class="button button-ghost compact" href="https://wa.me/${safe(phoneDigits)}" target="_blank" rel="noopener">WhatsApp</a>` : '';
      const assisted = phoneDigits && !lead.nao_contatar && lead.status === 'APROVADO_CONTATO' ? `<button class="button button-primary compact" data-admin-action="assisted-contact" data-id="${lead.id}" type="button">Preparar contato</button>` : '';
      const reply = lead.resposta_tipo ? `<span class="lead-reply-badge ${safe(String(lead.resposta_tipo).toLowerCase())}">${lead.resposta_tipo === 'HUMANA' ? 'Resposta humana' : lead.resposta_tipo === 'AUTOMATICA' ? 'Resposta automática' : lead.resposta_tipo === 'DESCADASTRO' ? 'Descadastrado' : safe(lead.resposta_tipo)}</span>` : '';
      const options = pipelineOptions.map((status) => `<option value="${status}" ${status === lead.status ? 'selected' : ''}>${safe(statusLabels[status] || status)}</option>`).join('');
      return `<tr data-lead-row="${lead.id}">
        <td><div class="table-primary"><strong>${safe(lead.empresa_nome)}</strong><span>${safe(lead.categoria || 'Categoria não informada')}</span><div class="table-inline-links">${web}${maps}</div></div></td>
        <td><div class="table-primary"><strong>${safe(fmtPhone(lead.telefone))}</strong><span>${safe(lead.email || 'E-mail não encontrado')}</span>${reply}</div></td>
        <td><div class="table-primary"><strong>${safe([lead.cidade, lead.estado].filter(Boolean).join(' - ') || 'Não informado')}</strong><span>${safe(lead.bairro || lead.endereco || '')}</span></div></td>
        <td><div class="lead-score ${scoreClass(lead.score)}"><strong>${Number(lead.score || 0)}</strong><span>/100</span></div><small>${Number(lead.avaliacao || 0).toFixed(1)} ★ · ${Number(lead.quantidade_avaliacoes || 0)} avaliações</small></td>
        <td><div class="lead-controls"><select data-lead-field="status">${options}</select><select data-lead-field="prioridade"><option value="BAIXA" ${lead.prioridade === 'BAIXA' ? 'selected' : ''}>Baixa</option><option value="MEDIA" ${lead.prioridade === 'MEDIA' ? 'selected' : ''}>Média</option><option value="ALTA" ${lead.prioridade === 'ALTA' ? 'selected' : ''}>Alta</option></select><label class="mini-check"><input data-lead-field="nao_contatar" type="checkbox" ${lead.nao_contatar ? 'checked' : ''}> Não contatar</label></div></td>
        <td><div class="table-actions">${assisted}${whatsapp}<button class="button button-ghost compact" data-admin-action="save-lead" data-id="${lead.id}" type="button">Salvar</button><button class="button button-ghost compact" data-admin-action="add-lead-note" data-id="${lead.id}" type="button">Nota</button></div></td>
      </tr>`;
    }).join('');
  }

  async function loadConfig() {
    const data = await app().api('/api/admin/prospeccao/configuracao');
    state.config = data.configuracao || {};
    renderConfig();
  }

  async function loadRuns() {
    const data = await app().api('/api/admin/prospeccao/execucoes');
    state.runs = data.execucoes || [];
    renderRuns();
    schedulePolling();
  }

  async function loadLeads() {
    const params = new URLSearchParams({ status: state.leadStatus, q: state.leadSearch, limit: '500' });
    Object.entries(state.leadFilters).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined) params.set(key, value); });
    const data = await app().api(`/api/admin/prospeccao/leads?${params}`);
    state.leads = data.leads || [];
    state.leadSummary = data.resumo || {};
    state.leadFilterOptions = data.filtros || state.leadFilterOptions;
    renderLeadFilters();
    renderLeads();
  }

  function populateFilter(id, values, selected, valueKey = null, labelKey = null) {
    const select = $(id);
    if (!select) return;
    const first = select.options[0]?.outerHTML || '<option value="">Todos</option>';
    select.innerHTML = first + (values || []).map((item) => {
      const value = valueKey ? item[valueKey] : item;
      const label = labelKey ? item[labelKey] : item;
      return `<option value="${safe(value)}">${safe(label)}</option>`;
    }).join('');
    select.value = String(selected || '');
  }

  function renderLeadFilters() {
    const options = state.leadFilterOptions || {};
    populateFilter('prospectCategoryFilter', options.categorias, state.leadFilters.categoria);
    populateFilter('prospectStateFilter', options.estados, state.leadFilters.estado);
    populateFilter('prospectCityFilter', options.cidades, state.leadFilters.cidade);
    populateFilter('prospectOwnerFilter', options.responsaveis, state.leadFilters.responsavel, 'id', 'nome');
    const filterIds = {
      prospectCategoryFilter: 'categoria', prospectStateFilter: 'estado', prospectCityFilter: 'cidade',
      prospectPriorityFilter: 'prioridade', prospectOwnerFilter: 'responsavel', prospectScoreFilter: 'score_min',
      prospectContactFilter: 'contato', prospectReplyFilter: 'resposta',
    };
    Object.entries(filterIds).forEach(([id, key]) => $(id)?.closest('.table-filter-menu')?.classList.toggle('has-active-filter', Boolean(state.leadFilters[key])));
  }

  async function loadProspecting(force = false) {
    if (!isAdmin()) return;
    await Promise.all([loadConfig(), loadRuns(), loadLeads()]);
  }

  function schedulePolling() {
    clearTimeout(state.pollingTimer);
    const hasActive = state.runs.some((run) => ['PREPARANDO','READY','RUNNING','TIMING-OUT','ABORTING'].includes(String(run.status || '').toUpperCase()));
    if (!hasActive || app().state.activeView !== 'prospecting') return;
    state.pollingTimer = setTimeout(async () => {
      try {
        const active = state.runs.filter((run) => ['PREPARANDO','READY','RUNNING','TIMING-OUT','ABORTING'].includes(String(run.status || '').toUpperCase()));
        for (const run of active.slice(0, 3)) await syncRun(run.id, false);
        await Promise.all([loadConfig(), loadRuns(), loadLeads()]);
      } catch (error) { console.warn(error); }
    }, 20000);
  }

  async function startRun(event) {
    event.preventDefault();
    const term = $('prospectingTerm').value.trim();
    const location = $('prospectingLocation').value.trim();
    if (!term || !location) return toast('Informe o segmento e a localização.', 'error');
    const estimate = estimateCost(state.quantity);
    const balance = Number(state.config?.saldo_estimado_usd || 0);
    if (estimate > balance) return toast('A estimativa ultrapassa o saldo preventivo local.', 'error');
    const ok = window.confirm(`Iniciar busca por até ${state.quantity} empresas?\n\nCusto preventivo estimado: ${moneyUsd(estimate)}\nSaldo local antes da busca: ${moneyUsd(balance)}\n\nA cobrança real é controlada pela Apify e pode variar.`);
    if (!ok) return;
    const button = $('startProspectingButton');
    button.disabled = true;
    button.textContent = 'Iniciando na Apify...';
    try {
      const data = await app().api('/api/admin/prospeccao/execucoes', {
        method: 'POST',
        body: JSON.stringify({ termo_busca: term, localizacao: location, quantidade: state.quantity, confirmar_custo: true }),
      });
      toast(data.mensagem || 'Busca iniciada.');
      await Promise.all([loadConfig(), loadRuns()]);
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Iniciar busca controlada'; }
  }

  async function saveConfig(event) {
    event.preventDefault();
    try {
      const payload = {
        orcamento_mensal_usd: Number($('prospectingMonthlyBudgetInput').value || 0),
        custo_estimado_por_1000_usd: Number($('prospectingCostPerThousandInput').value || 0),
        limite_padrao: Number($('prospectingDefaultLimit').value || 25),
        limite_maximo_execucao: Number($('prospectingMaxLimit').value || 100),
        ativo: $('prospectingEnabled').checked,
      };
      const data = await app().api('/api/admin/prospeccao/configuracao', { method: 'PATCH', body: JSON.stringify(payload) });
      toast(data.mensagem || 'Limites atualizados.');
      await loadConfig();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function syncRun(id, notify = true) {
    const data = await app().api(`/api/admin/prospeccao/execucoes/${id}/sincronizar`, { method: 'POST', body: '{}' });
    if (notify) toast(data.mensagem || 'Execução sincronizada.');
    return data;
  }

  async function abortRun(id) {
    if (!window.confirm('Interromper esta execução na Apify? Resultados já consumidos podem continuar sendo cobrados.')) return;
    const data = await app().api(`/api/admin/prospeccao/execucoes/${id}/abortar`, { method: 'POST', body: '{}' });
    toast(data.mensagem || 'Interrupção solicitada.');
    await loadRuns();
  }

  async function saveLead(id) {
    const row = document.querySelector(`[data-lead-row="${id}"]`);
    if (!row) return;
    const payload = {
      status: row.querySelector('[data-lead-field="status"]').value,
      prioridade: row.querySelector('[data-lead-field="prioridade"]').value,
      nao_contatar: row.querySelector('[data-lead-field="nao_contatar"]').checked,
      motivo_descarte: null,
      observacao: null,
    };
    const data = await app().api(`/api/admin/prospeccao/leads/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast(data.mensagem || 'Lead atualizado.');
    await loadLeads();
  }

  async function addLeadNote(id) {
    const note = window.prompt('Digite uma nota interna sobre esta empresa:');
    if (!note?.trim()) return;
    const data = await app().api(`/api/admin/prospeccao/leads/${id}/notas`, { method: 'POST', body: JSON.stringify({ nota: note.trim() }) });
    toast(data.mensagem || 'Nota adicionada.');
  }

  function renderUsers() {
    const container = $('usersList');
    if (!container) return;
    const companyOptions = (selected) => `<option value="">Todas / não vinculada</option>${(app().state.companies || []).map((company) => `<option value="${company.id}" ${Number(company.id) === Number(selected) ? 'selected' : ''}>${safe(company.nome)}</option>`).join('')}`;
    if ($('newUserCompany')) $('newUserCompany').innerHTML = companyOptions('');
    if (!state.users.length) {
      container.innerHTML = app().emptyState('Nenhum usuário cadastrado', 'Crie o primeiro login administrativo.');
      return;
    }
    container.innerHTML = state.users.map((user) => `<article class="user-card" data-user-card="${user.id}">
      <div class="user-avatar">${safe((user.nome || user.usuario || '?').slice(0, 1).toUpperCase())}</div>
      <div class="user-main"><strong>${safe(user.nome)}</strong><span>@${safe(user.usuario)} · último acesso ${safe(user.ultimo_login_at ? fmtDate(user.ultimo_login_at) : 'ainda não realizado')}</span><small>${safe(user.empresa_nome || 'Sem empresa exclusiva')} · criado em ${safe(fmtDate(user.created_at))}</small></div>
      <div class="user-controls"><select data-user-field="perfil"><option value="RECRUTADOR" ${user.perfil === 'RECRUTADOR' ? 'selected' : ''}>Recrutador</option><option value="ADMIN" ${user.perfil === 'ADMIN' ? 'selected' : ''}>Administrador</option></select><select data-user-field="empresa_id">${companyOptions(user.empresa_id)}</select><input data-user-field="telefone_whatsapp" type="tel" inputmode="tel" value="${safe(user.telefone_whatsapp || '')}" placeholder="WhatsApp para alertas"><label class="mini-check"><input data-user-field="alerta_entrevista" type="checkbox" ${user.alerta_entrevista !== false ? 'checked' : ''}> Entrevistas</label><label class="mini-check"><input data-user-field="alerta_revisao" type="checkbox" ${user.alerta_revisao !== false ? 'checked' : ''}> Revisões</label><label class="mini-check"><input data-user-field="ativo" type="checkbox" ${user.ativo ? 'checked' : ''}> Ativo</label></div>
      <div class="user-actions"><button class="button button-ghost compact" data-admin-action="save-user" data-id="${user.id}" type="button">Salvar</button><button class="button button-ghost compact" data-admin-action="reset-password" data-id="${user.id}" type="button">Nova senha</button></div>
    </article>`).join('');
  }

  async function loadUsers() {
    if (!isAdmin()) return;
    const data = await app().api('/api/admin/usuarios');
    state.users = data.usuarios || [];
    renderUsers();
  }

  async function createUser(event) {
    event.preventDefault();
    const payload = {
      nome: $('newUserName').value.trim(),
      usuario: $('newUsername').value.trim(),
      senha: $('newUserPassword').value,
      perfil: $('newUserRole').value,
      empresa_id: $('newUserCompany').value || null,
      telefone_whatsapp: $('newUserWhatsapp').value.trim(),
      alerta_entrevista: $('newUserInterviewAlerts').checked,
      alerta_revisao: $('newUserReviewAlerts').checked,
      ativo: $('newUserActive').checked,
    };
    try {
      const data = await app().api('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(payload) });
      toast(data.mensagem || 'Usuário criado.');
      $('createUserForm').reset();
      $('newUserInterviewAlerts').checked = true;
      $('newUserReviewAlerts').checked = true;
      $('newUserActive').checked = true;
      await loadUsers();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function saveUser(id) {
    const card = document.querySelector(`[data-user-card="${id}"]`);
    const current = state.users.find((user) => Number(user.id) === Number(id));
    if (!card || !current) return;
    const payload = {
      nome: current.nome,
      perfil: card.querySelector('[data-user-field="perfil"]').value,
      empresa_id: card.querySelector('[data-user-field="empresa_id"]').value || null,
      telefone_whatsapp: card.querySelector('[data-user-field="telefone_whatsapp"]').value.trim(),
      alerta_entrevista: card.querySelector('[data-user-field="alerta_entrevista"]').checked,
      alerta_revisao: card.querySelector('[data-user-field="alerta_revisao"]').checked,
      ativo: card.querySelector('[data-user-field="ativo"]').checked,
    };
    const data = await app().api(`/api/admin/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    toast(data.mensagem || 'Usuário atualizado.');
    await loadUsers();
  }

  async function resetPassword(id) {
    const password = window.prompt('Digite a nova senha (mínimo de 8 caracteres):');
    if (!password) return;
    if (password.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
    const confirmation = window.prompt('Repita a nova senha:');
    if (password !== confirmation) return toast('As senhas não são iguais.', 'error');
    const data = await app().api(`/api/admin/usuarios/${id}/redefinir-senha`, { method: 'POST', body: JSON.stringify({ senha: password }) });
    toast(data.mensagem || 'Senha redefinida.');
  }

  function focusNewProspecting() {
    $('prospectingTerm')?.focus();
    $('prospectingRunForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function focusNewUser() {
    $('newUserName')?.focus();
    $('createUserForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function delegatedClick(event) {
    const quantity = event.target.closest('[data-prospect-quantity]');
    if (quantity) return updateQuantityUI(Number(quantity.dataset.prospectQuantity));
    const action = event.target.closest('[data-admin-action]');
    if (!action) return;
    const id = Number(action.dataset.id);
    Promise.resolve()
      .then(async () => {
        if (action.dataset.adminAction === 'sync-run') { await syncRun(id); await Promise.all([loadConfig(), loadRuns(), loadLeads()]); }
        if (action.dataset.adminAction === 'abort-run') await abortRun(id);
        if (action.dataset.adminAction === 'save-lead') await saveLead(id);
        if (action.dataset.adminAction === 'add-lead-note') await addLeadNote(id);
        if (action.dataset.adminAction === 'assisted-contact') {
          const lead = state.leads.find((item) => Number(item.id) === id);
          if (lead) await window.GenesisOperationsV14?.openOutreach(lead);
        }
        if (action.dataset.adminAction === 'save-user') await saveUser(id);
        if (action.dataset.adminAction === 'reset-password') await resetPassword(id);
      })
      .catch((error) => toast(error.message, 'error'));
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $('prospectingRunForm')?.addEventListener('submit', startRun);
    $('prospectingConfigForm')?.addEventListener('submit', saveConfig);
    $('refreshProspectingRuns')?.addEventListener('click', () => Promise.all([loadConfig(), loadRuns(), loadLeads()]).catch((error) => toast(error.message, 'error')));
    $('prospectLeadStatusSegments')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-prospect-status]');
      if (!button) return;
      state.leadStatus = button.dataset.prospectStatus;
      $('prospectLeadStatusSegments').querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
      loadLeads().catch((error) => toast(error.message, 'error'));
    });
    let searchTimer;
    $('prospectLeadSearch')?.addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      state.leadSearch = event.target.value.trim();
      searchTimer = setTimeout(() => loadLeads().catch((error) => toast(error.message, 'error')), 350);
    });
    const leadFilterBindings = {
      prospectCategoryFilter: 'categoria', prospectStateFilter: 'estado', prospectCityFilter: 'cidade',
      prospectPriorityFilter: 'prioridade', prospectOwnerFilter: 'responsavel', prospectScoreFilter: 'score_min',
      prospectContactFilter: 'contato', prospectReplyFilter: 'resposta',
    };
    Object.entries(leadFilterBindings).forEach(([id, key]) => $(id)?.addEventListener('change', (event) => {
      state.leadFilters[key] = event.target.value;
      event.target.closest('details')?.removeAttribute('open');
      loadLeads().catch((error) => toast(error.message, 'error'));
    }));
    $('clearProspectFiltersButton')?.addEventListener('click', () => {
      Object.keys(state.leadFilters).forEach((key) => { state.leadFilters[key] = ''; });
      Object.keys(leadFilterBindings).forEach((id) => { if ($(id)) $(id).value = ''; });
      loadLeads().catch((error) => toast(error.message, 'error'));
    });
    $('createUserForm')?.addEventListener('submit', createUser);
    $('refreshUsersButton')?.addEventListener('click', () => loadUsers().catch((error) => toast(error.message, 'error')));
    document.addEventListener('click', delegatedClick);
  }

  window.GenesisAdmin = { loadProspecting, loadUsers, focusNewProspecting, focusNewUser };
  document.addEventListener('DOMContentLoaded', bind);
})();
