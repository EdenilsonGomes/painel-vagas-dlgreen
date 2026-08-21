'use strict';

(() => {
  const SVG_OPEN = '<svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">';
  const SVG_CLOSE = '</svg>';
  const paths = {
    layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M9 12v2h6v-2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-plus': '<path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    'user-cog': '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 10.2-6.2"/><circle cx="18" cy="16" r="3"/><path d="M18 11.5v1M18 19.5v1M13.5 16h1M21.5 16h1M14.8 12.8l.7.7M20.5 18.5l.7.7M21.2 12.8l-.7.7M15.5 18.5l-.7.7"/>',
    send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.65V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z"/>',
    messages: '<path d="M21 15a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-2-3.46V8a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
    'clipboard-check': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 13l2 2 4-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
    activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 11M4 13l2.3 4.6A7 7 0 0 0 18 15"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    sparkles: '<path d="m12 3 1.2 3.2L16.5 7.5l-3.3 1.3L12 12l-1.2-3.2-3.3-1.3 3.3-1.3Z"/><path d="m19 13 .8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8Z"/><path d="m5 14 .8 1.7 1.7.8-1.7.8L5 19l-.8-1.7-1.7-.8 1.7-.8Z"/>',
    chart: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 2 3 6 6.5.9-4.7 4.6 1.1 6.5-5.9-3.1L6.1 20l1.1-6.5L2.5 8.9 9 8Z"/>',
    minus: '<path d="M5 12h14"/>',
    restore: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowdown: '<path d="M12 5v14M18 13l-6 6-6-6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  };

  function icon(name, className = '') {
    const body = paths[name] || paths.layout;
    return `${SVG_OPEN.replace('class="g-icon"', `class="g-icon ${className}"`)}${body}${SVG_CLOSE}`;
  }

  function hydrateIcons(root = document) {
    const targets = root.matches?.('[data-icon]') ? [root] : root.querySelectorAll?.('[data-icon]') || [];
    targets.forEach((el) => {
      const name = el.dataset.icon;
      if (!name || el.dataset.iconReady === '1') return;
      el.innerHTML = icon(name);
      el.dataset.iconReady = '1';
    });
  }

  const legacyExact = new Map([
    ['×', 'close'], ['↻', 'refresh'], ['‹', 'chevron-left'], ['›', 'chevron-right'], ['☰', 'menu'],
    ['−', 'minus'], ['□', 'restore'], ['✓', 'check'], ['◇', 'clipboard-check'], ['◷', 'clock'], ['↗', 'external'], ['★', 'star'], ['⇩', 'download'], ['⬇', 'download'], ['Ⅱ', 'pause'], ['⌖', 'pin'], ['▣', 'building'], ['▤', 'file'], ['⚠', 'alert'], ['⚠️', 'alert'], ['✅', 'check'], ['❌', 'close'], ['👁', 'eye'], ['✨', 'sparkles']
  ]);

  function replaceExactIcon(el, name) {
    if (!el || el.dataset.v18IconUpgraded === '1') return;
    el.innerHTML = icon(name);
    el.dataset.v18IconUpgraded = '1';
  }

  function prefixTextIcon(el, name, pattern) {
    if (!el || el.dataset.v18IconUpgraded === '1') return;
    const raw = String(el.textContent || '').trim();
    const text = pattern ? raw.replace(pattern, '').trim() : raw;
    el.innerHTML = `${icon(name)}${text ? `<span>${escapeHtml(text)}</span>` : ''}`;
    el.classList.add('v18-icon-text');
    el.dataset.v18IconUpgraded = '1';
  }

  function upgradeLegacySymbols(root = document) {
    const q = (sel) => root.matches?.(sel) ? [root] : [...(root.querySelectorAll?.(sel) || [])];
    q('.icon-button').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (legacyExact.has(value)) replaceExactIcon(el, legacyExact.get(value));
    });
    q('.inline-search > span:first-child, .search-dialog-head > span:first-child, .conversation-center-search > span:first-child').forEach((el) => replaceExactIcon(el, 'search'));
    q('.dashboard-attention-icon').forEach((el) => {
      const value = String(el.textContent || '').trim();
      const name = value === '!' ? 'alert' : value === '◇' ? 'clipboard-check' : value === '◷' ? 'calendar' : value === '↻' ? 'refresh' : 'check';
      replaceExactIcon(el, name);
    });
    q('.step-badge').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (value === '★') replaceExactIcon(el, 'star');
      if (value === '✓') replaceExactIcon(el, 'check');
    });
    q('.candidate-doc-count').forEach((el) => {
      if (el.dataset.v18IconUpgraded === '1') return;
      const value = String(el.textContent || '').trim();
      if (!value.startsWith('▤')) return;
      el.innerHTML = `${icon('file')}<span>${escapeHtml(value.replace(/^▤\s*/, ''))}</span>`;
      el.dataset.v18IconUpgraded = '1';
    });
    q('.vacancy-next-action > span:first-child, .priority-icon').forEach((el) => {
      const value = String(el.textContent || '').trim();
      const name = value === '✎' ? 'file' : value === '✓' ? 'check' : value === '◷' ? 'clock' : value === '▣' ? 'calendar' : value === '!' ? 'alert' : null;
      if (name) replaceExactIcon(el, name);
    });
    q('.mobile-bottom-nav button').forEach((button) => {
      const map = { dashboard: 'layout', vacancies: 'briefcase', candidates: 'users', interviews: 'calendar' };
      const span = button.querySelector('span:first-child');
      const name = map[button.dataset.mobileView];
      if (span && name && !span.dataset.icon) { span.dataset.icon = name; span.dataset.iconReady = '0'; hydrateIcons(span); }
    });

    // Controles estáticos/dinâmicos que antes dependiam de glifos/emoji do sistema operacional.
    q('button > span:first-child, a.button > span:first-child').forEach((span) => {
      const value = String(span.textContent || '').trim();
      if (legacyExact.has(value)) replaceExactIcon(span, legacyExact.get(value));
    });
    q('.button-ai').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (/^✨/.test(value)) prefixTextIcon(el, 'sparkles', /^✨\s*/);
    });
    q('button[data-document-preview]').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (/^👁/.test(value)) prefixTextIcon(el, 'eye', /^👁(?:️)?\s*/);
    });
    q('a.button[href*="/download"]').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (/^⬇/.test(value)) prefixTextIcon(el, 'download', /^⬇(?:️)?\s*/);
    });
    q('.ctps-match-status').forEach((el) => {
      const name = el.classList.contains('compatible') ? 'check' : el.classList.contains('review') ? 'alert' : 'close';
      prefixTextIcon(el, name, /^(?:✅|⚠(?:️)?|❌)\s*/);
    });
    q('.ctps-manual-review-summary strong').forEach((el) => {
      const value = String(el.textContent || '').trim();
      const name = /^✅/.test(value) ? 'check' : /^❌/.test(value) ? 'close' : /^⚠/.test(value) ? 'alert' : null;
      if (name) prefixTextIcon(el, name, /^(?:✅|⚠(?:️)?|❌)\s*/);
    });
    q('.ctps-manual-history-warning').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (/^⚠/.test(value)) prefixTextIcon(el, 'alert', /^⚠(?:️)?\s*/);
    });
    q('#vacancyViewMeta > span').forEach((el) => {
      const value = String(el.textContent || '').trim();
      const first = [...value][0];
      const map = { '⌖':'pin', '▣':'building', '◷':'clock' };
      if (map[first]) prefixTextIcon(el, map[first], new RegExp(`^${first}\\s*`));
    });
    q('#vacancyViewRequirements b, #vacancyViewActivity i').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (legacyExact.has(value)) replaceExactIcon(el, legacyExact.get(value));
    });
    q('.audit-candidate-group-actions button').forEach((el) => {
      const value = String(el.textContent || '').trim();
      if (/^↻/.test(value)) prefixTextIcon(el, 'refresh', /^↻\s*/);
      else if (/^↗/.test(value)) prefixTextIcon(el, 'external', /^↗\s*/);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function inferMetricIcon(card) {
    const label = String(card.querySelector('span')?.textContent || card.textContent || '').toLowerCase();
    if (/vaga|oportunidade/.test(label)) return 'briefcase';
    if (/entrevista|agenda/.test(label)) return 'calendar';
    if (/document|ctps|arquivo/.test(label)) return 'file';
    if (/convers|taxa|conversão|percent/.test(label)) return 'chart';
    if (/novo/.test(label)) return 'user-plus';
    if (/contrat|aprov/.test(label)) return 'check';
    if (/atenção|revis|pendente|falha/.test(label)) return 'alert';
    return 'users';
  }

  function ensureMetricIcons(root = document) {
    const cards = root.matches?.('.dashboard-command-kpi,.kpi-card,.documents-summary-card') ? [root] : root.querySelectorAll?.('.dashboard-command-kpi,.kpi-card,.documents-summary-card') || [];
    cards.forEach((card) => {
      if (card.querySelector(':scope > .v18-metric-icon')) return;
      const span = document.createElement('span');
      span.className = 'v18-metric-icon';
      span.dataset.icon = inferMetricIcon(card);
      card.appendChild(span);
      hydrateIcons(span);
    });
  }

  function notify(message, tone = '') {
    if (typeof window.showToast === 'function') return window.showToast(message, tone);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden', 'error', 'success');
    if (tone) toast.classList.add(tone);
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.add('hidden'), 4200);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try { data = await response.json(); } catch { data = {}; }
    if (response.status === 401 && url !== '/api/auth/change-password') {
      window.location.assign('/login');
      throw new Error('Sua sessão expirou.');
    }
    if (!response.ok) throw new Error(data?.erro || data?.message || 'Não foi possível concluir a operação.');
    return data;
  }

  const refs = {};
  let currentUser = null;

  function collectRefs() {
    [
      'profileMenuButton','profileMenu','profileMenuAvatar','profileMenuName','profileMenuRole','profileMenuEditButton','profileMenuPasswordButton',
      'profileDialog','closeProfileDialogButton','profileDataTabButton','profilePasswordTabButton','profileDataPanel','profilePasswordPanel',
      'profileDataForm','profileNameInput','profileUsernameInput','profileWhatsappInput','profileInterviewAlertInput','profileReviewAlertInput','profileDataError','saveProfileDataButton',
      'profilePasswordForm','profileCurrentPasswordInput','profileNewPasswordInput','profileConfirmPasswordInput','profilePasswordError','saveProfilePasswordButton',
      'profileDialogAvatar','profileDialogName','profileDialogRole','dashboardGreetingName','dashboardGreetingText','themeToggleButton'
    ].forEach((id) => { refs[id] = document.getElementById(id); });
  }

  function firstName(name) {
    return String(name || 'Recrutador').trim().split(/\s+/)[0] || 'Recrutador';
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'R').toUpperCase();
  }

  function setUser(user) {
    if (!user) return;
    currentUser = { ...(currentUser || {}), ...user };
    const name = currentUser.nome || currentUser.usuario || 'Recrutador';
    const role = String(currentUser.perfil || 'RECRUTADOR').toUpperCase() === 'ADMIN' ? 'Administrador' : 'Recrutador';
    const avatar = initials(name);
    if (refs.profileMenuAvatar) refs.profileMenuAvatar.textContent = avatar;
    if (refs.profileMenuName) refs.profileMenuName.textContent = name;
    if (refs.profileMenuRole) refs.profileMenuRole.textContent = role;
    if (refs.profileDialogAvatar) refs.profileDialogAvatar.textContent = avatar;
    if (refs.profileDialogName) refs.profileDialogName.textContent = name;
    if (refs.profileDialogRole) refs.profileDialogRole.textContent = role;
    if (refs.dashboardGreetingName) refs.dashboardGreetingName.textContent = firstName(name);
    if (refs.dashboardGreetingText) refs.dashboardGreetingText.textContent = role === 'Administrador'
      ? 'Aqui está o panorama da operação e os pontos que precisam da sua atenção.'
      : 'Aqui está o resumo dos seus candidatos, vagas e próximas ações.';
  }

  function syncTheme(theme) {
    const dark = theme === 'dark' || document.documentElement.dataset.theme === 'dark';
    if (refs.themeToggleButton) {
      refs.themeToggleButton.setAttribute('aria-checked', dark ? 'true' : 'false');
      refs.themeToggleButton.dataset.themeState = dark ? 'dark' : 'light';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#081416' : '#eff4f3');
  }

  function closeProfileMenu() {
    refs.profileMenu?.classList.add('hidden');
    refs.profileMenuButton?.setAttribute('aria-expanded', 'false');
  }

  function toggleProfileMenu() {
    const willOpen = refs.profileMenu?.classList.contains('hidden');
    refs.profileMenu?.classList.toggle('hidden', !willOpen);
    refs.profileMenuButton?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  function switchProfileTab(tab) {
    const password = tab === 'password';
    refs.profileDataTabButton?.classList.toggle('active', !password);
    refs.profilePasswordTabButton?.classList.toggle('active', password);
    refs.profileDataPanel?.classList.toggle('hidden', password);
    refs.profilePasswordPanel?.classList.toggle('hidden', !password);
    refs.profileDataPanel?.classList.toggle('active', !password);
    refs.profilePasswordPanel?.classList.toggle('active', password);
    if (password) setTimeout(() => refs.profileCurrentPasswordInput?.focus(), 40);
  }

  function clearProfileErrors() {
    [refs.profileDataError, refs.profilePasswordError].forEach((el) => { if (el) { el.textContent = ''; el.classList.add('hidden'); } });
  }

  function showFormError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  async function loadProfile() {
    const data = await request('/api/auth/profile');
    const user = data.usuario || {};
    setUser(user);
    if (refs.profileNameInput) refs.profileNameInput.value = user.nome || '';
    if (refs.profileUsernameInput) refs.profileUsernameInput.value = user.usuario || '';
    if (refs.profileWhatsappInput) refs.profileWhatsappInput.value = user.telefone_whatsapp || '';
    if (refs.profileInterviewAlertInput) refs.profileInterviewAlertInput.checked = user.alerta_entrevista !== false;
    if (refs.profileReviewAlertInput) refs.profileReviewAlertInput.checked = user.alerta_revisao !== false;
    return user;
  }

  async function openProfile(tab = 'data') {
    closeProfileMenu();
    clearProfileErrors();
    switchProfileTab(tab);
    if (!refs.profileDialog) return;
    try {
      await loadProfile();
      refs.profileDialog.showModal();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    clearProfileErrors();
    if (refs.saveProfileDataButton) refs.saveProfileDataButton.disabled = true;
    try {
      const data = await request('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          nome: refs.profileNameInput?.value || '',
          usuario: refs.profileUsernameInput?.value || '',
          telefone_whatsapp: refs.profileWhatsappInput?.value || '',
          alerta_entrevista: Boolean(refs.profileInterviewAlertInput?.checked),
          alerta_revisao: Boolean(refs.profileReviewAlertInput?.checked),
        }),
      });
      setUser(data.usuario || {});
      const topName = document.getElementById('currentUserName');
      const topAvatar = document.getElementById('currentUserAvatar');
      if (topName) topName.textContent = data.usuario?.nome || data.usuario?.usuario || 'Recrutador';
      if (topAvatar) topAvatar.textContent = initials(data.usuario?.nome || data.usuario?.usuario);
      notify(data.mensagem || 'Perfil atualizado.', 'success');
    } catch (error) {
      showFormError(refs.profileDataError, error.message);
    } finally {
      if (refs.saveProfileDataButton) refs.saveProfileDataButton.disabled = false;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    clearProfileErrors();
    const current = refs.profileCurrentPasswordInput?.value || '';
    const next = refs.profileNewPasswordInput?.value || '';
    const confirmation = refs.profileConfirmPasswordInput?.value || '';
    if (next !== confirmation) return showFormError(refs.profilePasswordError, 'A confirmação da nova senha não confere.');
    if (next.length < 8) return showFormError(refs.profilePasswordError, 'A nova senha precisa ter pelo menos 8 caracteres.');
    if (refs.saveProfilePasswordButton) refs.saveProfilePasswordButton.disabled = true;
    try {
      const data = await request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ senha_atual: current, nova_senha: next }),
      });
      refs.profilePasswordForm?.reset();
      notify(data.mensagem || 'Senha atualizada.', 'success');
      switchProfileTab('data');
    } catch (error) {
      showFormError(refs.profilePasswordError, error.message);
    } finally {
      if (refs.saveProfilePasswordButton) refs.saveProfilePasswordButton.disabled = false;
    }
  }

  function bindProfile() {
    refs.profileMenuButton?.addEventListener('click', (event) => { event.stopPropagation(); toggleProfileMenu(); });
    refs.profileMenu?.addEventListener('click', (event) => event.stopPropagation());
    refs.profileMenuEditButton?.addEventListener('click', () => openProfile('data'));
    refs.profileMenuPasswordButton?.addEventListener('click', () => openProfile('password'));
    refs.closeProfileDialogButton?.addEventListener('click', () => refs.profileDialog?.close());
    refs.profileDataTabButton?.addEventListener('click', () => switchProfileTab('data'));
    refs.profilePasswordTabButton?.addEventListener('click', () => switchProfileTab('password'));
    refs.profileDataForm?.addEventListener('submit', saveProfile);
    refs.profilePasswordForm?.addEventListener('submit', changePassword);
    refs.profileDialog?.addEventListener('click', (event) => { if (event.target === refs.profileDialog) refs.profileDialog.close(); });
    document.addEventListener('click', closeProfileMenu);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeProfileMenu();
    });
  }

  function initialize() {
    collectRefs();
    hydrateIcons();
    upgradeLegacySymbols();
    ensureMetricIcons();
    bindProfile();
    syncTheme(document.documentElement.dataset.theme || 'light');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          hydrateIcons(node);
          upgradeLegacySymbols(node);
          ensureMetricIcons(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.GenesisUIV18 = { icon, hydrateIcons, setUser, syncTheme, openProfile };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
