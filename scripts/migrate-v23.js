'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { databaseConfigFromEnv } = require('./db-config');

async function main() {
  const { pool, label } = databaseConfigFromEnv();
  try {
    const file = path.join(__dirname, '..', 'sql', '31_GENESIS_UI_V23_NOTIFICACOES.sql');
    console.log(`Aplicando ${path.basename(file)} em ${label}...`);
    await pool.query(fs.readFileSync(file, 'utf8'));
    console.log('Migration da Central de Notificações V23 aplicada com sucesso.');
  } finally { await pool.end(); }
}

main().catch((error) => {
  console.error('Falha na migration V23:', error?.stack || error?.message || error);
  process.exitCode = 1;
});
