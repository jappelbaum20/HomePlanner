'use strict';
// Explicit maintenance job; never runs during web-server startup.
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const FILES = Object.freeze(['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql','005_shelf_documents.sql']);
async function expectedMigrations() {
  return Promise.all(FILES.map(async name => {
    const sql = await readFile(path.join(__dirname,'migrations',name),'utf8');
    return { name, sql, sha256: createHash('sha256').update(sql,'utf8').digest('hex') };
  }));
}
async function verifyMigrations(pool) {
  const expected = await expectedMigrations();
  const actual = (await pool.query('SELECT name,sha256 FROM hp_migration.applied ORDER BY name')).rows;
  return actual.length === expected.length && actual.every((row,i) => row.name === expected[i].name && row.sha256 === expected[i].sha256);
}
async function migrate(client) {
  const migrations = await expectedMigrations();
  await client.query("SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('homeplanner-migration',0))");
  try {
    await client.query('BEGIN');
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS hp_migration');
      await client.query('REVOKE ALL ON SCHEMA hp_migration FROM PUBLIC');
      await client.query('CREATE TABLE IF NOT EXISTS hp_migration.applied (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query('REVOKE ALL ON hp_migration.applied FROM PUBLIC');
      await client.query('GRANT USAGE ON SCHEMA hp_migration TO hp_auth_runtime, hp_app_runtime');
      await client.query('GRANT SELECT ON hp_migration.applied TO hp_auth_runtime, hp_app_runtime');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    const records = (await client.query('SELECT name,sha256 FROM hp_migration.applied ORDER BY name')).rows;
    if (records.length > migrations.length || records.some((r,i)=>r.name!==migrations[i].name || r.sha256!==migrations[i].sha256)) throw Error('Migration ledger mismatch');
    for (const entry of migrations.slice(records.length)) {
      await client.query('BEGIN');
      try {
        await client.query(entry.sql);
        await client.query('INSERT INTO hp_migration.applied(name,sha256) VALUES($1,$2)', [entry.name,entry.sha256]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query("SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('homeplanner-migration',0))"); }
}
module.exports = { FILES, expectedMigrations, verifyMigrations, migrate };
