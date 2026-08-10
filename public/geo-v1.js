'use strict';

(() => {
  const state = {
    distanceByCandidate: new Map(),
    enrichmentStarted: false,
    enrichmentFinished: false,
    loadingDistances: null,
    vacancyLookupTimer: null,
    bound: false,
    vacancyOriginalCep: '',
  };

  const $ = (id) => document.getElementById(id);
  const app = () => window.GenesisApp || {};
  const normalizeCep = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 8 ? digits : '';
  };
  const formatCep = (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
  };
  const formatKm = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(1).replace('.', ',')} km` : '—';
  };

  function proximityMeta(value, status) {
    const hasKm = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const km = hasKm ? Number(value) : null;
    if (!hasKm) {
      if (status === 'PENDENTE') return { label: 'Calculando…', className: 'geo-distance-pending', tone: 'pending' };
      return { label: 'Indisponível', className: 'geo-distance-unavailable', tone: 'unavailable' };
    }
    if (km <= 10) return { label: formatKm(km), className: 'geo-distance-near', tone: 'near', hint: 'Muito próximo' };
    if (km <= 15) return { label: formatKm(km), className: 'geo-distance-near', tone: 'near', hint: 'Próximo' };
    if (km <= 25) return { label: formatKm(km), className: 'geo-distance-moderate', tone: 'moderate', hint: 'Deslocamento moderado' };
    return { label: formatKm(km), className: 'geo-distance-far', tone: 'far', hint: 'Distante' };
  }

  async function loadDistances({ render = true } = {}) {
    if (state.loadingDistances) return state.loadingDistances;
    state.loadingDistances = (async () => {
      const data = await app().api('/api/geo/candidatos/distancias');
      state.distanceByCandidate.clear();
      for (const item of data.distancias || []) {
        state.distanceByCandidate.set(String(item.candidato_id), item);
      }
      const candidates = app().state?.candidates || [];
      for (const candidate of candidates) {
        const geo = state.distanceByCandidate.get(String(candidate.id));
        candidate.distancia_km = geo?.distancia_km ?? null;
        candidate.geo_status = geo?.geo_status || null;
        candidate.geo_candidato_cidade = geo?.candidato_cidade || null;
        candidate.geo_candidato_bairro = geo?.candidato_bairro || null;
        candidate.geo_vaga_cep = geo?.vaga_cep || null;
      }
      if (render && app().state?.activeView === 'candidates') {
        // Re-render only from already loaded state; no API recursion.
        window.dispatchEvent(new CustomEvent('genesis:geo-distances-updated'));
      }
      return data;
    })().finally(() => { state.loadingDistances = null; });
    return state.loadingDistances;
  }

  async function progressiveEnrichment() {
    if (state.enrichmentStarted || state.enrichmentFinished) return;
    state.enrichmentStarted = true;
    try {
      // One small controlled batch per page session. Full historical enrichment is performed by npm run backfill:geo.
      const result = await app().api('/api/geo/enriquecer', { method: 'POST', body: JSON.stringify({ limit: 8 }) });
      const processed = Number(result?.resultado?.processados || 0);
      if (processed === 0) state.enrichmentFinished = true;
      if (processed > 0) await loadDistances({ render: true });
    } catch (error) {
      // Geo is auxiliary. Never interrupt the recruitment operation.
      console.warn('[GEO V1] Enriquecimento progressivo indisponível:', error.message);
    } finally {
      state.enrichmentStarted = false;
    }
  }

  async function afterCandidatesLoaded() {
    try {
      await loadDistances({ render: true });
      progressiveEnrichment();
    } catch (error) {
      console.warn('[GEO V1] Distâncias indisponíveis:', error.message);
    }
  }

  function getCandidateGeo(id) {
    return state.distanceByCandidate.get(String(id)) || null;
  }

  function candidateDistanceHtml(candidate) {
    const geo = getCandidateGeo(candidate?.id) || candidate || {};
    const meta = proximityMeta(geo.distancia_km, geo.geo_status);
    const title = geo.distancia_km !== null && geo.distancia_km !== undefined && geo.distancia_km !== '' && Number.isFinite(Number(geo.distancia_km))
      ? 'Distância aproximada em linha reta entre o CEP do candidato e o CEP da vaga.'
      : geo.geo_status === 'SEM_CEP_VAGA' ? 'Cadastre o CEP da vaga para calcular a distância.'
        : geo.geo_status === 'SEM_CEP_CANDIDATO' ? 'O candidato ainda não possui CEP válido.'
          : geo.geo_status === 'SEM_VAGA' ? 'Candidato sem vaga vinculada.'
            : 'Localização ainda indisponível.';
    return `<span class="geo-distance-badge ${meta.className}" title="${app().escapeHtml?.(title) || title}"><span data-icon="pin"></span>${app().escapeHtml?.(meta.label) || meta.label}</span>`;
  }

  function renderCandidateDistance(candidate) {
    const geo = getCandidateGeo(candidate?.id) || {};
    const meta = proximityMeta(geo.distancia_km, geo.geo_status);
    const hasKm = geo.distancia_km !== null && geo.distancia_km !== undefined && geo.distancia_km !== '' && Number.isFinite(Number(geo.distancia_km));
    return { ...meta, km: hasKm ? Number(geo.distancia_km) : null, geo };
  }

  function setGeoStatus(message, tone = '') {
    const target = $('vacancyGeoStatus');
    if (!target) return;
    target.textContent = message || '';
    target.dataset.tone = tone;
  }

  function applyGeoToVacancyForm(geo) {
    if (!geo) return;
    const form = $('vacancyForm');
    const city = form?.elements?.cidade;
    const stateInput = form?.elements?.estado;
    const neighborhood = form?.elements?.bairro;
    const reference = form?.elements?.endereco_referencia;
    if (city && geo.cidade) city.value = geo.cidade;
    if (stateInput && geo.estado) stateInput.value = geo.estado;
    if (neighborhood && geo.bairro) neighborhood.value = geo.bairro;
    if (reference && geo.logradouro && !reference.value.trim()) reference.value = geo.logradouro;
  }

  async function lookupVacancyCep({ silent = false } = {}) {
    const input = $('vacancyGeoCep');
    if (!input) return null;
    const cep = normalizeCep(input.value);
    if (!cep) {
      if (!silent && input.value.trim()) setGeoStatus('Informe um CEP válido com 8 números.', 'error');
      return null;
    }
    input.value = formatCep(cep);
    setGeoStatus('Consultando localização…', 'loading');
    try {
      const data = await app().api(`/api/geo/cep/${cep}`);
      const geo = data.geo || null;
      if (geo?.status === 'OK') {
        applyGeoToVacancyForm(geo);
        const parts = [geo.logradouro, geo.bairro, geo.cidade, geo.estado].filter(Boolean);
        setGeoStatus(parts.length ? `Localizado: ${parts.join(' · ')}` : 'CEP localizado.', 'success');
      } else {
        setGeoStatus(data.aviso || 'CEP encontrado, mas sem coordenadas.', 'warning');
      }
      return geo;
    } catch (error) {
      setGeoStatus(error.message || 'Não foi possível consultar o CEP agora.', 'error');
      if (!silent) throw error;
      return null;
    }
  }

  async function prepareVacancyDialog(vacancy, duplicate = false) {
    const input = $('vacancyGeoCep');
    if (!input) return;
    input.value = '';
    state.vacancyOriginalCep = '';
    setGeoStatus('O CEP é usado apenas para mostrar a distância aproximada dos candidatos.', '');
    if (!vacancy?.id) return;
    try {
      const data = await app().api(`/api/geo/vagas/${vacancy.id}`);
      if (!data.geo?.cep) return;
      input.value = formatCep(data.geo.cep);
      state.vacancyOriginalCep = normalizeCep(data.geo.cep);
      if (data.geo.status === 'OK') {
        setGeoStatus(`CEP geolocalizado${duplicate ? ' · será copiado para a nova vaga' : ''}.`, 'success');
      } else {
        setGeoStatus('CEP salvo; coordenadas ainda indisponíveis.', 'warning');
      }
    } catch (error) {
      console.warn('[GEO V1] Não foi possível carregar o CEP da vaga:', error.message);
    }
  }

  async function saveVacancyGeo(vagaId) {
    const input = $('vacancyGeoCep');
    if (!input) return { skipped: true };
    const raw = input.value.trim();
    if (!raw) {
      if (state.vacancyOriginalCep) {
        const removed = await app().api(`/api/geo/vagas/${vagaId}`, { method: 'DELETE' });
        state.vacancyOriginalCep = '';
        return removed;
      }
      return { skipped: true };
    }
    const cep = normalizeCep(raw);
    if (!cep) throw new Error('CEP da vaga inválido. Informe 8 números.');
    const result = await app().api(`/api/geo/vagas/${vagaId}`, { method: 'PUT', body: JSON.stringify({ cep }) });
    state.vacancyOriginalCep = cep;
    return result;
  }

  async function status() {
    return app().api('/api/geo/status');
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    $('vacancyGeoCep')?.addEventListener('input', (event) => {
      const input = event.currentTarget;
      input.value = formatCep(input.value);
      clearTimeout(state.vacancyLookupTimer);
      const cep = normalizeCep(input.value);
      if (!cep) {
        setGeoStatus(input.value ? 'Complete os 8 números do CEP.' : 'O CEP é usado apenas para mostrar a distância aproximada dos candidatos.', '');
        return;
      }
      state.vacancyLookupTimer = setTimeout(() => lookupVacancyCep({ silent: true }), 420);
    });
    $('vacancyGeoLookupButton')?.addEventListener('click', () => lookupVacancyCep().catch((error) => app().showToast?.(error.message, 'error')));
  }

  bindOnce();
  window.GenesisGeoV1 = {
    afterCandidatesLoaded,
    getCandidateGeo,
    candidateDistanceHtml,
    renderCandidateDistance,
    prepareVacancyDialog,
    saveVacancyGeo,
    lookupVacancyCep,
    status,
    normalizeCep,
    formatCep,
    formatKm,
  };
})();
