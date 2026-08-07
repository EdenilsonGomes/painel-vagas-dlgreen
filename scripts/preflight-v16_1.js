'use strict';
const {Pool}=require('pg');const {buildPgConfig}=require('./db-config');const pool=new Pool(buildPgConfig());
function validUrl(value){const raw=String(value??'').trim();if(!raw||/^(undefined|null|false)$/i.test(raw))return false;try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&Boolean(u.hostname);}catch{return false;}}
(async()=>{try{
  const panelUrl=process.env.PANEL_URL||process.env.PUBLIC_BASE_URL||'';
  if(!validUrl(panelUrl))throw new Error(`PANEL_URL inválido: ${JSON.stringify(panelUrl)}. Configure a URL pública https:// do painel.`);
  const cols=['meet_access_type','meet_access_configured_at','meet_access_error'];
  const cr=await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='entrevistas' AND column_name=ANY($1::text[])`,[cols]);const found=new Set(cr.rows.map(r=>r.column_name));const missing=cols.filter(c=>!found.has(c));if(missing.length)throw new Error('Migration 28 ausente. Colunas: '+missing.join(', '));
  const fr=await pool.query(`SELECT pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='genesis_v15_enfileirar_entrevista' LIMIT 1`);if(!fr.rowCount||!fr.rows[0].def.includes("'/e/'"))throw new Error('Função de alerta ainda não usa o link curto /e/.');
  console.log('Pré-checagem V16.1 concluída: PANEL_URL válido, links curtos e campos de acesso do Meet instalados.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}})();
