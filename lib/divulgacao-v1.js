'use strict';

const crypto = require('node:crypto');
const { z } = require('zod');
const sharp = require('sharp');

class DivulgacaoError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = 'DivulgacaoError'; this.statusCode = statusCode; }
}

function clean(value, max = 5000) { return String(value ?? '').trim().slice(0, max); }
function parseId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function normalizeFacebookUrl(value) {
  try {
    const url = new URL(clean(value, 2000));
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/(^|\.)fb\.com$/i.test(url.hostname)) return '';
    url.hash = ''; url.search = '';
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}
function canonicalFacebookGroupUrl(value) {
  const normalized = normalizeFacebookUrl(value);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    const parts = url.pathname.split('/').filter(Boolean);
    if (String(parts[0] || '').toLowerCase() !== 'groups' || !parts[1]) return '';
    const groupRef = parts[1];
    if (['feed','discover','joins','create'].includes(groupRef.toLowerCase())) return '';
    return `https://www.facebook.com/groups/${groupRef}`;
  } catch { return ''; }
}
function facebookGroupKey(value) {
  const canonical = canonicalFacebookGroupUrl(value);
  if (!canonical) return '';
  try {
    const url = new URL(canonical);
    return decodeURIComponent(url.pathname.replace(/^\/groups\//i, '').replace(/\/+$/, '')).toLowerCase();
  } catch { return ''; }
}
function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item, 120)).filter(Boolean).slice(0, 30);
  return clean(value, 2000).split(/[,;\n|]+/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
}
function isAdmin(req) { return String(req.user?.perfil || '').toUpperCase() === 'ADMIN'; }
function scope(req, alias, ownerField = 'owner_user_id') {
  if (isAdmin(req)) return { sql: 'TRUE', values: [] };
  if (req.user?.empresa_id) return { sql: `${alias}.empresa_id=$1`, values: [Number(req.user.empresa_id)] };
  return { sql: `${alias}.${ownerField}=$1`, values: [Number(req.user?.id || 0)] };
}
function randomToken() { return crypto.randomBytes(24).toString('base64url'); }
function randomBetween(min, max) { return Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max); }
function messageId(body) { return clean(body?.id || body?.key?.id || body?._data?.id?._serialized || body?.messageId || '', 500); }
function jobLocation(vaga) { return [vaga.bairro, vaga.cidade, vaga.estado].filter(Boolean).join(' · '); }
function money(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''; }
function defaultText(vaga, model = 'COMPLETO') {
  const lines = [`📢 *${clean(vaga.titulo || vaga.cargo, 150)}*`, `📍 ${jobLocation(vaga) || 'Consulte a localização'}`];
  if (model !== 'CURTO') {
    if (vaga.salario) lines.push(`💰 Salário: ${money(vaga.salario)}`);
    if (vaga.escala || vaga.horario) lines.push(`🕐 ${[vaga.escala, vaga.horario].filter(Boolean).join(' · ')}`);
    if (vaga.beneficios) lines.push(`🎁 ${clean(vaga.beneficios, 500)}`);
  }
  lines.push('', 'Confira os detalhes e candidate-se:', '{{link}}');
  return lines.join('\n');
}
function normalizeWahaGroups(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.groups) ? body.groups : [];
  return list.map((item) => {
    const rawId = item?.id?._serialized || item?.id || item?.groupId || item?.jid || item?.chatId || '';
    const id = clean(rawId, 180).replace('@s.whatsapp.net', '@g.us');
    if (!id.endsWith('@g.us')) return null;
    const participants = Array.isArray(item?.participants) ? item.participants.length : Number(item?.participantsCount || item?.size || item?.participantCount || 0) || null;
    return {
      external_id: id,
      nome: clean(item?.name || item?.subject || item?.title || item?.groupName || id, 220),
      participantes: participants,
      papel_usuario: clean(item?.role || item?.myRole || item?.participantRole || '', 30) || null,
      metadata: item,
    };
  }).filter(Boolean);
}

function registerDivulgacaoV1({
  app, pool, currentUserName, wahaBaseUrl, wahaApiKey, divulgacaoSession,
  portalBaseUrl, automaticEnabled = false, loadVacancyForPromotion, promotionPng,
}) {
  let queueBusy = false;
  const sessionName = clean(divulgacaoSession, 120);
  const normalizedPortalBase = clean(portalBaseUrl, 2000).replace(/\/+$/, '');
  const imageDailyLimit = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_DAILY_LIMIT || 3), 1), 20);

  async function wahaRequest(endpoint, { method = 'GET', body, timeoutMs = 30000 } = {}) {
    if (!wahaBaseUrl || !wahaApiKey || !sessionName) throw new DivulgacaoError('Configure WAHA_BASE_URL, WAHA_API_KEY e DIVULGACAO_WAHA_SESSION no EasyPanel.', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${String(wahaBaseUrl).replace(/\/$/, '')}${endpoint}`, {
        method,
        headers: { 'X-Api-Key': wahaApiKey, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      const text = await response.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!response.ok) throw new DivulgacaoError(json?.message || json?.error || text.slice(0, 500) || `WAHA HTTP ${response.status}`, response.status >= 500 ? 502 : 409);
      return json;
    } catch (error) {
      if (error instanceof DivulgacaoError) throw error;
      if (error?.name === 'AbortError') throw new DivulgacaoError('O WAHA demorou para responder.', 504);
      throw new DivulgacaoError(`Não foi possível acessar o WAHA: ${error.message}`, 502);
    } finally { clearTimeout(timer); }
  }

  async function ensureConfig(req) {
    if (!req.user?.id) throw new DivulgacaoError('Entre novamente para configurar a Central de Divulgação.', 401);
    const result = await pool.query(`
      INSERT INTO divulgacao_configuracoes(usuario_id,empresa_id)
      VALUES($1,$2)
      ON CONFLICT(usuario_id) DO UPDATE SET empresa_id=COALESCE(EXCLUDED.empresa_id,divulgacao_configuracoes.empresa_id),updated_at=NOW()
      RETURNING *
    `, [req.user.id, req.user.empresa_id || null]);
    return result.rows[0];
  }

  function campaignScope(req, alias = 'c') { return scope(req, alias, 'created_by'); }
  function groupScope(req, alias = 'g') { return scope(req, alias, 'owner_user_id'); }

  app.get('/api/divulgacao/bootstrap', async (req, res, next) => {
    try {
      const config = await ensureConfig(req);
      const cs = campaignScope(req, 'c');
      const gs = groupScope(req, 'g');
      const [jobs, groups, campaigns, clicks] = await Promise.all([
        pool.query(`SELECT v.id,v.empresa_id,v.codigo,v.titulo,v.cargo,v.bairro,v.cidade,v.estado,v.salario,v.escala,v.horario,v.beneficios,v.status,e.nome AS empresa_nome,(m.logo_png IS NOT NULL) AS possui_logo,EXISTS(SELECT 1 FROM vaga_artes_ia ai WHERE ai.vaga_id=v.id AND ai.ativa IS TRUE AND ai.status='PRONTA') AS possui_arte_ia FROM vagas v JOIN empresas e ON e.id=v.empresa_id LEFT JOIN empresa_marcas m ON m.empresa_id=e.id WHERE v.status='ATIVA' ${!isAdmin(req) && req.user?.empresa_id ? 'AND v.empresa_id=$1' : ''} ORDER BY v.updated_at DESC LIMIT 200`, !isAdmin(req) && req.user?.empresa_id ? [req.user.empresa_id] : []),
        pool.query(`SELECT canal,COUNT(*)::INTEGER total,COUNT(*) FILTER (WHERE ativo)::INTEGER ativos,COUNT(*) FILTER (WHERE autorizado_envio)::INTEGER autorizados FROM divulgacao_grupos g WHERE ${gs.sql} GROUP BY canal`, gs.values),
        pool.query(`SELECT status,COUNT(*)::INTEGER total FROM divulgacao_campanhas c WHERE ${cs.sql} GROUP BY status`, cs.values),
        pool.query(`SELECT COUNT(*)::INTEGER total FROM divulgacao_cliques x JOIN divulgacao_campanha_destinos d ON d.id=x.destino_id JOIN divulgacao_campanhas c ON c.id=d.campanha_id WHERE ${cs.sql} AND x.created_at>=NOW()-INTERVAL '30 days'`, cs.values),
      ]);
      return res.json({ sucesso: true, configuracao: config, vagas: jobs.rows, grupos_resumo: groups.rows, campanhas_resumo: campaigns.rows, cliques_30d: clicks.rows[0]?.total || 0, waha: { configurado: Boolean(wahaBaseUrl && wahaApiKey && sessionName), session: sessionName || null, automatico_habilitado: Boolean(automaticEnabled) } });
    } catch (error) { next(error); }
  });

  const onboardingSchema = z.object({
    etapa: z.coerce.number().int().min(1).max(4),
    usar_facebook: z.boolean().default(true), usar_whatsapp: z.boolean().default(true),
    concluir: z.boolean().default(false), aceitar_termo_whatsapp: z.boolean().default(false),
    intervalo_min_segundos: z.coerce.number().int().min(90).max(7200).default(180),
    intervalo_max_segundos: z.coerce.number().int().min(90).max(10800).default(300),
    limite_diario: z.coerce.number().int().min(1).max(100).default(20),
  }).refine((data) => data.intervalo_max_segundos >= data.intervalo_min_segundos, { message: 'O intervalo máximo deve ser maior ou igual ao mínimo.' });

  app.put('/api/divulgacao/onboarding', async (req, res, next) => {
    try {
      const parsed = onboardingSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ sucesso: false, erro: parsed.error.issues[0]?.message || 'Configuração inválida.' });
      await ensureConfig(req);
      const data = parsed.data;
      const result = await pool.query(`UPDATE divulgacao_configuracoes SET onboarding_etapa=$2,onboarding_concluido=$3,usar_facebook=$4,usar_whatsapp=$5,whatsapp_termo_aceito_at=CASE WHEN $6 THEN COALESCE(whatsapp_termo_aceito_at,NOW()) ELSE whatsapp_termo_aceito_at END,intervalo_min_segundos=$7,intervalo_max_segundos=$8,limite_diario=$9,updated_at=NOW() WHERE usuario_id=$1 RETURNING *`, [req.user.id, data.etapa, data.concluir, data.usar_facebook, data.usar_whatsapp, data.aceitar_termo_whatsapp, data.intervalo_min_segundos, data.intervalo_max_segundos, data.limite_diario]);
      return res.json({ sucesso: true, configuracao: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get('/api/divulgacao/grupos', async (req, res, next) => {
    try {
      const sc = groupScope(req, 'g'); const values = [...sc.values]; const clauses = [sc.sql];
      const canal = clean(req.query.canal, 20).toUpperCase(); if (['FACEBOOK','WHATSAPP'].includes(canal)) { values.push(canal); clauses.push(`g.canal=$${values.length}`); }
      const q = clean(req.query.q, 150); if (q) { values.push(`%${q}%`); clauses.push(`(g.nome ILIKE $${values.length} OR COALESCE(g.regiao,'') ILIKE $${values.length})`); }
      const result = await pool.query(`SELECT g.*,(SELECT COUNT(*)::INTEGER FROM divulgacao_campanha_destinos d WHERE d.grupo_id=g.id AND d.status IN ('ENVIADO','PUBLICADO')) AS publicacoes,(SELECT COUNT(*)::INTEGER FROM divulgacao_cliques x JOIN divulgacao_campanha_destinos d ON d.id=x.destino_id WHERE d.grupo_id=g.id) AS cliques FROM divulgacao_grupos g WHERE ${clauses.join(' AND ')} ORDER BY g.ativo DESC,g.canal,g.nome LIMIT 1000`, values);
      return res.json({ sucesso: true, grupos: result.rows });
    } catch (error) { next(error); }
  });

  const groupSchema = z.object({ canal: z.enum(['FACEBOOK','WHATSAPP']), nome: z.string().trim().min(3).max(220), url: z.string().trim().max(2000).optional().default(''), external_id: z.string().trim().max(180).optional().default(''), regiao: z.string().trim().max(160).optional().default(''), categorias: z.union([z.string(),z.array(z.string())]).optional().default([]), cargos: z.union([z.string(),z.array(z.string())]).optional().default([]), regras: z.string().trim().max(5000).optional().default(''), observacoes: z.string().trim().max(5000).optional().default(''), autorizado_envio: z.boolean().default(false), ativo: z.boolean().default(true), intervalo_minimo_horas: z.coerce.number().int().min(0).max(720).default(24) });

  app.post('/api/divulgacao/grupos', async (req, res, next) => {
    try {
      const parsed = groupSchema.safeParse(req.body || {}); if (!parsed.success) return res.status(400).json({ sucesso:false,erro:parsed.error.issues[0]?.message||'Dados inválidos.' });
      const data=parsed.data; const urlNorm=data.canal==='FACEBOOK'?normalizeFacebookUrl(data.url):'';
      if (data.canal==='FACEBOOK'&&!urlNorm) return res.status(400).json({sucesso:false,erro:'Informe uma URL válida de grupo do Facebook.'});
      if (data.canal==='WHATSAPP'&&!data.external_id.endsWith('@g.us')) return res.status(400).json({sucesso:false,erro:'O identificador do grupo deve terminar em @g.us.'});
      const result=await pool.query(`INSERT INTO divulgacao_grupos(canal,nome,url,url_normalizada,external_id,session_name,empresa_id,owner_user_id,regiao,categorias,cargos,regras,observacoes,origem,ativo,autorizado_envio,intervalo_minimo_horas) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),$7,$8,NULLIF($9,''),$10::TEXT[],$11::TEXT[],NULLIF($12,''),NULLIF($13,''),'MANUAL',$14,$15,$16) RETURNING *`,[data.canal,data.nome,data.url,urlNorm,data.external_id,data.canal==='WHATSAPP'?sessionName:'',req.user.empresa_id||null,req.user.id||null,data.regiao,splitList(data.categorias),splitList(data.cargos),data.regras,data.observacoes,data.ativo,data.autorizado_envio,data.intervalo_minimo_horas]);
      return res.status(201).json({sucesso:true,grupo:result.rows[0]});
    } catch(error){ if(error.code==='23505') return res.status(409).json({sucesso:false,erro:'Esse grupo já está cadastrado.'}); next(error); }
  });

  app.post('/api/divulgacao/grupos/importar-facebook', async (req,res,next)=>{
    let client;
    try{
      const rawGroups=Array.isArray(req.body?.grupos)?req.body.grupos.slice(0,1000):null;
      const items=rawGroups?rawGroups.map((item,index)=>({
        nome:clean(item?.nome,220),
        url:clean(item?.url,2000),
        external_id:clean(item?.external_id,180),
        regiao:clean(item?.regiao,160),
        categorias:splitList(item?.categorias),
        regras:clean(item?.regras,5000),
        sourceIndex:index+1,
      })):clean(req.body?.conteudo,50000).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,500).map((line,index)=>{
        const [nome,url,regiao='',categorias='',regras='']=line.split('|').map(x=>x.trim());
        return {nome:clean(nome,220),url:clean(url,2000),external_id:'',regiao:clean(regiao,160),categorias:splitList(categorias),regras:clean(regras,5000),sourceIndex:index+1};
      });
      if(!items.length)return res.status(400).json({sucesso:false,erro:'Nenhum grupo foi enviado para importação.'});

      client=await pool.connect();
      await client.query('BEGIN');
      const sc=groupScope(req,'g');
      const existingResult=await client.query(`SELECT g.id,g.url,g.url_normalizada,g.external_id FROM divulgacao_grupos g WHERE g.canal='FACEBOOK' AND ${sc.sql}`,sc.values);
      const knownKeys=new Set();
      const knownIds=new Set();
      for(const row of existingResult.rows){
        const key=facebookGroupKey(row.url_normalizada||row.url);if(key)knownKeys.add(key);
        const ext=clean(row.external_id,180);if(ext)knownIds.add(ext);
      }

      let imported=0,ignored=0;const errors=[];
      for(const item of items){
        const norm=canonicalFacebookGroupUrl(item.url);const key=facebookGroupKey(norm);const ext=clean(item.external_id,180);
        if(!item.nome||!norm||!key){ignored++;errors.push(`Item ${item.sourceIndex}: nome ou URL inválidos.`);continue;}
        if(knownKeys.has(key)||(ext&&knownIds.has(ext))){ignored++;continue;}
        const result=await client.query(`INSERT INTO divulgacao_grupos(canal,nome,url,url_normalizada,external_id,empresa_id,owner_user_id,regiao,categorias,regras,origem,ativo,autorizado_envio) VALUES('FACEBOOK',$1,$2,$3,NULLIF($4,''),$5,$6,NULLIF($7,''),$8::TEXT[],NULLIF($9,''),'IMPORTACAO',TRUE,FALSE) ON CONFLICT DO NOTHING RETURNING id`,[item.nome,norm,norm,ext,req.user.empresa_id||null,req.user.id||null,item.regiao,item.categorias,item.regras]);
        if(result.rowCount){imported++;knownKeys.add(key);if(ext)knownIds.add(ext);}else ignored++;
      }
      await client.query('COMMIT');
      res.json({sucesso:true,importados:imported,ignorados:ignored,erros:errors.slice(0,20),recebidos:items.length});
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{}
      next(error);
    }finally{client?.release?.();}
  });

  app.patch('/api/divulgacao/grupos/:id', async(req,res,next)=>{
    try{
      const id=parseId(req.params.id); if(!id)return res.status(400).json({sucesso:false,erro:'Grupo inválido.'}); const sc=groupScope(req,'g');
      const current=await pool.query(`SELECT * FROM divulgacao_grupos g WHERE g.id=$${sc.values.length+1} AND ${sc.sql}`,[...sc.values,id]); if(!current.rowCount)return res.status(404).json({sucesso:false,erro:'Grupo não encontrado.'});
      const body=req.body||{}; const result=await pool.query(`UPDATE divulgacao_grupos SET nome=COALESCE(NULLIF($2,''),nome),regiao=NULLIF($3,''),categorias=$4::TEXT[],cargos=$5::TEXT[],regras=NULLIF($6,''),observacoes=NULLIF($7,''),ativo=$8,autorizado_envio=$9,intervalo_minimo_horas=$10,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,clean(body.nome,220),clean(body.regiao,160),splitList(body.categorias),splitList(body.cargos),clean(body.regras,5000),clean(body.observacoes,5000),body.ativo!==false,body.autorizado_envio===true,Math.min(720,Math.max(0,Number(body.intervalo_minimo_horas)||24))]);
      res.json({sucesso:true,grupo:result.rows[0]});
    }catch(error){next(error);}
  });

  app.delete('/api/divulgacao/grupos/:id', async(req,res,next)=>{
    try{const id=parseId(req.params.id); const sc=groupScope(req,'g'); const result=await pool.query(`UPDATE divulgacao_grupos g SET ativo=FALSE,updated_at=NOW() WHERE g.id=$${sc.values.length+1} AND ${sc.sql} RETURNING id`,[...sc.values,id]); if(!result.rowCount)return res.status(404).json({sucesso:false,erro:'Grupo não encontrado.'});res.json({sucesso:true});}catch(error){next(error);}
  });

  app.get('/api/divulgacao/whatsapp/status', async(_req,res,next)=>{
    try{if(!sessionName)return res.json({sucesso:true,configurado:false}); const status=await wahaRequest(`/api/sessions/${encodeURIComponent(sessionName)}`); res.json({sucesso:true,configurado:true,session:sessionName,status});}catch(error){next(error);}
  });

  app.post('/api/divulgacao/whatsapp/sincronizar', async(req,res,next)=>{
    try{
      if(!sessionName)throw new DivulgacaoError('Configure DIVULGACAO_WAHA_SESSION no EasyPanel.',503);
      const body=await wahaRequest(`/api/${encodeURIComponent(sessionName)}/groups?refresh=true`,{timeoutMs:60000}); const groups=normalizeWahaGroups(body); let inserted=0,updated=0;
      for(const item of groups){
        const existing=await pool.query(`SELECT id FROM divulgacao_grupos WHERE canal='WHATSAPP' AND session_name=$1 AND external_id=$2 AND COALESCE(empresa_id,-owner_user_id)=COALESCE($3::BIGINT,-$4::BIGINT) LIMIT 1`,[sessionName,item.external_id,req.user.empresa_id||null,req.user.id]);
        if(existing.rowCount){
          await pool.query(`UPDATE divulgacao_grupos SET nome=$2,participantes=$3,papel_usuario=$4,metadata=$5::JSONB,ativo=TRUE,updated_at=NOW() WHERE id=$1`,[existing.rows[0].id,item.nome,item.participantes,item.papel_usuario,JSON.stringify(item.metadata||{})]);
          updated++;
        }else{
          await pool.query(`INSERT INTO divulgacao_grupos(canal,nome,external_id,session_name,empresa_id,owner_user_id,origem,ativo,participantes,papel_usuario,metadata) VALUES('WHATSAPP',$1,$2,$3,$4,$5,'WAHA',TRUE,$6,$7,$8::JSONB)`,[item.nome,item.external_id,sessionName,req.user.empresa_id||null,req.user.id||null,item.participantes,item.papel_usuario,JSON.stringify(item.metadata||{})]);
          inserted++;
        }
      }
      res.json({sucesso:true,encontrados:groups.length,inseridos:inserted,atualizados:updated});
    }catch(error){next(error);}
  });

  app.get('/api/divulgacao/campanhas', async(req,res,next)=>{
    try{
      const sc=campaignScope(req,'c');
      const result=await pool.query(`
        SELECT c.*,v.titulo AS vaga_titulo,v.cidade,v.bairro,e.nome AS empresa_nome,
          (SELECT COUNT(*)::INTEGER FROM divulgacao_campanha_destinos d WHERE d.campanha_id=c.id) AS destinos_total,
          (SELECT COUNT(*)::INTEGER FROM divulgacao_campanha_destinos d WHERE d.campanha_id=c.id AND (d.status='PULADO' OR (c.canal='FACEBOOK' AND d.status='PUBLICADO') OR (c.canal='WHATSAPP' AND d.status='ENVIADO'))) AS concluidos,
          (SELECT COUNT(*)::INTEGER FROM divulgacao_cliques x JOIN divulgacao_campanha_destinos d ON d.id=x.destino_id WHERE d.campanha_id=c.id) AS cliques
        FROM divulgacao_campanhas c
        JOIN vagas v ON v.id=c.vaga_id
        JOIN empresas e ON e.id=v.empresa_id
        WHERE ${sc.sql}
        ORDER BY c.created_at DESC LIMIT 300
      `,sc.values);
      res.json({sucesso:true,campanhas:result.rows});
    }catch(error){next(error);}
  });

  const campaignSchema=z.object({vaga_id:z.coerce.number().int().positive(),canal:z.enum(['FACEBOOK','WHATSAPP']),grupo_ids:z.array(z.coerce.number().int().positive()).min(1).max(200),modelo:z.enum(['CURTO','COMPLETO','PERSONALIZADO']).default('COMPLETO'),texto:z.string().trim().max(12000).optional().default(''),usar_imagem:z.boolean().default(true),modo_envio:z.enum(['ASSISTIDO','AUTOMATICO']).default('ASSISTIDO'),agendada_para:z.string().trim().optional().default('')});

  app.post('/api/divulgacao/campanhas',async(req,res,next)=>{
    const client=await pool.connect();try{
      const parsed=campaignSchema.safeParse(req.body||{});if(!parsed.success)return res.status(400).json({sucesso:false,erro:parsed.error.issues[0]?.message||'Campanha inválida.'});const data=parsed.data;
      if(!/^https?:\/\//i.test(normalizedPortalBase))return res.status(503).json({sucesso:false,erro:'Configure PORTAL_BASE_URL com a URL pública do portal antes de criar campanhas.'});
      if(data.canal==='FACEBOOK'&&data.modo_envio==='AUTOMATICO')return res.status(400).json({sucesso:false,erro:'No Facebook, o MVP usa publicação assistida com confirmação humana.'});
      if(data.canal==='WHATSAPP'&&data.modo_envio==='AUTOMATICO'&&!automaticEnabled)return res.status(409).json({sucesso:false,erro:'O envio automático está desativado. Configure DIVULGACAO_WHATSAPP_AUTOMATICO=true somente após validar o modo assistido.'});
      const vaga=(await client.query(`SELECT v.*,e.nome AS empresa_nome,(m.logo_png IS NOT NULL) AS possui_logo,EXISTS(SELECT 1 FROM vaga_artes_ia ai WHERE ai.vaga_id=v.id AND ai.ativa IS TRUE AND ai.status='PRONTA') AS possui_arte_ia FROM vagas v JOIN empresas e ON e.id=v.empresa_id LEFT JOIN empresa_marcas m ON m.empresa_id=e.id WHERE v.id=$1 ${!isAdmin(req)&&req.user?.empresa_id?'AND v.empresa_id=$2':''} LIMIT 1`,!isAdmin(req)&&req.user?.empresa_id?[data.vaga_id,req.user.empresa_id]:[data.vaga_id])).rows[0];if(!vaga)return res.status(404).json({sucesso:false,erro:'Vaga não encontrada ou fora do seu acesso.'});
      if(data.usar_imagem&&!vaga.possui_logo)return res.status(409).json({sucesso:false,erro:'Para usar arte na campanha, configure primeiro a logo da empresa em Empresas e marcas.'});
      if(data.usar_imagem&&!vaga.possui_arte_ia)return res.status(409).json({sucesso:false,erro:'Gere uma arte com IA para esta vaga antes de criar a campanha com imagem.'});
      const gs=groupScope(req,'g');const params=[...gs.values,data.grupo_ids,data.canal];const groups=await client.query(`SELECT g.* FROM divulgacao_grupos g WHERE ${gs.sql} AND g.id=ANY($${gs.values.length+1}::BIGINT[]) AND g.canal=$${gs.values.length+2} AND g.ativo IS TRUE`,params);if(groups.rowCount!==new Set(data.grupo_ids).size)return res.status(400).json({sucesso:false,erro:'Um ou mais grupos não estão disponíveis para este canal.'});
      const config=await ensureConfig(req);const text=data.modelo==='PERSONALIZADO'?clean(data.texto,12000):defaultText(vaga,data.modelo);if(!text.includes('{{link}}'))return res.status(400).json({sucesso:false,erro:'O texto precisa conter {{link}} para rastrear o grupo de origem.'});
      await client.query('BEGIN');const created=await client.query(`INSERT INTO divulgacao_campanhas(vaga_id,canal,nome,texto_modelo,modelo,usar_imagem,modo_envio,status,agendada_para,intervalo_min_segundos,intervalo_max_segundos,limite_diario,empresa_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'RASCUNHO',$8,$9,$10,$11,$12,$13) RETURNING *`,[vaga.id,data.canal,`${vaga.titulo} · ${data.canal==='FACEBOOK'?'Facebook':'WhatsApp'}`,text,data.modelo,data.usar_imagem,data.modo_envio,data.agendada_para?new Date(data.agendada_para):null,config.intervalo_min_segundos,config.intervalo_max_segundos,config.limite_diario,req.user.empresa_id||vaga.empresa_id||null,req.user.id||null]);
      for(const group of groups.rows)await client.query(`INSERT INTO divulgacao_campanha_destinos(campanha_id,grupo_id,tracking_token,status,agendado_para) VALUES($1,$2,$3,'PENDENTE',$4)`,[created.rows[0].id,group.id,randomToken(),data.agendada_para?new Date(data.agendada_para):new Date()]);
      await client.query('COMMIT');res.status(201).json({sucesso:true,campanha:created.rows[0]});
    }catch(error){try{await client.query('ROLLBACK');}catch{}next(error);}finally{client.release();}
  });

  app.get('/api/divulgacao/campanhas/:id',async(req,res,next)=>{
    try{
      const id=parseId(req.params.id);
      if(!id)return res.status(400).json({sucesso:false,erro:'Campanha inválida.'});
      const sc=campaignScope(req,'c');
      const result=await pool.query(`
        SELECT c.*,v.titulo AS vaga_titulo,v.cargo,v.bairro,v.cidade,v.estado,v.salario,v.escala,v.horario,v.beneficios,v.empresa_id,
          e.nome AS empresa_nome,(m.logo_png IS NOT NULL) AS possui_logo,
          EXISTS(SELECT 1 FROM vaga_artes_ia ai WHERE ai.vaga_id=v.id AND ai.ativa IS TRUE AND ai.status='PRONTA') AS possui_arte_ia,
          (SELECT COUNT(*)::INTEGER FROM vaga_artes_ia ai2 WHERE ai2.empresa_id=v.empresa_id AND ai2.created_at >= (DATE_TRUNC('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')) AS ia_geracoes_hoje
        FROM divulgacao_campanhas c
        JOIN vagas v ON v.id=c.vaga_id
        JOIN empresas e ON e.id=v.empresa_id
        LEFT JOIN empresa_marcas m ON m.empresa_id=e.id
        WHERE c.id=$${sc.values.length+1} AND ${sc.sql}
        LIMIT 1
      `,[...sc.values,id]);
      if(!result.rowCount)return res.status(404).json({sucesso:false,erro:'Campanha não encontrada.'});
      const destinations=await pool.query(`
        SELECT d.*,g.nome AS grupo_nome,g.canal,g.url,g.external_id,g.regiao,g.regras,g.autorizado_envio,g.ultima_publicacao_at,
          (SELECT COUNT(*)::INTEGER FROM divulgacao_cliques x WHERE x.destino_id=d.id) AS cliques
        FROM divulgacao_campanha_destinos d
        JOIN divulgacao_grupos g ON g.id=d.grupo_id
        WHERE d.campanha_id=$1 ORDER BY d.id
      `,[id]);
      const campaign={...result.rows[0],ia_limite_diario:imageDailyLimit};
      const rows=destinations.rows.map(d=>{
        const link=`${normalizedPortalBase}/r/div/${d.tracking_token}`;
        const template=String(d.texto_override||campaign.texto_modelo||'').trim();
        return {...d,link_rastreavel:link,texto:(template||'Confira a vaga: {{link}}').split('{{link}}').join(link)};
      });
      res.json({sucesso:true,campanha,destinos:rows});
    }catch(error){
      console.error('[DIVULGAÇÃO V2] Falha ao abrir campanha:',{id:req.params.id,user:req.user?.id,message:error.message});
      next(error);
    }
  });

  app.get('/api/divulgacao/vagas/:id/imagem.jpg',async(req,res,next)=>{
    try{
      const id=parseId(req.params.id);
      const vacancy=await loadVacancyForPromotion?.(id);
      if(!vacancy)return res.status(404).json({sucesso:false,erro:'Vaga não encontrada.'});
      if(!vacancy.marca_logo_png)return res.status(409).json({sucesso:false,erro:'Configure a logo da empresa antes de usar a arte da Central de Divulgação.'});
      if(!vacancy.arte_ia_id||!vacancy.arte_ia_imagem)return res.status(409).json({sucesso:false,erro:'Gere uma arte com IA para esta vaga antes de abrir ou enviar a imagem.'});
      const png=await promotionPng(vacancy);
      const jpeg=await sharp(png).flatten({background:'#ffffff'}).jpeg({quality:90,mozjpeg:true}).toBuffer();
      res.setHeader('Content-Type','image/jpeg');res.setHeader('Cache-Control','private, no-store');res.send(jpeg);
    }catch(error){next(error);}
  });

  async function getDestination(req,id){const sc=campaignScope(req,'c');const result=await pool.query(`SELECT d.*,c.vaga_id,c.canal,c.texto_modelo,c.usar_imagem,c.modo_envio,c.status AS campanha_status,c.intervalo_min_segundos,c.intervalo_max_segundos,c.limite_diario,g.nome AS grupo_nome,g.url,g.external_id,g.session_name,g.autorizado_envio,g.ultima_publicacao_at,g.intervalo_minimo_horas FROM divulgacao_campanha_destinos d JOIN divulgacao_campanhas c ON c.id=d.campanha_id JOIN divulgacao_grupos g ON g.id=d.grupo_id WHERE d.id=$${sc.values.length+1} AND ${sc.sql}`,[...sc.values,id]);return result.rows[0]||null;}

  async function sendDestination(row, { claimed = false } = {}){
    if(row.canal!=='WHATSAPP')throw new DivulgacaoError('Este destino não é do WhatsApp.');if(!row.autorizado_envio)throw new DivulgacaoError('Autorize este grupo antes do envio.',409);if(!row.external_id?.endsWith('@g.us'))throw new DivulgacaoError('Identificador do grupo inválido.',409);if(clean(row.session_name,120)!==sessionName)throw new DivulgacaoError('Este grupo pertence a outra sessão do WAHA. Sincronize novamente antes de enviar.',409);
    const link=`${normalizedPortalBase}/r/div/${row.tracking_token}`;const text=String(row.texto_override||row.texto_modelo).replaceAll('{{link}}',link);
    if(!claimed){const claim=await pool.query(`UPDATE divulgacao_campanha_destinos SET status='ENVIANDO',tentativas=tentativas+1,erro=NULL,updated_at=NOW() WHERE id=$1 AND status IN ('PENDENTE','FALHA') RETURNING id`,[row.id]);if(!claim.rowCount)throw new DivulgacaoError('Este destino já foi enviado, pulado ou está em processamento.',409);}
    let response;
    if(row.usar_imagem&&loadVacancyForPromotion&&promotionPng){const vacancy=await loadVacancyForPromotion(row.vaga_id);if(!vacancy)throw new DivulgacaoError('Vaga não encontrada para gerar a arte.',404);if(!vacancy.marca_logo_png)throw new DivulgacaoError('Configure a logo da empresa antes de enviar a arte.',409);if(!vacancy.arte_ia_id||!vacancy.arte_ia_imagem)throw new DivulgacaoError('Gere uma arte com IA para esta vaga antes do envio.',409);const png=await promotionPng(vacancy);const jpeg=await sharp(png).flatten({background:'#ffffff'}).jpeg({quality:88,mozjpeg:true}).toBuffer();response=await wahaRequest('/api/sendImage',{method:'POST',timeoutMs:60000,body:{session:sessionName,chatId:row.external_id,file:{mimetype:'image/jpeg',filename:`vaga-${row.vaga_id}.jpg`,data:jpeg.toString('base64')},caption:text}});}else{response=await wahaRequest('/api/sendText',{method:'POST',body:{session:sessionName,chatId:row.external_id,text,linkPreview:true,linkPreviewHighQuality:true}});}
    await pool.query(`UPDATE divulgacao_campanha_destinos SET status='ENVIADO',enviado_at=NOW(),waha_message_id=$2,erro=NULL,updated_at=NOW() WHERE id=$1`,[row.id,messageId(response)||null]);await pool.query(`UPDATE divulgacao_grupos SET ultima_publicacao_at=NOW(),updated_at=NOW() WHERE id=$1`,[row.grupo_id]);return response;
  }

  app.patch('/api/divulgacao/destinos/:id/status',async(req,res,next)=>{
    try{
      const id=parseId(req.params.id);const row=await getDestination(req,id);if(!row)return res.status(404).json({sucesso:false,erro:'Destino não encontrado.'});
      const requested=clean(req.body?.status,30).toUpperCase();
      const allowed=row.canal==='FACEBOOK'?['PUBLICADO','ENVIADO','PULADO','FALHA','PENDENTE']:['PULADO','PENDENTE'];
      if(!allowed.includes(requested))return res.status(400).json({sucesso:false,erro:'Status não permitido para este canal.'});
      if(['PUBLICADO','ENVIADO'].includes(requested)&&row.campanha_status!=='EM_EXECUCAO')return res.status(409).json({sucesso:false,erro:'Inicie a campanha antes de registrar a publicação.'});
      const reason=clean(req.body?.erro,1500);
      await pool.query(`
        UPDATE divulgacao_campanha_destinos SET
          status=$2,
          enviado_at=CASE WHEN $2 IN ('ENVIADO','PUBLICADO') THEN COALESCE(enviado_at,NOW()) WHEN $2='PENDENTE' THEN NULL ELSE enviado_at END,
          publicado_at=CASE WHEN $2='PUBLICADO' THEN NOW() WHEN $2 IN ('PENDENTE','ENVIADO','FALHA') THEN NULL ELSE publicado_at END,
          erro=CASE WHEN $2='FALHA' THEN NULLIF($3,'') ELSE NULL END,
          updated_at=NOW()
        WHERE id=$1
      `,[id,requested,reason]);
      if(requested==='PUBLICADO')await pool.query('UPDATE divulgacao_grupos SET ultima_publicacao_at=NOW(),updated_at=NOW() WHERE id=$1',[row.grupo_id]);
      res.json({sucesso:true,status:requested});
    }catch(error){next(error);}
  });

  app.post('/api/divulgacao/destinos/:id/enviar',async(req,res,next)=>{
    try{const id=parseId(req.params.id);const row=await getDestination(req,id);if(!row)return res.status(404).json({sucesso:false,erro:'Destino não encontrado.'});if(row.campanha_status!=='EM_EXECUCAO')return res.status(409).json({sucesso:false,erro:'Inicie a campanha antes de enviar mensagens.'});await sendDestination(row);res.json({sucesso:true,mensagem:'Mensagem aceita pelo WAHA.'});}catch(error){if(req.params.id)await pool.query(`UPDATE divulgacao_campanha_destinos SET status='FALHA',erro=$2,updated_at=NOW() WHERE id=$1`,[Number(req.params.id),clean(error.message,1500)]).catch(()=>{});next(error);}
  });

  app.post('/api/divulgacao/campanhas/:id/controle',async(req,res,next)=>{
    try{const id=parseId(req.params.id);const action=clean(req.body?.acao,30).toUpperCase();const sc=campaignScope(req,'c');const result=await pool.query(`SELECT c.*,cfg.whatsapp_termo_aceito_at FROM divulgacao_campanhas c LEFT JOIN divulgacao_configuracoes cfg ON cfg.usuario_id=c.created_by WHERE c.id=$${sc.values.length+1} AND ${sc.sql}`,[...sc.values,id]);const campaign=result.rows[0];if(!campaign)return res.status(404).json({sucesso:false,erro:'Campanha não encontrada.'});
      if(action==='INICIAR'){if(campaign.canal==='WHATSAPP'&&campaign.modo_envio==='AUTOMATICO'){if(!automaticEnabled)throw new DivulgacaoError('Fila automática desativada no EasyPanel.',409);if(!campaign.whatsapp_termo_aceito_at)throw new DivulgacaoError('Conclua o onboarding e aceite as regras do WhatsApp.',409);const unauthorized=await pool.query(`SELECT COUNT(*)::INTEGER total FROM divulgacao_campanha_destinos d JOIN divulgacao_grupos g ON g.id=d.grupo_id WHERE d.campanha_id=$1 AND g.autorizado_envio IS NOT TRUE`,[id]);if(unauthorized.rows[0].total)throw new DivulgacaoError('Autorize todos os grupos selecionados antes de iniciar.',409);}await pool.query(`UPDATE divulgacao_campanhas SET status='EM_EXECUCAO',iniciada_at=COALESCE(iniciada_at,NOW()),pausada_at=NULL,erro=NULL,updated_at=NOW() WHERE id=$1`,[id]);await pool.query(`UPDATE divulgacao_campanha_destinos SET agendado_para=COALESCE(agendado_para,NOW()),status=CASE WHEN status='PRONTO' THEN 'PENDENTE' ELSE status END,updated_at=NOW() WHERE campanha_id=$1 AND status IN ('PENDENTE','PRONTO')`,[id]);}
      else if(action==='PAUSAR')await pool.query(`UPDATE divulgacao_campanhas SET status='PAUSADA',pausada_at=NOW(),updated_at=NOW() WHERE id=$1`,[id]);
      else if(action==='CANCELAR')await pool.query(`UPDATE divulgacao_campanhas SET status='CANCELADA',updated_at=NOW() WHERE id=$1`,[id]);
      else if(action==='CONCLUIR')await pool.query(`UPDATE divulgacao_campanhas SET status='CONCLUIDA',concluida_at=NOW(),updated_at=NOW() WHERE id=$1`,[id]);
      else return res.status(400).json({sucesso:false,erro:'Ação inválida.'});res.json({sucesso:true});
    }catch(error){next(error);}
  });

  async function processQueue(){
    if(queueBusy||!automaticEnabled||!sessionName)return;
    queueBusy=true;
    let row=null;
    try{
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        // Recupera uma tarefa que tenha ficado travada por reinício ou queda do processo.
        await client.query(`
          UPDATE divulgacao_campanha_destinos d
          SET status='PENDENTE',agendado_para=NOW(),erro=COALESCE(d.erro,'') || CASE WHEN COALESCE(d.erro,'')='' THEN '' ELSE E'\n' END || 'Retomado após interrupção.',updated_at=NOW()
          FROM divulgacao_campanhas c
          WHERE c.id=d.campanha_id
            AND c.canal='WHATSAPP'
            AND c.modo_envio='AUTOMATICO'
            AND c.status='EM_EXECUCAO'
            AND d.status='ENVIANDO'
            AND d.updated_at < NOW()-INTERVAL '15 minutes'
        `);
        const result=await client.query(`
          SELECT d.*,c.vaga_id,c.canal,c.texto_modelo,c.usar_imagem,c.modo_envio,
                 c.intervalo_min_segundos,c.intervalo_max_segundos,c.limite_diario,
                 g.external_id,g.session_name,g.autorizado_envio,g.id AS grupo_id,g.intervalo_minimo_horas
          FROM divulgacao_campanha_destinos d
          JOIN divulgacao_campanhas c ON c.id=d.campanha_id
          JOIN divulgacao_grupos g ON g.id=d.grupo_id
          LEFT JOIN divulgacao_configuracoes cfg ON cfg.usuario_id=c.created_by
          WHERE c.canal='WHATSAPP'
            AND c.modo_envio='AUTOMATICO'
            AND c.status='EM_EXECUCAO'
            AND d.status='PENDENTE'
            AND COALESCE(d.agendado_para,NOW())<=NOW()
            AND g.ativo IS TRUE
            AND g.autorizado_envio IS TRUE
            AND g.session_name=$1
            AND (g.ultima_publicacao_at IS NULL OR g.ultima_publicacao_at + (g.intervalo_minimo_horas || ' hours')::INTERVAL <= NOW())
            AND (
              cfg.id IS NULL OR (
                EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::SMALLINT = ANY(cfg.dias_semana)
                AND CASE
                  WHEN cfg.hora_inicio<=cfg.hora_fim THEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::TIME BETWEEN cfg.hora_inicio AND cfg.hora_fim
                  ELSE (NOW() AT TIME ZONE 'America/Sao_Paulo')::TIME>=cfg.hora_inicio OR (NOW() AT TIME ZONE 'America/Sao_Paulo')::TIME<=cfg.hora_fim
                END
              )
            )
            AND (
              SELECT COUNT(*)
              FROM divulgacao_campanha_destinos sent
              WHERE sent.campanha_id=c.id
                AND sent.status='ENVIADO'
                AND (sent.enviado_at AT TIME ZONE 'America/Sao_Paulo')::DATE=(NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
            )<c.limite_diario
          ORDER BY COALESCE(d.agendado_para,d.created_at),d.id
          FOR UPDATE OF d SKIP LOCKED
          LIMIT 1
        `,[sessionName]);
        if(!result.rowCount){await client.query('COMMIT');return;}
        row=result.rows[0];
        const claimed=await client.query(`
          UPDATE divulgacao_campanha_destinos
          SET status='ENVIANDO',tentativas=tentativas+1,erro=NULL,updated_at=NOW()
          WHERE id=$1 AND status='PENDENTE'
          RETURNING tentativas
        `,[row.id]);
        if(!claimed.rowCount){await client.query('ROLLBACK');row=null;return;}
        row.tentativas=claimed.rows[0].tentativas;
        row.status='ENVIANDO';
        await client.query('COMMIT');
      }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}

      await sendDestination(row,{claimed:true});
      const next=await pool.query(`SELECT id FROM divulgacao_campanha_destinos WHERE campanha_id=$1 AND status='PENDENTE' ORDER BY COALESCE(agendado_para,created_at),id LIMIT 1`,[row.campanha_id]);
      if(next.rowCount){
        const wait=randomBetween(row.intervalo_min_segundos,row.intervalo_max_segundos);
        await pool.query(`UPDATE divulgacao_campanha_destinos SET agendado_para=GREATEST(COALESCE(agendado_para,NOW()),NOW()+($2||' seconds')::INTERVAL),updated_at=NOW() WHERE id=$1`,[next.rows[0].id,wait]);
      }
      const open=await pool.query(`SELECT COUNT(*)::INTEGER total FROM divulgacao_campanha_destinos WHERE campanha_id=$1 AND status IN ('PENDENTE','ENVIANDO')`,[row.campanha_id]);
      if(!open.rows[0].total)await pool.query(`UPDATE divulgacao_campanhas SET status='CONCLUIDA',concluida_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='EM_EXECUCAO'`,[row.campanha_id]);
    }catch(error){
      if(row?.id){
        const attempts=Number(row.tentativas||1);
        await pool.query(`UPDATE divulgacao_campanha_destinos SET status=$2,agendado_para=CASE WHEN $2='PENDENTE' THEN NOW()+INTERVAL '15 minutes' ELSE agendado_para END,erro=$3,updated_at=NOW() WHERE id=$1`,[row.id,attempts<3?'PENDENTE':'FALHA',clean(error.message,1500)]).catch(()=>{});
      }
      console.error('[DIVULGAÇÃO V1] Falha na fila:',error.message);
    }finally{queueBusy=false;}
  }

  const timer=setInterval(()=>processQueue().catch(error=>console.error('[DIVULGAÇÃO V1]',error.message)),20000);timer.unref?.();
  setTimeout(()=>processQueue().catch(()=>{}),7000).unref?.();

  return { processQueue, config:{sessionName,automaticEnabled:Boolean(automaticEnabled)} };
}

module.exports={registerDivulgacaoV1,normalizeFacebookUrl,facebookGroupKey,normalizeWahaGroups,defaultText};
