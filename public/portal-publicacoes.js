'use strict';

(function () {
  const state = {
    loaded: false,
    tab: 'groups',
    groupStatus: 'pending',
    jobStatus: 'PENDENTE',
    leadStatus: 'NOVO',
    groupSearch: '', jobSearch: '', accountSearch: '',
    timers: {},
  };

  function app() { return window.GenesisApp; }
  function byId(id) { return document.getElementById(id); }
  function esc(value) { return app()?.escapeHtml(value ?? '') || String(value ?? ''); }
  function date(value) { return app()?.formatDate(value) || String(value || ''); }
  function money(value) { return value == null ? 'Não informado' : app()?.formatMoney(Number(value)); }
  function toast(message, type = '') { app()?.showToast(message, type); }
  async function api(url, options) { return app().api(url, options); }
  function portalUrl(path = '') { return `${String(app()?.state?.portalBaseUrl || '').replace(/\/$/, '')}${path}`; }
  function phoneUrl(value) { const digits = String(value || '').replace(/\D/g, ''); return digits ? `https://wa.me/${digits}` : ''; }
  function statusClass(value) {
    const normalized = String(value || '').toUpperCase();
    if (['APPROVED', 'APROVADA', 'CONVERTIDA', 'CLIENTE', 'ATIVA'].includes(normalized)) return 'success';
    if (['PENDING', 'PENDENTE', 'EM_REVISAO', 'NOVO', 'CONTATADO'].includes(normalized)) return 'warning';
    if (['REJECTED', 'REJEITADA', 'SUSPENDED', 'EXPIRED', 'BLOQUEADA'].includes(normalized)) return 'danger';
    return '';
  }
  function empty(title, description = '') { return `<div class="empty-state"><strong>${esc(title)}</strong>${description ? `<span>${esc(description)}</span>` : ''}</div>`; }

  async function load(force = false) {
    if (!app()?.currentUserIsAdmin && app()?.state?.currentUser && String(app().state.currentUser.perfil).toUpperCase() !== 'ADMIN') return;
    if (!force && state.loaded) return;
    await Promise.all([loadSummary(), loadCurrentTab()]);
    state.loaded = true;
    const link = byId('openPublicPortalButton');
    if (link) {
      const base = portalUrl('');
      link.href = base || '#';
      link.classList.toggle('hidden', !base);
    }
  }

  async function loadSummary() {
    const data = await api('/api/portal-publicacoes/resumo');
    const summary = data.resumo || {};
    if (data.portal_base_url) app().state.portalBaseUrl = data.portal_base_url;
    byId('portalKpiPendingGroups').textContent = Number(summary.grupos_pendentes || 0);
    byId('portalKpiPendingJobs').textContent = Number(summary.vagas_pendentes || 0);
    byId('portalKpiNewLeads').textContent = Number(summary.leads_novos || 0);
    byId('portalKpiReports').textContent = Number(summary.denuncias_pendentes || 0);
    byId('portalKpiClicks').textContent = Number(summary.acessos_grupos_30d || 0).toLocaleString('pt-BR');
  }

  async function loadCurrentTab() {
    if (state.tab === 'groups') return loadGroups();
    if (state.tab === 'jobs') return loadJobs();
    return loadAccounts();
  }

  async function loadGroups() {
    const target = byId('portalGroupsList');
    target.innerHTML = '<div class="empty-state">Carregando grupos...</div>';
    const params = new URLSearchParams({ limite: '60' });
    if (state.groupStatus) params.set('status', state.groupStatus);
    if (state.groupSearch) params.set('q', state.groupSearch);
    const data = await api(`/api/portal-publicacoes/grupos?${params}`);
    target.innerHTML = data.grupos?.length ? data.grupos.map(groupCard).join('') : empty('Nenhum grupo neste filtro', 'Altere o status ou faça outra busca.');
  }

  function groupCard(group) {
    const image = group.has_image && portalUrl('') ? `${portalUrl('')}/media/grupos/${group.id}.webp` : (group.image_url || '/assets/brand/genesis-mark.svg');
    const publicLink = group.slug && portalUrl('') ? `${portalUrl('')}/grupo/${group.slug}` : '';
    const owner = group.conta_nome || group.owner_name || 'Cadastro legado';
    const ownerContact = group.conta_whatsapp || group.owner_phone || '';
    return `<article class="portal-publication-card" data-portal-group-card="${group.id}">
      <div class="portal-publication-media"><img src="${esc(image)}" alt="" loading="lazy"><span class="portal-status ${statusClass(group.status)}">${esc(group.status)}</span></div>
      <div class="portal-publication-body">
        <div class="portal-publication-head"><div><p class="eyebrow">${esc(group.category || 'Grupo')}</p><h3>${esc(group.name)}</h3><span>${esc([group.city, group.region, group.state].filter(Boolean).join(' · '))}</span></div><div class="portal-publication-stats"><b>${Number(group.view_count || 0).toLocaleString('pt-BR')}</b><small>visualizações</small><b>${Number(group.click_count || 0).toLocaleString('pt-BR')}</b><small>acessos</small></div></div>
        <p class="portal-publication-description">${esc(group.description || '')}</p>
        <div class="portal-publisher"><div><strong>${esc(owner)}</strong><span>${esc(group.conta_empresa || group.conta_email || group.owner_email || '')}</span></div>${ownerContact ? `<a class="button button-ghost button-small" href="${phoneUrl(ownerContact)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
        ${Number(group.report_count || 0) ? `<div class="portal-warning">⚠ ${Number(group.report_count)} denúncia(s) pendente(s)</div>` : ''}
        <details class="portal-review-details"><summary>Revisar e moderar</summary>
          <div class="portal-review-grid">
            <label class="field"><span>Status</span><select data-group-status><option value="pending" ${group.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="approved" ${group.status === 'approved' ? 'selected' : ''}>Aprovado</option><option value="rejected" ${group.status === 'rejected' ? 'selected' : ''}>Rejeitado</option><option value="suspended" ${group.status === 'suspended' ? 'selected' : ''}>Suspenso</option><option value="expired" ${group.status === 'expired' ? 'selected' : ''}>Link expirado</option></select></label>
            <label class="toggle-field"><input data-group-verified type="checkbox" ${group.verified ? 'checked' : ''}><span><strong>Verificado</strong><small>Convite e conteúdo conferidos.</small></span></label>
            <label class="toggle-field"><input data-group-featured type="checkbox" ${group.featured ? 'checked' : ''}><span><strong>Destaque</strong><small>Aparece primeiro no diretório.</small></span></label>
            <label class="toggle-field"><input data-group-official type="checkbox" ${group.official ? 'checked' : ''}><span><strong>Oficial Gênesis</strong><small>Grupo administrado pela operação.</small></span></label>
            <label class="field span-2"><span>Motivo visível ao publicador</span><textarea data-group-reason rows="2" placeholder="Obrigatório ao rejeitar">${esc(group.rejection_reason || '')}</textarea></label>
            <label class="field span-2"><span>Nota interna</span><textarea data-group-note rows="2">${esc(group.moderation_note || '')}</textarea></label>
          </div>
          <div class="portal-review-actions"><a class="button button-ghost" href="${esc(group.invite_url || '#')}" target="_blank" rel="noopener">Testar convite ↗</a>${publicLink ? `<a class="button button-ghost" href="${esc(publicLink)}" target="_blank" rel="noopener">Página pública ↗</a>` : ''}<button class="button button-primary" data-save-group="${group.id}" type="button">Salvar moderação</button></div>
        </details>
      </div>
    </article>`;
  }

  async function saveGroup(id, card) {
    const payload = {
      status: card.querySelector('[data-group-status]').value,
      verified: card.querySelector('[data-group-verified]').checked,
      featured: card.querySelector('[data-group-featured]').checked,
      official: card.querySelector('[data-group-official]').checked,
      rejection_reason: card.querySelector('[data-group-reason]').value,
      moderation_note: card.querySelector('[data-group-note]').value,
    };
    await api(`/api/portal-publicacoes/grupos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('Moderação do grupo salva.');
    await Promise.all([loadSummary(), loadGroups()]);
  }

  async function loadJobs() {
    const target = byId('portalJobsList');
    target.innerHTML = '<div class="empty-state">Carregando vagas enviadas...</div>';
    const params = new URLSearchParams({ limite: '60' });
    if (state.jobStatus) params.set('status', state.jobStatus);
    if (state.jobSearch) params.set('q', state.jobSearch);
    const data = await api(`/api/portal-publicacoes/vagas?${params}`);
    target.innerHTML = data.vagas?.length ? data.vagas.map(jobCard).join('') : empty('Nenhuma vaga neste filtro', 'As novas submissões aparecerão aqui.');
  }

  function jobCard(job) {
    return `<article class="portal-publication-card portal-job-card" data-portal-job-card="${job.id}">
      <div class="portal-publication-body">
        <div class="portal-publication-head"><div><p class="eyebrow">${esc(job.empresa_nome)}</p><h3>${esc(job.titulo)}</h3><span>${esc([job.cargo, job.bairro, job.cidade, job.estado].filter(Boolean).join(' · '))}</span></div><span class="portal-status ${statusClass(job.status)}">${esc(job.status)}</span></div>
        <div class="portal-job-facts"><span><b>${money(job.salario)}</b> salário</span><span><b>${Number(job.quantidade_vagas || 1)}</b> vaga(s)</span><span><b>${esc(job.modalidade || 'Presencial')}</b> modalidade</span><span><b>${esc(job.escala || 'A definir')}</b> escala</span></div>
        <p class="portal-publication-description">${esc(job.descricao || '')}</p>
        <div class="portal-publisher"><div><strong>${esc(job.conta_nome)}</strong><span>${esc(job.conta_empresa || job.conta_email || '')}</span></div>${job.conta_whatsapp ? `<a class="button button-ghost button-small" href="${phoneUrl(job.conta_whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
        ${job.rejection_reason ? `<div class="portal-warning">${esc(job.rejection_reason)}</div>` : ''}
        <details class="portal-review-details"><summary>Revisar submissão</summary>
          <div class="portal-review-grid">
            <label class="field"><span>Status</span><select data-job-status ${job.status === 'CONVERTIDA' ? 'disabled' : ''}><option value="PENDENTE" ${job.status === 'PENDENTE' ? 'selected' : ''}>Pendente</option><option value="EM_REVISAO" ${job.status === 'EM_REVISAO' ? 'selected' : ''}>Em revisão</option><option value="APROVADA" ${job.status === 'APROVADA' ? 'selected' : ''}>Aprovada</option><option value="REJEITADA" ${job.status === 'REJEITADA' ? 'selected' : ''}>Rejeitada</option><option value="CANCELADA" ${job.status === 'CANCELADA' ? 'selected' : ''}>Cancelada</option></select></label>
            <label class="field span-2"><span>Motivo visível ao publicador</span><textarea data-job-reason rows="2" ${job.status === 'CONVERTIDA' ? 'disabled' : ''}>${esc(job.rejection_reason || '')}</textarea></label>
            <label class="field span-2"><span>Nota interna</span><textarea data-job-note rows="2" ${job.status === 'CONVERTIDA' ? 'disabled' : ''}>${esc(job.moderation_note || '')}</textarea></label>
          </div>
          <div class="portal-review-actions">${job.status !== 'CONVERTIDA' ? `<button class="button button-ghost" data-save-job="${job.id}" type="button">Salvar revisão</button><button class="button button-primary" data-convert-job="${job.id}" type="button">Criar rascunho oficial</button>` : `<button class="button button-primary" data-open-vacancies type="button">Abrir vaga #${Number(job.vaga_id || 0)}</button>`}</div>
        </details>
      </div>
    </article>`;
  }

  async function saveJob(id, card) {
    const payload = { status: card.querySelector('[data-job-status]').value, rejection_reason: card.querySelector('[data-job-reason]').value, moderation_note: card.querySelector('[data-job-note]').value };
    await api(`/api/portal-publicacoes/vagas/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('Revisão da vaga salva.');
    await Promise.all([loadSummary(), loadJobs()]);
  }
  async function convertJob(id) {
    if (!window.confirm('Criar esta vaga como RASCUNHO no painel oficial? Ela não será publicada até você revisar e ativar.')) return;
    const result = await api(`/api/portal-publicacoes/vagas/${id}/converter`, { method: 'POST', body: '{}' });
    toast(result.mensagem || 'Rascunho criado.');
    await Promise.all([loadSummary(), loadJobs()]);
  }

  async function loadAccounts() {
    const target = byId('portalAccountsList');
    target.innerHTML = '<div class="empty-state">Carregando contas...</div>';
    const params = new URLSearchParams({ limite: '60' });
    if (state.leadStatus) params.set('lead_status', state.leadStatus);
    if (state.accountSearch) params.set('q', state.accountSearch);
    const data = await api(`/api/portal-publicacoes/contas?${params}`);
    target.innerHTML = data.contas?.length ? data.contas.map(accountCard).join('') : empty('Nenhuma conta neste filtro', 'Novos recrutadores e empresas aparecerão aqui.');
  }

  function accountCard(account) {
    return `<article class="portal-publication-card portal-account-card" data-portal-account-card="${account.id}">
      <div class="portal-publication-body">
        <div class="portal-publication-head"><div><p class="eyebrow">${esc(account.tipo)}</p><h3>${esc(account.nome)}</h3><span>${esc(account.empresa_nome || 'Sem empresa informada')} · ${esc([account.cidade, account.estado].filter(Boolean).join(' · '))}</span></div><span class="portal-status ${statusClass(account.lead_status)}">${esc(account.lead_status)}</span></div>
        <div class="portal-contact-grid"><a href="mailto:${esc(account.email)}"><small>E-mail</small><strong>${esc(account.email)}</strong></a><a href="${phoneUrl(account.whatsapp)}" target="_blank" rel="noopener"><small>WhatsApp</small><strong>${esc(account.whatsapp)}</strong></a><div><small>Publicações</small><strong>${Number(account.grupos_total || 0)} grupos · ${Number(account.vagas_total || 0)} vagas</strong></div><div><small>Cadastro</small><strong>${esc(date(account.created_at))}</strong></div></div>
        <details class="portal-review-details"><summary>Trabalhar lead</summary>
          <div class="portal-review-grid">
            <label class="field"><span>Etapa comercial</span><select data-account-lead><option value="NOVO" ${account.lead_status === 'NOVO' ? 'selected' : ''}>Novo</option><option value="CONTATADO" ${account.lead_status === 'CONTATADO' ? 'selected' : ''}>Contatado</option><option value="QUALIFICADO" ${account.lead_status === 'QUALIFICADO' ? 'selected' : ''}>Qualificado</option><option value="CLIENTE" ${account.lead_status === 'CLIENTE' ? 'selected' : ''}>Cliente</option><option value="SEM_INTERESSE" ${account.lead_status === 'SEM_INTERESSE' ? 'selected' : ''}>Sem interesse</option></select></label>
            <label class="field"><span>Acesso</span><select data-account-status><option value="ATIVA" ${account.status === 'ATIVA' ? 'selected' : ''}>Ativa</option><option value="BLOQUEADA" ${account.status === 'BLOQUEADA' ? 'selected' : ''}>Bloqueada</option><option value="EXCLUIDA" ${account.status === 'EXCLUIDA' ? 'selected' : ''}>Excluída</option></select></label>
            <label class="field span-2"><span>Anotações comerciais</span><textarea data-account-note rows="3" placeholder="Interesse, momento, próximos passos...">${esc(account.observacao_interna || '')}</textarea></label>
          </div>
          <div class="portal-review-actions"><button class="button button-primary" data-save-account="${account.id}" type="button">Salvar lead</button></div>
        </details>
      </div>
    </article>`;
  }

  async function saveAccount(id, card) {
    const payload = { lead_status: card.querySelector('[data-account-lead]').value, status: card.querySelector('[data-account-status]').value, observacao_interna: card.querySelector('[data-account-note]').value };
    await api(`/api/portal-publicacoes/contas/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('Lead atualizado.');
    await Promise.all([loadSummary(), loadAccounts()]);
  }

  function activateTab(tab) {
    state.tab = tab;
    document.querySelectorAll('[data-portal-tab]').forEach((button) => button.classList.toggle('active', button.dataset.portalTab === tab));
    const map = { groups: 'portalPublicationsGroups', jobs: 'portalPublicationsJobs', accounts: 'portalPublicationsAccounts' };
    Object.entries(map).forEach(([key, id]) => byId(id)?.classList.toggle('hidden', key !== tab));
    loadCurrentTab().catch((error) => toast(error.message, 'error'));
  }
  function debounce(key, callback) {
    clearTimeout(state.timers[key]);
    state.timers[key] = setTimeout(callback, 350);
  }

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-portal-tab]');
    if (tab) return activateTab(tab.dataset.portalTab);
    const groupFilter = event.target.closest('[data-portal-group-status]');
    if (groupFilter) { state.groupStatus = groupFilter.dataset.portalGroupStatus; document.querySelectorAll('[data-portal-group-status]').forEach((b) => b.classList.toggle('active', b === groupFilter)); return loadGroups().catch((e) => toast(e.message, 'error')); }
    const jobFilter = event.target.closest('[data-portal-job-status]');
    if (jobFilter) { state.jobStatus = jobFilter.dataset.portalJobStatus; document.querySelectorAll('[data-portal-job-status]').forEach((b) => b.classList.toggle('active', b === jobFilter)); return loadJobs().catch((e) => toast(e.message, 'error')); }
    const leadFilter = event.target.closest('[data-portal-lead-status]');
    if (leadFilter) { state.leadStatus = leadFilter.dataset.portalLeadStatus; document.querySelectorAll('[data-portal-lead-status]').forEach((b) => b.classList.toggle('active', b === leadFilter)); return loadAccounts().catch((e) => toast(e.message, 'error')); }
    const groupSave = event.target.closest('[data-save-group]');
    if (groupSave) return saveGroup(groupSave.dataset.saveGroup, groupSave.closest('[data-portal-group-card]')).catch((e) => toast(e.message, 'error'));
    const jobSave = event.target.closest('[data-save-job]');
    if (jobSave) return saveJob(jobSave.dataset.saveJob, jobSave.closest('[data-portal-job-card]')).catch((e) => toast(e.message, 'error'));
    const jobConvert = event.target.closest('[data-convert-job]');
    if (jobConvert) return convertJob(jobConvert.dataset.convertJob).catch((e) => toast(e.message, 'error'));
    const accountSave = event.target.closest('[data-save-account]');
    if (accountSave) return saveAccount(accountSave.dataset.saveAccount, accountSave.closest('[data-portal-account-card]')).catch((e) => toast(e.message, 'error'));
    if (event.target.closest('[data-open-vacancies]')) return app().setView('vacancies');
  });

  byId('portalGroupSearch')?.addEventListener('input', (event) => { state.groupSearch = event.target.value.trim(); debounce('groups', () => loadGroups().catch((e) => toast(e.message, 'error'))); });
  byId('portalJobSearch')?.addEventListener('input', (event) => { state.jobSearch = event.target.value.trim(); debounce('jobs', () => loadJobs().catch((e) => toast(e.message, 'error'))); });
  byId('portalAccountSearch')?.addEventListener('input', (event) => { state.accountSearch = event.target.value.trim(); debounce('accounts', () => loadAccounts().catch((e) => toast(e.message, 'error'))); });

  window.GenesisPortalPublicacoes = { load };
})();
