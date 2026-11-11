'use strict';
// Test-only adapters that let the production modules talk to an in-process PGlite database.
const SINGLE = sql => !sql.includes('\n') && sql.trim().replace(/;$/, '').indexOf(';') === -1;
function client(db) {
  return {
    async query(sql, args) {
      if (args && args.length || SINGLE(sql)) return db.query(sql, args || []);
      const results = await db.exec(sql); return { rows: results.length ? results[results.length - 1].rows : [] };
    }
  };
}
// A pg.Pool lookalike whose connections run as the given NOLOGIN role. PGlite has a single session,
// so "connections" share it (PGlite serialises individual statements). Enough for sequential flows.
function rolePool(db, role, { searchPath } = {}) {
  const make = async () => {
    await db.exec(role ? 'SET ROLE ' + role : 'RESET ROLE');
    if (searchPath) await db.exec('SET search_path=' + searchPath);
    return { query: (sql, args) => pgClient(db).query(sql, args), release() {} };
  };
  return { connect: make, async query(sql, args) { const c = await make(); try { return await c.query(sql, args); } finally { c.release(); } }, async end() {} };
}
// Shape results like node-postgres so Kysely (used by Better Auth) can read them.
function pgClient(db) {
  const inner = client(db);
  return { async query(sql, args) {
    const r = await inner.query(sql, args);
    return { rows: r.rows || [], rowCount: r.affectedRows ?? (r.rows || []).length, command: String(sql).trim().split(/s+/)[0].toUpperCase() };
  } };
}
module.exports = { client, pgClient, rolePool };
