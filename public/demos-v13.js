'use strict';

(() => {
  const state = { demos: [], loadedVacancies: false };
  const get = (id) => document.getElementById(id);

  function app() { return window.GenesisApp; }
  function escapeHtml(value) { return app().escapeHtml(value); }

  function statusMeta(status) {
    const map = {
      CRIADA: ['Aguardando conexão', 'badge-neutral'],
      AGUARDANDO_QR: ['Aguardando QR Code', 'badge-process'],
      CONECTADA: ['Automação ligada', 'badge-active'],
      EXPIRADA: ['Expirada', 'badge-rejected'],
      ENCERRADA: ['Encerrada', 'badge-rejected'],
      ERRO: ['Atenção', 'badge-warning'],
    };
    return map[String(status || '').toUpperCase()] || [status || 'Não informado', 'badge-neutral'];
  }

  function formatDate(value) {
    return value ? app().formatDate(value) : 'Não informado';
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    app().showToast('Link copiado.');
  }

  function showCreatedLink(link, message = 'Link seguro criado') {
    const container = get('demoCreatedLink');
    container.classList.remove('hidden');
    container.innerHTML = `<span>${escapeHtml(message)}</span><strong>${escapeHtml(link)}</strong><div><button class="button button-primary" data-copy-demo-link type="button">Copiar link</button><a class="button button-ghost" href="${escapeHtml(link)}" target="_blank" rel="noopener">Abrir guia do cliente ↗</a></div>`;
    container.querySelector('[data-copy-demo-link]')?.addEventListener('click', () => copyText(link));
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadVacancies() {
    if (state.loadedVacancies) return;
    const data = await app().api('/api/vagas?periodo=30D');
    const vacancies = data.vagas || [];
    get('demoVacancySelect').innerHTML = '<option value="">Usar roteiro demonstrativo padrão</option>'
      + vacancies.map((vacancy) => `<option value="${vacancy.id}">${escapeHtml(vacancy.titulo)} · ${escapeHtml(vacancy.codigo || vacancy.empresa_nome || '')}</option>`).join('');
    state.loadedVacancies = true;
  }

  function renderConfig(config = {}) {
    const alert = get('demoConfigAlert');
    const missing = [];
    if (!config.waha_configurado) missing.push('WAHA_BASE_URL e WAHA_API_KEY');
    if (!config.webhook_configurado) missing.push('DEMO_CHATBOT_WEBHOOK_URL');
    alert.classList.toggle('hidden', missing.length === 0);
    if (missing.length) alert.innerHTML = `<strong>Falta concluir a configuração no EasyPanel</strong><span>Defina ${escapeHtml(missing.join(' e '))}. Você já pode preparar cadastros, mas o QR Code só será liberado depois disso.</span>`;
  }

  function render() {
    const container = get('demosList');
    if (!state.demos.length) {
      container.innerHTML = app().emptyState('Nenhuma demonstração criada', 'Crie o primeiro acesso para validar a jornada comercial.');
      return;
    }
    container.innerHTML = state.demos.map((demo) => {
      const [statusLabel, statusClass] = statusMeta(demo.status);
      const active = !['EXPIRADA', 'ENCERRADA'].includes(String(demo.status).toUpperCase()) && Number(demo.dias_restantes || 0) > 0;
      return `<article class="demo-list-card">
        <div class="demo-list-identity"><span class="demo-company-mark">${escapeHtml(String(demo.empresa_nome || 'D').slice(0, 2).toUpperCase())}</span><div><strong>${escapeHtml(demo.empresa_nome)}</strong><span>${escapeHtml(demo.contato_nome)} · ${escapeHtml(demo.vaga_titulo)}</span><small>Criada em ${escapeHtml(formatDate(demo.created_at))}</small></div></div>
        <div class="demo-list-status"><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span><strong>${Number(demo.dias_restantes || 0)} dia(s)</strong><small>até ${escapeHtml(formatDate(demo.expira_em))}</small></div>
        <div class="demo-list-metrics"><span><strong>${Number(demo.contatos || 0)}</strong> testes</span><span><strong>${Number(demo.concluidas || 0)}</strong> concluídos</span><span><strong>${Number(demo.nao_atenderam || 0)}</strong> não atenderam</span></div>
        <div class="demo-list-actions"><button class="button button-ghost" data-demo-action="details" data-id="${demo.id}" type="button">Resultados</button>${active ? `<button class="button button-ghost" data-demo-action="link" data-id="${demo.id}" type="button">Novo link</button><button class="button button-danger-soft" data-demo-action="end" data-id="${demo.id}" type="button">Encerrar</button>` : ''}</div>
      </article>`;
    }).join('');
  }

  async function load(force = false) {
    if (!force && state.demos.length) {
      render();
      return;
    }
    await loadVacancies();
    const data = await app().api('/api/demos');
    state.demos = data.demos || [];
    renderConfig(data.configuracao || {});
    render();
  }

  async function createDemo(event) {
    event.preventDefault();
    const button = get('createDemoButton');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = await app().api('/api/demos', { method: 'POST', body: JSON.stringify(data) });
      showCreatedLink(result.link, result.mensagem || 'Link seguro criado');
      event.currentTarget.reset();
      await load(true);
    } catch (error) {
      app().showToast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function renewLink(id) {
    const result = await app().api(`/api/demos/${id}/renovar-link`, { method: 'POST', body: '{}' });
    showCreatedLink(result.link, 'Novo link criado; o anterior foi invalidado');
  }

  async function endDemo(id) {
    if (!window.confirm('Encerrar esta demonstração e remover a sessão do WAHA? Essa ação não poderá ser desfeita.')) return;
    const result = await app().api(`/api/demos/${id}/encerrar`, { method: 'POST', body: '{}' });
    app().showToast(result.mensagem || 'Demonstração encerrada.');
    await load(true);
  }

  function answerResult(answer) {
    if (answer.atendida === false) return '<span class="screening-answer-result rejected">Não atendeu</span>';
    if (answer.atendida === true) return '<span class="screening-answer-result approved">Atendeu</span>';
    return '<span class="screening-answer-result neutral">Informativa</span>';
  }

  async function showDetails(id) {
    const dialog = get('demoDetailsDialog');
    get('demoDetailsContent').innerHTML = '<div class="empty-state">Carregando resultados...</div>';
    dialog.showModal();
    try {
      const data = await app().api(`/api/demos/${id}`);
      get('demoDetailsTitle').textContent = data.demo.empresa_nome;
      get('demoDetailsSubtitle').textContent = `${data.demo.vaga_titulo} · expira em ${formatDate(data.demo.expira_em)}`;
      const contacts = data.contatos || [];
      get('demoDetailsContent').innerHTML = contacts.length ? contacts.map((contact) => `<article class="demo-contact-result"><header><div><strong>${escapeHtml(contact.nome || contact.telefone)}</strong><span>${escapeHtml(contact.telefone)} · ${escapeHtml(contact.origem || 'WhatsApp')}</span></div><span class="badge ${contact.status === 'CONCLUIDA' ? 'badge-active' : contact.status === 'NAO_ATENDEU' ? 'badge-rejected' : 'badge-process'}">${escapeHtml(contact.status === 'NAO_ATENDEU' ? 'Não atendeu' : contact.status === 'CONCLUIDA' ? 'Concluída' : 'Em andamento')}</span></header><div class="demo-contact-score"><span>Pontuação</span><strong>${Number(contact.score || 0)}</strong></div><div class="screening-answer-list">${(contact.respostas || []).map((answer) => `<article class="screening-answer"><header><span>${answer.ordem}</span><div><strong>${escapeHtml(answer.pergunta)}</strong><small>${escapeHtml(answer.origem === 'AUDIO' ? 'Áudio transcrito' : 'Texto')}</small></div>${answerResult(answer)}</header><p>${escapeHtml(answer.resumo || answer.resposta || 'Resposta registrada')}</p></article>`).join('') || '<div class="empty-state compact">Nenhuma pergunta respondida.</div>'}</div></article>`).join('') : app().emptyState('Nenhum teste iniciado', 'Depois que alguém conversar com o número conectado, os resultados aparecerão aqui.');
    } catch (error) {
      get('demoDetailsContent').innerHTML = app().emptyState('Não foi possível carregar', error.message);
    }
  }

  function focusCreate() {
    get('demoCompanyName')?.focus();
    get('demoCreateForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  get('demoCreateForm')?.addEventListener('submit', createDemo);
  get('refreshDemosButton')?.addEventListener('click', () => load(true).catch((error) => app().showToast(error.message, 'error')));
  get('closeDemoDetailsButton')?.addEventListener('click', () => get('demoDetailsDialog')?.close());
  get('demosList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-demo-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.demoAction;
    Promise.resolve(action === 'details' ? showDetails(id) : action === 'link' ? renewLink(id) : action === 'end' ? endDemo(id) : null)
      .catch((error) => app().showToast(error.message, 'error'));
  });

  window.GenesisDemos = { load, focusCreate };
})();
