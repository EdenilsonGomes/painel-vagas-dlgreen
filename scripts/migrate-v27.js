'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');
(async () => {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const file = path.join(__dirname, '..', 'sql', '32_GENESIS_SALES_TALENT_FLOWS.sql');
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(fs.readFileSync(file, 'utf8'));
    console.log('Migration V27 aplicada com sucesso.');
  } finally { await pool.end(); }
})().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
