'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const file = path.join(__dirname, '..', 'sql', '28_GENESIS_IA_V16_1_LINKS_MEET_REAGENDAMENTO.sql');
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(fs.readFileSync(file, 'utf8'));
    console.log('Migration V16.1 aplicada com sucesso.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha na migration V16.1:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
