'use strict';
const fs=require('node:fs');const path=require('node:path');const {databaseConfigFromEnv}=require('./db-config');
async function main(){const {pool,label}=databaseConfigFromEnv();try{const file=path.join(__dirname,'..','sql','25_GENESIS_IA_CENTRAL_DIVULGACAO_V1.sql');console.log(`Aplicando ${path.basename(file)} em ${label}...`);await pool.query(fs.readFileSync(file,'utf8'));console.log('Central de Divulgação V1 instalada.');}finally{await pool.end();}}
main().catch(error=>{console.error('Falha na migration de divulgação:',error.message);process.exitCode=1;});
