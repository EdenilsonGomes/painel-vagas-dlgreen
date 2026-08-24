'use strict';

(() => {
  const state = { loaded: false, data: null, tab: 'campaigns', queue: 'all', selectedCampaign: null };
  const app = () => window.GenesisApp;
  const root = () => document.getElementById('facebookPromotionRoot');
  const esc = (value) => app()?.escapeHtml?.(value) ?? String(value ?? '');
  const api = (url, options) => app().api(url, options);
  const toast = (message, type) => app().showToast(message, type);
  const number = (value) => Number(value || 0).toLocaleString('pt-BR');
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const statusLabel = (value) => ({ EM_EXECUCAO: 'Em andamento', CONCLUIDA: 'Concluída', RASCUNHO: 'Rascunho', PENDENTE: 'Precisa publicar', ENVIADO: 'Aguardando aprovação', PUBLICADO: 'Publicado', FALHA: 'Com problema', PULADO: 'Pulado' }[String(value || '').toUpperCase()] || value);
  const statusTone = (value) => ({ EM_EXECUCAO: 'active', CONCLUIDA: 'done', PENDENTE: 'pending', ENVIADO: 'waiting', PUBLICADO: 'published', FALHA: 'failed', PULADO: 'muted' }[String(value || '').toUpperCase()] || 'muted');

  function modal(id, content, className = '') {
    document.getElementById(id)?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = id; dialog.className = `facebook-promotion-dialog ${className}`; dialog.innerHTML = content;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.showModal(); return dialog;
  }

  function campaignMatches(item) {
    if (state.tab === 'history') return item.status === 'CONCLUIDA';
    if (item.status === 'CONCLUIDA') return false;
    if (state.queue === 'publish') return Number(item.pendentes) > 0;
    if (state.queue === 'waiting') return Number(item.aguardando_aprovacao) > 0;
    if (state.queue === 'problem') return Number(item.falhas) > 0;
    return true;
  }

  function renderCampaignRows() {
    const campaigns = (state.data?.campanhas || []).filter(campaignMatches);
    if (!campaigns.length) return `<div class="promotion-empty"><strong>Nada nesta fila</strong><span>As campanhas aparecerão aqui conforme avançarem.</span></div>`;
    return `<div class="promotion-campaign-list">${campaigns.map((item) => {
      const total = Math.max(1, Number(item.destinos_total || 0)); const complete = Number(item.publicados || 0) + Number(item.aguardando_aprovacao || 0);
      const progress = Math.round((complete / total) * 100);
      return `<article class="promotion-campaign-card" data-campaign-id="${item.id}" tabindex="0">
        <div class="promotion-campaign-main"><div class="promotion-meta-line"><span class="promotion-status ${statusTone(item.status)}">${esc(statusLabel(item.status))}</span><small>${esc(date(item.updated_at))}</small></div><h3>${esc(item.vaga_titulo)}</h3><p>${esc(item.empresa_nome)}</p></div>
        <div class="promotion-progress"><div><span>Progresso</span><strong>${complete}/${total}</strong></div><i><b style="width:${progress}%"></b></i></div>
        <div class="promotion-campaign-counts"><span><strong>${number(item.pendentes)}</strong> publicar</span><span><strong>${number(item.aguardando_aprovacao)}</strong> aprovação</span><span><strong>${number(item.publicados)}</strong> publicadas</span>${Number(item.falhas) ? `<span class="danger"><strong>${number(item.falhas)}</strong> problemas</span>` : ''}</div>
        <button class="button button-primary" data-action="open-campaign" data-id="${item.id}" type="button">Trabalhar campanha</button>
      </article>`;
    }).join('')}</div>`;
  }

  function renderGroups() {
    const groups = state.data?.grupos || [];
    return `<section class="promotion-groups"><header><div><strong>Grupos do Facebook</strong><span>Cadastre uma vez e reutilize nas campanhas.</span></div><button class="button button-primary" data-action="new-group" type="button">+ Adicionar grupo</button></header>
      ${groups.length ? `<div class="promotion-group-table"><div class="promotion-group-head"><span>Grupo</span><span>Região</span><span>Publicações</span><span>Intervalo</span><span>Ação</span></div>${groups.map((group) => `<article class="promotion-group-row ${group.ativo ? '' : 'inactive'}"><div><strong>${esc(group.nome)}</strong><a href="${esc(group.url)}" target="_blank" rel="noopener">Abrir no Facebook</a></div><span>${esc(group.regiao || 'Sem região')}</span><span>${number(group.publicacoes_total)}</span><span>${number(group.intervalo_minimo_horas)}h</span><button class="button button-ghost" data-action="toggle-group" data-id="${group.id}" data-active="${group.ativo}" type="button">${group.ativo ? 'Desativar' : 'Ativar'}</button></article>`).join('')}</div>` : `<div class="promotion-empty"><strong>Nenhum grupo cadastrado</strong><span>Adicione os grupos em que sua equipe pode publicar vagas.</span></div>`}
    </section>`;
  }

  function render() {
    if (!root() || !state.data) return;
    const r = state.data.resumo || {};
    root().innerHTML = `<section class="promotion-commandbar"><div><span class="promotion-channel">Facebook assistido</span><strong>Divulgação</strong></div><nav aria-label="Seções da divulgação"><button class="${state.tab === 'campaigns' ? 'active' : ''}" data-tab="campaigns" type="button">Campanhas</button><button class="${state.tab === 'groups' ? 'active' : ''}" data-tab="groups" type="button">Grupos</button><button class="${state.tab === 'history' ? 'active' : ''}" data-tab="history" type="button">Histórico</button></nav><button class="button button-primary" data-action="new-campaign" type="button">+ Nova campanha</button></section>
      <section class="promotion-kpis"><article><span>Campanhas ativas</span><strong>${number(r.ativas)}</strong><small>em execução manual</small></article><article><span>Precisa publicar</span><strong>${number(r.pendentes)}</strong><small>grupos aguardando ação</small></article><article><span>Aguardando aprovação</span><strong>${number(r.aguardando)}</strong><small>posts enviados aos grupos</small></article><article><span>Publicadas</span><strong>${number(r.publicadas)}</strong><small>${number(r.cliques)} cliques em 30 dias</small></article></section>
      ${state.tab === 'groups' ? renderGroups() : `<section class="promotion-workspace"><div class="promotion-queues"><span>Para trabalhar agora</span><button class="${state.queue === 'all' ? 'active' : ''}" data-queue="all" type="button">Todas</button><button class="${state.queue === 'publish' ? 'active' : ''}" data-queue="publish" type="button">Precisa publicar <b>${number(r.pendentes)}</b></button><button class="${state.queue === 'waiting' ? 'active' : ''}" data-queue="waiting" type="button">Aguardando aprovação <b>${number(r.aguardando)}</b></button><button class="${state.queue === 'problem' ? 'active' : ''}" data-queue="problem" type="button">Com problema</button></div>${renderCampaignRows()}</section>`}`;
  }

  async function load(force = false) {
    if (!force && state.loaded) return render();
    if (root()) root().innerHTML = '<div class="empty-state">Carregando Divulgação...</div>';
    state.data = await api('/api/admin/divulgacao-facebook/bootstrap'); state.loaded = true; render();
  }

  function newGroupDialog() {
    const dialog = modal('facebookGroupDialog', `<form class="promotion-form-dialog"><header><div><span>GRUPO DO FACEBOOK</span><h2>Adicionar destino</h2><p>Cadastre apenas grupos que permitem anúncios de vagas.</p></div><button value="cancel" class="icon-button" type="button" data-close>×</button></header><div class="promotion-dialog-body"><label class="field span-full"><span>Nome do grupo</span><input name="nome" required maxlength="220"></label><label class="field span-full"><span>URL do grupo</span><input name="url" required type="url" placeholder="https://facebook.com/groups/..."></label><label class="field"><span>Região</span><input name="regiao" maxlength="160"></label><label class="field"><span>Intervalo mínimo</span><select name="intervalo"><option value="24">24 horas</option><option value="48">48 horas</option><option value="72">72 horas</option><option value="168">7 dias</option></select></label><label class="field span-full"><span>Categorias</span><input name="categorias" placeholder="Limpeza, portaria, serviços gerais"></label><label class="field span-full"><span>Regras importantes</span><textarea name="regras" rows="3"></textarea></label></div><footer><button class="button button-ghost" type="button" data-close>Cancelar</button><button class="button button-primary" type="submit">Salvar grupo</button></footer></form>`);
    dialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => dialog.close());
    dialog.querySelector('form').onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const submit = event.submitter; submit.disabled = true; try { await api('/api/admin/divulgacao-facebook/grupos', { method: 'POST', body: JSON.stringify({ nome: form.get('nome'), url: form.get('url'), regiao: form.get('regiao'), categorias: String(form.get('categorias') || '').split(',').map((item) => item.trim()).filter(Boolean), regras: form.get('regras'), intervalo_minimo_horas: Number(form.get('intervalo')) }) }); dialog.close(); toast('Grupo salvo.'); await load(true); } catch (error) { submit.disabled = false; toast(error.message, 'error'); } };
  }

  function newCampaignDialog() {
    const vacancies = state.data?.vagas || []; const groups = (state.data?.grupos || []).filter((item) => item.ativo);
    if (!vacancies.length) return toast('Crie ou ative uma vaga antes de iniciar a campanha.', 'error');
    if (!groups.length) { state.tab = 'groups'; render(); newGroupDialog(); return; }
    const dialog = modal('facebookCampaignDialog', `<form class="promotion-form-dialog promotion-campaign-form"><header><div><span>NOVA CAMPANHA</span><h2>Preparar divulgação</h2><p>Escolha a vaga e os grupos. A publicação continuará manual.</p></div><button class="icon-button" type="button" data-close>×</button></header><div class="promotion-dialog-body"><label class="field span-full"><span>Vaga</span><select name="vaga_id" required><option value="">Selecione</option>${vacancies.map((item) => `<option value="${item.id}">${esc(item.titulo)} · ${esc(item.empresa_nome)}</option>`).join('')}</select></label><label class="field"><span>Modelo do texto</span><select name="modelo"><option value="COMPLETO">Completo</option><option value="CURTO">Curto</option><option value="PERSONALIZADO">Personalizado</option></select></label><label class="toggle-field"><input name="usar_imagem" type="checkbox" checked><span><strong>Usar arte da vaga</strong><small>A imagem atual será reutilizada.</small></span></label><label class="field span-full promotion-custom-text hidden"><span>Texto personalizado</span><textarea name="texto" rows="6" placeholder="Inclua {{link}} onde deve aparecer o link rastreável."></textarea></label><fieldset class="promotion-group-picker span-full"><legend>Grupos</legend><div class="promotion-picker-actions"><button data-select-all type="button">Selecionar todos</button><button data-clear-all type="button">Limpar</button></div>${groups.map((group) => `<label><input name="grupo_ids" value="${group.id}" type="checkbox"><span><strong>${esc(group.nome)}</strong><small>${esc(group.regiao || 'Sem região')}</small></span></label>`).join('')}</fieldset></div><footer><button class="button button-ghost" type="button" data-close>Cancelar</button><button class="button button-primary" type="submit">Criar campanha</button></footer></form>`);
    const form = dialog.querySelector('form');
    dialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => dialog.close());
    form.modelo.onchange = () => dialog.querySelector('.promotion-custom-text').classList.toggle('hidden', form.modelo.value !== 'PERSONALIZADO');
    dialog.querySelector('[data-select-all]').onclick = () => dialog.querySelectorAll('[name="grupo_ids"]').forEach((item) => { item.checked = true; });
    dialog.querySelector('[data-clear-all]').onclick = () => dialog.querySelectorAll('[name="grupo_ids"]').forEach((item) => { item.checked = false; });
    form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form); const ids = data.getAll('grupo_ids').map(Number); if (!ids.length) return toast('Selecione ao menos um grupo.', 'error'); event.submitter.disabled = true; try { const result = await api('/api/admin/divulgacao-facebook/campanhas', { method: 'POST', body: JSON.stringify({ vaga_id: Number(data.get('vaga_id')), grupo_ids: ids, modelo: data.get('modelo'), texto: data.get('texto'), usar_imagem: data.get('usar_imagem') === 'on' }) }); dialog.close(); await load(true); await openCampaign(result.campanha.id); } catch (error) { event.submitter.disabled = false; toast(error.message, 'error'); } };
  }

  function destinationCard(item) {
    const action = item.status === 'PENDENTE' || item.status === 'FALHA';
    return `<article class="promotion-destination ${statusTone(item.status)}"><header><div><span class="promotion-status ${statusTone(item.status)}">${esc(statusLabel(item.status))}</span><h3>${esc(item.grupo_nome)}</h3><p>${esc(item.regiao || 'Sem região')}</p></div><a class="button button-primary" href="${esc(item.grupo_url)}" target="_blank" rel="noopener">Abrir grupo</a></header>${item.regras ? `<div class="promotion-rule"><strong>Regra do grupo</strong><span>${esc(item.regras)}</span></div>` : ''}<textarea readonly rows="6">${esc(item.texto)}</textarea><div class="promotion-destination-actions"><button class="button button-ghost" data-copy="${item.id}" type="button">Copiar texto</button>${action ? `<button class="button button-primary" data-destination-status="PUBLICADO" data-id="${item.id}" type="button">Publicado agora</button><button class="button button-ghost" data-destination-status="ENVIADO" data-id="${item.id}" type="button">Foi para aprovação</button><button class="button button-ghost" data-destination-status="FALHA" data-id="${item.id}" type="button">Não consegui publicar</button>` : item.status === 'ENVIADO' ? `<button class="button button-primary" data-destination-status="PUBLICADO" data-id="${item.id}" type="button">Publicação aprovada</button><button class="button button-ghost" data-destination-status="FALHA" data-id="${item.id}" type="button">Rejeitada pelo grupo</button>` : `<button class="button button-ghost" data-destination-status="PENDENTE" data-id="${item.id}" type="button">Voltar para pendente</button>`}</div></article>`;
  }

  async function openCampaign(id) {
    const data = await api(`/api/admin/divulgacao-facebook/campanhas/${id}`); state.selectedCampaign = data;
    const campaign = data.campanha; const destinations = data.destinos || [];
    const dialog = modal('facebookCampaignDetailDialog', `<div class="promotion-detail-shell"><header><div><span>FACEBOOK · PUBLICAÇÃO MANUAL</span><h2>${esc(campaign.vaga_titulo)}</h2><p>${esc(campaign.empresa_nome)} · ${esc([campaign.bairro, campaign.cidade].filter(Boolean).join(' · '))}</p></div><button class="icon-button" type="button" data-close>×</button></header><div class="promotion-detail-body">${data.imagem_url ? `<aside class="promotion-art"><img src="${esc(data.imagem_url)}" alt="Arte da campanha"><a class="button button-ghost" href="${esc(data.imagem_url)}" target="_blank" rel="noopener">Abrir arte</a></aside>` : ''}<main><div class="promotion-run-summary"><strong>${destinations.filter((item) => item.status === 'PENDENTE').length} grupos precisam de ação</strong><span>Copie o conteúdo, publique no Facebook e registre o resultado.</span></div><div class="promotion-destination-list">${destinations.map(destinationCard).join('') || '<div class="promotion-empty">Nenhum grupo nesta campanha.</div>'}</div></main></div><footer><button class="button button-ghost" type="button" data-close>Fechar</button>${campaign.status !== 'CONCLUIDA' ? `<button class="button button-primary" data-conclude="${campaign.id}" type="button">Concluir campanha</button>` : ''}</footer></div>`, 'promotion-detail-dialog');
    dialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => dialog.close());
    dialog.querySelectorAll('[data-copy]').forEach((button) => button.onclick = async () => { const item = destinations.find((destination) => String(destination.id) === button.dataset.copy); await navigator.clipboard.writeText(item?.texto || ''); toast('Texto copiado.'); });
    dialog.querySelectorAll('[data-destination-status]').forEach((button) => button.onclick = async () => { button.disabled = true; try { await api(`/api/admin/divulgacao-facebook/destinos/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.destinationStatus }) }); await load(true); dialog.close(); await openCampaign(campaign.id); } catch (error) { button.disabled = false; toast(error.message, 'error'); } });
    dialog.querySelector('[data-conclude]')?.addEventListener('click', async (event) => { event.currentTarget.disabled = true; try { await api(`/api/admin/divulgacao-facebook/campanhas/${campaign.id}/concluir`, { method: 'POST', body: '{}' }); dialog.close(); await load(true); toast('Campanha concluída.'); } catch (error) { event.currentTarget.disabled = false; toast(error.message, 'error'); } });
  }

  root()?.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; state.queue = 'all'; render(); return; }
    const queue = event.target.closest('[data-queue]'); if (queue) { state.queue = queue.dataset.queue; render(); return; }
    const action = event.target.closest('[data-action]'); if (!action) return;
    try {
      if (action.dataset.action === 'new-group') newGroupDialog();
      if (action.dataset.action === 'new-campaign') newCampaignDialog();
      if (action.dataset.action === 'open-campaign') await openCampaign(action.dataset.id);
      if (action.dataset.action === 'toggle-group') { await api(`/api/admin/divulgacao-facebook/grupos/${action.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ ativo: action.dataset.active !== 'true' }) }); await load(true); }
    } catch (error) { toast(error.message, 'error'); }
  });

  window.GenesisFacebookPromotionV32 = { load, openCampaign };
})();
