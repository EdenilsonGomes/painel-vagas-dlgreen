'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

function nextBusinessTime(value = new Date()) {
  const date = new Date(value);
  const local = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = local.getDay(); const minutes = local.getHours() * 60 + local.getMinutes();
  if (day >= 1 && day <= 5 && minutes >= 540 && minutes <= 1050) return date;
  local.setSeconds(0,0);
  if (day === 0) local.setDate(local.getDate()+1); else if (day === 6) local.setDate(local.getDate()+2); else if (minutes > 1050) local.setDate(local.getDate()+(day===5?3:1));
  local.setHours(9,0,0,0);
  const offset = date.getTime() - new Date(date.toLocaleString('en-US',{timeZone:'America/Sao_Paulo'})).getTime();
  return new Date(local.getTime()+offset);
}
function personalizeTemplate(template, lead, userName) {
  const r={empresa:lead.empresa_nome||'sua empresa',cidade:lead.cidade||'sua região',segmento:lead.categoria||'seu segmento',nome_sdr:userName||'equipe comercial'};
  return String(template||'').replace(/\{(empresa|cidade|segmento|nome_sdr)\}/g,(_m,k)=>r[k]).trim();
}
function id(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
function text(value, max = 5000) { const v = String(value ?? '').trim(); return v ? v.slice(0, max) : null; }
function digits(value) { let v = String(value || '').replace(/\D/g, ''); if (v.length === 10 || v.length === 11) v = `55${v}`; return /^55\d{10,11}$/.test(v) ? v : ''; }
function cnpjDigits(value) { const v = String(value || '').replace(/\D/g, ''); return v.length === 14 ? v : null; }
function first(...values) { return values.find((v) => v !== undefined && v !== null && String(v).trim() !== '') ?? null; }
function htmlText(value) { return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function extractLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && out.length < 300) { try { out.push({ url: new URL(m[1], base).toString(), label: htmlText(m[2]).slice(0, 180) }); } catch {} }
  return out;
}
function findCnpj(source) { const m = String(source || '').match(/(?:CNPJ\s*[:\-]?\s*)?(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}[-\s]?\d{2})/i); return m ? cnpjDigits(m[1]) : null; }
function findEmployees(raw) {
  const keys = /^(employeeCount|employees|numberOfEmployees|employeesCount|staffCount|companySize)$/i;
  const queue = [raw]; let depth = 0;
  while (queue.length && depth < 500) { depth += 1; const obj = queue.shift(); if (!obj || typeof obj !== 'object') continue; for (const [k,v] of Object.entries(obj)) { if (keys.test(k)) { const n = Number(String(v).replace(/[^0-9]/g,'')); if (Number.isFinite(n) && n > 0 && n < 10000000) return n; } if (v && typeof v === 'object') queue.push(v); } }
  return null;
}
function normalizeDate(value) {
  const raw = String(value || '').trim(); if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function parseMoney(value) { if (value == null || value === '') return null; const n = Number(String(value).replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? n : null; }
function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  if (net.isIPv4(ip)) { const [a,b] = ip.split('.').map(Number); return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168); }
  return false;
}
async function safeUrl(value) {
  if (!value) return null; let u; try { u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  if (!['http:','https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase(); if (host === 'localhost' || host.endsWith('.local')) return null;
  try { const results = await dns.lookup(host, { all:true }); if (!results.length || results.some((r)=>isPrivateIp(r.address))) return null; } catch { return null; }
  return u;
}
async function fetchPage(url, timeout = 10000) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), timeout);
  try { const response = await fetch(url, { signal:controller.signal, redirect:'follow', headers:{'User-Agent':'GenesisIA-LeadEnrichment/1.0 (+business-contact-discovery)','Accept':'text/html,application/xhtml+xml'} }); if (!response.ok) return null; const ct=String(response.headers.get('content-type')||''); if (!/text\/html|application\/xhtml/i.test(ct)) return null; const body=(await response.text()).slice(0,1_500_000); return { url:response.url, body }; } catch { return null; } finally { clearTimeout(timer); }
}
function detectAts(links) { const all=links.map((l)=>`${l.url} ${l.label}`).join(' ').toLowerCase(); const map=[['Gupy',/gupy\.io|gupy\.com/],['Pandapé',/pandape\./],['Sólides',/solides\./],['Workday',/myworkdayjobs|workday/],['Greenhouse',/greenhouse\.io/],['Lever',/lever\.co/],['Indeed',/indeed\./],['LinkedIn Jobs',/linkedin\.com\/jobs/]]; return map.find(([,r])=>r.test(all))?.[0] || null; }
function offerFor(enriched) {
  if (!enriched.tem_trabalhe_conosco && !enriched.portal_vagas_url && !enriched.ats_detectado) return ['PORTAL_GRATIS','A empresa não possui portal de vagas identificado; o portal gratuito é uma entrada de baixo atrito.'];
  if (enriched.portal_vagas_url || enriched.ats_detectado || Number(enriched.vagas_abertas_estimadas||0) >= 3) return ['DIVULGACAO_CANDIDATOS',`A empresa já recruta digitalmente${enriched.ats_detectado ? ` via ${enriched.ats_detectado}` : ''}; a melhor entrada é ampliar aquisição/divulgação de candidatos.`];
  return ['AUTOMACAO_RECRUTAMENTO','Há sinais de operação estruturada; a abordagem recomendada é redução de trabalho manual com automação de recrutamento.'];
}
function enrichedScore(lead, e) {
  let score = Number(lead.score || 0); if (e.cnpj) score += 5; if (e.tem_trabalhe_conosco) score += 8; if (e.portal_vagas_url || e.ats_detectado) score += 10; if (Number(e.vagas_abertas_estimadas||0)>=3) score += 10; if (Number(e.vagas_abertas_estimadas||0)>=10) score += 5; if (e.linkedin_url) score += 3; if (e.funcionarios_estimados && e.funcionarios_estimados>=50) score += 5; return Math.min(100, score);
}
function estimatedSize(e, lead) { if (e.funcionarios_estimados) return e.funcionarios_estimados>=500?'GRANDE':e.funcionarios_estimados>=100?'MEDIA':e.funcionarios_estimados>=20?'PEQUENA':'MICRO'; const reviews=Number(lead.quantidade_avaliacoes||0); if (reviews>=1000 || Number(e.vagas_abertas_estimadas||0)>=20) return 'GRANDE'; if (reviews>=200 || Number(e.vagas_abertas_estimadas||0)>=5) return 'MEDIA'; if (reviews>0) return 'PEQUENA'; return null; }

async function analyzeLeadSite(lead) {
  const rawDump = JSON.stringify(lead.dados_brutos || {});
  const result = { cnpj:cnpjDigits(lead.cnpj) || findCnpj(rawDump), razao_social:null, porte_cadastral:null, capital_social:null, data_abertura:null, funcionarios_estimados:findEmployees(lead.dados_brutos), linkedin_url:null, instagram_url:null, facebook_url:null, tem_trabalhe_conosco:false, portal_vagas_url:null, ats_detectado:null, vagas_abertas_estimadas:null, cargos_detectados:[] };
  const base = await safeUrl(lead.website); let allText = ''; let allLinks = [];
  if (base) {
    const home = await fetchPage(base.toString());
    if (home) {
      allText += ` ${htmlText(home.body)}`; allLinks.push(...extractLinks(home.body, home.url));
      result.cnpj ||= findCnpj(home.body);
      const relevant = allLinks.filter((l)=>/(trabalhe|carreira|vaga|emprego|jobs?|oportunidade)/i.test(`${l.label} ${l.url}`)).slice(0,3);
      for (const link of relevant) { const u = await safeUrl(link.url); if (!u) continue; const page = await fetchPage(u.toString(), 8000); if (!page) continue; allText += ` ${htmlText(page.body)}`; allLinks.push(...extractLinks(page.body,page.url)); result.cnpj ||= findCnpj(page.body); }
      result.linkedin_url = allLinks.find((l)=>/linkedin\.com\/company/i.test(l.url))?.url || null;
      result.instagram_url = allLinks.find((l)=>/instagram\.com\//i.test(l.url))?.url || null;
      result.facebook_url = allLinks.find((l)=>/facebook\.com\//i.test(l.url))?.url || null;
      const careers = allLinks.filter((l)=>/(trabalhe|carreira|vaga|emprego|jobs?|oportunidade)/i.test(`${l.label} ${l.url}`));
      result.tem_trabalhe_conosco = careers.length > 0 || /(trabalhe conosco|carreiras|vagas abertas)/i.test(allText);
      result.ats_detectado = detectAts(allLinks);
      result.portal_vagas_url = careers.find((l)=>/(gupy|pandape|solides|workday|greenhouse|lever|indeed|linkedin\.com\/jobs)/i.test(l.url))?.url || careers[0]?.url || null;
      const vacancyLabels = careers.map((l)=>l.label).filter((x)=>x && x.length>3 && x.length<120); result.cargos_detectados = [...new Set(vacancyLabels)].slice(0,12);
      const countMatches = allText.match(/(\d{1,3})\s+(?:vagas?|oportunidades?)\s+(?:abertas?|dispon[ií]veis?)/i); result.vagas_abertas_estimadas = countMatches ? Number(countMatches[1]) : (result.cargos_detectados.length || null);
    }
  }
  if (result.cnpj) {
    try { const response = await fetch(`https://minhareceita.org/${result.cnpj}`, { headers:{'User-Agent':'GenesisIA/1.0'} }); if (response.ok) { const mr=await response.json(); result.razao_social=text(first(mr.razao_social,mr.nome),300); result.porte_cadastral=text(first(mr.porte,mr.descricao_porte),80); result.capital_social=parseMoney(mr.capital_social); result.data_abertura=normalizeDate(first(mr.data_inicio_atividade,mr.data_abertura)); } } catch {}
  }
  result.porte_estimado = estimatedSize(result, lead); const [offer, reason] = offerFor(result); result.oferta_sugerida=offer; result.motivo_abordagem=reason; result.score=enrichedScore(lead,result); return result;
}

function registerProspectingV20({ app, pool, requireAdmin, currentUserName, wahaBaseUrl, wahaApiKey }) {
  const session = String(process.env.PROSPECTING_WAHA_SESSION || 'genesis_prospeccao').trim();
  const outreachEnabled = String(process.env.PROSPECTING_OUTREACH_ENABLED || 'false').toLowerCase()==='true';
  const dailyLimit = Math.min(Math.max(Number(process.env.PROSPECTING_DAILY_LIMIT || 20),1),100);
  const followupEnabled = String(process.env.PROSPECTING_FOLLOWUP_ENABLED || 'true').toLowerCase()==='true';
  const followupHours = Math.min(Math.max(Number(process.env.PROSPECTING_FOLLOWUP_HOURS || 48),12),168);
  let enrichmentBusy=false, followupBusy=false; let schemaReadyCache={value:false,checkedAt:0};
  async function schemaReady(){ if(Date.now()-schemaReadyCache.checkedAt<30000)return schemaReadyCache.value; try{const r=await pool.query("SELECT to_regclass('public.prospeccao_conversa_controle') IS NOT NULL AS ok");schemaReadyCache={value:Boolean(r.rows[0]?.ok),checkedAt:Date.now()};return schemaReadyCache.value;}catch{schemaReadyCache={value:false,checkedAt:Date.now()};return false;} }

  async function wahaSend(phone, message) {
    if (!wahaBaseUrl || !wahaApiKey) throw new Error('WAHA não configurado no painel.');
    const response=await fetch(`${String(wahaBaseUrl).replace(/\/$/,'')}/api/sendText`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':wahaApiKey},body:JSON.stringify({session,chatId:`${phone}@c.us`,text:message,linkPreview:false})});
    const raw=await response.text(); let data=null; try{data=raw?JSON.parse(raw):null;}catch{} if(!response.ok) throw new Error(data?.message||data?.error||raw||`WAHA HTTP ${response.status}`); return data||{};
  }

  async function processOneEnrichment() {
    if (enrichmentBusy || !(await schemaReady())) return; enrichmentBusy=true; let job=null;
    try {
      const claimed=await pool.query(`UPDATE prospeccao_enriquecimentos SET status='PROCESSANDO',tentativas=tentativas+1,iniciado_at=NOW(),updated_at=NOW() WHERE id=(SELECT id FROM prospeccao_enriquecimentos WHERE status IN ('PENDENTE','FALHA') AND tentativas<3 ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
      job=claimed.rows[0]; if(!job) return;
      const leadResult=await pool.query('SELECT * FROM prospeccao_leads WHERE id=$1',[job.lead_id]); const lead=leadResult.rows[0]; if(!lead) throw new Error('Lead não encontrado.');
      const e=await analyzeLeadSite(lead);
      await pool.query(`UPDATE prospeccao_leads SET cnpj=COALESCE($2,cnpj),razao_social=COALESCE($3,razao_social),porte_cadastral=COALESCE($4,porte_cadastral),capital_social=COALESCE($5,capital_social),data_abertura=COALESCE($6::DATE,data_abertura),funcionarios_estimados=COALESCE($7,funcionarios_estimados),porte_estimado=COALESCE($8,porte_estimado),linkedin_url=COALESCE($9,linkedin_url),instagram_url=COALESCE($10,instagram_url),facebook_url=COALESCE($11,facebook_url),tem_trabalhe_conosco=$12,portal_vagas_url=COALESCE($13,portal_vagas_url),ats_detectado=COALESCE($14,ats_detectado),vagas_abertas_estimadas=COALESCE($15,vagas_abertas_estimadas),cargos_detectados=$16::JSONB,oferta_sugerida=$17,motivo_abordagem=$18,enriquecimento_status='CONCLUIDO',enriquecido_at=NOW(),site_analisado_at=NOW(),score=$19,updated_at=NOW() WHERE id=$1`,[lead.id,e.cnpj,e.razao_social,e.porte_cadastral,e.capital_social,e.data_abertura,e.funcionarios_estimados,e.porte_estimado,e.linkedin_url,e.instagram_url,e.facebook_url,e.tem_trabalhe_conosco,e.portal_vagas_url,e.ats_detectado,e.vagas_abertas_estimadas,JSON.stringify(e.cargos_detectados),e.oferta_sugerida,e.motivo_abordagem,e.score]);
      await pool.query(`UPDATE prospeccao_enriquecimentos SET status='CONCLUIDO',concluido_at=NOW(),ultimo_erro=NULL,updated_at=NOW() WHERE id=$1`,[job.id]);
    } catch(err) { if(job) { await pool.query(`UPDATE prospeccao_leads SET enriquecimento_status='FALHA',updated_at=NOW() WHERE id=$1`,[job.lead_id]).catch(()=>{}); await pool.query(`UPDATE prospeccao_enriquecimentos SET status='FALHA',ultimo_erro=$2,updated_at=NOW() WHERE id=$1`,[job.id,String(err.message||err).slice(0,1500)]).catch(()=>{}); } console.error('[PROSPECÇÃO V20] enriquecimento:',err.message); }
    finally { enrichmentBusy=false; }
  }

  app.post('/api/admin/prospeccao/enriquecer-lote',requireAdmin,async(req,res,next)=>{try{const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(id).filter(Boolean))].slice(0,50);if(!ids.length)return res.status(400).json({sucesso:false,erro:'Selecione ao menos um lead.'});const result=await pool.query(`INSERT INTO prospeccao_enriquecimentos(lead_id,status,solicitado_por,solicitado_por_nome) SELECT id,'PENDENTE',$2,$3 FROM prospeccao_leads WHERE id=ANY($1::BIGINT[]) ON CONFLICT(��-�G����ƭy�.filter(Boolean))].slice(0,25);
    const modelId=id(req.body?.modelo_id); const useSuggested=req.body?.usar_oferta_sugerida===true; const source=text(req.body?.autorizacao_origem,200);
    if(!ids.length || (!modelId && !useSuggested))return res.status(400).json({sucesso:false,erro:'Selecione leads e um modelo, ou use a oferta sugerida.'});
    if(req.body?.confirmar_autorizacao!==true||!source)return res.status(400).json({sucesso:false,erro:'Confirme a base legítima/origem do contato.'});
    const models=(await pool.query(`SELECT * FROM prospeccao_modelos_mensagem WHERE ativo IS TRUE ORDER BY id`)).rows;
    const fixed=modelId?models.find(m=>Number(m.id)===Number(modelId)):null;if(modelId&&!fixed)return res.status(404).json({sucesso:false,erro:'Modelo não encontrado.'});
    const byOffer={PORTAL_GRATIS:models.find(m=>m.nome==='V20 · Portal grátis'),DIVULGACAO_CANDIDATOS:models.find(m=>m.nome==='V20 · Divulgação de vagas'),AUTOMACAO_RECRUTAMENTO:models.find(m=>m.nome==='V20 · Automação de RH')};
    const leads=(await pool.query(`SELECT * FROM prospeccao_leads WHERE id=ANY($1::BIGINT[]) ORDER BY score DESC,id`,[ids])).rows;const client=await pool.connect();let inserted=0,skipped=0;
    try{await client.query('BEGIN');let cursor=nextBusinessTime(new Date());for(const lead of leads){const phone=digits(lead.telefone_normalizado||lead.telefone);if(!phone||lead.nao_contatar){skipped++;continue;}const model=useSuggested?(byOffer[lead.oferta_sugerida]||byOffer.AUTOMACAO_RECRUTAMENTO||models[0]):fixed;if(!model){skipped++;continue;}const exists=await client.query(`SELECT 1 FROM prospeccao_envios WHERE lead_id=$1 AND status IN ('AGENDADO','PROCESSANDO','ENVIADO') LIMIT 1`,[lead.id]);if(exists.rowCount){skipped++;continue;}cursor=nextBusinessTime(new Date(cursor.getTime()+(120+Math.floor(Math.random()*121))*1000));const msg=personalizeTemplate(model.mensagem,lead,currentUserName(req));await client.query(`UPDATE prospeccao_leads SET contato_autorizado=TRUE,contato_autorizado_origem=$2,contato_autorizado_em=NOW(),status=CASE WHEN status='NOVO' THEN 'APROVADO_CONTATO' ELSE status END,responsavel_id=COALESCE(responsavel_id,$3),updated_at=NOW() WHERE id=$1`,[lead.id,source,req.user?.id||null]);await client.query(`INSERT INTO prospeccao_envios(lead_id,modelo_id,session_name,telefone,mensagem,status,agendado_para,aprovado_por) VALUES($1,$2,$3,$4,$5,'AGENDADO',$6,$7)`,[lead.id,model.id,session,phone,msg,cursor.toISOString(),req.user?.id||null]);inserted++;}await client.query('COMMIT');}catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
    res.status(201).json({sucesso:true,enfileirados:inserted,ignorados:skipped,outreach_habilitado:outreachEnabled,mensagem:outreachEnabled?`${inserted} contato(s) agendado(s) com espaçamento controlado.`:`${inserted} contato(s) preparado(s). PROSPECTING_OUTREACH_ENABLED está desligado.`});
  }catch(e){next(e);}});

  app.get('/api/admin/prospeccao/relatorio-v20',requireAdmin,async(_req,res,next)=>{try{const r=await pool.query(`SELECT (SELECT COUNT(*) FROM prospeccao_envios WHERE status='ENVIADO' AND enviado_em>=DATE_TRUNC('month',NOW()))::INT AS enviados_mes,(SELECT COUNT(*) FROM prospeccao_respostas WHERE classificacao='HUMANA' AND created_at>=DATE_TRUNC('month',NOW()))::INT AS respostas_humanas,(SELECT COUNT(*) FROM prospeccao_leads WHERE status='REUNIAO')::INT AS demos,(SELECT COUNT(*) FROM prospeccao_leads WHERE status='CLIENTE')::INT AS clientes,(SELECT COUNT(*) FROM prospeccao_followups_auto WHERE status='ENVIADO' AND enviado_em>=DATE_TRUNC('month',NOW()))::INT AS followups_mes`);const row=r.rows[0];row.taxa_resposta=Number(row.enviados_mes)?Math.round(Number(row.respostas_humanas)*1000/Number(row.enviados_mes))/10:0;res.json({sucesso:true,...row});}catch(e){next(e);}});

  app.get('/api/admin/prospeccao/conversas',requireAdmin,async(req,res,next)=>{try{const q=text(req.query.q,100);const filter=String(req.query.filtro||'TODOS').toUpperCase();const params=[];let where=`WHERE (l.primeiro_contato_at IS NOT NULL OR EXISTS(SELECT 1 FROM prospeccao_respostas pr0 WHERE pr0.lead_id=l.id) OR EXISTS(SELECT 1 FROM prospeccao_mensagens_manuais pm0 WHERE pm0.lead_id=l.id))`;if(q){params.push(`%${q}%`);where+=` AND (l.empresa_nome ILIKE $${params.length} OR COALESCE(l.telefone,'') ILIKE $${params.length} OR COALESCE(l.website,'') ILIKE $${params.length})`;}const result=await pool.query(`SELECT l.id,l.empresa_nome,l.telefone,l.telefone_normalizado,l.website,l.avaliacao,l.quantidade_avaliacoes,l.score,l.status,l.resposta_tipo,l.oferta_sugerida,l.motivo_abordagem,l.portal_vagas_url,l.ats_detectado,l.vagas_abertas_estimadas,l.porte_estimado,cc.automacao_pausada,cc.assumida_por_nome,cc.lida_em,co.etapa AS crm_etapa,lastmsg.mensagem AS ultima_mensagem,lastmsg.direcao AS ultima_direcao,lastmsg.classificacao AS ultima_classificacao,lastmsg.created_at AS ultima_mensagem_at,CASE WHEN lastmsg.direcao='ENTRADA' AND lastmsg.classificacao='HUMANA' AND (cc.lida_em IS NULL OR lastmsg.created_at>cc.lida_em) THEN TRUE ELSE FALSE END AS nao_lida FROM prospeccao_leads l LEFT JOIN prospeccao_conversa_controle cc ON cc.lead_id=l.id LEFT JOIN crm_oportunidades co ON co.prospeccao_lead_id=l.id LEFT JOIN LATERAL (SELECT * FROM (SELECT mensagem,'ENTRADA'::TEXT AS direcao,classificacao,created_at FROM prospeccao_respostas WHERE lead_id=l.id UNION ALL SELECT mensagem,'SAIDA','AUTOMACAO',COALESCE(enviado_em,created_at) FROM prospeccao_envios WHERE lead_id=l.id AND status='ENVIADO' UNION ALL SELECT mensagem,'SAIDA','FOLLOWUP',COALESCE(enviado_em,created_at) FROM prospeccao_followups_auto WHERE lead_id=l.id AND status='ENVIADO' UNION ALL SELECT mensagem,'SAIDA','SDR',created_at FROM prospeccao_mensagens_manuais WHERE lead_id=l.id AND status='ENVIADO') m ORDER BY created_at DESC LIMIT 1) lastmsg ON TRUE ${where} ORDER BY lastmsg.created_at DESC NULLS LAST,l.updated_at DESC LIMIT 300`,params);let rows=result.rows;if(filter==='NAO_LIDAS')rows=rows.filter(r=>r.nao_lida);if(filter==='RESPONDEU')rows=rows.filter(r=>r.resposta_tipo==='HUMANA');if(filter==='ASSUMIDAS')rows=rows.filter(r=>r.automacao_pausada);res.json({sucesso:true,conversas:rows});}catch(e){next(e);}});

  app.get('/api/admin/prospeccao/conversas/:leadId',requireAdmin,async(req,res,next)=>{try{const leadId=id(req.params.leadId);if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});const lead=(await pool.query(`SELECT l.*,cc.automacao_pausada,cc.assumida_por_nome,co.etapa AS crm_etapa FROM prospeccao_leads l LEFT JOIN prospeccao_conversa_controle cc ON cc.lead_id=l.id LEFT JOIN crm_oportunidades co ON co.prospeccao_lead_id=l.id WHERE l.id=$1`,[leadId])).rows[0];if(!lead)return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});await pool.query(`INSERT INTO prospeccao_conversa_controle(lead_id,lida_em) VALUES($1,NOW()) ON CONFLICT(lead_id) DO UPDATE SET lida_em=NOW(),updated_at=NOW()`,[leadId]);const messages=(await pool.query(`SELECT * FROM (SELECT id,mensagem,'ENTRADA'::TEXT AS direcao,classificacao AS tipo,created_at,NULL::TEXT AS autor FROM prospeccao_respostas WHERE lead_id=$1 UNION ALL SELECT id,mensagem,'SAIDA','AUTOMACAO',COALESCE(enviado_em,created_at),NULL FROM prospeccao_envios WHERE lead_id=$1 AND status='ENVIADO' UNION ALL SELECT id,mensagem,'SAIDA','FOLLOWUP',COALESCE(enviado_em,created_at),NULL FROM prospeccao_followups_auto WHERE lead_id=$1 AND status='ENVIADO' UNION ALL SELECT id,mensagem,'SAIDA','SDR',created_at,enviado_por_nome FROM prospeccao_mensagens_manuais WHERE lead_id=$1 AND status='ENVIADO') m ORDER BY created_at,id`,[leadId])).rows;res.json({sucesso:true,lead,mensagens:messages});}catch(e){next(e);}});

  app.post('/api/admin/prospeccao/conversas/:leadId/assumir',requireAdmin,async(req,res,next)=>{try{const leadId=id(req.params.leadId);if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});await pool.query(`INSERT INTO prospeccao_conversa_controle(lead_id,automacao_pausada,assumida_por,assumida_por_nome,assumida_em,lida_em) VALUES($1,TRUE,$2,$3,NOW(),NOW()) ON CONFLICT(lead_id) DO UPDATE SET automacao_pausada=TRUE,assumida_por=$2,assumida_por_nome=$3,assumida_em=NOW(),lida_em=NOW(),updated_at=NOW()`,[leadId,req.user?.id||null,currentUserName(req)]);await pool.query(`UPDATE prospeccao_followups_auto SET status='CANCELADO',updated_at=NOW() WHERE lead_id=$1 AND status='AGENDADO'`,[leadId]);res.json({sucesso:true,mensagem:'Conversa assumida. Follow-ups automáticos pausados.'});}catch(e){next(e);}});
  app.post('/api/admin/prospeccao/conversas/:leadId/devolver',requireAdmin,async(req,res,next)=>{try{const leadId=id(req.params.leadId);if(!leadId)return res.status(400).json({sucesso:false,erro:'Lead inválido.'});await pool.query(`INSERT INTO prospeccao_conversa_controle(lead_id,automacao_pausada,lida_em) VALUES($1,FALSE,NOW()) ON CONFLICT(lead_id) DO UPDATE SET automacao_pausada=FALSE,assumida_por=NULL,assumida_por_nome=NULL,assumida_em=NULL,lida_em=NOW(),updated_at=NOW()`,[leadId]);res.json({sucesso:true,mensagem:'Automação liberada para este lead.'});}catch(e){next(e);}});
  app.post('/api/admin/prospeccao/conversas/:leadId/mensagens',requireAdmin,async(req,res,next)=>{try{const leadId=id(req.params.leadId);const message=text(req.body?.mensagem,4000);if(!leadId||!message)return res.status(400).json({sucesso:false,erro:'Mensagem inválida.'});const lead=(await pool.query(`SELECT l.*,cc.automacao_pausada FROM prospeccao_leads l LEFT JOIN prospeccao_conversa_controle cc ON cc.lead_id=l.id WHERE l.id=$1`,[leadId])).rows[0];if(!lead)return res.status(404).json({sucesso:false,erro:'Lead não encontrado.'});if(!lead.automacao_pausada)return res.status(409).json({sucesso:false,erro:'Assuma a conversa antes de responder.'});if(lead.nao_contatar)return res.status(409).json({sucesso:false,erro:'Lead marcado como não contatar.'});const phone=digits(lead.telefone_normalizado||lead.telefone);if(!phone)return res.status(409).json({sucesso:false,erro:'WhatsApp do lead inválido.'});try{const sent=await wahaSend(phone,message);const mid=String(sent?.id||sent?.key?.id||sent?.message?.id||'');await pool.query(`INSERT INTO prospeccao_mensagens_manuais(lead_id,session_name,telefone,mensagem,status,waha_message_id,enviado_por,enviado_por_nome) VALUES($1,$2,$3,$4,'ENVIADO',$5,$6,$7)`,[leadId,session,phone,message,mid||null,req.user?.id||null,currentUserName(req)]);await pool.query(`INSERT INTO prospeccao_contatos(lead_id,canal,resultado,mensagem,realizado_por,realizado_por_nome) VALUES($1,'WHATSAPP','SDR',$2,$3,$4)`,[leadId,message,req.user?.id||null,currentUserName(req)]);res.status(201).json({sucesso:true,mensagem:'Mensagem enviada.'});}catch(err){await pool.query(`INSERT INTO prospeccao_mensagens_manuais(lead_id,session_name,telefone,mensagem,status,enviado_por,enviado_por_nome,erro) VALUES($1,$2,$3,$4,'FALHA',$5,$6,$7)`,[leadId,session,phone,message,req.user?.id||null,currentUserName(req),String(err.message||err).slice(0,1200)]).catch(()=>{});throw err;}}catch(e){next(e);}});

  async function maintainFollowups() {
    if (!followupEnabled || !outreachEnabled || followupBusy || !wahaBaseUrl || !wahaApiKey || !(await schemaReady())) return; followupBusy=true;
    try {
      await pool.query(`INSERT INTO prospeccao_followups_auto(lead_id,tipo,session_name,telefone,mensagem,status,agendado_para) SELECT l.id,'FOLLOWUP_1',$1,REGEXP_REPLACE(COALESCE(l.telefone_normalizado,l.telefone,''),'\\D','','g'),CASE l.oferta_sugerida WHEN 'PORTAL_GRATIS' THEN 'Olá! Passando para saber se conseguiu ver minha mensagem. Se fizer sentido, posso te mostrar como deixar um portal de vagas da empresa no ar sem custo para começar.' WHEN 'DIVULGACAO_CANDIDATOS' THEN 'Olá! Passando para saber se conseguiu ver minha mensagem sobre ampliar o alcance das vagas e a entrada de candidatos. Se fizer sentido, te explico rapidamente.' ELSE 'Olá! Passando para saber se conseguiu ver minha mensagem sobre reduzir tarefas manuais no recrutamento. Se fizer sentido, te explico rapidamente.' END,'AGENDADO',NOW() FROM prospeccao_leads l JOIN prospeccao_envios e ON e.lead_id=l.id AND e.status='ENVIADO' LEFT JOIN prospeccao_conversa_controle cc ON cc.lead_id=l.id WHERE l.nao_contatar IS FALSE AND COALESCE(cc.automacao_pausada,FALSE)=FALSE AND e.enviado_em<=NOW()-($2::TEXT||' hours')::INTERVAL AND NOT EXISTS(SELECT 1 FROM prospeccao_respostas r WHERE r.lead_id=l.id AND r.classificacao IN ('HUMANA','DESCADASTRO')) ON CONFLICT(lead_id,tipo) DO NOTHING`,[session,followupHours]);
      const now=new Date();if(nextBusinessTime(now).getTime()>now.getTime()+1000)return;
      const daily=(await pool.query(`SELECT ((SELECT COUNT(*) FROM prospeccao_envios WHERE status='ENVIADO' AND enviado_em>=DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')+(SELECT COUNT(*) FROM prospeccao_followups_auto WHERE status='ENVIADO' AND enviado_em>=DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'))::INT AS total`)).rows[0]?.total||0;if(Number(daily)>=dailyLimit)return;
      const item=(await pool.query(`UPDATE prospeccao_followups_auto SET status='PROCESSANDO',tentativas=tentativas+1,updated_at=NOW() WHERE id=(SELECT f.id FROM prospeccao_followups_auto f JOIN prospeccao_leads l ON l.id=f.lead_id LEFT JOIN prospeccao_conversa_controle cc ON cc.lead_id=l.id WHERE f.status='AGENDADO' AND f.agendado_para<=NOW() AND l.nao_contatar IS FALSE AND COALESCE(cc.automacao_pausada,FALSE)=FALSE AND NOT EXISTS(SELECT 1 FROM prospeccao_respostas r WHERE r.lead_id=l.id AND r.classificacao IN ('HUMANA','DESCADASTRO')) ORDER BY f.agendado_para,f.id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)).rows[0];if(!item)return;
      try{const sent=await wahaSend(item.telefone,item.mensagem);const mid=String(sent?.id||sent?.key?.id||sent?.message?.id||'');await pool.query(`UPDATE prospeccao_followups_auto SET status='ENVIADO',enviado_em=NOW(),waha_message_id=$2,erro=NULL,updated_at=NOW() WHERE id=$1`,[item.id,mid||null]);await pool.query(`INSERT INTO prospeccao_contatos(lead_id,canal,resultado,mensagem,realizado_por_nome) VALUES($1,'WHATSAPP','FOLLOWUP',$2,'Automação comercial V20')`,[item.lead_id,item.mensagem]);}catch(err){await pool.query(`UPDATE prospeccao_followups_auto SET status=CASE WHEN tentativas<3 THEN 'AGENDADO' ELSE 'FALHA' END,agendado_para=NOW()+INTERVAL '30 minutes',erro=$2,updated_at=NOW() WHERE id=$1`,[item.id,String(err.message||err).slice(0,1200)]);}
    } catch(e){console.error('[PROSPECÇÃO V20] follow-up:',e.message);} finally{followupBusy=false;}
  }

  const enrichmentTimer=setInterval(()=>processOneEnrichment().catch(()=>{}),5000); enrichmentTimer.unref?.();
  const followupTimer=setInterval(()=>maintainFollowups().catch(()=>{}),60000); followupTimer.unref?.();
  setTimeout(()=>{processOneEnrichment().catch(()=>{});maintainFollowups().catch(()=>{});},7000).unref?.();
}

module.exports={ registerProspectingV20, analyzeLeadSite, offerFor };
