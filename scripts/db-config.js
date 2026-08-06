'use strict';

const { Pool } = require('pg');

function databaseConfigFromEnv() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  const config = databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      };

  if (!databaseUrl && (!config.host || !config.database || !config.user || !config.password)) {
    throw new Error('Configure DATABASE_URL ou PGHOST, PGDATABASE, PGUSER e PGPASSWORD.');
  }

  return {
    label: databaseUrl ? 'DATABASE_URL' : config.database,
    pool: new Pool({
      ...config,
      ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true'
        ? { rejectUnauthorized: false }
        : false,
      max: 1,
      connectionTimeoutMillis: 10_000,
    }),
  };
}

module.exports = { databaseConfigFromEnv };
