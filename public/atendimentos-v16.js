'use strict';

(() => {
  const local = { scope:'TODOS', items:[], summary:{}, search:'', timer:null };
  const byId=(id)=>document.getElementById(id);
  const panel=()=>window.GenesisPanel||{};
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function api(path,options={}) {
    if(panel().api)return panel().api(path,options);
    const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const d=await r.json().catch(()=>({}));if(!r.ok||d.sucesso===false)throw new Error(d.erro||d.message||`HTTP ${r.status}`);return d;
  }
  function formatTime(value){if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);}
  function waitText(minutes){const m=Math.max(0,Math.round(Number(minutes||0)));if(m<1)return 'agora';if(m<60)return `${m} min`;const h=Math.floor(m/60),rest=m%60;return rest?`${h}h ${rest}min`:`${h}h`;}
  function stateMeta(state){
    const map={
      AGUARDANDO_ATENDIMENTO:['waiting-owner','Aguardando alguém assumir'],
      AGUARDANDO_RECRUTADOR:['waiting-recruiter','Aguardando recrutador'],
      AGUARDANDO_CANDIDATO:['waiting-candidate','Aguardando candidato'],
      IA_PAUSADA:['ia-paused','IA pausada'],
      EM_CONVERSA:['conversation','Em conversa'],
    };return map[state]||map.EM_CONVERSA;
  }
  function filtered(){const q=local.search.trim().toLowerCase();if(!q)return local.items;return local.items.filter((x)=>`${x.nome||''} ${x.vaga_nome||''} ${x.atendimento_responsavel_nome||x.atendimento_humano_nome||''}`.toLowerCase().includes(q));}
  function render(){
    const s=local.summary||{};
    if(byId('humanServiceNeedsAction'))byId('humanServiceNeedsAction').textContent=Number(s.precisam_acao||0);
    if(byId('humanServiceWaitingOwner'))byId('humanServiceWaitingOwner').textContent=Number(s.aguardando_atendimento||0);
    if(byId('humanServiceWaitingRecruiter'))byId('humanServiceWaitingRecruiter').textContent=Number(s.aguardando_recrutador||0);
    if(byId('humanServiceWaitingCandidate'))byId('humanServiceWaitingCandidate').textContent=Number(s.aguardando_candidato||0);
    const list=byId('humanServiceList');if(!list)return;
    const items=filtered();
    if(!items.length){list.innerHTML='<div class="empty-state"><strong>Nenhum atendimento nesta fila</strong><span>Quando a IA for pausada ou um candidato pedir ajuda, o caso aparecerá aqui.</span></div>';return;}
    list.innerHTML=items.map((x)=>{
      const [cls,label]=stateMeta(x.atendimento_estado);
      const attention=['AGUARDANDO_ATENDIMENTO','AGUARDANDO_RECRUTADOR'].includes(x.atendimento_estado);
      const owner=x.atendimento_responsavel_nome||x.atendimento_humano_nome||'Sem responsável';
      const message=String(x.ultima_mensagem||'Sem mensagem registrada').replace(/^#[^:]+:\s*/, '');
      return `<article class="human-service-card" data-human-candidate="${Number(x.id)}">
        <div class="human-service-person"><strong>${esc(x.nome||'Nome não informado')}</strong><span>${esc(x.vaga_nome||'Sem vaga')}</span><small>${esc(owner)}</small></div>
        <div class="human-service-message"><div class="human-service-meta"><span class="human-state ${cls}">${esc(label)}</span><span class="human-service-time ${attention?'attention':''}">${attention?'esperando':'há'} ${esc(waitText(x.tempo_espera_minutos))}</span>${Number(x.documentos_pendentes||0)>0?`<span class="badge badge-warning">${Number(x.documentos_pendentes)} doc. pendente(s)</span>`:''}</div><p>${esc(message)}</p><small>${esc(formatTime(x.ultima_mensagem_em||x.ia_pausada_em))}</small></div>
        <div class="human-service-actions"><button class="button button-primary compact" data-open-human="${Number(x.id)}" type="button">Abrir conversa</button></div>
      </article>`;
    }).join('');
  }
  async function refreshBadge(){try{const d=await api('/api/atendimentos/resumo');const n=Number(d.resumo?.precisam_acao||0);const badge=byId('humanServiceNavBadge');if(badge){badge.textContent=n>99?'99+':String(n);badge.classList.toggle('hidden',n===0);}}catch{}}
  async function load(force=false){
    const d=await api(`/api/atendimentos?escopo=${encodeURIComponent(local.scope)}${force?'&t='+Date.now():''}`);local.items=d.atendimentos||[];local.summary=d.resumo||{};render();await refreshBadge();
  }
  function bind(){
    byId('humanServiceScopeSegments')?.addEventListener('click',(e)=>{const b=e.target.closest('[data-human-scope]');if(!b)return;local.scope=b.dataset.humanScope;byId('humanServiceScopeSegments').querySelectorAll('button').forEach((x)=>x.classList.toggle('active',x===b));load(true).catch((err)=>panel().toast?.(err.message,'error'));});
    byId('humanServiceSearch')?.addEventListener('input',(e)=>{local.search=e.target.value;render();});
    byId('humanServiceList')?.addEventListener('click',async(e)=>{const b=e.target.closest('[data-open-human]');if(!b)return;try{await panel().openCandidate?.(Number(b.dataset.openHuman));document.querySelector('[data-drawer-tab="conversation"]')?.click();}catch(err){panel().toast?.(err.message,'error');}});
    refreshBadge();
    local.timer=setInterval(()=>{if(document.hidden)return;refreshBadge();if(window.GenesisApp?.state?.activeView==='atendimentos')load().catch(()=>{});},30000);local.timer.unref?.();
  }
  window.GenesisAtendimentosV16={load,refreshBadge};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
