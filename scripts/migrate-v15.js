'use strict';
const fs=require('node:fs');const path=require('node:path');const {Pool}=require('pg');
const ssl=String(process.env.DB_SSL||'false').toLowerCase()==='true'?{rejectUnauthorized:false}:false;
const pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL,ssl}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD,ssl});
(async()=>{try{const sql=fs.readFileSync(path.join(__dirname,'..','sql','26_GENESIS_IA_ATENDIMENTO_HUMANO_ENTREVISTAS_V15.sql'),'utf8');await pool.query(sql);console.log('Migração Genesis IA V15 aplicada com sucesso.');}catch(e){console.error(e);process.exitCode=1;}finally{await pool.end();}})();
