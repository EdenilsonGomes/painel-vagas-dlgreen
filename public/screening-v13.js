'use strict';

(() => {
  const typeLabels = {
    SIM_NAO: 'Sim ou não',
    UNICA_ESCOLHA: 'Escolha única',
    MULTIPLA_ESCOLHA: 'Múltipla escolha',
    NUMERO: 'Número',
    TEXTO_CURTO: 'Resposta curta',
    TEXTO_LONGO: 'Resposta aberta',
  };
  const purposeLabels = {
    ELIMINATORIA: 'Eliminatória objetiva',
    CLASSIFICATORIA: 'Classificatória',
    ABERTA: 'Aberta · resumo para análise',
  };
  const state = { vacancyId: null, questions: [], loaded: false };

  const get = (id) => document.getElementById(id);
  const escapeHtml = (value) => window.GenesisApp?.escapeHtml
    ? window.GenesisApp.escapeHtml(value)
    : String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function makeQuestion(overrides = {}) {
    return {
      texto: '',
      tipo: 'SIM_NAO',
      finalidade: 'CLASSIFICATORIA',
      obrigatoria: true,
      opcoes: ['Sim', 'Não'],
      regra_operador: 'SEMPRE',
      regra_valor: null,
      pontos: 0,
      mensagem_nao_atende: null,
      ...overrides,
    };
  }

  function optionsText(question) {
    return Array.isArray(question.opcoes) ? question.opcoes.join('\n') : '';
  }

  function ruleText(question) {
    if (Array.isArray(question.regra_valor)) return question.regra_valor.join(', ');
    if (question.regra_valor === null || question.regra_valor === undefined) return '';
    return String(question.regra_valor);
  }

  function operatorOptions(type, selected) {
    const values = type === 'NUMERO'
      ? [['MAIOR_IGUAL', 'No mínimo'], ['MENOR_IGUAL', 'No máximo'], ['IGUAL', 'Exatamente'], ['DIFERENTE', 'Diferente de']]
      : type === 'MULTIPLA_ESCOLHA'
        ? [['CONTEM_TODOS', 'Precisa conter todas'], ['CONTEM_QUALQUER', 'Precisa conter uma delas']]
        : [['IGUAL', 'Resposta necessária'], ['DIFERENTE', 'Resposta proibida']];
    return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
  }

  function ruleField(question, index) {
    const textType = ['TEXTO_CURTO', 'TEXTO_LONGO'].includes(question.tipo);
    if (textType || question.finalidade !== 'ELIMINATORIA') return '';
    const value = ruleText(question);
    if (question.tipo === 'SIM_NAO') {
      return `<label class="field"><span>Resposta necessária *</span><select data-question-field="regra_valor" data-index="${index}"><option value="">Selecione</option><option value="SIM" ${value === 'SIM' ? 'selected' : ''}>Sim</option><option value="NAO" ${value === 'NAO' ? 'selected' : ''}>Não</option></select></label>`;
    }
    const help = question.tipo === 'UNICA_ESCOLHA'
      ? 'Informe o número da opção válida.'
      : question.tipo === 'MULTIPLA_ESCOLHA'
        ? 'Informe os números separados por vírgula.'
        : 'Informe o valor numérico da regra.';
    return `<label class="field"><span>Regra objetiva *</span><select data-question-field="regra_operador" data-index="${index}">${operatorOptions(question.tipo, question.regra_operador)}</select></label><label class="field"><span>Valor da regra *</span><input data-question-field="regra_valor" data-index="${index}" type="text" value="${escapeHtml(value)}" placeholder="${question.tipo === 'MULTIPLA_ESCOLHA' ? '1, 3' : '1'}"><small>${escapeHtml(help)}</small></label>`;
  }

  function render() {
    const container = get('screeningQuestionsBuilder');
    if (!container) return;
    const counter = get('screeningQuestionCount');
    if (counter) counter.textContent = state.questions.length
      ? `${state.questions.length} pergunta${state.questions.length === 1 ? '' : 's'}`
      : 'Nenhuma pergunta';
    if (!state.questions.length) {
      container.innerHTML = '<div class="empty-state compact"><strong>Nenhuma pergunta adicional</strong><span>O fluxo atual continuará normalmente.</span></div>';
      return;
    }
    container.innerHTML = state.questions.map((question, index) => {
      const textType = ['TEXTO_CURTO', 'TEXTO_LONGO'].includes(question.tipo);
      const choiceType = ['UNICA_ESCOLHA', 'MULTIPLA_ESCOLHA'].includes(question.tipo);
      const purpose = textType ? 'ABERTA' : question.finalidade;
      const purposeOptions = Object.entries(purposeLabels)
        .filter(([value]) => value !== 'ABERTA' || textType)
        .map(([value, label]) => `<option value="${value}" ${purpose === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
      return `<article class="screening-question-card" data-question-index="${index}">
        <header><span class="screening-question-number">${index + 1}</span><div><strong>${escapeHtml(typeLabels[question.tipo] || question.tipo)}</strong><small>${escapeHtml(purposeLabels[purpose] || purpose)}</small></div><div class="screening-question-actions"><button type="button" data-screening-action="up" data-index="${index}" aria-label="Mover para cima" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-screening-action="down" data-index="${index}" aria-label="Mover para baixo" ${index === state.questions.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-screening-action="remove" data-index="${index}" aria-label="Remover pergunta">×</button></div></header>
        <div class="form-grid screening-question-fields">
          <label class="field span-full"><span>Pergunta *</span><textarea data-question-field="texto" data-index="${index}" rows="2" maxlength="500" placeholder="Escreva exatamente como a Evelyn deve perguntar">${escapeHtml(question.texto)}</textarea></label>
          <label class="field"><span>Tipo de resposta</span><select data-question-field="tipo" data-index="${index}">${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${question.tipo === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
          <label class="field"><span>Uso da resposta</span><select data-question-field="finalidade" data-index="${index}" ${textType ? 'disabled' : ''}>${purposeOptions}</select>${textType ? '<small>Respostas abertas nunca eliminam automaticamente.</small>' : ''}</label>
          ${choiceType ? `<label class="field span-full"><span>Opções, uma por linha *</span><textarea data-question-field="opcoes" data-index="${index}" rows="3" placeholder="Opção 1&#10;Opção 2">${escapeHtml(optionsText(question))}</textarea></label>` : ''}
          ${ruleField({ ...question, finalidade: purpose }, index)}
          ${purpose === 'CLASSIFICATORIA' ? `<label class="field"><span>Pontos quando respondida</span><input data-question-field="pontos" data-index="${index}" type="number" min="0" max="1000" value="${Number(question.pontos || 0)}"></label>` : ''}
          <label class="toggle-field"><input data-question-field="obrigatoria" data-index="${index}" type="checkbox" ${question.obrigatoria !== false ? 'checked' : ''}><span><strong>Resposta obrigatória</strong><small>Se não for compreendida, a Evelyn pergunta novamente.</small></span></label>
          ${purpose === 'ELIMINATORIA' ? `<label class="field span-full"><span>Mensagem se não atender</span><textarea data-question-field="mensagem_nao_atende" data-index="${index}" rows="2" maxlength="600" placeholder="Opcional — mensagem respeitosa e objetiva">${escapeHtml(question.mensagem_nao_atende || '')}</textarea></label>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function updateField(target) {
    const index = Number(target.dataset.index);
    const field = target.dataset.questionField;
    const question = state.questions[index];
    if (!question || !field) return;
    if (field === 'obrigatoria') question[field] = target.checked;
    else if (field === 'pontos') question[field] = Number(target.value || 0);
    else if (field === 'opcoes') question[field] = target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    else question[field] = target.value;

    if (field === 'tipo') {
      if (target.value === 'SIM_NAO') question.opcoes = ['Sim', 'Não'];
      if (['TEXTO_CURTO', 'TEXTO_LONGO'].includes(target.value)) {
        question.finalidade = 'ABERTA';
        question.regra_operador = 'SEMPRE';
        question.regra_valor = null;
        question.pontos = 0;
      } else if (question.finalidade === 'ABERTA') {
        question.finalidade = 'CLASSIFICATORIA';
      }
      render();
    }
    if (field === 'finalidade') {
      if (target.value !== 'CLASSIFICATORIA') question.pontos = 0;
      if (target.value !== 'ELIMINATORIA') {
        question.regra_operador = 'SEMPRE';
        question.regra_valor = null;
      } else {
        question.regra_operador = question.tipo === 'NUMERO' ? 'MAIOR_IGUAL' : question.tipo === 'MULTIPLA_ESCOLHA' ? 'CONTEM_TODOS' : 'IGUAL';
      }
      render();
    }
  }

  function addQuestion(question = makeQuestion()) {
    if (state.questions.length >= 30) return window.GenesisApp?.showToast('Uma vaga pode ter no máximo 30 perguntas.', 'error');
    state.questions.push(makeQuestion(question));
    render();
    requestAnimationFrame(() => get('screeningQuestionsBuilder')?.lastElementChild?.querySelector('textarea')?.focus());
  }

  function addTemplate() {
    const templates = [
      makeQuestion({ texto: 'Você possui disponibilidade para trabalhar no horário e na escala informados?', tipo: 'SIM_NAO', finalidade: 'ELIMINATORIA', regra_operador: 'IGUAL', regra_valor: 'SIM', mensagem_nao_atende: 'A disponibilidade de horário é um requisito desta oportunidade.' }),
      makeQuestion({ texto: 'Quanto tempo de experiência você possui nesta função, em meses?', tipo: 'NUMERO', finalidade: 'CLASSIFICATORIA', regra_operador: 'SEMPRE', pontos: 10 }),
      makeQuestion({ texto: 'Conte brevemente uma experiência que represente bem o seu trabalho.', tipo: 'TEXTO_LONGO', finalidade: 'ABERTA', regra_operador: 'SEMPRE' }),
    ];
    if (state.questions.length + templates.length > 30) return window.GenesisApp?.showToast('Não há espaço para adicionar o modelo completo.', 'error');
    state.questions.push(...templates);
    render();
    window.GenesisApp?.showToast('Modelo com 3 perguntas adicionado para revisão.');
  }

  function normalizedQuestions() {
    return state.questions.map((question) => {
      const textType = ['TEXTO_CURTO', 'TEXTO_LONGO'].includes(question.tipo);
      const choiceType = ['UNICA_ESCOLHA', 'MULTIPLA_ESCOLHA'].includes(question.tipo);
      const purpose = textType ? 'ABERTA' : question.finalidade;
      let ruleValue = question.regra_valor;
      if (purpose === 'ELIMINATORIA') {
        if (question.tipo === 'UNICA_ESCOLHA') ruleValue = Number(ruleValue);
        if (question.tipo === 'MULTIPLA_ESCOLHA') ruleValue = String(ruleValue || '').split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
        if (question.tipo === 'NUMERO') ruleValue = Number(ruleValue);
      } else ruleValue = null;
      return {
        texto: String(question.texto || '').trim(),
        tipo: question.tipo,
        finalidade: purpose,
        obrigatoria: question.obrigatoria !== false,
        opcoes: question.tipo === 'SIM_NAO' ? ['Sim', 'Não'] : choiceType ? (question.opcoes || []).map((item) => String(item).trim()).filter(Boolean) : [],
        regra_operador: purpose === 'ELIMINATORIA' ? question.regra_operador : 'SEMPRE',
        regra_valor: Number.isNaN(ruleValue) ? null : ruleValue,
        pontos: purpose === 'CLASSIFICATORIA' ? Number(question.pontos || 0) : 0,
        mensagem_nao_atende: purpose === 'ELIMINATORIA' ? String(question.mensagem_nao_atende || '').trim() || null : null,
      };
    });
  }

  function validate(questions) {
    questions.forEach((question, index) => {
      const label = `Pergunta ${index + 1}`;
      if (question.texto.length < 5) throw new Error(`${label}: escreva uma pergunta com pelo menos 5 caracteres.`);
      if (['UNICA_ESCOLHA', 'MULTIPLA_ESCOLHA'].includes(question.tipo) && question.opcoes.length < 2) throw new Error(`${label}: adicione pelo menos duas opções.`);
      if (question.finalidade === 'ELIMINATORIA') {
        const emptyArray = Array.isArray(question.regra_valor) && !question.regra_valor.length;
        if (question.regra_valor === null || question.regra_valor === '' || emptyArray) throw new Error(`${label}: defina a resposta necessária para a regra eliminatória.`);
      }
    });
    return questions;
  }

  async function load(vacancyId, { duplicate = false } = {}) {
    state.vacancyId = vacancyId ? Number(vacancyId) : null;
    state.questions = [];
    state.loaded = true;
    if (vacancyId) {
      const data = await window.GenesisApp.api(`/api/vagas/${vacancyId}/perguntas`);
      state.questions = (data.perguntas || []).map((question) => makeQuestion(question));
      if (!duplicate) state.vacancyId = Number(vacancyId);
    }
    render();
  }

  async function save(vacancyId) {
    if (!state.loaded) return null;
    const questions = validate(normalizedQuestions());
    return window.GenesisApp.api(`/api/vagas/${vacancyId}/perguntas`, {
      method: 'PUT',
      body: JSON.stringify({ perguntas: questions }),
    });
  }

  function statusMeta(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'CONCLUIDA') return ['Concluída', 'badge-active'];
    if (value === 'ELIMINADO') return ['Não atendeu', 'badge-rejected'];
    if (value === 'REVISAO') return ['Revisão', 'badge-warning'];
    return ['Em andamento', 'badge-process'];
  }

  async function loadCandidate(candidateId) {
    const section = get('candidateScreeningSection');
    if (!section) return;
    try {
      const data = await window.GenesisApp.api(`/api/candidatos/${candidateId}/triagem`);
      if (!data.triagem) {
        section.classList.add('hidden');
        return;
      }
      section.classList.remove('hidden');
      const [label, css] = statusMeta(data.triagem.status);
      const status = get('candidateScreeningStatus');
      status.textContent = label;
      status.className = `badge ${css}`;
      const answered = (data.respostas || []).filter((item) => item.respondida).length;
      get('candidateScreeningSummary').innerHTML = `<article><span>Progresso</span><strong>${answered}/${data.respostas.length}</strong></article><article><span>Pontuação</span><strong>${Number(data.triagem.score || 0)}</strong></article><article><span>Versão da triagem</span><strong>${Number(data.triagem.versao || 1)}</strong></article>`;
      get('candidateScreeningAnswers').innerHTML = (data.respostas || []).map((answer) => {
        const confidence = answer.confianca === null || answer.confianca === undefined ? '' : `${Math.round(Number(answer.confianca) * 100)}% confiança`;
        const origin = answer.origem === 'AUDIO' ? 'Áudio transcrito' : answer.origem === 'PAINEL' ? 'Painel' : 'Texto';
        const response = answer.respondida ? (answer.resumo_ia || answer.resposta_bruta || 'Resposta registrada') : 'Ainda não respondida';
        const decision = answer.atendida === false ? '<span class="screening-answer-result rejected">Não atendeu</span>' : answer.atendida === true ? '<span class="screening-answer-result approved">Atendeu</span>' : '<span class="screening-answer-result neutral">Informativa</span>';
        return `<article class="screening-answer ${answer.respondida ? '' : 'pending'}"><header><span>${answer.ordem}</span><div><strong>${escapeHtml(answer.pergunta)}</strong><small>${escapeHtml(purposeLabels[answer.finalidade] || answer.finalidade)}</small></div>${answer.respondida ? decision : ''}</header><p>${escapeHtml(response)}</p>${answer.respondida ? `<footer><span>${escapeHtml(origin)}</span>${confidence ? `<span>${escapeHtml(confidence)}</span>` : ''}${answer.precisa_revisao ? '<span class="warning">Revisar interpretação</span>' : ''}</footer>` : ''}</article>`;
      }).join('');
    } catch (error) {
      section.classList.remove('hidden');
      get('candidateScreeningAnswers').innerHTML = `<div class="empty-state compact"><strong>Triagem indisponível</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  get('addScreeningQuestionButton')?.addEventListener('click', () => addQuestion());
  get('addScreeningTemplateButton')?.addEventListener('click', addTemplate);
  get('screeningQuestionsBuilder')?.addEventListener('input', (event) => {
    if (event.target.dataset.questionField) updateField(event.target);
  });
  get('screeningQuestionsBuilder')?.addEventListener('change', (event) => {
    if (event.target.dataset.questionField) updateField(event.target);
  });
  get('screeningQuestionsBuilder')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-screening-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.screeningAction === 'remove') state.questions.splice(index, 1);
    if (button.dataset.screeningAction === 'up' && index > 0) [state.questions[index - 1], state.questions[index]] = [state.questions[index], state.questions[index - 1]];
    if (button.dataset.screeningAction === 'down' && index < state.questions.length - 1) [state.questions[index + 1], state.questions[index]] = [state.questions[index], state.questions[index + 1]];
    render();
  });

  window.GenesisScreening = {
    load,
    save,
    loadCandidate,
    getQuestions: normalizedQuestions,
    validate: () => validate(normalizedQuestions()),
  };
})();
