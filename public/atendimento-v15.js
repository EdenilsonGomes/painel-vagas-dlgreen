'use strict';

(() => {
  const POLL_INTERVAL_MS = 5000;
  const quickReplies = [
    'Olá! Sou a recrutadora responsável pelo seu processo.',
    'Recebi sua mensagem e estou verificando as informações.',
    'Sua entrevista permanece confirmada no horário agendado.',
    'Preciso que envie novamente o documento com melhor qualidade.',
  ];

  const handoffFieldLabels = {
    nome: 'Nome', cep: 'CEP', cidade: 'Cidade', estado: 'Estado', cargo: 'Cargo', tempo_experiencia: 'Experiência',
    apresentacao_profissional: 'Apresentação profissional', observacao_triagem: 'Observação da triagem', telefone: 'Telefone', cpf: 'CPF',
    nome_mae: 'Nome da mãe', data_nascimento: 'Data de nascimento', sexo: 'Sexo',
  };

  const local = {
    candidateId: null,
    details: null,
    user: null,
    isAdmin: false,
    activeTab: 'summary',
    pollingTimer: null,
    polling: false,
    lastMessageId: 0,
    messages: new Map(),
    previewTimer: null,
  };

  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const panel = () => window.GenesisPanel || {};
  const toast = (message, type = 'success') => panel().toast?.(message, type);

  async function api(path, options = {}) {
    if (panel().api) return panel().api(path, options);
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.sucesso === false) throw new Error(data.erro || data.message || `Erro HTTP ${response.status}`);
    return data;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function messageDirection(message) {
    const author = String(message.quem || '').toUpperCase();
    return ['USUARIO', 'CANDIDATO'].includes(author) ? 'incoming' : 'outgoing';
  }

  function renderMessages() {
    const container = byId('candidateConversation');
    if (!container) return;
    const messages = [...local.messages.values()].sort((a, b) => Number(a.id) - Number(b.id));
    if (!messages.length) {
      container.innerHTML = '<div class="empty-state compact"><strong>Nenhuma mensagem registrada</strong><span>A conversa aparecerá aqui quando o atendimento começar.</span></div>';
      return;
    }
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    container.innerHTML = messages.map((message) => {
      const direction = messageDirection(message);
      const author = String(message.quem || '').toUpperCase();
      const label = direction === 'incoming' ? 'Candidato' : author === 'IA' ? 'Evelyn' : (message.autor_nome || 'Equipe Genesis');
      const delivery = message.status_envio
        ? `<small class="message-delivery ${esc(String(message.status_envio).toLowerCase())}">${esc(message.status_envio)}</small>`
        : '';
      return `<article class="conversation-message ${direction}" data-message-id="${Number(message.id)}">
        <div><strong>${esc(label)}</strong><time>${esc(formatDate(message.created_at))}</time></div>
        <p>${esc(message.mensagem || 'Mensagem sem conteúdo').replace(/\n/g, '<br>')}</p>${delivery}
      </article>`;
    }).join('');
    if (wasNearBottom || messages.length <= 120) container.scrollTop = container.scrollHeight;
  }

  function mergeMessages(messages = []) {
    for (const message of messages) {
      const id = Number(message.id || 0);
      if (!id) continue;
      local.messages.set(id, message);
      local.lastMessageId = Math.max(local.lastMessageId, id);
    }
    renderMessages();
  }

  async function reloadCandidateDrawer() {
    const id = local.candidateId;
    if (!id) return;
    const drawer = byId('candidateDrawer');
    if (drawer?.open) drawer.close();
    await panel().openCandidate?.(id);
  }

  function currentUserId() { return Number(local.user?.id || 0); }
  function humanOwnedByCurrent(candidate) {
    return Boolean(candidate?.atendimento_humano_ativo) && Number(candidate.atendimento_humano_usuario_id || 0) === currentUserId();
  }

  function latestMessage() {
    return [...local.messages.values()].sort((a,b)=>Number(b.id)-Number(a.id))[0] || null;
  }

  function humanWaitState(candidate) {
    if (!candidate?.atendimento_humano_ativo) return { key:'AGUARDANDO_ATENDIMENTO', label:'Aguardando alguém assumir' };
    const who=String(latestMessage()?.quem||'').toUpperCase();
    if (['USUARIO','CANDIDATO'].includes(who)) return { key:'AGUARDANDO_RECRUTADOR', label:'Aguardando sua resposta' };
    if (['RECRUTADOR','IA'].includes(who)) return { key:'AGUARDANDO_CANDIDATO', label:'Aguardando candidato' };
    return { key:'EM_CONVERSA', label:'Em conversa' };
  }

  function syncChatControls(candidate = local.details?.candidato) {
    if (!candidate) return;
    const active = Boolean(candidate.atendimento_humano_ativo);
    const owned = humanOwnedByCurrent(candidate);
    const owner = candidate.atendimento_responsavel_nome || candidate.atendimento_humano_nome || 'outro recrutador';
    const ownerBadge = byId('candidateChatOwnerBadge');
    const statusText = byId('candidateChatStatusText');
    const assume = byId('assumeCandidateChatButton');
    const returnButton = byId('returnCandidateChatButton');
    const composer = byId('candidateChatComposer');
    const textarea = byId('candidateChatMessage');
    const send = byId('sendCandidateChatButton');
    const replies = byId('candidateChatQuickReplies');
    const upload = byId('uploadCandidateDocumentButton');

    if (active) {
      const wait=humanWaitState(candidate);
      ownerBadge.textContent = owned ? wait.label : `Atendimento: ${owner}`;
      ownerBadge.className = `badge ${wait.key === 'AGUARDANDO_RECRUTADOR' ? 'badge-warning' : owned ? 'badge-approved' : 'badge-warning'}`;
      const pausedAt=candidate.ia_pausada_em ? ` IA pausada desde ${formatDate(candidate.ia_pausada_em)}.` : ' A IA está pausada.';
      statusText.textContent = owned ? `${wait.label}.${pausedAt}` : `${owner} é o responsável atual.${pausedAt}`;
      assume.textContent = owned ? 'Atendimento assumido' : (local.isAdmin ? 'Assumir de administrador' : 'Atendimento ocupado');
      assume.disabled = owned || (!local.isAdmin && active);
      assume.classList.toggle('hidden', owned);
      returnButton.classList.toggle('hidden', !owned && !local.isAdmin);
      if(upload) upload.classList.toggle('hidden', !owned && !local.isAdmin);
    } else {
      const aiActive = candidate.ia_atendimento_ativo !== false;
      ownerBadge.textContent = aiActive ? 'IA ativa' : 'Aguardando atendimento';
      ownerBadge.className = `badge ${aiActive ? 'badge-approved' : 'badge-warning'}`;
      statusText.textContent = aiActive ? 'A Evelyn pode responder automaticamente. Assuma para iniciar o atendimento humano.' : `A IA está pausada${candidate.ia_pausa_motivo ? `: ${candidate.ia_pausa_motivo}` : '. Assuma para responder pelo painel.'}`;
      assume.textContent = 'Assumir atendimento';
      assume.disabled = false;
      assume.classList.remove('hidden');
      returnButton.classList.add('hidden');
      if(upload) upload.classList.add('hidden');
    }

    textarea.disabled = !owned;
    send.disabled = !owned;
    textarea.placeholder = owned ? 'Digite uma mensagem para o candidato...' : 'Assuma o atendimento para responder...';
    composer.classList.toggle('is-disabled', !owned);
    replies.classList.toggle('hidden', !owned);
  }

  async function pollConversation({ force = false } = {}) {
    if (!local.candidateId || local.polling || (!force && local.activeTab !== 'conversation')) return;
    local.polling = true;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.candidateId}/conversa?after=${local.lastMessageId}`);
      if (data.candidato) {
        local.details.candidato = { ...local.details.candidato, ...data.candidato };
        syncChatControls(data.candidato);
      }
      mergeMessages(data.mensagens || []);
    } catch (error) {
      const help = byId('candidateChatHelp');
      if (help) help.textContent = `Não foi possível atualizar agora: ${error.message}`;
    } finally {
      local.polling = false;
    }
  }

  function stopPolling() {
    if (local.pollingTimer) clearInterval(local.pollingTimer);
    local.pollingTimer = null;
  }

  function startPolling() {
    stopPolling();
    if (!local.candidateId || local.activeTab !== 'conversation') return;
    pollConversation({ force: true });
    local.pollingTimer = setInterval(() => pollConversation(), POLL_INTERVAL_MS);
  }

  async function assumeChat() {
    const button = byId('assumeCandidateChatButton');
    button.disabled = true;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.candidateId}/assumir`, { method: 'POST', body: '{}' });
      toast(data.mensagem || 'Atendimento assumido.');
      await pollConversation({ force: true });
      byId('candidateChatMessage')?.focus();
      panel().reloadCandidates?.(true).catch?.(() => {});
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  function renderHandoffTriage(triage) {
    if(!triage)return '';
    const suggestion=triage.resposta_sugerida&&typeof triage.resposta_sugerida==='object'?triage.resposta_sugerida:null;
    const suggestedValue=String(suggestion?.valor??'').trim();
    const confidence=Number(suggestion?.confianca||0);
    const checked=suggestedValue&&confidence>=0.75?'checked':'';
    const type=String(triage.tipo||'').toUpperCase();
    const options=Array.isArray(triage.opcoes)?triage.opcoes:[];
    let control='';
    if(type==='SIM_NAO'){
      control=`<select id="candidateHandoffTriageAnswerV16"><option value="">Selecione</option><option value="1" ${['1','SIM'].includes(suggestedValue.toUpperCase())?'selected':''}>1 — Sim</option><option value="2" ${['2','NAO','NÃO'].includes(suggestedValue.toUpperCase())?'selected':''}>2 — Não</option></select>`;
    }else if(type==='UNICA_ESCOLHA'){
      const opts=options.map((value,index)=>{const n=String(index+1);const label=typeof value==='string'?value:JSON.stringify(value);return `<option value="${n}" ${suggestedValue===n||suggestedValue.toLowerCase()===String(label).toLowerCase()?'selected':''}>${n} — ${esc(label)}</option>`;}).join('');
      control=`<select id="candidateHandoffTriageAnswerV16"><option value="">Selecione</option>${opts}</select>`;
    }else{
      const hint=type==='MULTIPLA_ESCOLHA'?'Ex.: 1,2':type==='NUMERO'?'Informe somente o número':'Digite a resposta confirmada';
      control=`<input id="candidateHandoffTriageAnswerV16" type="text" maxlength="2000" value="${esc(suggestedValue)}" placeholder="${esc(hint)}">`;
    }
    const optionHint=options.length&&type==='MULTIPLA_ESCOLHA'?`<small>Opções: ${options.map((v,i)=>`${i+1} — ${esc(typeof v==='string'?v:JSON.stringify(v))}`).join(' · ')}</small>`:'';
    const aiHint=suggestedValue&&confidence>=0.75?`<small>Sugestão encontrada na conversa · confiança ${Math.round(confidence*100)}%. Revise antes de confirmar.</small>`:'<small>Preencha somente se esta pergunta foi realmente resolvida durante o atendimento humano.</small>';
    return `<section class="handoff-section handoff-triage"><h3>Pergunta pendente da vaga</h3><p>A resposta só será aplicada se você confirmar. A regra e a pontuação continuam sendo as configuradas na vaga.</p><div class="handoff-triage-question"><strong>${esc(triage.texto||'Pergunta')}</strong><span>${esc(type.replaceAll('_',' '))}</span></div><label class="handoff-triage-confirm"><input id="candidateHandoffApplyTriageV16" type="checkbox" ${checked}><span>Aplicar esta resposta ao finalizar</span></label><label class="field"><span>Resposta confirmada</span>${control}${optionHint}${aiHint}</label><input id="candidateHandoffTriageQuestionIdV16" type="hidden" value="${Number(triage.pergunta_id||0)}"></section>`;
  }

  function ensureHandoffDialog() {
    let dialog=byId('candidateHandoffDialogV16');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');
    dialog.id='candidateHandoffDialogV16';
    dialog.className='modal handoff-dialog';
    dialog.innerHTML=`<form id="candidateHandoffFormV16" method="dialog">
      <header class="modal-header"><div><p class="eyebrow">PASSAGEM DE BASTÃO</p><h2>Finalizar atendimento humano</h2><span>Revise o que a Gênesis identificou antes de devolver a conversa para a Evelyn.</span></div><button type="button" class="icon-button" data-close-handoff>×</button></header>
      <div class="modal-body"><div id="candidateHandoffLoadingV16" class="empty-state compact">Analisando o atendimento...</div><div id="candidateHandoffContentV16" class="hidden"></div><div id="candidateHandoffErrorV16" class="form-error hidden"></div></div>
      <footer class="modal-footer"><button type="button" class="button button-ghost" data-close-handoff>Continuar atendimento</button><button id="confirmCandidateHandoffV16" type="submit" class="button button-primary" disabled>Salvar e devolver para IA</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close-handoff]').forEach((b)=>b.addEventListener('click',()=>dialog.close()));
    dialog.querySelector('form').addEventListener('submit',submitHandoff);
    return dialog;
  }

  function renderHandoffPreview(data) {
    const box=byId('candidateHandoffContentV16');
    const suggestions=data.sugestoes||{};
    const suggestionHtml=Object.entries(suggestions).map(([field,item])=>{
      const value=typeof item==='object'?item.valor:item;
      const confidence=typeof item==='object'&&item.confianca?` · confiança ${Math.round(Number(item.confianca)*100)}%`:'';
      return `<div class="handoff-suggestion"><input id="handoff-${esc(field)}" data-handoff-check="${esc(field)}" type="checkbox" checked><label for="handoff-${esc(field)}"><strong>${esc(handoffFieldLabels[field]||field)}</strong><input data-handoff-value="${esc(field)}" type="text" value="${esc(value)}"><small>Identificado na conversa${esc(confidence)}. Confirme antes de salvar.</small></label></div>`;
    }).join('') || '<p class="helper-text">Nenhum dado cadastral novo foi identificado automaticamente. Você pode finalizar sem alterar o cadastro.</p>';
    const docs=(data.documentos||[]).filter((d)=>d.aplicacao_pendente||d.recebido_durante_atendimento_humano);
    const docsHtml=docs.map((d)=>`<div class="handoff-doc"><div><strong>📄 ${esc(d.nome_arquivo||d.titulo||'Documento')}</strong><span>${esc(d.tipo||'PENDENTE')} · ${esc(d.status_processamento||'ARMAZENADO')}</span></div><span class="badge ${d.aplicacao_pendente?'badge-warning':'badge-approved'}">${d.aplicacao_pendente?'Aplicação pendente':'Preservado'}</span></div>`).join('') || '<p class="helper-text">Nenhum documento novo neste atendimento.</p>';
    const triageHtml=renderHandoffTriage(data.triagem_pendente);
    box.innerHTML=`<section class="handoff-section"><h3>O que foi resolvido?</h3><p>Edite o resumo se necessário. Ele ficará registrado no histórico interno.</p><textarea id="candidateHandoffSummaryV16" class="handoff-summary" maxlength="2000">${esc(data.resumo||'')}</textarea></section>
      <section class="handoff-section"><h3>Dados encontrados</h3><p>A Gênesis sugere; você confirma. Nada é alterado silenciosamente.</p>${suggestionHtml}</section>
      ${triageHtml}
      <section class="handoff-section"><h3>Documentos</h3><div class="handoff-doc-list">${docsHtml}</div></section>
      <section class="handoff-next"><strong>Próximo passo da Evelyn</strong><span>${esc(data.proxima_acao||data.proxima_etapa||'Retomar o fluxo atual')}</span></section>`;
    box.classList.remove('hidden');
    byId('confirmCandidateHandoffV16').disabled=false;
  }

  async function returnToAi() {
    const dialog=ensureHandoffDialog();
    byId('candidateHandoffLoadingV16').classList.remove('hidden');
    byId('candidateHandoffContentV16').classList.add('hidden');
    byId('candidateHandoffErrorV16').classList.add('hidden');
    byId('confirmCandidateHandoffV16').disabled=true;
    dialog.showModal();
    try{
      const data=await api(`/api/atendimento/candidatos/${local.candidateId}/handoff-preview`);
      byId('candidateHandoffLoadingV16').classList.add('hidden');renderHandoffPreview(data);
    }catch(error){byId('candidateHandoffLoadingV16').classList.add('hidden');const e=byId('candidateHandoffErrorV16');e.textContent=error.message;e.classList.remove('hidden');}
  }

  async function submitHandoff(event) {
    event.preventDefault();
    const button=byId('confirmCandidateHandoffV16');const errorBox=byId('candidateHandoffErrorV16');
    const confirmed={};
    document.querySelectorAll('[data-handoff-check]').forEach((check)=>{if(!check.checked)return;const field=check.dataset.handoffCheck;const input=document.querySelector(`[data-handoff-value="${CSS.escape(field)}"]`);if(input)confirmed[field]=input.value.trim();});
    let triagemConfirmada=null;
    if(byId('candidateHandoffApplyTriageV16')?.checked){
      const perguntaId=Number(byId('candidateHandoffTriageQuestionIdV16')?.value||0);const resposta=String(byId('candidateHandoffTriageAnswerV16')?.value||'').trim();
      if(!resposta){errorBox.textContent='Informe a resposta da pergunta da vaga ou desmarque “Aplicar esta resposta”.';errorBox.classList.remove('hidden');return;}
      triagemConfirmada={pergunta_id:perguntaId,resposta};
    }
    button.disabled=true;errorBox.classList.add('hidden');
    try{
      const data=await api(`/api/atendimento/candidatos/${local.candidateId}/finalizar-handoff`,{method:'POST',body:JSON.stringify({dados_confirmados:confirmed,triagem_confirmada:triagemConfirmada,resumo:byId('candidateHandoffSummaryV16')?.value.trim()||''})});
      toast(data.mensagem||'Atendimento finalizado.');byId('candidateHandoffDialogV16').close();
      await pollConversation({force:true});panel().reloadCandidates?.(true).catch?.(()=>{});window.GenesisAtendimentosV16?.load?.(true).catch?.(()=>{});
    }catch(error){errorBox.textContent=error.message;errorBox.classList.remove('hidden');}
    finally{button.disabled=false;}
  }

  function ensureUploadDialog() {
    let dialog=byId('candidateDocumentUploadDialogV16');if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='candidateDocumentUploadDialogV16';dialog.className='modal document-upload-dialog';
    dialog.innerHTML=`<form id="candidateDocumentUploadFormV16" method="dialog"><header class="modal-header"><div><p class="eyebrow">DOCUMENTO DO CANDIDATO</p><h2>Adicionar PDF</h2><span>O arquivo será preservado imediatamente e analisado em segundo plano.</span></div><button type="button" class="icon-button" data-close-upload>×</button></header><div class="modal-body"><label class="field"><span>Tipo esperado</span><select id="candidateUploadTypeV16"><option value="CTPS">CTPS Digital</option><option value="CURRICULO">Currículo</option><option value="PENDENTE">Outro / identificar automaticamente</option></select></label><div class="upload-drop-zone"><input id="candidateUploadFileV16" type="file" accept="application/pdf,.pdf" required><p class="helper-text">PDF de até 8 MB.</p></div><div id="candidateUploadErrorV16" class="form-error hidden"></div></div><footer class="modal-footer"><button type="button" class="button button-ghost" data-close-upload>Cancelar</button><button id="candidateUploadSubmitV16" type="submit" class="button button-primary">Preservar e analisar</button></footer></form>`;
    document.body.appendChild(dialog);dialog.querySelectorAll('[data-close-upload]').forEach((b)=>b.addEventListener('click',()=>dialog.close()));dialog.querySelector('form').addEventListener('submit',submitUpload);return dialog;
  }
  function openUpload(){const d=ensureUploadDialog();d.querySelector('form').reset();byId('candidateUploadErrorV16').classList.add('hidden');d.showModal();}
  function fileBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=()=>reject(new Error('Não foi possível ler o PDF.'));r.readAsDataURL(file);});}
  async function submitUpload(event){event.preventDefault();const file=byId('candidateUploadFileV16')?.files?.[0];const button=byId('candidateUploadSubmitV16');const errorBox=byId('candidateUploadErrorV16');if(!file)return;button.disabled=true;errorBox.classList.add('hidden');try{if(file.size>8*1024*1024)throw new Error('O PDF precisa ter até 8 MB.');const base64=await fileBase64(file);const data=await api(`/api/atendimento/candidatos/${local.candidateId}/documentos`,{method:'POST',body:JSON.stringify({nome_arquivo:file.name,mime_type:file.type||'application/pdf',tipo:byId('candidateUploadTypeV16').value,arquivo_base64:base64})});toast(data.mensagem||'Documento preservado.');byId('candidateDocumentUploadDialogV16').close();await reloadCandidateDrawer();document.querySelector('[data-drawer-tab="conversation"]')?.click();}catch(error){errorBox.textContent=error.message;errorBox.classList.remove('hidden');}finally{button.disabled=false;}}

  async function sendMessage(event) {
    event.preventDefault();
    const textarea = byId('candidateChatMessage');
    const button = byId('sendCandidateChatButton');
    const message = String(textarea.value || '').trim();
    if (!message) return;
    button.disabled = true;
    textarea.disabled = true;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.candidateId}/mensagens`, {
        method: 'POST',
        body: JSON.stringify({ mensagem: message, client_message_id: crypto.randomUUID() }),
      });
      textarea.value = '';
      if (data.registro) mergeMessages([data.registro]);
      toast(data.mensagem || 'Mensagem enviada.');
      await pollConversation({ force: true });
    } catch (error) { toast(error.message, 'error'); }
    finally {
      textarea.disabled = false;
      button.disabled = false;
      textarea.focus();
    }
  }

  function ensureEditDialog() {
    let dialog = byId('candidateEditDialogV15');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'candidateEditDialogV15';
    dialog.className = 'modal candidate-edit-dialog';
    dialog.innerHTML = `<form id="candidateEditFormV15" method="dialog">
      <header class="modal-header"><div><p class="eyebrow">CORREÇÃO CADASTRAL</p><h2>Editar dados do candidato</h2><span>As alterações serão registradas no histórico.</span></div><button class="icon-button" data-close-edit type="button" aria-label="Fechar">×</button></header>
      <div class="modal-body"><div class="form-grid">
        <label class="field span-2"><span>Nome completo</span><input name="nome" maxlength="150"></label>
        <label class="field" data-admin-edit><span>Telefone</span><input name="telefone" inputmode="tel" maxlength="20"></label>
        <label class="field" data-admin-edit><span>CPF</span><input name="cpf" inputmode="numeric" maxlength="20"></label>
        <label class="field" data-admin-edit><span>Data de nascimento</span><input name="data_nascimento" type="date"></label>
        <label class="field" data-admin-edit><span>Nome da mãe</span><input name="nome_mae" maxlength="150"></label>
        <label class="field" data-admin-edit><span>Sexo</span><select name="sexo"><option value="">Não informado</option><option value="MASCULINO">Masculino</option><option value="FEMININO">Feminino</option></select></label>
        <label class="field"><span>CEP</span><input name="cep" inputmode="numeric" maxlength="10"></label>
        <label class="field"><span>Cidade</span><input name="cidade" maxlength="100"></label>
        <label class="field"><span>Estado</span><input name="estado" maxlength="50"></label>
        <label class="field"><span>Cargo informado</span><input name="cargo" maxlength="200"></label>
        <label class="field span-full"><span>Experiência declarada</span><textarea name="tempo_experiencia" rows="2" maxlength="1000"></textarea></label>
        <label class="field span-full"><span>Apresentação profissional</span><textarea name="apresentacao_profissional" rows="3" maxlength="5000"></textarea></label>
        <label class="field span-full"><span>Observação interna</span><textarea name="observacao_triagem" rows="3" maxlength="5000"></textarea></label>
        <label class="field span-full"><span>Motivo da correção *</span><textarea name="motivo" rows="2" maxlength="1000" required placeholder="Ex.: nome coletado incorretamente durante a conversa."></textarea></label>
      </div><div id="candidateEditErrorV15" class="form-error hidden"></div></div>
      <footer class="modal-footer"><button class="button button-ghost" data-close-edit type="button">Cancelar</button><button id="saveCandidateEditV15" class="button button-primary" type="submit">Salvar alterações</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', saveCandidateData);
    return dialog;
  }

  function openEditDialog() {
    const dialog = ensureEditDialog();
    const form = dialog.querySelector('form');
    const candidate = local.details?.candidato || {};
    const fields = ['nome','telefone','cpf','data_nascimento','nome_mae','sexo','cep','cidade','estado','cargo','tempo_experiencia','apresentacao_profissional','observacao_triagem'];
    for (const field of fields) if (form.elements[field]) form.elements[field].value = candidate[field] == null ? '' : String(candidate[field]).slice(0, field === 'data_nascimento' ? 10 : undefined);
    form.elements.motivo.value = '';
    dialog.querySelectorAll('[data-admin-edit]').forEach((item) => item.classList.toggle('hidden', !local.isAdmin));
    byId('candidateEditErrorV15')?.classList.add('hidden');
    dialog.showModal();
  }

  async function saveCandidateData(event) {
    event.preventDefault();
    const dialog = byId('candidateEditDialogV15');
    const form = event.currentTarget;
    const button = byId('saveCandidateEditV15');
    const errorBox = byId('candidateEditErrorV15');
    const candidate = local.details?.candidato || {};
    const allowed = local.isAdmin
      ? ['nome','telefone','cpf','data_nascimento','nome_mae','sexo','cep','cidade','estado','cargo','tempo_experiencia','apresentacao_profissional','observacao_triagem']
      : ['nome','cep','cidade','estado','cargo','tempo_experiencia','apresentacao_profissional','observacao_triagem'];
    const data = {};
    for (const field of allowed) {
      const value = String(form.elements[field]?.value || '').trim();
      const previous = candidate[field] == null ? '' : String(candidate[field]).slice(0, field === 'data_nascimento' ? 10 : undefined);
      if (value !== previous) data[field] = value || null;
    }
    const motivo = String(form.elements.motivo.value || '').trim();
    if (!motivo) { errorBox.textContent = 'Informe o motivo da correção.'; errorBox.classList.remove('hidden'); return; }
    button.disabled = true;
    try {
      const result = await api(`/api/atendimento/candidatos/${local.candidateId}/dados`, { method:'PATCH', body: JSON.stringify({ dados:data, motivo }) });
      toast(result.mensagem || 'Dados atualizados.');
      dialog.close();
      await panel().reloadCandidates?.(true);
      await reloadCandidateDrawer();
    } catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
    finally { button.disabled = false; }
  }

  // Compatibilidade V15: Propor novo horário agora usa apenas horários livres do Calendar.
  function ensureRescheduleDialog() {
    let dialog = byId('candidateRescheduleDialogV15');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'candidateRescheduleDialogV15';
    dialog.className = 'modal candidate-reschedule-dialog';
    dialog.innerHTML = `<form id="candidateRescheduleFormV15" method="dialog">
      <header class="modal-header"><div><p class="eyebrow">REAGENDAMENTO</p><h2>Escolher novo horário</h2><span>Mostramos horários livres do Google Calendar. O horário atual continua reservado até o candidato aceitar.</span></div><button class="icon-button" data-close-reschedule type="button">×</button></header>
      <div class="modal-body"><div class="privacy-note"><strong>Horário atual</strong><span id="candidateCurrentInterviewV15"></span></div><div id="candidateRescheduleSlotsV15" class="reschedule-slots"><div class="empty-state">Consultando agenda...</div></div><label class="field span-full"><span>Motivo</span><textarea name="motivo" rows="3" maxlength="500" placeholder="Ex.: conflito na agenda da recrutadora."></textarea></label><div id="candidateRescheduleErrorV15" class="form-error hidden"></div></div>
      <footer class="modal-footer"><button class="button button-ghost" data-close-reschedule type="button">Cancelar</button><button id="refreshCandidateRescheduleV15" class="button button-ghost" type="button">Atualizar horários</button><button id="saveCandidateRescheduleV15" class="button button-primary" type="submit" disabled>Propor horário</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close-reschedule]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', submitReschedule);
    byId('refreshCandidateRescheduleV15').addEventListener('click', loadRescheduleOptions);
    return dialog;
  }

  async function loadRescheduleOptions() {
    const dialog = ensureRescheduleDialog();
    const box = byId('candidateRescheduleSlotsV15');
    const save = byId('saveCandidateRescheduleV15');
    const errorBox = byId('candidateRescheduleErrorV15');
    const interviewId = Number(local.details?.candidato?.entrevista_id || 0);
    save.disabled = true;
    errorBox.classList.add('hidden');
    box.innerHTML = '<div class="empty-state">Consultando agenda...</div>';
    try {
      const data = await api(`/api/atendimento/entrevistas/${interviewId}/opcoes-reagendamento`);
      const options = Array.isArray(data.opcoes) ? data.opcoes : [];
      if (!options.length) { box.innerHTML = '<div class="empty-state">Nenhum horário livre foi encontrado na janela configurada.</div>'; return; }
      box.innerHTML = options.map((option,index)=>`<label class="reschedule-slot"><input type="radio" name="slotV15" value="${encodeURIComponent(JSON.stringify({inicio:option.inicio,fim:option.fim}))}" ${index===0?'checked':''}><span><strong>${esc(option.texto || formatDate(option.inicio))}</strong><small>Disponível no Google Calendar</small></span></label>`).join('');
      save.disabled = false;
    } catch (error) {
      box.innerHTML = '<div class="empty-state">Não foi possível consultar a agenda.</div>';
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  }

  async function openRescheduleDialog() {
    const dialog = ensureRescheduleDialog();
    const interview = local.details?.candidato || {};
    byId('candidateCurrentInterviewV15').textContent = interview.entrevista_inicio ? formatDate(interview.entrevista_inicio) : 'Não informado';
    dialog.querySelector('form').elements.motivo.value = '';
    byId('candidateRescheduleErrorV15').classList.add('hidden');
    dialog.showModal();
    await loadRescheduleOptions();
  }

  async function submitReschedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = byId('saveCandidateRescheduleV15');
    const errorBox = byId('candidateRescheduleErrorV15');
    const selected = form.querySelector('input[name="slotV15"]:checked');
    if (!selected) { errorBox.textContent='Selecione um horário disponível.';errorBox.classList.remove('hidden');return; }
    button.disabled = true;
    try {
      const slot = JSON.parse(decodeURIComponent(selected.value));
      const data = await api(`/api/atendimento/entrevistas/${local.details.candidato.entrevista_id}/reagendar`, { method:'POST', body:JSON.stringify({ inicio:slot.inicio, fim:slot.fim, motivo:form.elements.motivo.value.trim() }) });
      toast(data.mensagem || 'Proposta enviada ao candidato.');
      byId('candidateRescheduleDialogV15').close();
      await reloadCandidateDrawer();
    } catch (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); }
    finally { button.disabled = false; }
  }

  async function confirmInterview() {
    const id = Number(local.details?.candidato?.entrevista_id || 0);
    if (!id) return toast('Não há entrevista agendada para confirmar.', 'error');
    const button = byId('confirmCandidateInterviewButton');
    button.disabled = true;
    try {
      const data = await api(`/api/atendimento/entrevistas/${id}/confirmar`, { method:'POST', body:'{}' });
      toast(data.mensagem || 'Entrevista confirmada.');
      await reloadCandidateDrawer();
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  function syncInterviewControls(candidate) {
    const section = byId('candidateInterviewManagement');
    if (!section) return;
    const hasInterview = Boolean(candidate?.entrevista_id && candidate?.entrevista_inicio && ['AGENDADA','REAGENDADA'].includes(String(candidate.entrevista_status || '').toUpperCase()));
    section.classList.toggle('hidden', !hasInterview);
    if (!hasInterview) return;
    const status = String(candidate.entrevista_confirmacao_recrutador_status || 'PENDENTE').toUpperCase();
    const badge = byId('candidateInterviewConfirmationBadge');
    badge.textContent = status === 'CONFIRMADA' ? 'Confirmada' : status === 'REAGENDAMENTO_SOLICITADO' ? 'Reagendamento proposto' : 'Aguardando confirmação';
    badge.className = `badge ${status === 'CONFIRMADA' ? 'badge-approved' : 'badge-warning'}`;
    byId('confirmCandidateInterviewButton').disabled = status === 'CONFIRMADA';
  }

  async function refreshCorrectionPreview() {
    if (!local.isAdmin || !local.candidateId) return;
    const status = byId('candidateStatusSelect')?.value;
    const etapa = byId('candidateStageSelect')?.value;
    const box = byId('candidateCorrectionPreview');
    if (!status || !etapa || !box) return;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.candidateId}/correcao/preview?status=${encodeURIComponent(status)}&etapa=${encodeURIComponent(etapa)}`);
      box.innerHTML = `<strong>Próxima ação prevista</strong><p>${esc(data.mensagem_prevista || 'Nenhuma mensagem automática prevista para esta etapa.')}</p><small>O envio só ocorre em “Aplicar e continuar atendimento”.</small>`;
    } catch (error) { box.innerHTML = `<strong>Prévia indisponível</strong><p>${esc(error.message)}</p>`; }
  }

  function scheduleCorrectionPreview() {
    clearTimeout(local.previewTimer);
    local.previewTimer = setTimeout(refreshCorrectionPreview, 250);
  }

  function candidateLoaded(details, context = {}) {
    stopPolling();
    local.details = details;
    local.candidateId = Number(context.candidateId || details?.candidato?.id || 0);
    local.user = context.user || panel().getCurrentUser?.() || null;
    local.isAdmin = Boolean(context.isAdmin);
    local.lastMessageId = 0;
    local.messages.clear();
    mergeMessages(details?.conversa || []);
    syncChatControls(details?.candidato);
    syncInterviewControls(details?.candidato);
    scheduleCorrectionPreview();
    if (local.activeTab === 'conversation') startPolling();
  }

  function tabChanged(name) {
    local.activeTab = name;
    if (name === 'conversation') startPolling();
    else stopPolling();
  }

  function bind() {
    byId('assumeCandidateChatButton')?.addEventListener('click', assumeChat);
    byId('returnCandidateChatButton')?.addEventListener('click', returnToAi);
    byId('uploadCandidateDocumentButton')?.addEventListener('click', openUpload);
    byId('candidateChatComposer')?.addEventListener('submit', sendMessage);
    byId('editCandidateDataButton')?.addEventListener('click', openEditDialog);
    byId('confirmCandidateInterviewButton')?.addEventListener('click', confirmInterview);
    byId('rescheduleCandidateInterviewButton')?.addEventListener('click', openRescheduleDialog);
    byId('candidateStatusSelect')?.addEventListener('change', scheduleCorrectionPreview);
    byId('candidateStageSelect')?.addEventListener('change', scheduleCorrectionPreview);
    byId('candidateDrawer')?.addEventListener('close', () => { stopPolling(); local.candidateId = null; local.messages.clear(); });
    byId('candidateChatMessage')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); byId('candidateChatComposer')?.requestSubmit(); }
    });

    const replies = byId('candidateChatQuickReplies');
    const upload = byId('uploadCandidateDocumentButton');
    if (replies) {
      replies.innerHTML = quickReplies.map((text, index) => `<button type="button" data-quick-reply="${index}">${esc(text)}</button>`).join('');
      replies.addEventListener('click', (event) => {
        const button = event.target.closest('[data-quick-reply]');
        if (!button) return;
        const textarea = byId('candidateChatMessage');
        textarea.value = quickReplies[Number(button.dataset.quickReply)] || '';
        textarea.focus();
      });
    }

    byId('candidatesTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-candidate-row]');
      if (row) panel().openCandidate?.(row.dataset.candidateRow);
    });
    byId('candidatesTableBody')?.addEventListener('keydown', (event) => {
      const row = event.target.closest('[data-candidate-row]');
      if (row && ['Enter',' '].includes(event.key)) { event.preventDefault(); panel().openCandidate?.(row.dataset.candidateRow); }
    });

    const params = new URLSearchParams(location.search);
    const candidateId = Number(params.get('candidato') || 0);
    if (candidateId) {
      window.setTimeout(async () => {
        try {
          document.querySelector('[data-view="candidates"]')?.click();
          await panel().openCandidate?.(candidateId);
          const tab = params.get('aba');
          if (tab) document.querySelector(`[data-drawer-tab="${CSS.escape(tab)}"]`)?.click();
        } catch {}
      }, 900);
    }
  }

  window.GenesisAtendimentoV15 = { candidateLoaded, tabChanged, refresh: () => pollConversation({ force:true }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true }); else bind();
})();
