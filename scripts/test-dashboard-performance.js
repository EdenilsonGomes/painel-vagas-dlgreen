'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const functions = source.slice(source.indexOf('async function loadDashboard()'), source.indexOf('function renderDashboardVacancies'));

function context(api = async () => ({})) {
  const attributes = {};
  const ctx = vm.createContext({
    state: { dashboardPeriod: '1D', dashboardRequest: 0, dashboard: null },
    el: { dashboardPerformanceMetrics: { innerHTML: '' } },
    escapeHtml: String,
    api,
    document: { querySelector: () => ({ setAttribute: (key, value) => { attributes[key] = value; } }) },
    renderDashboard: () => { ctx.rendered = ctx.state.dashboard; },
  });
  vm.runInContext(functions, ctx);
  ctx.attributes = attributes;
  return ctx;
}

test('Hoje é padrão e comparação usa o mesmo horário', () => {
  assert.match(source, /dashboardPeriod: '1D'/);
  const ctx = context();
  assert.equal(ctx.dashboardComparison(5, 2).label, '+150% vs. ontem até este horário');
  assert.equal(ctx.dashboardComparison(0, 2).tone, 'negative');
  assert.equal(ctx.dashboardComparison(5, 0).label, 'Sem base anterior');
  ctx.state.dashboardPeriod = '7D';
  assert.equal(ctx.dashboardComparison(5, 2).label, '+150% vs. período anterior');
});

test('Sem resultado não vira presença; zero confirmado continua 0%', () => {
  const ctx = context();
  ctx.renderDashboardPerformance({ comparecimento: null, primeira_analise_minutos: null });
  assert.match(ctx.el.dashboardPerformanceMetrics.innerHTML, /Sem resultados registrados/);
  assert.doesNotMatch(ctx.el.dashboardPerformanceMetrics.innerHTML, /<strong>0%/);
  ctx.renderDashboardPerformance({ comparecimento: 0, entrevistas_com_resultado: 1, primeira_analise_minutos: 0 });
  assert.match(ctx.el.dashboardPerformanceMetrics.innerHTML, /<strong>0%/);
  assert.match(ctx.el.dashboardPerformanceMetrics.innerHTML, /<strong>0 min/);
});

test('Troca rápida de filtro descarta resposta atrasada', async () => {
  const pending = [];
  const ctx = context(url => new Promise(resolve => pending.push({ url, resolve })));
  const first = ctx.loadDashboard();
  ctx.state.dashboardPeriod = '7D';
  const second = ctx.loadDashboard();
  assert.match(pending[0].url, /periodo=1D/);
  assert.match(pending[1].url, /periodo=7D/);
  pending[1].resolve({ desempenho: { periodo: '7D' } });
  await second;
  pending[0].resolve({ desempenho: { periodo: '1D' } });
  await first;
  assert.equal(ctx.state.dashboard.desempenho.periodo, '7D');
  assert.equal(ctx.rendered.desempenho.periodo, '7D');
  assert.equal(ctx.attributes['aria-busy'], 'false');
});

test('Erro restaura o filtro dos dados que continuam na tela', async () => {
  const ctx = context(async () => { throw Error('Falha de rede'); });
  ctx.state.dashboard = { desempenho: { periodo: '30D' } };
  await assert.rejects(ctx.loadDashboard(), /Falha de rede/);
  assert.equal(ctx.state.dashboardPeriod, '30D');
  assert.equal(ctx.attributes['aria-busy'], 'false');
});

test('Controles acessíveis e gráfico horário preservados', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /data-dashboard-period="1D" aria-pressed="true"/);
  assert.match(html, /data-dashboard-period="7D" aria-pressed="false"/);
  assert.match(html, /data-dashboard-period="30D" aria-pressed="false"/);
  assert.match(source, /if \(point.futuro\)/);
  assert.match(source, /points\[index\].rotulo/);
});
