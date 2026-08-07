'use strict';

(() => {
  const token = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) || '');
  const get = (id) => document.getElementById(id);
  let demo = null;
  let pollTimer = null;
  let qrTimer = null;

  async function api(endpoint, options = {}) {
    const response = await fetch(`/api/demo/${encodeURIComponent(token)}${endpoint}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      cache: 'no-store',
      ...options,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.erro || `Não foi possível concluir a operação (${response.status}).`);
    return body;
  }

  function showError(message) {
    get('demoLoading').classList.add('hidden');
    get('demoContent').classList.add('hidden');
    get('demoError').classList.remove('hidden');
    get('demoErrorMessage').textContent = message;
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
  }

  function setState(name) {
    get('demoReadyState').classList.toggle('hidden', name !== 'ready');
    get('demoQrState').classList.toggle('hidden', name !== 'qr');
    get('demoConnectedState').classList.toggle('hidden', name !== 'connected');
    get('demoConnectionDot').className = `demo-status-dot ${name}`;
  }

  function renderStatus(value) {
    demo = value;
    get('demoCompanyName').textContent = value.empresa_nome;
    get('demoVacancyName').textContent = value.vaga_titulo;
    get('demoDaysRemaining').textContent = `${Number(value.dias_restantes || 0)} dia${Number(value.dias_restantes || 0) === 1 ? '' : 's'}`;
    get('demoExpiresAt').textContent = `até ${formatDate(value.expira_em)}`;
    const status = String(value.status || '').toUpperCase();
    const connectButton = get('demoConnectButton');
    if (['EXPIRADA', 'ENCERRADA'].includes(status)) {
      clearTimers();
      setState('ready');
      connectButton.disabled = true;
      connectButton.textContent = 'Período encerrado';
      get('demoConnectionStatus').textContent = 'Demonstração encerrada';
      return;
    }
    if (status === 'CONECTADA') {
      setState('connected');
      get('demoConnectionStatus').textContent = 'WhatsApp conectado e pronto para testar';
      return;
    }
    if (status === 'AGUARDANDO_QR') {
      setState('qr');
      get('demoConnectionStatus').textContent = 'Aguardando leitura do QR Code';
      return;
    }
    setState('ready');
    connectButton.disabled = !value.configuracao_pronta;
    connectButton.textContent = status === 'ERRO' ? 'Tentar conectar novamente' : 'Gerar QR Code seguro';
    get('demoConnectionStatus').textContent = status === 'ERRO' ? 'A conexão precisa ser tentada novamente' : 'Aguardando ativação';
  }

  function refreshQr() {
    if (!demo || ['EXPIRADA', 'ENCERRADA', 'CONECTADA'].includes(String(demo.status).toUpperCase())) return;
    const image = get('demoQrImage');
    get('demoQrLoading').classList.remove('hidden');
    image.classList.add('hidden');
    image.onload = () => { image.classList.remove('hidden'); get('demoQrLoading').classList.add('hidden'); };
    image.onerror = () => { image.classList.add('hidden'); get('demoQrLoading').classList.remove('hidden'); get('demoQrLoading').textContent = 'QR Code ainda não disponível. Aguarde…'; };
    image.src = `/api/demo/${encodeURIComponent(token)}/qr?t=${Date.now()}`;
  }

  function startTimers() {
    clearTimers();
    pollTimer = setInterval(checkStatus, 5_000);
    qrTimer = setInterval(refreshQr, 18_000);
    if (demo && String(demo.status).toUpperCase() === 'AGUARDANDO_QR') setTimeout(refreshQr, 300);
  }

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (qrTimer) clearInterval(qrTimer);
    pollTimer = null;
    qrTimer = null;
  }

  async function checkStatus() {
    try {
      const result = await api('/status');
      renderStatus(result.demo);
      if (result.demo.status === 'CONECTADA') {
        if (qrTimer) clearInterval(qrTimer);
        qrTimer = null;
      }
    } catch (error) {
      get('demoConnectionStatus').textContent = error.message;
    }
  }

  async function connect() {
    const button = get('demoConnectButton');
    button.disabled = true;
    button.textContent = 'Preparando sessão…';
    try {
      await api('/conectar', { method: 'POST', body: '{}' });
      demo.status = 'AGUARDANDO_QR';
      renderStatus(demo);
      startTimers();
    } catch (error) {
      get('demoConnectionStatus').textContent = error.message;
      button.disabled = false;
      button.textContent = 'Tentar gerar novamente';
    }
  }

  async function disconnect() {
    const button = get('demoDisconnectButton');
    button.disabled = true;
    try {
      await api('/desconectar', { method: 'POST', body: '{}' });
      demo.status = 'CRIADA';
      renderStatus(demo);
      clearTimers();
    } catch (error) {
      get('demoConnectionStatus').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function load() {
    if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return showError('O link informado é inválido. Solicite um novo link à equipe Genesis.');
    get('demoError').classList.add('hidden');
    get('demoLoading').classList.remove('hidden');
    try {
      const result = await api('');
      demo = result.demo;
      get('demoLoading').classList.add('hidden');
      get('demoContent').classList.remove('hidden');
      renderStatus(demo);
      if (!demo.configuracao_pronta) {
        get('demoConnectButton').disabled = true;
        get('demoConnectButton').textContent = 'Configuração em andamento';
        get('demoConnectionStatus').textContent = 'A equipe Genesis está concluindo a preparação deste acesso';
      } else if (['AGUARDANDO_QR', 'CONECTADA'].includes(String(demo.status).toUpperCase())) {
        startTimers();
      }
    } catch (error) { showError(error.message); }
  }

  get('demoConnectButton').addEventListener('click', connect);
  get('demoRefreshQrButton').addEventListener('click', refreshQr);
  get('demoDisconnectButton').addEventListener('click', disconnect);
  get('demoRetryButton').addEventListener('click', load);
  window.addEventListener('beforeunload', clearTimers);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimers();
    else if (demo && ['AGUARDANDO_QR', 'CONECTADA'].includes(String(demo.status).toUpperCase())) startTimers();
  });
  load();
})();
