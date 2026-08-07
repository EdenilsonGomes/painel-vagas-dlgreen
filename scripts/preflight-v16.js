'use strict';
const {Pool}=require('pg');
const ssl=String(process.env.DB_SSL||'false').toLowerCase()==='true'?{rejectUnauthorized:false}:false;
const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL,ssl}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD,ssl});
(async()=>{try{
  const tables=['atendimento_handoff_historico','candidato_revisoes','documentos','candidatos'];
  const tr=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])`,[tables]);
  const tf=new Set(tr.rows.map(r=>r.tablename)); const mt=tables.filter(t=>!tf.has(t));
  const cols=[['documentos','origem_documento'],['documentos','recebido_durante_atendimento_humano'],['documentos','aplicacao_pendente'],['documentos','aplicacao_tentativas'],['documentos','aplicacao_proxima_tentativa_em'],['candidatos','atendimento_humano_solicitado_em']];
  const cr=await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (SELECT * FROM UNNEST($1::text[],$2::text[]))`,[cols.map(x=>x[0]),cols.map(x=>x[1])]);
  const cf=new Set(cr.rows.map(r=>`${r.table_name}.${r.column_name}`)); const mc=cols.map(x=>x.join('.')).filter(x=>!cf.has(x));
  const funcs=['genesis_v16_controle_entrada','genesis_v16_estagiar_documento','genesis_v16_registrar_pdf','genesis_v16_acao_manual','genesis_v16_pausar_ia_em_suporte'];
  const fr=await pool.query(`SELECT proname FROM pg_proc WHERE proname=ANY($1::text[])`,[funcs]);const ff=new Set(fr.rows.map(r=>r.proname));const mf=funcs.filter(f=>!ff.has(f));
  const triggers=['trg_genesis_v16_documento_aplicado','trg_genesis_v16_pausar_ia_suporte'];
  const gr=await pool.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])`,[triggers]);const gf=new Set(gr.rows.map(r=>r.tgname));const mg=triggers.filter(t=>!gf.has(t));
  if(mt.length||mc.length||mf.length||mg.length)throw new Error(`Tabelas ausentes: ${mt.join(', ')||'nenhuma'} | Colunas ausentes: ${mc.join(', ')||'nenhuma'} | Funções ausentes: ${mf.join(', ')||'nenhuma'} | Triggers ausentes: ${mg.join(', ')||'nenhum'}`);
  console.log('Pré-checagem V16 concluída: handoff, pausa automática e documentos preservados estão instalados.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}})();
