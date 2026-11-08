import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const { maintenanceRole } = require('../runtime/composition.cjs');

test('maintenance role guard accepts only scoped access and rejects direct table grants', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE ROLE hp_auth_owner NOLOGIN; CREATE ROLE hp_auth_runtime NOLOGIN; CREATE ROLE hp_app_owner NOLOGIN; CREATE ROLE hp_app_runtime NOLOGIN; CREATE ROLE hp_photo_maintenance NOLOGIN; CREATE ROLE hp_photo_maintenance_login LOGIN; GRANT hp_photo_maintenance TO hp_photo_maintenance_login;');
    for (const name of ['001_auth.sql','002_business.sql','003_photos.sql','004_photo_maintenance.sql']) {
      await db.exec('BEGIN;\n' + await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8') + '\nCOMMIT;');
    }
    await db.exec('SET ROLE hp_photo_maintenance_login');
    assert.equal(await maintenanceRole(db), true);
    await db.exec('RESET ROLE; GRANT SELECT ON hp_app.designs TO hp_photo_maintenance_login; SET ROLE hp_photo_maintenance_login');
    assert.equal(await maintenanceRole(db), false);
  } finally { await db.close(); }
});
