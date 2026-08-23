'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function text(value, max = 5000) { const normalized = String(value ?? '').trim(); return normalized ? normalized.slice(0, max) : null; }
function first(...values) { return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null; }
function cnpjDigits(value) { const normalized = String(value || '').replace(/\D/g, ''); return normalized.length === 14 ? normalized : null; }
function htmlText(value) { return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function extractLinks(html, base) {
  const links = [];
  const expression = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = expression.exec(html)) && links.length < 300) {
    try { links.push({ url: new URL(match[1], base).toString(), label: htmlText(match[2]).slice(0, 180) }); } catch {}
  }
  return links;
}
function findCnpj(source) { const match = String(source || '').match(/(?:CNPJ\s*[:\-]?\s*)?(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/i); return match ? cnpjDigits(match[1]) : null; }
function findEmployees(raw) {
  const keys = /^(employeeCount|employees|numberOfEmployees|employeesCount|staffCount|companySize)$/i;
  const queue = [raw];
  let inspected = 0;
  while (queue.length && inspected < 500) {
    inspected += 1;
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    for (const [key, value] of Object.entries(item)) {
      if (keys.test(key)) {
        const number = Number(String(value).replace(/[^0-9]/g, ''));
        if (Number.isFinite(number) && number > 0 && number < 10000000) return number;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}
function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
function parseMoney(value) { if (value == null || value === '') return null; const number = Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')); return Number.isFinite(number) ? number : null; }
function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
  return false;
}
async function safeUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return null;
  try { const results = await dns.lookup(host, { all: true }); if (!results.length || results.some((item) => isPrivateIp(item.address))) return null; } catch { return null; }
  return parsed;
}
async function fetchPage(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'GenesisIA-LeadEnrichment/2.0 (+manual-sales-workspace)', Accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok || !/text\/html|application\/xhtml/i.test(String(response.headers.get('content-type') || ''))) return null;
    return { url: response.url, body: (await response.text()).slice(0, 1_500_000) };
  } catch { return null; } finally { clearTimeout(timer); }
}
function detectAts(links) {
  const content = links.map((link) => `${link.url} ${link.label}`).join(' ').toLowerCase();
  const providers = [['Gupy', /gupy\.io|gupy\.com/], ['Pandapé', /pandape\./], ['Sólides', /solides\./], ['Workday', /myworkdayjobs|workday/], ['Greenhouse', /greenhouse\.io/], ['Lever', /lever\.co/], ['Indeed', /indeed\./], ['LinkedIn Jobs', /linkedin\.com\/jobs/]];
  return providers.find(([, expression]) => expression.test(content))?.[0] || null;
}
function offerFor(enriched) {
  if (!enriched.tem_trabalhe_conosco && !enriched.portal_vagas_url && !enriched.ats_detectado) return ['PORTAL_GRATIS', 'A empresa não possui portal de vagas identificado; o portal gratuito é uma entrada de baixo atrito.'];
  if (enriched.portal_vagas_url || enriched.ats_detectado || Number(enriched.vagas_abertas_estimadas || 0) >= 3) return ['DIVULGACAO_CANDIDATOS', `A empresa já recruta digitalmente${enriched.ats_detectado ? ` via ${enriched.ats_detectado}` : ''}; a melhor entrada é ampliar aquisição e divulgação de candidatos.`];
  return ['AUTOMACAO_RECRUTAMENTO', 'Há sinais de operação estruturada; a abordagem recomendada é redução de trabalho manual com automação de recrutamento.'];
}
function enrichedScore(lead, enriched) {
  let score = Number(lead.score || 0);
  if (enriched.cnpj) score += 5;
  if (enriched.tem_trabalhe_conosco) score += 8;
  if (enriched.portal_vagas_url || enriched.ats_detectado) score += 10;
  if (Number(enriched.vagas_abertas_estimadas || 0) >= 3) score += 10;
  if (Number(enriched.vagas_abertas_estimadas || 0) >= 10) score += 5;
  if (enriched.linkedin_url) score += 3;
  if (enriched.funcionarios_estimados >= 50) score += 5;
  return Math.min(100, score);
}
function estimatedSize(enriched, lead) {
  if (enriched.funcionarios_estimados) return enriched.funcionarios_estimados >= 500 ? 'GRANDE' : enriched.funcionarios_estimados >= 100 ? 'MEDIA' : enriched.funcionarios_estimados >= 20 ? 'PEQUENA' : 'MICRO';
  const reviews = Number(lead.quantidade_avaliacoes || 0);
  if (reviews >= 1000 || Number(enriched.vagas_abertas_estimadas || 0) >= 20) return 'GRANDE';
  if (reviews >= 200 || Number(enriched.vagas_abertas_estimadas || 0) >= 5) return 'MEDIA';
  return reviews > 0 ? 'PEQUENA' : null;
}

async function analyzeLeadSite(lead) {
  const rawDump = JSON.stringify(lead.dados_brutos || {});
  const result = { cnpj: cnpjDigits(lead.cnpj) || findCnpj(rawDump), razao_social: null, porte_cadastral: null, capital_social: null, data_abertura: null, funcionarios_estimados: findEmployees(lead.dados_brutos), linkedin_url: null, instagram_url: null, facebook_url: null, tem_trabalhe_conosco: false, portal_vagas_url: null, ats_detectado: null, vagas_abertas_estimadas: null, cargos_detectados: [] };
  const base = await safeUrl(lead.website);
  let allText = '';
  let allLinks = [];
  if (base) {
    const home = await fetchPage(base.toString());
    if (home) {
      allText += ` ${htmlText(home.body)}`;
      allLinks.push(...extractLinks(home.body, home.url));
      result.cnpj ||= findCnpj(home.body);
      const relevant = allLinks.filter((link) => /(trabalhe|carreira|vaga|emprego|jobs?|oportunidade)/i.test(`${link.label} ${link.url}`)).slice(0, 3);
      for (const link of relevant) {
        const pageUrl = await safeUrl(link.url);
        if (!pageUrl) continue;
        const page = await fetchPage(pageUrl.toString(), 8000);
        if (!page) continue;
        allText += ` ${htmlText(page.body)}`;
        allLinks.push(...extractLinks(page.body, page.url));
        result.cnpj ||= findCnpj(page.body);
      }
      result.linkedin_url = allLinks.find((link) => /linkedin\.com\/company/i.test(link.url))?.url || null;
      result.instagram_url = allLinks.find((link) => /instagram\.com\//i.test(link.url))?.url || null;
      result.facebook_url = allLinks.find((link) => /facebook\.com\//i.test(link.url))?.url || null;
      const careers = allLinks.filter((link) => /(trabalhe|carreira|vaga|emprego|jobs?|oportunidade)/i.test(`${link.label} ${link.url}`));
      result.tem_trabalhe_conosco = careers.length > 0 || /(trabalhe conosco|carreiras|vagas abertas)/i.test(allText);
      result.ats_detectado = detectAts(allLinks);
      result.portal_vagas_url = careers.find((link) => /(gupy|pandape|solides|workday|greenhouse|lever|indeed|linkedin\.com\/jobs)/i.test(link.url))?.url || careers[0]?.url || null;
      result.cargos_detectados = [...new Set(careers.map((link) => link.label).filter((label) => label && label.length > 3 && label.length < 120))].slice(0, 12);
      const countMatch = allText.match(/(\d{1,3})\s+(?:vagas?|oportunidades?)\s+(?:abertas?|dispon[ií]veis?)/i);
      result.vagas_abertas_estimadas = countMatch ? Number(countMatch[1]) : (result.cargos_detectados.length || null);
    }
  }
  if (result.cnpj) {
    try {
      const response = await fetch(`https://minhareceita.org/${result.cnpj}`, { headers: { 'User-Agent': 'GenesisIA/1.0' } });
      if (response.ok) {
        const company = await response.json();
        result.razao_social = text(first(company.razao_social, company.nome), 300);
        result.porte_cadastral = text(first(company.porte, company.descricao_porte), 80);
        result.capital_social = parseMoney(company.capital_social);
        result.data_abertura = normalizeDate(first(company.data_inicio_atividade, company.data_abertura));
      }
    } catch {}
  }
  result.porte_estimado = estimatedSize(result, lead);
  const [offer, reason] = offerFor(result);
  result.oferta_sugerida = offer;
  result.motivo_abordagem = reason;
  result.score = enrichedScore(lead, result);
  return result;
}

module.exports = { analyzeLeadSite, offerFor };
