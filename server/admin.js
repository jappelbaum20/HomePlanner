'use strict';
const { createHash, randomBytes } = require('node:crypto');
const { googleSubjects } = require('./auth');
const { fail, uuid } = require('./errors');
const { validateUpdate, safeConfig, MAX_BUDGET_MICROS } = require('./model-config');
const EMAIL = 'jacob@appelbaums.com';
const hash = x => createHash('sha256').update(x).digest('hex');
const denied = () => fail(403, 'admin_verification_required', 'Google verification is required.');
function settings(deps) {
  const clientId = deps?.googleClientId;
  if (typeof clientId !== 'string' || !clientId.endsWith('.apps.googleusercontent.com')) fail(503, 'unavailable', 'Admin verification is not configured.');
  return clientId;
}
async function challenge(ctx, deps) {
  const clientId = settings(deps);
  if (!uuid(ctx.sessionId)) fail(401, 'unauthenticated', 'A valid session is required.');
  const subjects = await googleSubjects(ctx, deps);
  if (!Array.isArray(subjects) || subjects.length !== 1 || typeof subjects[0] !== 'string') denied();
  const nonce = randomBytes(32).toString('base64url');
  await ctx.backend.rpc('hp_admin_challenge_issue', { p_nonce_hash: hash(nonce), p_google_subject: subjects[0] });
  return { clientId, nonce, expiresIn: 300 };
}
async function bootstrap(req, ctx, deps) {
  const clientId = settings(deps);
  const nonce = req.headers['x-admin-challenge'], token = req.headers['x-google-id-token'];
  if (!uuid(ctx.sessionId) || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || typeof token !== 'string' || token.length > 16384) denied();
  let claims;
  try {
    if (deps?.verifyGoogleToken) claims = await deps.verifyGoogleToken(token, clientId);
    else { const { OAuth2Client } = require('google-auth-library'); claims = (await new OAuth2Client().verifyIdToken({ idToken: token, audience: clientId })).getPayload(); }
  } catch { denied(); }
  const now = Math.floor(Date.now() / 1000);
  if (!claims || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== clientId || claims.email !== EMAIL || claims.email_verified !== true || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) || claims.nonce !== nonce || !Number.isInteger(claims.iat) || claims.iat > now + 30 || claims.iat < now - 330 || !Number.isInteger(claims.exp) || claims.exp <= now) denied();
  const subjects = await googleSubjects(ctx, deps);
  if (!Array.isArray(subjects) || subjects.length !== 1 || subjects[0] !== claims.sub) denied();
  const grantId = randomBytes(32).toString('base64url');
  const accepted = await ctx.backend.rpc('hp_admin_verify', { p_nonce_hash: hash(nonce), p_google_subject: claims.sub, p_grant_hash: hash(grantId) });
  if (accepted !== true) denied();
  if (deps?.accessStore) await deps.accessStore.seedOwner(ctx, hash(grantId));
  return { isAdmin: true, grantId, expiresIn: 600 };
}
async function requireAdmin(req, ctx) {
  const grant = req.headers['x-admin-grant'];
  if (typeof grant !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(grant)) denied();
  const subject = await ctx.backend.rpc('hp_admin_grant', { p_grant_hash: hash(grant) });
  if (typeof subject !== 'string' || !subject) denied();
  return subject;
}
async function getConfig(ctx, deps) {
  const config = await ctx.backend.rpc('hp_model_config_get', {});
  if (!config || !Number.isSafeInteger(config.revision)) fail(503, 'unavailable', 'Settings are unavailable.');
  return safeConfig(config, deps);
}
async function updateConfig(ctx, subject, revision, body, deps) {
  validateUpdate(body, deps);
  const current = await ctx.backend.rpc('hp_model_config_get', {});
  if (!current) fail(503, 'unavailable', 'Settings are unavailable.');
  if (body.enabled && (!Number.isSafeInteger(current.globalBudgetMicros) || current.globalBudgetMicros < 1 || current.globalBudgetMicros > MAX_BUDGET_MICROS)) fail(422, 'invalid_data', 'Set the lifetime budget before enabling.');
  const config = { enabled: body.enabled, adapterId: body.adapterId, modelId: body.modelId, connectionRef: body.connectionId, limits: body.limits, globalBudgetMicros: current.globalBudgetMicros };
  return safeConfig(await ctx.backend.rpc('hp_model_config_update', { p_actor: ctx.userId, p_google_subject: subject, p_revision: revision, p_config: config }), deps);
}
async function updateBudget(ctx, subject, revision, body, deps) {
  if (!body || Object.keys(body).length !== 1 || !Number.isSafeInteger(body.globalBudgetMicros) || body.globalBudgetMicros < 1 || body.globalBudgetMicros > MAX_BUDGET_MICROS) fail(422, 'invalid_data', 'Invalid lifetime budget.');
  const current = await ctx.backend.rpc('hp_model_config_get', {});
  if (!current) fail(503, 'unavailable', 'Settings are unavailable.');
  const config = { enabled: current.enabled, adapterId: current.adapterId, modelId: current.modelId, connectionRef: current.connectionRef, limits: current.limits, globalBudgetMicros: body.globalBudgetMicros };
  return safeConfig(await ctx.backend.rpc('hp_model_config_update', { p_actor: ctx.userId, p_google_subject: subject, p_revision: revision, p_config: config }), deps);
}
module.exports = { challenge, bootstrap, requireAdmin, getConfig, updateConfig, updateBudget };
