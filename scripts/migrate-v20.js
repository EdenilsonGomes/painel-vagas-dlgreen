'use strict';
const fs=require('node:fs');const path=require('node:path');const {Pool}=require('pg');const {buildPoolConfig}=require('./db-config');
(async()=>{const pool=new Pool(buildPoolConfig());try{const sql=fs.readFileSync(path.join(__dirname,'..','sql','30_GENESIS_IA_PROSPECCAO_COMERCIAL_V20.sql'),'utf8');await pool.query(sql);console.log('Migration V20 aplicada: Prospecção comercial, enriquecimento, conversas e follow-up.');}catch(e){console.error('Falha migration V20:',e.message);process.exitCode=1;}finally{await pool.end();}})();
