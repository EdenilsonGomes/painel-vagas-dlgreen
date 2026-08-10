'use strict';

(() => {
  const POLL_QUEUE_MS = 12000;
  const POLL_CHAT_MS = 5000;
  const MAX_OPEN = 3;
  const local = {
    initialized: false,
    queue: new Map(),
    seen: new Map(),
    open: new Map(),
    currentUser: null,
    queueTimer: null,
    menuOpen: false,
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  const initials = (value) => String(value || '?').trim().split(/\s+/).filter(Boolean).slice(0,2).map((p)=>p[0]).join('').toUpperCase() || '?';
  const panel = () => window.GenesisPanel || window.GenesisApp || {};
  async function api(path, options={}) {
    if (panel().api) return panel().api(path, options);
    const response = await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const data = await response.json().catch(()=>({}));
    if(!response.ok||data.sucesso===false) throw new Error(data.erro||data.message||`HTTP ${response.status}`);
    return data;
  }
  const toast=(message,type='success')=>panel().toast?.(message,type);
  const currentUserId=()=>Number(local.currentUser?.id||0);
  const isAdmin=()=>String(local.currentUser?.perfil||'').toUpperCase()==='ADMIN';
  const formatTime=(value)=>{if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(d);};

  function ensureUi(){
    if(document.getElementById('genesisFloatingChatLauncher'))return;
    const launcher=document.createElement('button');
    launcher.id='genesisFloatingChatLauncher';
    launcher.className='genesis-floating-chat-launcher';
    launcher.type='button';
    launcher.title='Conversas que precisam de atenção';
    launcher.setAttribute('aria-label','Abrir conversas');
    launcher.innerHTML='<span>💬</span><b id="genesisFloatingChatBadge" class="genesis-floating-chat-badge hidden">0</b>';
    const menu=document.createElement('section');
    menu.id='genesisFloatingChatMenu';
    menu.className='genesis-floating-chat-menu hidden';
    menu.innerHTML='<header><div><strong>Conversas</strong><small>Conversas que precisam de atenção</small></div><span class="gfc-menu-actions"><button type="button" data-gfc-refresh class="icon-button" title="Atualizar">↻</button><button type="button" data-gfc-menu-close class="icon-button" title="Fechar" aria-label="Fechar conversas">×</button></span></header><div id="genesisFloatingChatMenuList" class="genesis-floating-chat-menu-list"></div>';
    const stack=document.createElement('div');
    stack.id='genesisFloatingChatStack';
    stack.className='genesis-floating-chat-stack';
    document.body.append(menu,stack,launcher);
    launcher.addEventListener('click',()=>{local.menuOpen=!local.menuOpen;menu.classList.toggle('hidden',!local.menuOpen);renderMenu();});
    menu.querySelector('[data-gfc-refresh]').addEventListener('click',()=>pollQueue({force:true}));
    menu.querySelector('[data-gfc-menu-close]').addEventListener('click',()=>{local.menuOpen=false;menu.classList.add('hidden');});
    menu.addEventListener('click',(event)=>{const button=event.target.closest('[data-gfc-open]');if(button)openChat(Number(button.dataset.gfcOpen));});
  }

  function actionable(item){return ['AGUARDANDO_ATENDIMENTO','AGUARDANDO_RECRUTADOR'].includes(String(item.atendimento_estado||''));}
  function renderLauncher(){
    const badge=document.getElementById('genesisFloatingChatBadge');
    if(!badge)return;
    const count=[...local.queue.values()].filter(actionable).length;
    badge.textContent=count>99?'99+':String(count);
    badge.classList.toggle('hidden',count===0);
  }
  function renderMenu(){
    const box=document.getElementById('genesisFloatingChatMenuList');if(!box)return;
    const items=[...local.queue.values()].filter(actionable).sort((a,b)=>new Date(a.ultima_mensagem_em||0)-new Date(b.ultima_mensagem_em||0));
    box.innerHTML=items.length?items.map(item=>`<button class="genesis-floating-chat-menu-item" data-gfc-open="${Number(item.id)}" type="button"><span class="avatar">${esc(initials(item.nome))}</span><span class="copy"><strong>${esc(item.nome||`Candidato #${item.id}`)}</strong><span>${esc(item.ultima_mensagem||item.vaga_nome||'Aguardando atendimento')}</span></span><time>${esc(formatTime(item.ultima_mensagem_em))}</time></button>`).join(''):'<div class="genesis-floating-chat-empty">Nenhuma conversa aguardando sua ação agora.</div>';
  }

  function shouldNotify(item, previousId){
    const id=Number(item.ultima_mensagem_id||0);
    return local.initialized && id>Number(previousId||0) && String(item.atendimento_estado)==='AGUARDANDO_RECRUTADOR';
  }
  async function pollQueue({force=false}={}){
    try{
      const data=await api('/api/atendimentos?escopo=TODOS');
      const next=new Map();
      for(const item of data.atendimentos||[]){
        const id=Number(item.id);if(!id)continue;
        next.set(id,item);
        const previous=local.seen.get(id)||0;
        if(shouldNotify(item,previous)){
          toast(`Nova mensagem de ${item.nome||'um candidato'}.`);
          if(window.innerWidth>900 && local.open.size<MAX_OPEN) openChat(id,{auto:true,item});
        }
        local.seen.set(id,Math.max(previous,Number(item.ultima_mensagem_id||0)));
        const chat=local.open.get(id);if(chat){chat.item={...chat.item,...item};syncChatHeader(chat);}
      }
      local.queue=next;local.initialized=true;renderLauncher();if(local.menuOpen||force)renderMenu();
    }catch(error){if(force)toast(error.message,'error');}
  }

  function owned(candidate){return Boolean(candidate?.atendimento_humano_ativo)&&Number(candidate.atendimento_humano_usuario_id||0)===currentUserId();}
  function canTake(candidate){return !candidate?.atendimento_humano_ativo || isAdmin();}
  function statusLabel(candidate,item){
    if(!candidate?.atendimento_humano_ativo)return candidate?.ia_atendimento_ativo===false?'IA pausada · aguardando responsável':'IA ativa · assuma para responder';
    if(owned(candidate))return String(item?.atendimento_estado)==='AGUARDANDO_RECRUTADOR'?'Aguardando sua resposta':'Atendimento humano ativo';
    return `Atendido por ${candidate.atendimento_responsavel_nome||candidate.atendimento_humano_nome||item?.atendimento_responsavel_nome||'outro recrutador'}`;
  }
  function syncChatHeader(chat){
    if(!chat?.element)return;
    const item=chat.item||{};const candidate=chat.candidate||item;
    chat.element.querySelector('[data-gfc-name]').textContent=item.nome||`Candidato #${chat.id}`;
    chat.element.querySelector('[data-gfc-subtitle]').textContent=item.vaga_nome||'Conversa';
    chat.element.querySelector('[data-gfc-status-text]').textContent=statusLabel(candidate,item);
    const assume=chat.element.querySelector('[data-gfc-assume]');
    const isOwned=owned(candidate);
    assume.hidden=isOwned || (!canTake(candidate)&&candidate?.atendimento_humano_ativo);
    assume.textContent=candidate?.atendimento_humano_ativo?'Assumir como admin':'Assumir';
    const textarea=chat.element.querySelector('textarea');const send=chat.element.querySelector('[data-gfc-send]');
    textarea.disabled=!isOwned;send.disabled=!isOwned;textarea.placeholder=isOwned?'Digite uma mensagem...':'Assuma o atendimento para responder...';
  }
  function renderMessages(chat){
    const box=chat.element.querySelector('[data-gfc-messages]');
    const messages=[...chat.messages.values()].sort((a,b)=>Number(a.id)-Number(b.id));
    box.innerHTML=messages.length?messages.map(m=>{const incoming=['USUARIO','CANDIDATO'].includes(String(m.quem||'').toUpperCase());return `<div class="gfc-message ${incoming?'incoming':'outgoing'}">${esc(m.mensagem||'').replace(/\n/g,'<br>')}<small>${esc(formatTime(m.created_at))}${m.status_envio?` · ${esc(String(m.status_envio).toLowerCase())}`:''}</small></div>`;}).join(''):'<div class="gfc-loading">Nenhuma mensagem registrada.</div>';
    box.scrollTop=box.scrollHeight;
  }
  function mergeMessages(chat,messages=[]){for(const m of messages){const id=Number(m.id||0);if(!id)continue;chat.messages.set(id,m);chat.lastId=Math.max(chat.lastId,id);}renderMessages(chat);}
  async function pollConversation(chat,{full=false}={}){
    if(chat.polling)return;chat.polling=true;
    try{
      const data=await api(`/api/atendimento/candidatos/${chat.id}/conversa?after=${full?0:chat.lastId}`);
      if(data.candidato)chat.candidate={...(chat.candidate||{}),...data.candidato};
      mergeMessages(chat,data.mensagens||[]);syncChatHeader(chat);
    }catch(error){chat.element.querySelector('[data-gfc-status-text]').textContent=`Falha ao atualizar: ${error.message}`;}
    finally{chat.polling=false;}
  }
  async function assume(chat){
    const button=chat.element.querySelector('[data-gfc-assume]');button.disabled=true;
    try{const data=await api(`/api/atendimento/candidatos/${chat.id}/assumir`,{method:'POST',body:'{}'});toast(data.mensagem||'Atendimento assumido.');await pollConversation(chat,{full:true});await pollQueue();chat.element.querySelector('textarea')?.focus();}
    catch(error){toast(error.message,'error');}finally{button.disabled=false;}
  }
  async function send(chat){
    const textarea=chat.element.querySelector('textarea');const text=String(textarea.value||'').trim();if(!text)return;
    const button=chat.element.querySelector('[data-gfc-send]');button.disabled=true;
    try{await api(`/api/atendimento/candidatos/${chat.id}/mensagens`,{method:'POST',body:JSON.stringify({mensagem:text,client_message_id:crypto.randomUUID()})});textarea.value='';await pollConversation(chat);await pollQueue();}
    catch(error){toast(error.message,'error');}finally{button.disabled=!owned(chat.candidate);}
  }
  function closeChat(id){const chat=local.open.get(id);if(!chat)return;if(chat.timer)clearInterval(chat.timer);chat.element.remove();local.open.delete(id);}
  function createChat(item){
    const id=Number(item.id);const element=document.createElement('section');element.className='genesis-floating-chat-window';element.dataset.candidateId=String(id);
    element.innerHTML=`<header class="gfc-header"><span class="gfc-avatar">${esc(initials(item.nome))}</span><span class="gfc-person"><strong data-gfc-name>${esc(item.nome||`Candidato #${id}`)}</strong><small data-gfc-subtitle>${esc(item.vaga_nome||'Conversa')}</small></span><span class="gfc-header-actions"><button type="button" data-gfc-profile title="Abrir perfil completo">↗</button><button type="button" data-gfc-min title="Minimizar">−</button><button type="button" data-gfc-close title="Fechar">×</button></span></header><div class="gfc-status"><span data-gfc-status-text>Carregando atendimento...</span><button type="button" data-gfc-assume>Assumir</button></div><div class="gfc-messages" data-gfc-messages><div class="gfc-loading">Carregando conversa...</div></div><div class="gfc-composer"><textarea rows="2" maxlength="4000" disabled></textarea><button type="button" data-gfc-send disabled title="Enviar">➤</button></div>`;
    document.getElementById('genesisFloatingChatStack').appendChild(element);
    const chat={id,item,candidate:item,element,messages:new Map(),lastId:0,timer:null,polling:false};
    element.querySelector('[data-gfc-close]').addEventListener('click',()=>closeChat(id));
    const minimizeButton=element.querySelector('[data-gfc-min]');
    minimizeButton.addEventListener('click',()=>{
      const minimized=element.classList.toggle('minimized');
      // Inline height wins over optional theme/redesign CSS and prevents a minimized chat from keeping its expanded height.
      element.style.height=minimized?'auto':'';
      minimizeButton.textContent=minimized?'□':'−';
      minimizeButton.title=minimized?'Restaurar':'Minimizar';
      minimizeButton.setAttribute('aria-label',minimized?'Restaurar conversa':'Minimizar conversa');
    });
    element.querySelector('[data-gfc-profile]').addEventListener('click',()=>panel().openCandidate?.(id));
    element.querySelector('[data-gfc-assume]').addEventListener('click',()=>assume(chat));
    element.querySelector('[data-gfc-send]').addEventListener('click',()=>send(chat));
    element.querySelector('textarea').addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send(chat);}});
    local.open.set(id,chat);return chat;
  }
  async function openChat(id,{item=null}={}){
    if(window.innerWidth<=900)return;
    const existing=local.open.get(Number(id));if(existing){existing.element.classList.remove('minimized');existing.element.style.height='';const min=existing.element.querySelector('[data-gfc-min]');if(min){min.textContent='−';min.title='Minimizar';min.setAttribute('aria-label','Minimizar conversa');}existing.element.querySelector('textarea')?.focus();return;}
    if(local.open.size>=MAX_OPEN){const first=local.open.keys().next().value;closeChat(first);}
    const source=item||local.queue.get(Number(id))||{id:Number(id),nome:`Candidato #${id}`};
    const chat=createChat(source);local.menuOpen=false;document.getElementById('genesisFloatingChatMenu')?.classList.add('hidden');
    await pollConversation(chat,{full:true});chat.timer=setInterval(()=>pollConversation(chat),POLL_CHAT_MS);
  }

  async function init(){
    if(window.innerWidth<=900)return;
    ensureUi();
    try{const me=await api('/api/auth/me');local.currentUser=me.usuario||window.GenesisApp?.state?.currentUser||null;}catch{return;}
    await pollQueue({force:true});local.queueTimer=setInterval(()=>pollQueue(),POLL_QUEUE_MS);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollQueue();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
