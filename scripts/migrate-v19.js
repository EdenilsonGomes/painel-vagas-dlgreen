'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const file = path.join(__dirname, '..', 'sql', '29_GENESIS_IA_GEO_CRM_V1.sql');
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(fs.readFileSync(file, 'utf8'));
    console.log('Gênesis V19 Geo V1 + CRM Comercial V1 instalados.');
  } finally {
    await pool.end();
  }
}
main().catch((error) => { console.error('Falha na migration V19:', error.message); process.exitCode = 1; });
