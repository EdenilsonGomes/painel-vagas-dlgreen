'use strict';
const fs=require('node:fs');const path=require('node:path');const {Pool}=require('pg');const {buildPgConfig}=require('./db-config');
const pool=new Pool(buildPgConfig());
(async()=>{try{const sql=fs.readFileSync(path.join(__dirname,'..','sql','28_GENESIS_IA_V16_1_LINKS_MEET_REAGENDAMENTO.sql'),'utf8');await pool.query(sql);console.log('Migration V16.1 aplicada.');}catch(e){console.error(e.message);process.exitCode=1;}finally{await pool.end();}})();
