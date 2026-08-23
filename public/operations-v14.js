'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const app = () => window.GenesisApp;
  const state = {
    brands: [],
    selectedBrand: null,
    agenda: null,
    agendaTimes: new Set(),
    recruiters: [],
    wizardStep: 1,
    promotionVacancyId: null,
    bound: false,
  };

  function safe(value) { return app().escapeHtml(value ?? ''); }
  function toast(message, type = 'success') { app().showToast(message, type); }
  function isAdmin() { return String(app().state.currentUser?.perfil || '').toUpperCase() === 'ADMIN'; }
  function color(value, fallback) { return /^#[0-9A-Fa-f]{6}$/.test(String(value || '')) ? String(value).toUpperCase() : fallback; }
  function wizardCards() {
    return [...document.querySelectorAll('#vacancyForm .form-card')];
  }

  function configureWizardCards() {
    const statusField = $('vacancyForm')?.elements?.status?.closest('.field');
    if (statusField) statusField.classList.add('hidden');
    if (!$('vacancyReviewCard')) {
      const card = document.createElement('section');
      card.id = 'vacancyReviewCard';
      card.className = 'form-card';
      card.innerHTML = '<div class="form-card-head"><div><strong>Revisão antes de publicar</strong><span>Confira as informações que o candidato verá</span></div><span class="step-badge">✓</span></div><div id="vacancyReviewSummary" class="vacancy-review-summary"></div>';
      document.querySelector('#vacancyForm .interview-preferences-card')?.before(card);
    }
    wizardCards().forEach((card) => {
      const badge = card.querySelector('.step-badge')?.textContent?.trim() || '';
      let step = 1;
      if (badge === '03') step = 2;
      if (['04', '05'].includes(badge)) step = 3;
      if (['06', '07', '✓'].includes(badge)) step = 4;
      card.dataset.v14StepCard = String(step);
    });
  }

  function renderVacancyReview() {
    const form = $('vacancyForm');
    const summary = $('vacancyReviewSummary');
    if (!form || !summary) return;
    const data = new FormData(form);
    const company = form.elements.empresa_id?.selectedOptions?.[0]?.textContent || 'Empresa não selecionada';
    const recruiter = form.elements.recrutador_responsavel_id?.selectedOptions?.[0]?.textContent || 'Seleção automática';
    const salary = Number(data.get('salario')) > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(data.get('salario'))) : 'A combinar';
    summary.innerHTML = `<article><span>Oportunidade</span><strong>${safe(data.get('titulo') || 'Título pendente')} · ${safe(company)}</strong></article><article><span>Local e jornada</span><strong>${safe([data.get('bairro'),data.get('cidade'),data.get('estado')].filter(Boolean).join(' · ') || 'Local a combinar')} · ${safe(data.get('horario') || 'horário pendente')}</strong></article><article><span>Oferta</span><strong>${safe(salary)} · ${Number(data.get('quantidade_vagas') || 1)} vaga(s)</strong></article><article><span>Entrevistas</span><strong>${safe(recruiter)} · ${data.get('agenda_personalizada') === 'on' ? 'agenda específica desta vaga' : 'agenda herdada do recrutador'}</strong></article>`;
  }

  function updateWizard() {
    configureWizardCards();
    wizardCards().forEach((card) => card.classList.toggle('hidden', Number(card.dataset.v14StepCard) !== state.wizardStep));
    document.querySelectorAll('[data-vacancy-wizard-step]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.vacancyWizardStep) === state.wizardStep);
      button.setAttribute('aria-current', Number(button.dataset.vacancyWizardStep) === state.wizardStep ? 'step' : 'false');
    });
    $('vacancyWizardBackButton')?.classList.toggle('hidden', state.wizardStep === 1);
    $('vacancyWizardNextButton')?.classList.toggle('hidden', state.wizardStep === 4);
    $('saveVacancyButton')?.classList.toggle('hidden', state.wizardStep !== 4);
    $('publishVacancyButton')?.classList.toggle('hidden', state.wizardStep !== 4);
    const editing = Boolean($('vacancyId')?.value);
    if ($('saveVacancyButton')) $('saveVacancyButton').textContent = editing ? 'Salvar alterações' : 'Salvar rascunho';
    if (state.wizardStep === 4) renderVacancyReview();
    document.querySelector('#vacancyDialog .modal-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateWizardStep() {
    const cards = wizardCards().filter((card) => Number(card.dataset.v14StepCard) === state.wizardStep);
    const invalid = cards.flatMap((card) => [...card.querySelectorAll('input,select,textarea')])
      .find((input) => !input.disabled && !input.closest('.hidden') && !input.checkValidity());
    if (invalid) { invalid.reportValidity(); invalid.focus(); return false; }
    return true;
  }

  async function loadRecruiters(force = false) {
    if (state.recruiters.length && !force) return state.recruiters;
    const data = await app().api('/api/recrutadores');
    state.recruiters = data.recrutadores || [];
    return state.recruiters;
  }

  async function prepareVacancyDialog(source = {}) {
    state.wizardStep = 1;
    await loadRecruiters();
    const select = $('vacancyRecruiterSelect');
    if (select) {
      select.innerHTML = '<option value="">Selecionar automaticamente</option>' + state.recruiters.map((recruiter) => (
        `<option value="${recruiter.id}">${safe(recruiter.nome)}${recruiter.empresa_nome ? ` · ${safe(recruiter.empresa_nome)}` : ''}</option>`
      )).join('');
      select.value = String(source.recrutador_responsavel_id || app().state.currentUser?.id || '');
    }
    const custom = source.agenda_personalizada === true;
    if ($('vacancyCustomAgendaToggle')) $('vacancyCustomAgendaToggle').checked = custom;
    $('vacancyCustomAgendaFields')?.classList.toggle('hidden', !custom);
    updateWizard();
  }

  function renderBrands() {
    const container = $('brandsList');
    if (!container) return;
    if (!state.brands.length) {
      container.innerHTML = app().emptyState('Nenhuma empresa ativa', 'Cadastre uma empresa antes de configurar a identidade visual.');
      return;
    }
    container.innerHTML = state.brands.map((brand) => `<article class="brand-company-card">
      <div class="brand-company-logo">${brand.possui_logo ? `<img src="/api/empresas/${brand.id}/marca/logo?v=${encodeURIComponent(brand.logo_atualizada_em || '')}" alt="Logo de ${safe(brand.nome)}">` : '<span>Sem logo</span>'}</div>
      <div class="brand-company-main"><h3>${safe(brand.nome)}</h3><p>${safe(brand.slogan || 'Slogan ainda não configurado')}</p><div class="brand-swatches"><i style="background:${color(brand.cor_primaria, '#0F766E')}"></i><i style="background:${color(brand.cor_secundaria, '#0B1324')}"></i><i style="background:${color(brand.cor_destaque, '#22C55E')}"></i></div><div class="brand-company-meta"><span>${safe(String(brand.estilo_visual || 'corporativo').toLowerCase())}</span><span>${safe(String(brand.tom_comunicacao || 'profissional').toLowerCase())}</span><span>${brand.configurada ? 'pronta para divulgar' : 'configuração pendente'}</span></div></div>
      <button class="button button-primary" data-edit-brand="${brand.id}" type="button">${brand.configurada ? 'Editar identidade' : 'Configurar marca'}</button>
    </article>`).join('');
  }

  async function loadBrands(force = false) {
    if (!isAdmin()) return;
    if (state.brands.length && !force) { renderBrands(); return; }
    const data = await app().api('/api/empresas/marcas');
    state.brands = data.empresas || [];
    renderBrands();
  }

  function brandLogoPreview(brand, file = null) {
    const preview = $('brandLogoPreview');
    if (!preview) return;
    if (file) {
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" alt="Prévia da logo">`;
      preview.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      return;
    }
    preview.innerHTML = brand?.possui_logo ? `<img src="/api/empresas/${brand.id}/marca/logo?v=${Date.now()}" alt="Logo atual">` : '<span>Logo</span>';
  }

  function openBrandEditor(id) {
    const brand = state.brands.find((item) => Number(item.id) === Number(id));
    if (!brand) return;
    state.selectedBrand = brand;
    $('brandCompanyId').value = brand.id;
    $('brandEditorTitle').textContent = `Marca de ${brand.nome}`;
    $('brandSlogan').value = brand.slogan || '';
    $('brandPrimaryColor').value = color(brand.cor_primaria, '#0F766E');
    $('brandSecondaryColor').value = color(brand.cor_secundaria, '#0B1324');
    $('brandAccentColor').value = color(brand.cor_destaque, '#22C55E');
    $('brandVisualStyle').value = brand.estilo_visual || 'CORPORATIVO';
    $('brandVoiceTone').value = brand.tom_comunicacao || 'PROFISSIONAL';
    $('brandWhatsapp').value = brand.whatsapp || '';
    $('brandEmail').value = brand.email || '';
    $('brandWebsite').value = brand.website || '';
    $('brandLogoFile').value = '';
    $('brandEditorError').classList.add('hidden');
    brandLogoPreview(brand);
    $('brandEditorDialog').showModal();
  }

  async function uploadBrandLogo(companyId, file) {
    const response = await fetch(`/api/empresas/${companyId}/marca/logo`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name },
      body: file,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.erro || 'Não foi possível enviar a logo.');
    return body;
  }

  async function saveBrand(event) {
    event.preventDefault();
    const id = Number($('brandCompanyId').value);
    const button = $('saveBrandButton');
    button.disabled = true;
    $('brandEditorError').classList.add('hidden');
    try {
      const payload = {
        slogan: $('brandSlogan').value.trim() || null,
        cor_primaria: $('brandPrimaryColor').value,
        cor_secundaria: $('brandSecondaryColor').value,
        cor_destaque: $('brandAccentColor').value,
        estilo_visual: $('brandVisualStyle').value,
        tom_comunicacao: $('brandVoiceTone').value,
        whatsapp: $('brandWhatsapp').value.trim() || null,
        email: $('brandEmail').value.trim() || null,
        website: $('brandWebsite').value.trim() || null,
      };
      const saved = await app().api(`/api/empresas/${id}/marca`, { method: 'PUT', body: JSON.stringify(payload) });
      const file = $('brandLogoFile').files?.[0];
      if (file) await uploadBrandLogo(id, file);
      $('brandEditorDialog').close();
      toast(saved.mensagem || 'Identidade visual salva.');
      await loadBrands(true);
    } catch (error) {
      $('brandEditorError').textContent = error.message;
      $('brandEditorError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  async function removeBrandLogo() {
    const id = Number($('brandCompanyId').value);
    if (!id || !state.selectedBrand?.possui_logo) return;
    if (!window.confirm('Remover a logo desta empresa?')) return;
    const data = await app().api(`/api/empresas/${id}/marca/logo`, { method: 'DELETE' });
    state.selectedBrand.possui_logo = false;
    brandLogoPreview(state.selectedBrand);
    toast(data.mensagem || 'Logo removida.');
  }

  function renderAgendaTimes() {
    const container = $('agendaTimeChips');
    if (!container) return;
    const times = [...state.agendaTimes].sort();
    container.innerHTML = times.length ? times.map((time) => `<span class="agenda-time-chip">${safe(time)}<button data-remove-agenda-time="${safe(time)}" type="button" aria-label="Remover ${safe(time)}">×</button></span>`).join('') : '<span class="empty-state compact">Adicione pelo menos um horário.</span>';
  }

  async function openAgendaSettings() {
    const data = await app().api('/api/minha-agenda');
    state.agenda = data.agenda || {};
    state.agendaTimes = new Set(Array.isArray(state.agenda.horarios) ? state.agenda.horarios : ['09:00','10:00','14:00','15:00']);
    document.querySelectorAll('#agendaWeekdays input').forEach((input) => { input.checked = (state.agenda.dias_semana || [1,2,3,4,5]).map(Number).includes(Number(input.value)); });
    $('agendaDuration').value = String(state.agenda.duracao_minutos || 30);
    $('agendaLookahead').value = String(state.agenda.busca_dias || 7);
    $('agendaCalendarId').value = state.agenda.google_calendar_id || '';
    $('agendaWhatsapp').value = state.agenda.whatsapp_alerta || '';
    $('agendaAvoidHolidays').checked = state.agenda.evitar_feriados !== false;
    $('agendaActive').checked = state.agenda.ativa !== false;
    $('agendaSettingsError').classList.add('hidden');
    renderAgendaTimes();
    $('agendaSettingsDialog').showModal();
  }

  async function saveAgenda(event) {
    event.preventDefault();
    const days = [...document.querySelectorAll('#agendaWeekdays input:checked')].map((input) => Number(input.value));
    const times = [...state.agendaTimes].sort();
    if (!days.length || !times.length) return toast('Marque ao menos um dia e um horário.', 'error');
    const button = $('saveAgendaSettingsButton');
    button.disabled = true;
    try {
      const data = await app().api('/api/minha-agenda', { method: 'PUT', body: JSON.stringify({
        dias_semana: days,
        horarios: times,
        duracao_minutos: Number($('agendaDuration').value),
        busca_dias: Number($('agendaLookahead').value),
        evitar_feriados: $('agendaAvoidHolidays').checked,
        timezone: 'America/Sao_Paulo',
        google_calendar_id: $('agendaCalendarId').value.trim() || null,
        whatsapp_alerta: $('agendaWhatsapp').value.trim() || null,
        ativa: $('agendaActive').checked,
      }) });
      $('agendaSettingsDialog').close();
      state.recruiters = [];
      toast(data.mensagem || 'Disponibilidade salva.');
    } catch (error) {
      $('agendaSettingsError').textContent = error.message;
      $('agendaSettingsError').classList.remove('hidden');
    } finally { button.disabled = false; }
  }

  function applyPromotionData(vacancyId, data) {
    app().state.promotion = data.divulgacao || {};
    const promotion = app().state.promotion;
    $('promotionWhatsappText').value = promotion.whatsapp_texto || '';
    $('promotionFacebookText').value = promotion.facebook_texto || '';
    $('promotionPrimaryImage').src = promotion.imagem_png_url || promotion.imagem_data_url || '';
    $('promotionImageSource').textContent = promotion.imagem_fonte === 'IA' ? `Fotografia gerada por IA · ${promotion.modelo_ia || 'modelo configurado'}` : 'Modelo contextual · gere uma fotografia exclusiva quando quiser';
    state.promotionVacancyId = Number(vacancyId);
  }

  function setPromotionContext(vacancyId, data) { applyPromotionData(vacancyId, data); }

  async function generatePromotionPhoto() {
    const id = Number(state.promotionVacancyId);
    if (!id) return toast('Abra novamente a divulgação da vaga.', 'error');
    const button = $('generatePromotionAiButton');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Gerando fotografia...';
    $('promotionAiHelp').textContent = 'A geração pode levar até dois minutos. Esta janela pode permanecer aberta.';
    try {
      const generated = await app().api(`/api/vagas/${id}/divulgacao/gerar-ia`, { method: 'POST', body: '{}' });
      const data = await app().api(`/api/vagas/${id}/divulgacao`, { method: 'POST', body: '{}' });
      applyPromotionData(id, data);
      toast(generated.mensagem || 'Nova fotografia gerada.');
    } catch (error) { toast(error.message, 'error'); }
    finally {
      button.disabled = false;
      button.textContent = original;
      $('promotionAiHelp').textContent = 'A IA cria somente a cena. Logo e conteúdo são aplicados pelo painel para preservar a identidade visual.';
    }
  }

  function selectedReviewIds() {
    return [...document.querySelectorAll('[data-review-select]:checked')].map((input) => Number(input.value)).filter(Boolean);
  }

  function updateReviewBatchToolbar() {
    const ids = selectedReviewIds();
    $('reviewBatchCount').textContent = String(ids.length);
    $('reviewBatchToolbar')?.classList.toggle('hidden', !ids.length);
  }

  async function decideReviewBatch(decision) {
    const ids = selectedReviewIds();
    if (!ids.length) return;
    const label = decision === 'NAO_APROVAR' ? 'confirmar que estes candidatos não atendem a esta vaga' : 'manter estes candidatos no processo';
    if (!window.confirm(`Deseja ${label}?\n\n${ids.length} caso(s) selecionado(s).`)) return;
    const motivo = decision === 'NAO_APROVAR' ? 'Incompatibilidade operacional confirmada em revisão interna.' : 'Compatibilidade confirmada pelo recrutador.';
    const data = await app().api('/api/revisoes/lote/decidir', { method: 'POST', body: JSON.stringify({ decisoes: ids.map((id) => ({ id, decisao: decision, motivo })) }) });
    toast(data.mensagem || 'Decisões registradas.');
    await app().loadCurrentView(true);
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    configureWizardCards();
    $('vacancyWizardNextButton')?.addEventListener('click', () => { if (validateWizardStep()) { state.wizardStep = Math.min(4, state.wizardStep + 1); updateWizard(); } });
    $('vacancyWizardBackButton')?.addEventListener('click', () => { state.wizardStep = Math.max(1, state.wizardStep - 1); updateWizard(); });
    $('vacancyWizardSteps')?.addEventListener('click', (event) => { const button = event.target.closest('[data-vacancy-wizard-step]'); if (!button) return; const target = Number(button.dataset.vacancyWizardStep); if (target <= state.wizardStep || validateWizardStep()) { state.wizardStep = target; updateWizard(); } });
    $('publishVacancyButton')?.addEventListener('click', () => { const status = $('vacancyForm')?.elements?.status; if (status) status.value = 'ATIVA'; $('vacancyForm')?.requestSubmit($('saveVacancyButton')); });
    $('vacancyCustomAgendaToggle')?.addEventListener('change', (event) => $('vacancyCustomAgendaFields')?.classList.toggle('hidden', !event.target.checked));

    $('refreshBrandsButton')?.addEventListener('click', () => loadBrands(true).catch((error) => toast(error.message, 'error')));
    $('brandEditorForm')?.addEventListener('submit', saveBrand);
    $('brandLogoFile')?.addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) brandLogoPreview(state.selectedBrand, file); });
    $('removeBrandLogoButton')?.addEventListener('click', () => removeBrandLogo().catch((error) => toast(error.message, 'error')));
    $('closeBrandEditorButton')?.addEventListener('click', () => $('brandEditorDialog').close());
    $('cancelBrandEditorButton')?.addEventListener('click', () => $('brandEditorDialog').close());

    $('openAgendaSettingsButton')?.addEventListener('click', () => openAgendaSettings().catch((error) => toast(error.message, 'error')));
    $('agendaSettingsForm')?.addEventListener('submit', saveAgenda);
    $('addAgendaTimeButton')?.addEventListener('click', () => { const time = $('agendaNewTime').value; if (time) { state.agendaTimes.add(time); $('agendaNewTime').value = ''; renderAgendaTimes(); } });
    $('closeAgendaSettingsButton')?.addEventListener('click', () => $('agendaSettingsDialog').close());
    $('cancelAgendaSettingsButton')?.addEventListener('click', () => $('agendaSettingsDialog').close());

    $('generatePromotionAiButton')?.addEventListener('click', generatePromotionPhoto);
    $('reviewBatchApproveButton')?.addEventListener('click', () => decideReviewBatch('APROVAR').catch((error) => toast(error.message, 'error')));
    $('reviewBatchRejectButton')?.addEventListener('click', () => decideReviewBatch('NAO_APROVAR').catch((error) => toast(error.message, 'error')));

    document.addEventListener('change', (event) => { if (event.target.matches('[data-review-select]')) updateReviewBatchToolbar(); });
    document.addEventListener('click', (event) => {
      const editBrand = event.target.closest('[data-edit-brand]');
      if (editBrand) return openBrandEditor(editBrand.dataset.editBrand);
      const removeTime = event.target.closest('[data-remove-agenda-time]');
      if (removeTime) { state.agendaTimes.delete(removeTime.dataset.removeAgendaTime); renderAgendaTimes(); }
    });
  }

  window.GenesisOperationsV14 = {
    loadBrands,
    openAgendaSettings,
    prepareVacancyDialog,
    setPromotionContext,
    updateReviewBatchToolbar,
  };
  document.addEventListener('DOMContentLoaded', bind);
})();
