'use strict';

(() => {
  const POLL_LIST_MS = 30000;
  const POLL_CHAT_MS = 8000;
  const STORE_KEY = 'genesis_conversations_v164_read';
  const SEEDED_KEY = 'genesis_conversations_v164_seeded';
  const local = {
    items: [],
    filter: 'TODOS',
    search: '',
    selectedId: null,
    selectedItem: null,
    candidate: null,
    messages: new Map(),
    lastId: 0,
    currentUser: null,
    read: {},
    listTimer: null,
    chatTimer: null,
    loadingList: false,
    loadingChat: false,
    sendingMessage: false,
  };

  const byId = (id) => document.getElementById(id);
  const panel = () => window.GenesisPanel || window.GenesisApp || {};
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const initials = (value) => String(value || '?').trim().split(/\s+/).filter(Boolean).slice(0,2).map((part)=>part[0]).join('').toUpperCase() || '?';
  const stripAuthor = (value) => String(value || '').replace(/^#[^:]+:\s*/, '');
  const isIncoming = (who) => ['USUARIO','CANDIDATO'].includes(String(who || '').toUpperCase());
  const currentUserId = () => Number(local.currentUser?.id || 0);
  const isAdmin = () => String(local.currentUser?.perfil || '').toUpperCase() === 'ADMIN';

  async function api(path, options={}) {
    if (panel().api) return panel().api(path, options);
    const response = await fetch(path, { credentials:'same-origin', headers:{'Content-Type':'application/json', ...(options.headers || {})}, ...options });
    const data = await response.json().catch(()=>({}));
    if (!response.ok || data.sucesso === false) throw new Error(data.erro || data.message || `HTTP ${response.status}`);
    return data;
  }
  const toast = (message, type='success') => panel().toast?.(message, type);

  const readStoreKey = () => `${STORE_KEY}_${currentUserId() || 'shared'}`;
  const seededStoreKey = () => `${SEEDED_KEY}_${currentUserId() || 'shared'}`;
  function loadReadState() {
    try { local.read = JSON.parse(localStorage.getItem(readStoreKey()) || '{}') || {}; } catch { local.read = {}; }
  }
  function saveReadState() {
    try { localStorage.setItem(readStoreKey(), JSON.stringify(local.read)); } catch {}
  }
  function formatListTime(value) {
    if (!value) return '';
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const sameDay = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
      === new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    return new Intl.DateTimeFormat('pt-BR', sameDay
      ? {timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}
      : {timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit'}).format(date);
  }
  function formatMessageTime(value) {
    if (!value) return '';
    const date = new Date(value); if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);
  }
  function isUnread(item) {
    if (!isIncoming(item.ultima_mensagem_quem)) return false;
    return Number(item.ultima_mensagem_id || 0) > Number(local.read[item.id] || 0);
  }
  function humanActive(item) { return item?.atendimento_humano_ativo === true; }
  function owned(candidate) {
    return Boolean(candidate?.atendimento_humano_ativo)
      && Number(candidate.atendimento_humano_usuario_id || 0) === currentUserId();
  }
  function canAssume(candidate) {
    return !candidate?.atendimento_humano_ativo || isAdmin() || owned(candidate);
  }
  function statusMeta(item) {
    if (item?.atendimento_humano_ativo) {
      if (owned(item)) return ['badge-warning','Humano · você'];
      return ['badge-warning',`Humano · ${item.atendimento_responsavel_nome || item.atendimento_humano_nome || 'equipe'}`];
    }
    if (item?.ia_atendimento_ativo === false) return ['badge-warning','IA pausada'];
    return ['badge-approved','IA ativa'];
  }

  function filteredItems() {
    const q = local.search.trim().toLocaleLowerCase('pt-BR');
    return local.items.filter((item) => {
      const unread = isUnread(item);
      const filterOk = local.filter === 'TODOS'
        || (local.filter === 'NAO_LIDOS' && unread)
        || (local.filter === 'HUMANO' && humanActive(item))
        || (local.filter === 'IA' && !humanActive(item) && item.ia_atendimento_ativo !== false);
      if (!filterOk) return false;
      if (!q) return true;
      return [item.nome,item.telefone,item.vaga_nome,item.ultima_mensagem]
        .join(' ').toLocaleLowerCase('pt-BR').includes(q);
    });
  }

  function renderBadge() {
    const n = local.items.filter((item) => isUnread(item)).length;
    const badge = byId('humanServiceNavBadge');
    if (!badge) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  function renderList() {
    const list = byId('allChatsList'); if (!list) return;
    const items = filteredItems();
    if (!items.length) {
      list.innerHTML = '<div class="empty-state compact"><strong>Nenhuma conversa encontrada</strong><span>Ajuste a busca ou o filtro.</span></div>';
      renderBadge();
      return;
    }
    list.innerHTML = items.map((item) => {
      const unread = isUnread(item);
      const selected = Number(item.id) === Number(local.selectedId);
      const [statusClass,statusLabel] = statusMeta(item);
      return `<button class="conversation-center-item ${selected ? 'selected' : ''} ${unread ? 'unread' : ''}" data-chat-open="${Number(item.id)}" type="button">
        <span class="conversation-center-avatar">${esc(initials(item.nome))}</span>
        <span class="conversation-center-item-copy"><span class="conversation-center-item-title"><strong>${esc(item.nome || `Candidato #${item.id}`)}</strong><time>${esc(formatListTime(item.ultima_mensagem_em))}</time></span><span class="conversation-center-item-preview">${esc(stripAuthor(item.ultima_mensagem) || 'Sem mensagem')}</span><small>${esc(item.vaga_nome || 'Sem vaga')} · <em class="${statusClass}">${esc(statusLabel)}</em></small></span>
        ${unread ? '<b class="conversation-center-unread" aria-label="Não lida">•</b>' : ''}
      </button>`;
    }).join('');
    renderBadge();
  }

  function seedReadState() {
    if (localStorage.getItem(seededStoreKey())) return;
    for (const item of local.items) {
      const actionable = ['AGUARDANDO_RECRUTADOR','AGUARDANDO_ATENDIMENTO'].includes(String(item.atendimento_estado || ''));
      if (!actionable) local.read[item.id] = Number(item.ultima_mensagem_id || 0);
    }
    saveReadState();
    try { localStorage.setItem(seededStoreKey(), '1'); } catch {}
  }

  async function load(force=false) {
    if (local.loadingList) return;
    local.loadingList = true;
    try {
      const data = await api(`/api/conversas?escopo=TODOS&limite=300${force ? `&t=${Date.now()}` : ''}`);
      local.items = data.conversas || [];
      seedReadState();
      renderList();
      if (local.selectedId) {
        const current = local.items.find((item)=>Number(item.id)===Number(local.selectedId));
        if (current) { local.selectedItem = current; syncHeader(); }
      }
    } catch (error) {
      const list = byId('allChatsList');
      if (list) list.innerHTML = `<div class="empty-state compact"><strong>Não foi possível carregar</strong><span>${esc(error.message)}</span></div>`;
      if (force) toast(error.message,'error');
    } finally { local.loadingList = false; }
  }

  function renderMessages() {
    const box = byId('allChatsMessages'); if (!box) return;
    const messages = [...local.messages.values()].sort((a,b)=>Number(a.id)-Number(b.id));
    if (!messages.length) {
      box.innerHTML = '<div class="conversation-center-empty small"><strong>Nenhuma mensagem registrada.</strong></div>';
      return;
    }
    box.innerHTML = messages.map((message) => {
      const incoming = isIncoming(message.quem);
      const author = !incoming && message.autor_nome ? `<span class="conversation-center-author">${esc(message.autor_nome)}</span>` : '';
      return `<div class="conversation-center-message ${incoming ? 'incoming' : 'outgoing'}">${author}<div>${esc(stripAuthor(message.mensagem)).replace(/\n/g,'<br>')}</div><small>${esc(formatMessageTime(message.created_at))}${message.status_envio ? ` · ${esc(String(message.status_envio).toLowerCase())}` : ''}</small></div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function syncHeader() {
    const item = local.selectedItem || {};
    const candidate = local.candidate || item;
    byId('allChatsAvatar').textContent = initials(item.nome);
    byId('allChatsName').textContent = item.nome || `Candidato #${local.selectedId}`;
    byId('allChatsVacancy').textContent = item.vaga_nome || 'Sem vaga';
    const [cls,label] = statusMeta({...item,...candidate});
    const status = byId('allChatsStatus');
    status.className = `badge ${cls}`; status.textContent = label;
    const assume = byId('allChatsAssumeButton');
    const isOwned = owned(candidate);
    assume.classList.toggle('hidden', isOwned);
    assume.disabled = !canAssume(candidate);
    assume.textContent = candidate?.atendimento_humano_ativo ? 'Assumir como admin' : 'Assumir atendimento';
    const input = byId('allChatsMessageInput');
    const send = byId('allChatsSendButton');
    input.disabled = !isOwned; send.disabled = !isOwned;
    input.placeholder = isOwned ? 'Digite uma mensagem...' : 'Assuma o atendimento para responder...';
  }

  function mergeMessages(messages=[]) {
    for (const message of messages) {
      const id = Number(message.id || 0); if (!id) continue;
      local.messages.set(id,message); local.lastId = Math.max(local.lastId,id);
    }
    if (local.selectedId && local.lastId) {
      local.read[local.selectedId] = Math.max(Number(local.read[local.selectedId] || 0), local.lastId);
      saveReadState(); renderList();
    }
    renderMessages();
  }

  async function pollSelected({full=false}={}) {
    if (!local.selectedId || local.loadingChat) return;
    local.loadingChat = true;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.selectedId}/conversa?after=${full ? 0 : local.lastId}`);
      if (data.candidato) local.candidate = {...(local.candidate || {}), ...data.candidato};
      mergeMessages(data.mensagens || []);
      syncHeader();
    } catch (error) {
      toast(error.message,'error');
    } finally { local.loadingChat = false; }
  }

  async function openConversation(id) {
    id = Number(id); if (!id) return;
    local.selectedId = id;
    local.selectedItem = local.items.find((item)=>Number(item.id)===id) || {id,nome:`Candidato #${id}`};
    local.candidate = local.selectedItem;
    local.messages = new Map(); local.lastId = 0;
    byId('allChatsEmpty')?.classList.add('hidden');
    byId('allChatsWorkspace')?.classList.remove('hidden');
    document.querySelector('.conversation-center')?.classList.add('chat-open-mobile');
    local.read[id] = Math.max(Number(local.read[id] || 0), Number(local.selectedItem.ultima_mensagem_id || 0));
    saveReadState(); renderList(); syncHeader();
    byId('allChatsMessages').innerHTML = '<div class="empty-state compact">Carregando conversa...</div>';
    await pollSelected({full:true});
    if (local.chatTimer) clearInterval(local.chatTimer);
    local.chatTimer = setInterval(()=>{if(!document.hidden&&window.GenesisApp?.state?.activeView==='atendimentos')pollSelected();},POLL_CHAT_MS);
  }

  function closeMobileConversation() {
    document.querySelector('.conversation-center')?.classList.remove('chat-open-mobile');
  }

  async function assumeSelected() {
    if (!local.selectedId) return;
    const button = byId('allChatsAssumeButton'); button.disabled = true;
    try {
      const result = await api(`/api/atendimento/candidatos/${local.selectedId}/assumir`,{method:'POST',body:'{}'});
      toast(result.mensagem || 'Atendimento assumido.');
      await Promise.all([pollSelected({full:true}),load(true)]);
      byId('allChatsMessageInput')?.focus();
    } catch (error) { toast(error.message,'error'); }
    finally { syncHeader(); }
  }

  async function sendSelected(event) {
    event?.preventDefault?.();
    if (!local.selectedId || local.sendingMessage) return;
    const input = byId('allChatsMessageInput');
    const text = String(input.value || '').trim(); if (!text) return;
    const button = byId('allChatsSendButton'); local.sendingMessage = true; button.disabled = true;
    try {
      const clientMessageId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      await api(`/api/atendimento/candidatos/${local.selectedId}/mensagens`,{method:'POST',body:JSON.stringify({mensagem:text,client_message_id:clientMessageId})});
      input.value = '';
      await Promise.all([pollSelected(),load(true)]);
    } catch (error) { toast(error.message,'error'); }
    finally { local.sendingMessage = false; syncHeader(); }
  }

  function bind() {
    byId('allChatsSearch')?.addEventListener('input',(event)=>{local.search=event.target.value;renderList();});
    byId('allChatsFilters')?.addEventListener('click',(event)=>{const button=event.target.closest('[data-chat-filter]');if(!button)return;local.filter=button.dataset.chatFilter;byId('allChatsFilters').querySelectorAll('button').forEach((item)=>item.classList.toggle('active',item===button));renderList();});
    byId('allChatsList')?.addEventListener('click',(event)=>{const button=event.target.closest('[data-chat-open]');if(button)openConversation(button.dataset.chatOpen);});
    byId('allChatsRefreshButton')?.addEventListener('click',()=>load(true));
    byId('allChatsBackButton')?.addEventListener('click',closeMobileConversation);
    byId('allChatsProfileButton')?.addEventListener('click',()=>local.selectedId && panel().openCandidate?.(local.selectedId));
    byId('allChatsAssumeButton')?.addEventListener('click',assumeSelected);
    byId('allChatsComposer')?.addEventListener('submit',sendSelected);
    byId('allChatsMessageInput')?.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSelected(event);}});
    local.listTimer = setInterval(()=>{if(!document.hidden&&window.GenesisApp?.state?.activeView==='atendimentos')load();},POLL_LIST_MS);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&window.GenesisApp?.state?.activeView==='atendimentos')load();});
    api('/api/auth/me').then((data)=>{local.currentUser=data.usuario||panel().getCurrentUser?.()||null;loadReadState();if(window.GenesisApp?.state?.activeView==='atendimentos')load(true);}).catch(()=>{});
  }

  window.GenesisConversationsV164 = { load, openConversation };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
})();
