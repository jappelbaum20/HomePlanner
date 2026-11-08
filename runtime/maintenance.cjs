'use strict';
// Explicit operator jobs only; never imported by the web entry point.
const { Client } = require('pg');
const { readSetting, requireDatabaseUrl } = require('./composition.cjs');
const { migrate, verifyMigrations } = require('../db/migrate.cjs');

async function run(job, env = process.env) {
  if (!['provision', 'migrate', 'verify'].includes(job)) throw Error('Unknown maintenance job');
  const connectionString = await readSetting(env, 'HOMEPLANNER_MIGRATION_DATABASE_URL');
  requireDatabaseUrl(connectionString, 'homeplanner_bootstrap');
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    if (job === 'migrate') { await migrate(client); return; }
    if (job === 'verify') { if (!await verifyMigrations(client)) throw Error('Migration ledger mismatch'); return; }
    const authPassword = await readSetting(env, 'HOMEPLANNER_AUTH_DB_PASSWORD');
    const appPassword = await readSetting(env, 'HOMEPLANNER_APP_DB_PASSWORD');
    const photoPassword = await readSetting(env, 'HOMEPLANNER_PHOTO_MAINTENANCE_DB_PASSWORD');
    if ([authPassword, appPassword, photoPassword].some(v => Buffer.byteLength(v) < 32) || new Set([authPassword, appPassword, photoPassword]).size !== 3) throw Error('Invalid database credentials');
    const names = ['hp_auth_owner','hp_app_owner','hp_auth_runtime','hp_app_runtime','hp_photo_maintenance','hp_auth_login','hp_app_login','hp_photo_maintenance_login'];
    await client.query('BEGIN');
    try {
      const existing = await client.query('SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])', [names]);
      if (existing.rowCount) throw Error('Role names already exist');
      for (const name of names.slice(0,5)) await client.query(`CREATE ROLE ${client.escapeIdentifier(name)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      for (const [name, password] of [['hp_auth_login',authPassword],['hp_app_login',appPassword],['hp_photo_maintenance_login',photoPassword]]) {
        await client.query(`CREATE ROLE ${client.escapeIdentifier(name)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`);
      }
      await client.query('GRANT hp_auth_runtime TO hp_auth_login');
      await client.query('GRANT hp_app_runtime TO hp_app_login');
      await client.query('GRANT hp_photo_maintenance TO hp_photo_maintenance_login');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { await client.end(); }
}
if (require.main === module) run(process.argv[2]).then(() => console.log('Maintenance job completed.'), () => { console.error('Maintenance job failed.'); process.exitCode = 1; });
module.exports = { run };
