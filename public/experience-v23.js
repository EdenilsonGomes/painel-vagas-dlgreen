'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const panel = () => window.GenesisApp || window.GenesisPanel || {};
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const icon = (name) => `<span data-icon="${name}" aria-hidden="true"></span>`;
  const hydrate = (root = document) => window.GenesisUIV18?.hydrateIcons?.(root);

  async function api(path, options = {}) {
    if (panel().api) return panel().api(path, options);
    const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type':'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.sucesso === false) throw new Error(data.erro || `HTTP ${response.status}`);
    return data;
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 45) return 'agora';
    if (seconds < 3600) return `há ${Math.max(1, Math.floor(seconds / 60))} min`;
    if (seconds < 86400) return `há ${Math.floor(seconds / 3600)} h`;
    if (seconds < 604800) return `há ${Math.floor(seconds / 86400)} d`;
    return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'short', timeZone:'America/Sao_Paulo' }).format(date);
  }

  function notificationMeta(item) {
    const type = String(item.tipo || '').toUpperCase();
    const reviewType = String(item.revisao_tipo || '').toUpperCase();
    if (type === 'REVISAO_HUMANA' && ['SUPORTE_FLUXO','ATENDIMENTO_HUMANO'].includes(reviewType)) return { icon:'message', tone:'warning', title:'Atendimento humano solicitado', reason:item.revisao_titulo || item.motivo || 'O candidato pediu ajuda e aguarda uma pessoa.' };
    if (type === 'REVISAO_HUMANA') return { icon:'clipboard-check', tone:'warning', title:'Revisão necessária', reason:item.revisao_titulo || item.motivo || 'Uma decisão humana está pendente.' };
    if (type === 'ENTREVISTA_AGENDADA') return { icon:'calendar', tone:'', title:'Entrevista agendada', reason:'Confira o horário e a confirmação do recrutador.' };
    if (type === 'ENTREVISTA_REAGENDADA') return { icon:'calendar', tone:'', title:'Entrevista reagendada', reason:'O novo horário foi confirmado.' };
    if (type === 'REAGENDAMENTO_RECUSADO') return { icon:'alert', tone:'warning', title:'Reagendamento recusado', reason:'O candidato não aceitou o novo horário.' };
    if (type === 'ENTREVISTA_CANCELADA') return { icon:'calendar', tone:'danger', title:'Entrevista cancelada', reason:'Revise a agenda e o próximo passo do candidato.' };
    if (type.includes('AJUDA') || type.includes('ATENDIMENTO')) return { icon:'message', tone:'warning', title:'Atendimento humano solicitado', reason:'O candidato pediu ajuda e aguarda uma pessoa.' };
    return { icon:'alert', tone:item.status === 'FALHA' ? 'danger' : '', title:'Atenção operacional', reason:item.mensagem || 'Existe uma atualização que precisa ser verificada.' };
  }

  const notifications = { items:[], open:false, loading:false, timer:null };

  function setNotificationsOpen(open) {
    notifications.open = Boolean(open);
    $('notificationCenterPanel')?.classList.toggle('hidden', !notifications.open);
    $('notificationCenterButton')?.setAttribute('aria-expanded', String(notifications.open));
    if (notifications.open) {
      loadNotifications(true);
      requestAnimationFrame(() => $('notificationCenterPanel')?.querySelector('button, [tabindex]')?.focus());
    }
  }

  function renderNotifications() {
    const list = $('notificationCenterList');
    const badge = $('notificationCenterBadge');
    const summary = $('notificationCenterSummary');
    if (!list || !badge) return;
    const unread = notifications.items.filter((item) => !item.lida).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
    if (summary) summary.textContent = unread ? `${unread} ${unread === 1 ? 'item exige' : 'itens exigem'} sua atenção` : 'Nenhuma ação nova';
    $('notificationMarkAllButton')?.classList.toggle('hidden', unread === 0);
    if (!notifications.items.length) {
      list.innerHTML = '<div class="notification-center-empty"><span>Tudo em dia.<br>Novas ações importantes aparecerão aqui.</span></div>';
      return;
    }
    list.innerHTML = notifications.items.map((item) => {
      const meta = notificationMeta(item);
      const name = item.candidato_nome || 'Operação Gênesis';
      return `<button class="notification-item ${meta.tone} ${item.lida ? '' : 'unread'}" data-notification-id="${Number(item.id)}" type="button">
        <span class="notification-item-icon">${icon(meta.icon)}</span>
        <span class="notification-item-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(meta.title)} — ${escapeHtml(meta.reason)}</span><small>${escapeHtml(relativeTime(item.created_at))}${item.vaga_nome ? ` · ${escapeHtml(item.vaga_nome)}` : ''}</small></span>
        ${item.lida ? '' : '<span class="notification-unread-dot" aria-label="Não lida"></span>'}
      </button>`;
    }).join('');
    hydrate(list);
  }

  async function loadNotifications(force = false) {
    if (notifications.loading || (document.hidden && !force)) return;
    notifications.loading = true;
    try {
      const data = await api(`/api/notificacoes?limite=50${force ? `&t=${Date.now()}` : ''}`);
      notifications.items = data.notificacoes || [];
      renderNotifications();
    } catch (error) {
      if (notifications.open && $('notificationCenterList')) {
        $('notificationCenterList').innerHTML = `<div class="notification-center-empty"><span>Não foi possível carregar as notificações.<br>${escapeHtml(error.message)}</span></div>`;
      }
    } finally { notifications.loading = false; }
  }

  async function markNotification(id) {
    const item = notifications.items.find((entry) => Number(entry.id) === Number(id));
    if (!item) return;
    if (!item.lida) {
      await api(`/api/notificacoes/${Number(id)}/lida`, { method:'POST', body:'{}' });
      item.lida = true;
      renderNotifications();
    }
    setNotificationsOpen(false);
    const type = String(item.tipo || '').toUpperCase();
    if (item.revisao_id || type === 'REVISAO_HUMANA') return panel().setView?.('reviews');
    if (item.entrevista_id || type.includes('ENTREVISTA') || type.includes('REAGENDAMENTO')) return panel().setView?.('interviews');
    if (item.candidato_id) {
      panel().setView?.('atendimentos');
      setTimeout(() => window.GenesisConversationsV164?.openConversation?.(item.candidato_id), 80);
    }
  }

  async function markAllNotifications() {
    await api('/api/notificacoes/marcar-todas-lidas', { method:'POST', body:'{}' });
    notifications.items.forEach((item) => { item.lida = true; });
    renderNotifications();
  }

  function bindNotifications() {
    $('notificationCenterButton')?.addEventListener('click', () => setNotificationsOpen(!notifications.open));
    $('notificationMarkAllButton')?.addEventListener('click', (event) => { event.stopPropagation(); markAllNotifications().catch((error) => panel().showToast?.(error.message, 'error')); });
    $('notificationCenterList')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-notification-id]');
      if (target) markNotification(target.dataset.notificationId).catch((error) => panel().showToast?.(error.message, 'error'));
    });
    document.addEventListener('pointerdown', (event) => {
      if (!notifications.open || event.target.closest('#notificationCenter')) return;
      setNotificationsOpen(false);
    });
    notifications.timer = setInterval(() => loadNotifications(), 30_000);
    loadNotifications();
  }

  const filterDefinitions = [
    ['candidatePeriodSelect', 'Período', 'TODOS'],
    ['candidateVacancyFilter', 'Vaga', 'TODAS'],
    ['candidateStageFilter', 'Etapa', 'TODAS'],
    ['candidateDocumentFilter', 'Documentos', 'TODOS'],
    ['candidateInterviewFilter', 'Entrevista', 'TODAS'],
    ['candidateSexFilter', 'Sexo informado', 'TODOS'],
    ['candidateReallocationFilter', 'Realocação', 'TODOS'],
    ['candidateDistanceFilter', 'Distância', 'TODAS'],
    ['candidateDistanceSort', 'Ordenação', 'RECENTES'],
  ];
  const candidateFilters = { open:false, drafts:new Map() };

  function filterLabel(select) {
    return select?.selectedOptions?.[0]?.textContent?.trim() || select?.value || '';
  }

  function activeCandidateFilters() {
    return filterDefinitions.map(([id, label, fallback]) => {
      const select = $(id);
      return select && String(select.value) !== String(fallback) ? { id, label, value:select.value, text:filterLabel(select), fallback } : null;
    }).filter(Boolean);
  }

  function renderCandidateFilterState() {
    const active = activeCandidateFilters();
    const count = $('candidateFiltersCount');
    if (count) { count.textContent = String(active.length); count.dataset.empty = String(active.length === 0); }
    const chips = $('candidateFilterChips');
    if (chips) chips.innerHTML = active.map((item) => `<span class="active-filter-chip">${escapeHtml(item.text)}<button type="button" data-remove-candidate-filter="${escapeHtml(item.id)}" aria-label="Remover filtro ${escapeHtml(item.label)}">×</button></span>`).join('');
    document.querySelectorAll('.table-filter-menu').forEach((details) => {
      const select = details.querySelector('select');
      const def = select && filterDefinitions.find(([id]) => id === select.id);
      details.classList.toggle('has-active-filter', Boolean(def && String(select.value) !== String(def[2])));
    });
  }

  function buildCandidateFilterFields() {
    const fields = $('candidateFiltersFields');
    if (!fields) return;
    fields.replaceChildren();
    candidateFilters.drafts.clear();
    filterDefinitions.forEach(([id, label]) => {
      const source = $(id);
      if (!source) return;
      const wrapper = document.createElement('label');
      const title = document.createElement('span');
      const clone = source.cloneNode(true);
      clone.id = `${id}V23Clone`;
      clone.removeAttribute('name');
      clone.value = source.value;
      title.textContent = label;
      wrapper.append(title, clone);
      fields.append(wrapper);
      candidateFilters.drafts.set(id, clone);
    });
  }

  function setCandidateFiltersOpen(open) {
    candidateFilters.open = Boolean(open);
    $('candidateFiltersPopover')?.classList.toggle('hidden', !candidateFilters.open);
    $('candidateFiltersButton')?.setAttribute('aria-expanded', String(candidateFilters.open));
    if (candidateFilters.open) { buildCandidateFilterFields(); requestAnimationFrame(() => $('candidateFiltersFields')?.querySelector('select')?.focus()); }
  }

  function applyCandidateFilters() {
    candidateFilters.drafts.forEach((clone, id) => {
      const source = $(id);
      if (!source || source.value === clone.value) return;
      source.value = clone.value;
      source.dispatchEvent(new Event('change', { bubbles:true }));
    });
    renderCandidateFilterState();
    setCandidateFiltersOpen(false);
  }

  function clearCandidateFilters() {
    filterDefinitions.forEach(([id,,fallback]) => { const clone = candidateFilters.drafts.get(id); if (clone) clone.value = fallback; });
  }

  function bindCandidateFilters() {
    $('candidateFiltersButton')?.addEventListener('click', () => setCandidateFiltersOpen(!candidateFilters.open));
    $('candidateFiltersCloseButton')?.addEventListener('click', () => setCandidateFiltersOpen(false));
    $('candidateFiltersApplyButton')?.addEventListener('click', applyCandidateFilters);
    $('candidateFiltersClearButton')?.addEventListener('click', clearCandidateFilters);
    $('candidateFilterChips')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-candidate-filter]');
      if (!button) return;
      const definition = filterDefinitions.find(([id]) => id === button.dataset.removeCandidateFilter);
      const source = definition && $(definition[0]);
      if (!source) return;
      source.value = definition[2];
      source.dispatchEvent(new Event('change', { bubbles:true }));
      renderCandidateFilterState();
    });
    filterDefinitions.forEach(([id]) => $(id)?.addEventListener('change', renderCandidateFilterState));
    document.addEventListener('pointerdown', (event) => {
      if (!candidateFilters.open || event.target.closest('.candidate-filter-center')) return;
      setCandidateFiltersOpen(false);
    });
    renderCandidateFilterState();
  }

  const copyPattern = /^Copiar(?:\s+(?:link|telefone|texto|mensagem|URL|url|código|codigo))?$/i;
  function upgradeCopyButton(button) {
    if (!(button instanceof HTMLElement) || button.dataset.copyUpgrade === '1') return;
    const label = String(button.textContent || '').trim();
    if (!copyPattern.test(label) && !button.hasAttribute('data-copy-text')) return;
    if (button.closest('.candidate-filters-popover')) return;
    button.dataset.copyUpgrade = '1';
    button.dataset.copyLabel = label || 'Copiar';
    button.dataset.tooltip = label || 'Copiar';
    button.classList.add('gx-copy-button');
    button.setAttribute('aria-label', label || 'Copiar para a área de transferência');
    button.innerHTML = `${icon('copy')}<span class="gx-copy-label">${escapeHtml(label || 'Copiar')}</span>`;
    hydrate(button);
  }

  function scanCopyButtons(root = document) {
    if (root.matches?.('button,a')) upgradeCopyButton(root);
    root.querySelectorAll?.('button,a').forEach(upgradeCopyButton);
  }

  function copyFeedback(button) {
    if (!button?.classList.contains('gx-copy-button')) return;
    const iconNode = button.querySelector('[data-icon]');
    if (iconNode) { iconNode.dataset.icon = 'check'; iconNode.dataset.iconReady = '0'; iconNode.innerHTML = ''; hydrate(iconNode); }
    button.classList.add('is-copied');
    button.dataset.tooltip = 'Copiado';
    button.setAttribute('aria-label', 'Copiado');
    clearTimeout(button._gxCopyTimer);
    button._gxCopyTimer = setTimeout(() => {
      if (iconNode) { iconNode.dataset.icon = 'copy'; iconNode.dataset.iconReady = '0'; iconNode.innerHTML = ''; hydrate(iconNode); }
      button.classList.remove('is-copied');
      button.dataset.tooltip = button.dataset.copyLabel || 'Copiar';
      button.setAttribute('aria-label', button.dataset.copyLabel || 'Copiar');
    }, 1800);
  }

  function bindCopyButtons() {
    scanCopyButtons();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('.gx-copy-button');
      if (button) setTimeout(() => copyFeedback(button), 0);
    }, true);
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => { if (node.nodeType === Node.ELEMENT_NODE) scanCopyButtons(node); })));
    observer.observe(document.body, { childList:true, subtree:true });
  }

  function bindGlobalDismissal() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (notifications.open) setNotificationsOpen(false);
      if (candidateFilters.open) setCandidateFiltersOpen(false);
    });
  }

  function init() {
    hydrate();
    bindNotifications();
    bindCandidateFilters();
    bindCopyButtons();
    bindGlobalDismissal();
  }

  window.GenesisExperienceV23 = { loadNotifications, renderCandidateFilterState };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
})();
