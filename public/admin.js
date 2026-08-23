'use strict';

(() => {
  const app = () => window.GenesisApp;
  const $ = (id) => document.getElementById(id);
  const state = { users: [], bound: false };

  function safe(value) { return app().escapeHtml(value ?? ''); }
  function toast(message, type = 'success') { app().showToast(message, type); }
  function fmtDate(value) { return value ? app().formatDate(value) : '—'; }
  function isAdmin() { return String(app().state.currentUser?.perfil || '').toUpperCase() === 'ADMIN'; }

  function renderUsers() {
    const container = $('usersList');
    if (!container) return;
    const companyOptions = (selected) => `<option value="">Todas / não vinculada</option>${(app().state.companies || []).map((company) => `<option value="${company.id}" ${Number(company.id) === Number(selected) ? 'selected' : ''}>${safe(company.nome)}</option>`).join('')}`;
    if ($('newUserCompany')) $('newUserCompany').innerHTML = companyOptions('');
    if (!state.users.length) {
      container.innerHTML = app().emptyState('Nenhum usuário cadastrado', 'Crie o primeiro login administrativo.');
      return;
    }
    container.innerHTML = state.users.map((user) => `<article class="user-card" data-user-card="${user.id}">
      <div class="user-avatar">${safe((user.nome || user.usuario || '?').slice(0, 1).toUpperCase())}</div>
      <div class="user-main"><strong>${safe(user.nome)}</strong><span>@${safe(user.usuario)} · último acesso ${safe(user.ultimo_login_at ? fmtDate(user.ultimo_login_at) : 'ainda não realizado')}</span><small>${safe(user.empresa_nome || 'Sem empresa exclusiva')} · criado em ${safe(fmtDate(user.created_at))}</small></div>
      <div class="user-controls"><select data-user-field="perfil"><option value="RECRUTADOR" ${user.perfil === 'RECRUTADOR' ? 'selected' : ''}>Recrutador</option><option value="ADMIN" ${user.perfil === 'ADMIN' ? 'selected' : ''}>Administrador</option></select><select data-user-field="empresa_id">${companyOptions(user.empresa_id)}</select><input data-user-field="telefone_whatsapp" type="tel" inputmode="tel" value="${safe(user.telefone_whatsapp || '')}" placeholder="WhatsApp para alertas"><label class="mini-check"><input data-user-field="alerta_entrevista" type="checkbox" ${user.alerta_entrevista !== false ? 'checked' : ''}> Entrevistas</label><label class="mini-check"><input data-user-field="alerta_revisao" type="checkbox" ${user.alerta_revisao !== false ? 'checked' : ''}> Revisões</label><label class="mini-check"><input data-user-field="ativo" type="checkbox" ${user.ativo ? 'checked' : ''}> Ativo</label></div>
      <div class="user-actions"><button class="button button-ghost compact" data-admin-action="save-user" data-id="${user.id}" type="button">Salvar</button><button class="button button-ghost compact" data-admin-action="reset-password" data-id="${user.id}" type="button">Nova senha</button></div>
    </article>`).join('');
  }

  async function loadUsers() {
    if (!isAdmin()) return;
    const data = await app().api('/api/admin/usuarios');
    state.users = data.usuarios || [];
    renderUsers();
  }

  async function createUser(event) {
    event.preventDefault();
    const payload = {
      nome: $('newUserName').value.trim(),
      usuario: $('newUsername').value.trim(),
      senha: $('newUserPassword').value,
      perfil: $('newUserRole').value,
      empresa_id: $('newUserCompany').value || null,
      telefone_whatsapp: $('newUserWhatsapp').value.trim(),
      alerta_entrevista: $('newUserInterviewAlerts').checked,
      alerta_revisao: $('newUserReviewAlerts').checked,
      ativo: $('newUserActive').checked,
    };
    try {
      const data = await app().api('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(payload) });
      toast(data.mensagem || 'Usuário criado.');
      $('createUserForm').reset();
      $('newUserInterviewAlerts').checked = true;
      $('newUserReviewAlerts').checked = true;
      $('newUserActive').checked = true;
      await loadUsers();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function saveUser(id) {
    const card = document.querySelector(`[data-user-card="${id}"]`);
    const current = state.users.find((user) => Number(user.id) === Number(id));
    if (!card || !current) return;
    const payload = {
      nome: current.nome,
      perfil: card.querySelector('[data-user-field="perfil"]').value,
      empresa_id: card.querySelector('[data-user-field="empresa_id"]').value || null,
      telefone_whatsapp: card.querySelector('[data-user-field="telefone_whatsapp"]').value.trim(),
      alerta_entrevista: card.querySelector('[data-user-field="alerta_entrevista"]').checked,
      alerta_revisao: card.querySelector('[data-user-field="alerta_revisao"]').checked,
      ativo: card.querySelector('[data-user-field="ativo"]').checked,
    };
    const data = await app().api(`/api/admin/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    toast(data.mensagem || 'Usuário atualizado.');
    await loadUsers();
  }

  async function resetPassword(id) {
    const password = window.prompt('Digite a nova senha (mínimo de 8 caracteres):');
    if (!password) return;
    if (password.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.', 'error');
    const confirmation = window.prompt('Repita a nova senha:');
    if (password !== confirmation) return toast('As senhas não são iguais.', 'error');
    const data = await app().api(`/api/admin/usuarios/${id}/redefinir-senha`, { method: 'POST', body: JSON.stringify({ senha: password }) });
    toast(data.mensagem || 'Senha redefinida.');
  }

  function focusNewUser() {
    $('newUserName')?.focus();
    $('createUserForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function delegatedClick(event) {
    const action = event.target.closest('[data-admin-action]');
    if (!action) return;
    const id = Number(action.dataset.id);
    const promise = action.dataset.adminAction === 'save-user' ? saveUser(id)
      : action.dataset.adminAction === 'reset-password' ? resetPassword(id)
        : null;
    promise?.catch((error) => toast(error.message, 'error'));
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    $('createUserForm')?.addEventListener('submit', createUser);
    $('refreshUsersButton')?.addEventListener('click', () => loadUsers().catch((error) => toast(error.message, 'error')));
    document.addEventListener('click', delegatedClick);
  }

  window.GenesisAdmin = { loadUsers, focusNewUser };
  document.addEventListener('DOMContentLoaded', bind);
})();
