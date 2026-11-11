'use strict';
// Explicit composition seam. No configuration or secret file is read on import.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');
const { createIntegrations } = require('./integrations.cjs');
const { createBackend } = require('../server/db');
const { createPhotoStore } = require('../server/photo-files.cjs');
const { createPhotoService } = require('../server/photos');
const { canonicalIp } = require('../server/access.cjs');
const { createGmailTransport } = require('../server/gmail-transport.cjs');
const { createOutboxWorker } = require('../server/mail-outbox.cjs');

async function readSetting(env, name, { optional = false } = {}) {
  const value = env[name], file = env[name + '_FILE'];
  if (value && file) throw Error('Conflicting configuration sources');
  if (!value && !file) { if (optional) return undefined; throw Error('Missing required configuration'); }
  if (value) return value;
  if (!path.isAbsolute(file)) throw Error('Secret file path must be absolute');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error('Invalid secret file');
  const content = (await fs.readFile(file, 'utf8')).replace(/\r?\n$/, '');
  if (!content || content.includes('\0') || content.includes('\n') || content.includes('\r')) throw Error('Invalid secret file content');
  return content;
}
async function privateFileSetting(env, name, optional = false) {
  if (env[name]) throw Error('Private file required');
  const file = env[name + '_FILE'];
  if (file && (process.platform !== 'linux' || !path.resolve(file).startsWith('/run/secrets/'))) throw Error('Private secret mount required');
  if (file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw Error('Invalid private secret permissions');
  }
  return readSetting(env, name, { optional });
}
function trustedClientIp(req, proxyIp) {
  if (!proxyIp || canonicalIp(req.socket?.remoteAddress) !== canonicalIp(proxyIp)) throw Error('Untrusted ingress');
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || forwarded.includes(',') || forwarded.trim() !== forwarded) throw Error('Invalid ingress address');
  return canonicalIp(forwarded);
}
// Access requests are recorded (and shown in the owner's admin queue) whenever a trusted ingress
// address is configured for rate limiting. Mail is an optional notification add-on only.
function accessRequestsAvailable({ proxyIp } = {}) { return !!proxyIp; }
function databasePair(auth, app) {
  const a = new URL(auth), b = new URL(app);
  if (![a, b].every(u => ['postgres:', 'postgresql:'].includes(u.protocol) && u.username && u.password && u.hostname && u.pathname.length > 1) ||
      a.hostname !== b.hostname || a.port !== b.port || a.pathname !== b.pathname || a.username === b.username) throw Error('Invalid database scope');
}
function requireDatabaseUrl(value, login) {
  const u = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== 'db' || (u.port && u.port !== '5432') ||
      u.pathname !== '/homeplanner' || u.username !== login || !u.password || u.search || u.hash) throw Error('Invalid database target');
}
function assertVolumeLock(root, env) {
  if (process.platform !== 'linux' || env.HOMEPLANNER_VOLUME_LOCK_FD !== '9') throw Error('Volume lock unavailable');
  const volume = env.HOMEPLANNER_PHOTO_VOLUME_ROOT;
  if (!volume || !path.isAbsolute(volume) || path.resolve(root) !== path.join(path.resolve(volume), 'data')) throw Error('Volume lock unavailable');
  const parent = fsSync.lstatSync(volume);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022)) throw Error('Volume lock unavailable');
  const lock = path.join(volume, '.homeplanner-writer.lock');
  const file = fsSync.lstatSync(lock), descriptor = fsSync.fstatSync(9);
  if (!file.isFile() || file.isSymbolicLink() || file.dev !== descriptor.dev || file.ino !== descriptor.ino) throw Error('Volume lock unavailable');
  // A separately opened descriptor must be unable to obtain the same lock.
  const check = spawnSync('flock', ['-n', lock, 'true'], { stdio: 'ignore', timeout: 3000 });
  if (check.error || check.status !== 1) throw Error('Volume lock unavailable');
}
function holdVolumeLock(root, env) {
  assertVolumeLock(root, env);
  const lock = path.join(env.HOMEPLANNER_PHOTO_VOLUME_ROOT, '.homeplanner-writer.lock');
  function check() {
    try {
      const parent = fsSync.lstatSync(env.HOMEPLANNER_PHOTO_VOLUME_ROOT), file = fsSync.lstatSync(lock), fd = fsSync.fstatSync(9);
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) || !file.isFile() || file.isSymbolicLink() || file.dev !== fd.dev || file.ino !== fd.ino) throw Error();
    } catch { process.exit(70); }
  }
  const timer = setInterval(check, 1000); timer.unref();
  return { exclusiveWriter: () => { check(); return true; }, close: () => clearInterval(timer) };
}
async function maintenanceRole(pool) {
  const result = await pool.query("SELECT pg_catalog.pg_has_role(current_user,'hp_photo_maintenance','MEMBER') AS member, pg_catalog.pg_has_role(current_user,'hp_auth_runtime','MEMBER') AS auth_runtime, pg_catalog.pg_has_role(current_user,'hp_app_runtime','MEMBER') AS app_runtime, pg_catalog.pg_has_role(current_user,'hp_auth_owner','MEMBER') AS auth_owner, pg_catalog.pg_has_role(current_user,'hp_app_owner','MEMBER') AS app_owner, r.rolsuper, r.rolbypassrls, EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('hp_auth','hp_app','hp_private','hp_migration') AND c.relkind IN ('r','p','v','m','f','S') AND (c.relowner=r.oid OR CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE') ELSE pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') END)) AS direct_access FROM pg_catalog.pg_roles r WHERE r.rolname=current_user");
  const r = result.rows[0];
  return !!r && r.member === true && [r.auth_runtime,r.app_runtime,r.auth_owner,r.app_owner,r.rolsuper,r.rolbypassrls,r.direct_access].every(x => x === false);
}
async function createComposition({ env = process.env, safety, PoolClass = Pool } = {}) {
  // Safety must own a real fenced lease and an unattended recovery worker.
  // The executable does not supply one until the corresponding C/B contract is implemented.
  if (!safety || typeof safety.start !== 'function') throw Error('Photo safety integration is unavailable');
  const origin = env.HOMEPLANNER_ORIGIN;
  if (origin !== 'https://home.appelbaums.com') throw Error('Invalid origin');
  const dist = path.resolve(env.HOMEPLANNER_DIST || 'dist-vps');
  const root = env.HOMEPLANNER_PHOTO_ROOT;
  if (!root || !path.isAbsolute(root)) throw Error('Invalid photo root');
  const minFree = Number(env.HOMEPLANNER_MIN_FREE_BYTES);
  if (!Number.isSafeInteger(minFree) || minFree < 20 * 1024 ** 3) throw Error('Invalid free-space floor');
  const lock = holdVolumeLock(root, env);
  let authUrl, appUrl, maintenanceUrl, publicUrl, mailUrl, rateKey, authSecret, csrfSecret, googleClientSecret;
  try { [authUrl, appUrl, maintenanceUrl, publicUrl, mailUrl, rateKey, authSecret, csrfSecret, googleClientSecret] = await Promise.all([
    readSetting(env, 'HOMEPLANNER_AUTH_DATABASE_URL'), readSetting(env, 'HOMEPLANNER_APP_DATABASE_URL'),
    readSetting(env, 'HOMEPLANNER_PHOTO_MAINTENANCE_DATABASE_URL'),
    privateFileSetting(env, 'HOMEPLANNER_ACCESS_PUBLIC_DATABASE_URL'), privateFileSetting(env, 'HOMEPLANNER_MAIL_DATABASE_URL'),
    privateFileSetting(env, 'HOMEPLANNER_ACCESS_RATE_KEY'),
    readSetting(env, 'HOMEPLANNER_AUTH_SECRET'), readSetting(env, 'HOMEPLANNER_CSRF_SECRET'),
    readSetting(env, 'GOOGLE_OAUTH_CLIENT_SECRET')
  ]); } catch (error) { lock.close(); throw error; }
  try {
    requireDatabaseUrl(authUrl, 'hp_auth_login'); requireDatabaseUrl(appUrl, 'hp_app_login'); requireDatabaseUrl(maintenanceUrl, 'hp_photo_maintenance_login');
    requireDatabaseUrl(publicUrl, 'hp_access_public_login'); requireDatabaseUrl(mailUrl, 'hp_mail_worker_login');
    databasePair(authUrl, appUrl); databasePair(authUrl, maintenanceUrl); databasePair(appUrl, maintenanceUrl);
    for (const existing of [authUrl,appUrl,maintenanceUrl]) { databasePair(existing,publicUrl); databasePair(existing,mailUrl); } databasePair(publicUrl,mailUrl);
  }
  catch (error) { lock.close(); throw error; }
  if (Buffer.byteLength(authSecret) < 32 || Buffer.byteLength(csrfSecret) < 32 || Buffer.byteLength(rateKey) < 32 || new Set([authSecret,csrfSecret,rateKey]).size !== 3 ||
      !env.GOOGLE_OAUTH_CLIENT_ID?.endsWith('.apps.googleusercontent.com')) { lock.close(); throw Error('Invalid authentication configuration'); }
  let guard, authPool, appPool, maintenancePool, publicPool, mailPool, transport, timer, mailTask;
  try {
    authPool = new PoolClass({ connectionString: authUrl, max: 5, connectionTimeoutMillis: 5000, options: '-c search_path=hp_auth,pg_catalog' });
    appPool = new PoolClass({ connectionString: appUrl, max: 5, connectionTimeoutMillis: 5000 });
    maintenancePool = new PoolClass({ connectionString: maintenanceUrl, max: 2, connectionTimeoutMillis: 5000 });
    publicPool = new PoolClass({ connectionString: publicUrl, max: 2, connectionTimeoutMillis: 5000 });
    mailPool = new PoolClass({ connectionString: mailUrl, max: 2, connectionTimeoutMillis: 5000 });
    const store = createPhotoStore({ root, publicRoot: dist, maxBytes: 5 * 1024 ** 3, minFreeBytes: minFree });
    await store.init();
    if (!await maintenanceRole(maintenancePool)) throw Error('Maintenance role unavailable');
    guard = await safety.start({ appPool, maintenancePool, store, exclusiveWriter: lock.exclusiveWriter });
    if (!guard || typeof guard.maintenanceReady !== 'function' || typeof guard.close !== 'function' ||
        !lock.exclusiveWriter() || !await guard.maintenanceReady()) throw Error('Photo safety controls unavailable');
    const available = async () => lock.exclusiveWriter() && await guard.maintenanceReady() === true && await maintenanceRole(maintenancePool);
    const requireAvailable = async () => { if (!await available()) throw Error('Photo safety controls unavailable'); };
    let photos;
    const recovery = async args => { await requireAvailable(); return photos.photoRecovery(args); };
    const backend = createBackend({ appPool, photoRecovery: recovery });
    photos = createPhotoService({ backend, store, origin, exclusiveWriter: lock.exclusiveWriter, maintenanceReady: available });
    const photoHandlers = Object.fromEntries(Object.entries(photos.photoHandlers).map(([key, handler]) => [key, async (...args) => { await requireAvailable(); return handler(...args); }]));
    if (!['0','1'].includes(env.HOMEPLANNER_MAIL_ENABLED || '0')) throw Error('Invalid mail mode');
    if (env.HOMEPLANNER_MAIL_ENABLED === '1') transport = createGmailTransport(await privateFileSetting(env, 'HOMEPLANNER_GMAIL_APP_PASSWORD'));
    const worker = createOutboxWorker({ pool: mailPool, transport, origin, from: 'jacob@appelbaums.com' });
    await worker.verifyRole();
    const proxyIp = env.HOMEPLANNER_TRUSTED_PROXY_IP;
    if (proxyIp) canonicalIp(proxyIp);
    const close = async () => { clearInterval(timer); if (mailTask) await mailTask; transport?.close(); try { await guard.close(); } finally { lock.close(); await Promise.allSettled([authPool.end(), appPool.end(), maintenancePool.end(), publicPool.end(), mailPool.end()]); } };
    // Optional key loads only on configured startup; never baked into the image.
    const providerKey = await readSetting(env, 'OPENAI_API_KEY', { optional: true });
    if (providerKey) process.env.OPENAI_API_KEY = providerKey;
    const integrations = await createIntegrations({ origin, authPool, appPool, publicPool, rateKey, authSecret, csrfSecret, googleClientId: env.GOOGLE_OAUTH_CLIENT_ID,
      googleClientSecret, photoHandlers, photoRecovery: recovery, photoReady: photos.photoReady, close,
      requestsAvailable: accessRequestsAvailable({ proxyIp }), getTrustedClientIp: req => trustedClientIp(req, proxyIp) });
    if (!transport) console.log('mail notifications disabled; access requests are recorded for admin review only');
    if (transport) {
      const tick = () => { if (!mailTask) { mailTask = worker.runOnce().catch(() => {}).finally(() => { mailTask = null; }); } };
      timer = setInterval(tick, 15000); timer.unref(); tick();
    }
    return integrations;
  } catch (error) {
    clearInterval(timer); if (mailTask) await mailTask; transport?.close();
    if (guard?.close) await guard.close().catch(() => {});
    lock.close(); await Promise.allSettled([authPool, appPool, maintenancePool, publicPool, mailPool].filter(Boolean).map(pool => pool.end()));
    throw error;
  }
}
module.exports = { createComposition, accessRequestsAvailable, readSetting, privateFileSetting, trustedClientIp, databasePair, requireDatabaseUrl, assertVolumeLock, maintenanceRole };
