'use strict';

(() => {
  const POLL_INTERVAL_MS = 5000;
  const quickReplies = [
    'Olá! Sou a recrutadora responsável pelo seu processo.',
    'Recebi sua mensagem e estou verificando as informações.',
    'Sua entrevista permanece confirmada no horário agendado.',
    'Preciso que envie novamente o documento com melhor qualidade.',
  ];

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

    if (active) {
      ownerBadge.textContent = owned ? 'Você está atendendo' : `Atendimento: ${owner}`;
      ownerBadge.className = `badge ${owned ? 'badge-approved' : 'badge-warning'}`;
      statusText.textContent = owned ? 'A IA está pausada. As novas mensagens chegarão aqui.' : `A IA está pausada e ${owner} é o responsável atual.`;
      assume.textContent = owned ? 'Atendimento assumido' : (local.isAdmin ? 'Assumir de administrador' : 'Atendimento ocupado');
      assume.disabled = owned || (!local.isAdmin && active);
      assume.classList.toggle('hidden', owned);
      returnButton.classList.toggle('hidden', !owned && !local.isAdmin);
    } else {
      const aiActive = candidate.ia_atendimento_ativo !== false;
      ownerBadge.textContent = aiActive ? 'IA ativa' : 'IA pausada';
      ownerBadge.className = `badge ${aiActive ? 'badge-approved' : 'badge-warning'}`;
      statusText.textContent = aiActive ? 'A Evelyn pode responder automaticamente. Assuma para iniciar o atendimento humano.' : 'A IA está pausada administrativamente. Assuma para responder pelo painel.';
      assume.textContent = 'Assumir atendimento';
      assume.disabled = false;
      assume.classList.remove('hidden');
      returnButton.classList.add('hidden');
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

  async function returnToAi() {
    const stage = local.details?.candidato?.etapa || 'etapa atual';
    const nextAction = String(local.details?.candidato?.proxima_acao || 'A próxima ação será definida pela etapa atual.').slice(0, 700);
    if (!window.confirm(`Devolver esta conversa para a IA?\n\nEtapa atual: ${stage}\n\nPróxima ação prevista:\n${nextAction}`)) return;
    const button = byId('returnCandidateChatButton');
    button.disabled = true;
    try {
      const data = await api(`/api/atendimento/candidatos/${local.candidateId}/devolver`, { method: 'POST', body: '{}' });
      toast(data.mensagem || 'Atendimento devolvido para a IA.');
      await pollConversation({ force: true });
      panel().reloadCandidates?.(true).catch?.(() => {});
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  }

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

  function ensureRescheduleDialog() {
    let dialog = byId('candidateRescheduleDialogV15');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'candidateRescheduleDialogV15';
    dialog.className = 'modal candidate-reschedule-dialog';
    dialog.innerHTML = `<form id="candidateRescheduleFormV15" method="dialog">
      <header class="modal-header"><div><p class="eyebrow">REAGENDAMENTO</p><h2>Propor novo horário</h2><span>O horário atual continuará reservado até o candidato aceitar.</span></div><button class="icon-button" data-close-reschedule type="button">×</button></header>
      <div class="modal-body"><div class="privacy-note"><strong>Horário atual</strong><span id="candidateCurrentInterviewV15"></span></div><div class="form-grid"><label class="field span-full"><span>Novo início *</span><input name="inicio" type="datetime-local" required></label><label class="field"><span>Duração</span><select name="duracao"><option value="20">20 minutos</option><option value="30" selected>30 minutos</option><option value="40">40 minutos</option><option value="60">60 minutos</option></select></label><label class="field span-full"><span>Motivo</span><textarea name="motivo" rows="3" maxlength="500" placeholder="Ex.: conflito na agenda da recrutadora."></textarea></label></div><div id="candidateRescheduleErrorV15" class="form-error hidden"></div></div>
      <footer class="modal-footer"><button class="button button-ghost" data-close-reschedule type="button">Cancelar</button><button id="saveCandidateRescheduleV15" class="button button-primary" type="submit">Enviar proposta</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-close-reschedule]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.querySelector('form').addEventListener('submit', submitReschedule);
    return dialog;
  }

  function openRescheduleDialog() {
    const dialog = ensureRescheduleDialog();
    const interview = local.details?.candidato || {};
    byId('candidateCurrentInterviewV15').textContent = interview.entrevista_inicio ? formatDate(interview.entrevista_inicio) : 'Não informado';
    const form = dialog.querySelector('form');
    const base = new Date(interview.entrevista_inicio || Date.now() + 86400000);
    base.setHours(base.getHours() + 1);
    form.elements.inicio.value = new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    form.elements.motivo.value = '';
    byId('candidateRescheduleErrorV15').classList.add('hidden');
    dialog.showModal();
  }

  async function submitReschedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = byId('saveCandidateRescheduleV15');
    const errorBox = byId('candidateRescheduleErrorV15');
    button.disabled = true;
    try {
      const data = await api(`/api/atendimento/entrevistas/${local.details.candidato.entrevista_id}/reagendar`, { method:'POST', body:JSON.stringify({ inicio:form.elements.inicio.value, duracao:Number(form.elements.duracao.value), motivo:form.elements.motivo.value.trim() }) });
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
