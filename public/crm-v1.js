'use strict';

(() => {
  const stageMeta = {
    NOVO_LEAD: ['Novo lead', 'neutral'],
    CONTATADO: ['Contatado', 'process'],
    RESPONDEU: ['Respondeu', 'info'],
    QUALIFICADO: ['Qualificado', 'active'],
    DEMONSTRACAO: ['Demonstração', 'warning'],
    PROPOSTA: ['Proposta', 'warning'],
    NEGOCIACAO: ['Negociação', 'process'],
    GANHO: ['Ganho', 'active'],
    PERDIDO: ['Perdido', 'rejected'],
  };
  const pipelineStages = ['NOVO_LEAD','CONTATADO','RESPONDEU','QUALIFICADO','DEMONSTRACAO','PROPOSTA','NEGOCIACAO'];
  const state = { tab: 'overview', opportunities: [], dashboard: null, selectedId: null, initialized: false, loadedAt: 0 };
  const $ = (id) => document.getElementById(id);
  const app = () => window.GenesisApp;
  const safe = (value) => app()?.escapeHtml?.(value ?? '') ?? String(value ?? '');
  const money = (value) => app()?.formatMoney?.(value) ?? String(value ?? '');
  const date = (value) => value ? (app()?.formatDate?.(value) || String(value)) : 'Sem data';

  function badge(stage) {
    const [label, type] = stageMeta[stage] || [stage || 'Sem etapa', 'neutral'];
    return `<span class="badge badge-${type}">${safe(label)}</span>`;
  }

  function card(opportunity) {
    return `<article class="crm-opportunity-card" draggable="true" data-crm-opportunity="${opportunity.id}" data-stage="${safe(opportunity.etapa)}">
      <header><strong>${safe(opportunity.empresa_nome)}</strong><button class="crm-card-open" data-crm-open="${opportunity.id}" type="button" aria-label="Abrir oportunidade">•••</button></header>
      <span>${safe(opportunity.segmento || opportunity.origem || 'Lead comercial')}</span>
      <div class="crm-card-meta"><small>${safe([opportunity.cidade, opportunity.estado].filter(Boolean).join(' · ') || 'Local não informado')}</small>${opportunity.valor_estimado ? `<strong>${money(opportunity.valor_estimado)}</strong>` : ''}</div>
      <footer><small>${opportunity.responsavel_nome ? `Responsável: ${safe(opportunity.responsavel_nome)}` : 'Sem responsável'}</small>${Number(opportunity.followups_pendentes || 0) ? `<span class="crm-followup-count">${Number(opportunity.followups_pendentes)} follow-up</span>` : ''}</footer>
    </article>`;
  }

  function renderOverview() {
    const root = $('crmTabContent');
    const d = state.dashboard || {};
    const m = d.metricas || {};
    const stages = new Map((d.etapas || []).map((item) => [item.etapa, Number(item.total || 0)]));
    root.innerHTML = `<section class="crm-overview-grid">
      <article class="panel crm-funnel-panel"><div class="panel-header"><div><p class="eyebrow">PIPELINE</p><h3>Funil comercial</h3></div><button class="text-button" data-crm-tab="pipeline" type="button">Abrir pipeline</button></div>
        <div class="crm-funnel-list">${pipelineStages.map((stage) => `<div><span>${safe(stageMeta[stage][0])}</span><strong>${stages.get(stage) || 0}</strong><i style="--crm-funnel:${Math.max(4, Math.min(100, (stages.get(stage)||0) * 12))}%"></i></div>`).join('')}</div>
      </article>
      <article class="panel crm-followups-panel"><div class="panel-header"><div><p class="eyebrow">PRÓXIMAS AÇÕES</p><h3>Follow-ups pendentes</h3></div><button class="text-button" data-crm-tab="followups" type="button">Ver todos</button></div>
        <div class="crm-followups-list">${(d.followups || []).length ? d.followups.map((item) => `<button class="crm-followup-row" data-crm-open="${item.oportunidade_id}" type="button"><span><strong>${safe(item.empresa_nome)}</strong><small>${safe(item.titulo)}</small></span><time>${safe(date(item.vencimento))}</time></button>`).join('') : '<div class="empty-state compact">Nenhum follow-up pendente.</div>'}</div>
      </article>
      <article class="panel crm-recent-panel"><div class="panel-header"><div><p class="eyebrow">ATIVIDADE</p><h3>Oportunidades recentes</h3></div></div>
        <div class="crm-recent-list">${(d.recentes || []).map((item) => `<button data-crm-open="${item.id}" type="button"><span><strong>${safe(item.empresa_nome)}</strong><small>${safe(item.origem || 'CRM')}</small></span>${badge(item.etapa)}</button>`).join('') || '<div class="empty-state compact">Nenhuma oportunidade.</div>'}</div>
      </article>
    </section>`;
    hydrate();
  }

  function renderPipeline() {
    const root = $('crmTabContent');
    root.innerHTML = `<div class="crm-pipeline-shell">${pipelineStages.map((stage) => {
      const items = state.opportunities.filter((item) => item.etapa === stage);
      return `<section class="crm-pipeline-column" data-crm-drop-stage="${stage}"><header><span>${safe(stageMeta[stage][0])}</span><b>${items.length}</b></header><div class="crm-pipeline-cards">${items.map(card).join('') || '<div class="crm-drop-empty">Arraste uma oportunidade para cá</div>'}</div></section>`;
    }).join('')}</div>
    <section class="crm-closed-strip"><div><strong>Fechadas</strong><span>Ganhos e perdas ficam fora do fluxo ativo.</span></div><div>${badge('GANHO')} <b>${state.opportunities.filter((item)=>item.etapa==='GANHO').length}</b>${badge('PERDIDO')} <b>${state.opportunities.filter((item)=>item.etapa==='PERDIDO').length}</b></div></section>`;
    bindDragDrop();
  }

  function groupCompanies() {
    const map = new Map();
    state.opportunities.forEach((item) => {
      const key = item.crm_empresa_id;
      if (!map.has(key)) map.set(key, { id:key, nome:item.empresa_nome, segmento:item.segmento, cidade:item.cidade, estado:item.estado, operacional:item.empresa_operacional_id, abertas:0, ganhos:0, oportunidades:0 });
      const row = map.get(key); row.oportunidades += 1; if (!['GANHO','PERDIDO'].includes(item.etapa)) row.abertas += 1; if (item.etapa==='GANHO') row.ganhos += 1;
    });
    return [...map.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  }

  function renderCompanies() {
    const companies = groupCompanies();
    $('crmTabContent').innerHTML = `<section class="panel crm-company-panel"><div class="crm-company-grid">${companies.map((company) => `<article class="crm-company-card"><div class="crm-company-avatar">${safe(String(company.nome||'?').slice(0,2).toUpperCase())}</div><div><strong>${safe(company.nome)}</strong><span>${safe(company.segmento || 'Segmento não informado')}</span><small>${safe([company.cidade,company.estado].filter(Boolean).join(' · ') || 'Local não informado')}</small></div><div class="crm-company-stats"><span><b>${company.abertas}</b> abertas</span><span><b>${company.oportunidades}</b> total</span></div><footer>${company.operacional ? '<span class="badge badge-active">Cliente operacional</span>' : '<span class="badge badge-neutral">Lead comercial</span>'}<button class="button button-ghost compact" data-crm-open="${state.opportunities.find(o=>o.crm_empresa_id===company.id)?.id || ''}" type="button">Abrir</button></footer></article>`).join('') || '<div class="empty-state">Nenhuma empresa no CRM.</div>'}</div></section>`;
  }

  function renderFollowups() {
    const items = state.dashboard?.followups || [];
    $('crmTabContent').innerHTML = `<section class="panel crm-followups-full"><div class="panel-header"><div><p class="eyebrow">ROTINA COMERCIAL</p><h3>Follow-ups pendentes</h3><span>Priorize o que vence primeiro e conclua sem perder o histórico.</span></div></div><div class="crm-followups-table">${items.length ? items.map((item) => `<article><button class="crm-followup-check" data-crm-followup-done="${item.id}" type="button" title="Concluir follow-up"><span data-icon="check"></span></button><div><strong>${safe(item.empresa_nome)}</strong><span>${safe(item.titulo)}</span><small>${safe(item.responsavel_nome || 'Sem responsável')}</small></div><time>${safe(date(item.vencimento))}</time><button class="button button-ghost compact" data-crm-open="${item.oportunidade_id}" type="button">Abrir</button></article>`).join('') : '<div class="empty-state">Nenhum follow-up pendente.</div>'}</div></section>`;
    hydrate();
  }

  function renderCurrentTab() {
    document.querySelectorAll('[data-crm-tab]').forEach((button) => button.classList.toggle('active', button.dataset.crmTab === state.tab));
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'pipeline') renderPipeline();
    else if (state.tab === 'companies') renderCompanies();
    else renderFollowups();
  }

  function renderHeader() {
    const d = state.dashboard || {}; const m = d.metricas || {};
    $('crmKpiOpen').textContent = Number(m.abertas || 0);
    $('crmKpiDemos').textContent = Number(m.demos || 0);
    $('crmKpiProposals').textContent = Number(m.propostas || 0);
    $('crmKpiWins').textContent = Number(m.ganhos || 0);
    $('crmKpiValue').textContent = money(m.pipeline_valor || 0);
  }

  async function load(force = false) {
    if (!app()?.currentUserIsAdmin?.()) return;
    if (!force && state.initialized && Date.now() - state.loadedAt < 15000) { renderHeader(); renderCurrentTab(); return; }
    const root = $('crmTabContent');
    if (root) root.innerHTML = '<div class="empty-state">Carregando CRM comercial...</div>';
    // Uma única sincronização controlada por carga evita concorrência entre Prospecção e Demonstrações.
    await app().api('/api/admin/crm/sincronizar', { method:'POST', body:'{}' });
    const [dashboard, opportunities] = await Promise.all([
      app().api('/api/admin/crm/dashboard'),
      app().api('/api/admin/crm/oportunidades'),
    ]);
    state.dashboard = dashboard;
    state.opportunities = opportunities.oportunidades || [];
    state.initialized = true;
    state.loadedAt = Date.now();
    renderHeader(); renderCurrentTab();
  }

  async function moveOpportunity(id, stage) {
    const row = state.opportunities.find((item) => Number(item.id) === Number(id));
    if (!row || row.etapa === stage) return;
    if (['GANHO','PERDIDO'].includes(stage)) return openOpportunity(id);
    await app().api(`/api/admin/crm/oportunidades/${id}`, { method:'PATCH', body:JSON.stringify({ etapa:stage }) });
    row.etapa = stage; row.updated_at = new Date().toISOString();
    app().showToast?.(`Movido para ${stageMeta[stage]?.[0] || stage}.`);
    await load(true);
  }

  function bindDragDrop() {
    document.querySelectorAll('[data-crm-opportunity]').forEach((cardEl) => cardEl.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', cardEl.dataset.crmOpportunity); cardEl.classList.add('dragging'); }));
    document.querySelectorAll('[data-crm-opportunity]').forEach((cardEl) => cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging')));
    document.querySelectorAll('[data-crm-drop-stage]').forEach((column) => {
      column.addEventListener('dragover', (event) => { event.preventDefault(); column.classList.add('drag-over'); });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', async (event) => { event.preventDefault(); column.classList.remove('drag-over'); const id=event.dataTransfer.getData('text/plain'); if(id) await moveOpportunity(id,column.dataset.crmDropStage); });
    });
  }

  async function openOpportunity(id) {
    if (!id) return;
    state.selectedId = Number(id);
    const dialog = $('crmOpportunityDialog');
    $('crmOpportunityBody').innerHTML = '<div class="empty-state">Carregando oportunidade...</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const data = await app().api(`/api/admin/crm/oportunidades/${id}`);
      const o = data.oportunidade;
      $('crmOpportunityTitle').textContent = o.empresa_nome;
      $('crmOpportunitySubtitle').textContent = o.titulo || 'Oportunidade comercial';
      $('crmOpportunityBody').innerHTML = `<div class="crm-detail-grid">
        <section class="crm-detail-main">
          <article class="crm-detail-summary"><div><span>Etapa</span>${badge(o.etapa)}</div><div><span>Origem</span><strong>${safe(o.origem)}</strong></div><div><span>Responsável</span><strong>${safe(o.responsavel_nome || 'Não definido')}</strong></div><div><span>Valor estimado</span><strong>${o.valor_estimado ? money(o.valor_estimado) : 'Não informado'}</strong></div></article>
          <article class="panel crm-detail-section"><div class="panel-header"><div><p class="eyebrow">CONTATOS</p><h3>Pessoas da empresa</h3></div></div><div class="crm-contact-list">${(data.contatos||[]).map((c)=>`<div><span class="crm-contact-avatar">${safe(String(c.nome||c.whatsapp||'?').slice(0,1).toUpperCase())}</span><span><strong>${safe(c.nome || 'Contato')}</strong><small>${safe(c.cargo || c.email || c.whatsapp || 'Sem dados adicionais')}</small></span></div>`).join('') || '<div class="empty-state compact">Nenhum contato registrado.</div>'}</div></article>
          <article class="panel crm-detail-section"><div class="panel-header"><div><p class="eyebrow">HISTÓRICO</p><h3>Interações</h3></div></div><form id="crmInteractionForm" class="crm-inline-form"><input id="crmInteractionText" maxlength="1000" placeholder="Registrar ligação, retorno, observação..."><button class="button button-primary compact" type="submit">Registrar</button></form><div class="crm-interaction-list">${(data.interacoes||[]).map((i)=>`<div><span></span><section><strong>${safe(i.tipo)}</strong><p>${safe(i.descricao)}</p><small>${safe(i.criado_por_nome || 'Sistema')} · ${safe(date(i.created_at))}</small></section></div>`).join('') || '<div class="empty-state compact">Sem interações manuais.</div>'}</div></article>
        </section>
        <aside class="crm-detail-side">
          <article class="panel crm-detail-actions"><label class="field"><span>Etapa</span><select id="crmDetailStage">${Object.entries(stageMeta).map(([value,meta])=>`<option value="${value}" ${value===o.etapa?'selected':''}>${safe(meta[0])}</option>`).join('')}</select></label><label class="field"><span>Próxima ação</span><input id="crmDetailNextAction" value="${safe(o.proxima_acao || '')}" maxlength="240" placeholder="Ex.: retornar proposta"></label><label class="field"><span>Quando</span><input id="crmDetailNextAt" type="datetime-local" value="${o.proxima_acao_em ? new Date(o.proxima_acao_em).toISOString().slice(0,16) : ''}"></label><button id="crmSaveOpportunityButton" class="button button-primary" type="button">Salvar oportunidade</button>${o.empresa_operacional_id ? '<div class="crm-client-linked"><span data-icon="check"></span><strong>Cliente operacional vinculado</strong></div>' : `<button id="crmConvertClientButton" class="button button-ghost" type="button">Converter em cliente</button>`}</article>
          <article class="panel crm-detail-section"><div class="panel-header"><div><p class="eyebrow">FOLLOW-UP</p><h3>Próxima tarefa</h3></div></div><form id="crmFollowupForm" class="stack-form"><label class="field"><span>Ação</span><input id="crmFollowupTitle" maxlength="240" required placeholder="Ex.: cobrar retorno da proposta"></label><label class="field"><span>Vencimento</span><input id="crmFollowupAt" type="datetime-local"></label><button class="button button-primary" type="submit">Criar follow-up</button></form><div class="crm-detail-followups">${(data.followups||[]).map((f)=>`<div class="${f.status!=='PENDENTE'?'done':''}"><span><strong>${safe(f.titulo)}</strong><small>${safe(date(f.vencimento))}</small></span>${f.status==='PENDENTE'?`<button data-crm-followup-done="${f.id}" type="button" class="text-button">Concluir</button>`:`<small>${safe(f.status)}</small>`}</div>`).join('') || '<div class="empty-state compact">Nenhum follow-up.</div>'}</div></article>
          ${o.demo_id ? `<article class="crm-source-card"><span data-icon="monitor"></span><div><strong>Demonstração vinculada</strong><small>${safe(o.demo_status || 'Registrada')} · ${o.demo_expira_em ? safe(date(o.demo_expira_em)) : ''}</small></div><button data-go-view="demos" class="text-button" type="button">Abrir</button></article>` : ''}
          ${o.prospeccao_lead_id ? `<article class="crm-source-card"><span data-icon="target"></span><div><strong>Lead de prospecção</strong><small>${safe(o.prospeccao_status || 'Registrado')}</small></div><button data-go-view="prospecting" class="text-button" type="button">Abrir</button></article>` : ''}
        </aside>
      </div>`;
      hydrate(); bindDetailForms();
    } catch (error) { $('crmOpportunityBody').innerHTML = `<div class="empty-state"><strong>Não foi possível abrir</strong><span>${safe(error.message)}</span></div>`; }
  }

  function bindDetailForms() {
    $('crmSaveOpportunityButton')?.addEventListener('click', async () => {
      const stage = $('crmDetailStage').value;
      const payload = { etapa:stage, proxima_acao:$('crmDetailNextAction').value, proxima_acao_em:$('crmDetailNextAt').value || null };
      if (stage === 'PERDIDO') { const reason = window.prompt('Motivo da perda:'); if (!reason) return; payload.motivo_perda = reason; }
      await app().api(`/api/admin/crm/oportunidades/${state.selectedId}`, {method:'PATCH',body:JSON.stringify(payload)}); app().showToast?.('Oportunidade atualizada.'); await openOpportunity(state.selectedId); await load(true);
    });
    $('crmInteractionForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const text=$('crmInteractionText').value.trim(); if(!text)return; await app().api(`/api/admin/crm/oportunidades/${state.selectedId}/interacoes`,{method:'POST',body:JSON.stringify({tipo:'NOTA',descricao:text})}); await openOpportunity(state.selectedId); });
    $('crmFollowupForm')?.addEventListener('submit', async (event) => { event.preventDefault(); const title=$('crmFollowupTitle').value.trim(); if(!title)return; await app().api(`/api/admin/crm/oportunidades/${state.selectedId}/followups`,{method:'POST',body:JSON.stringify({titulo:title,vencimento:$('crmFollowupAt').value||null})}); app().showToast?.('Follow-up criado.'); await openOpportunity(state.selectedId); await load(true); });
    $('crmConvertClientButton')?.addEventListener('click', async () => { if(!window.confirm('Converter/vincular esta empresa como cliente operacional da Gênesis?'))return; const result=await app().api(`/api/admin/crm/oportunidades/${state.selectedId}/converter-cliente`,{method:'POST',body:'{}'}); app().showToast?.(result.mensagem||'Cliente convertido.'); await openOpportunity(state.selectedId); await load(true); });
  }

  function openCreate() {
    $('crmNewOpportunityForm').reset();
    $('crmNewOpportunityDialog').showModal();
    $('crmNewCompanyName')?.focus();
  }

  async function createOpportunity(event) {
    event.preventDefault();
    const payload = {
      empresa_nome:$('crmNewCompanyName').value,
      segmento:$('crmNewSegment').value,
      cidade:$('crmNewCity').value,
      estado:$('crmNewState').value,
      contato_nome:$('crmNewContactName').value,
      contato_whatsapp:$('crmNewContactWhatsapp').value,
      contato_email:$('crmNewContactEmail').value,
      valor_estimado:$('crmNewValue').value,
      etapa:$('crmNewStage').value,
      proxima_acao:$('crmNewNextAction').value,
      proxima_acao_em:$('crmNewNextAt').value || null,
    };
    const result=await app().api('/api/admin/crm/oportunidades',{method:'POST',body:JSON.stringify(payload)});
    $('crmNewOpportunityDialog').close(); app().showToast?.(result.mensagem||'Oportunidade criada.'); await load(true);
  }

  async function completeFollowup(id) {
    await app().api(`/api/admin/crm/followups/${id}`,{method:'PATCH',body:JSON.stringify({status:'CONCLUIDO'})}); app().showToast?.('Follow-up concluído.'); await load(true); if(state.selectedId && $('crmOpportunityDialog')?.open) await openOpportunity(state.selectedId);
  }

  function hydrate() { window.GenesisUIV18?.hydrateIcons?.(document); }

  function bindOnce() {
    if (state.bound) return; state.bound=true;
    $('crmTabs')?.addEventListener('click', (event)=>{ const button=event.target.closest('[data-crm-tab]'); if(!button)return; state.tab=button.dataset.crmTab; renderCurrentTab(); });
    $('crmRoot')?.addEventListener('click', (event)=>{ const tab=event.target.closest('[data-crm-tab]'); if(tab){state.tab=tab.dataset.crmTab;renderCurrentTab();return;} const open=event.target.closest('[data-crm-open]'); if(open)return openOpportunity(open.dataset.crmOpen); const done=event.target.closest('[data-crm-followup-done]'); if(done)return completeFollowup(done.dataset.crmFollowupDone); });
    document.addEventListener('click', (event)=>{ const done=event.target.closest('[data-crm-followup-done]'); if(done && !$('crmRoot')?.contains(done)) completeFollowup(done.dataset.crmFollowupDone).catch((e)=>app().showToast?.(e.message,'error')); });
    $('crmSyncButton')?.addEventListener('click', async()=>{ await app().api('/api/admin/crm/sincronizar',{method:'POST',body:'{}'}); app().showToast?.('Prospecção e demonstrações sincronizadas.'); await load(true); });
    $('crmNewOpportunityButton')?.addEventListener('click',openCreate);
    $('crmCloseOpportunityButton')?.addEventListener('click',()=> $('crmOpportunityDialog').close());
    $('crmCloseNewButton')?.addEventListener('click',()=> $('crmNewOpportunityDialog').close());
    $('crmCancelNewButton')?.addEventListener('click',()=> $('crmNewOpportunityDialog').close());
    $('crmNewOpportunityForm')?.addEventListener('submit',createOpportunity);
  }

  bindOnce();
  window.GenesisCRM = { load, focusCreate: openCreate, openOpportunity };
})();
