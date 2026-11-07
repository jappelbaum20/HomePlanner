'use strict';
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { googleSubjects } = require('./auth');
const { fail, uuid } = require('./errors');
const { validateUpdate, safeConfig, MAX_BUDGET_MICROS } = require('./model-config');

const EMAIL = 'jacob@appelbaums.com';
function settings(deps) {
  const clientId = deps?.googleClientId || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = deps?.challengeSecret || process.env.ADMIN_STEP_UP_SECRET;
  if (typeof clientId !== 'string' || !clientId.endsWith('.apps.googleusercontent.com') || typeof secret !== 'string' || Buffer.byteLength(secret) < 32) fail(503, 'unavailable', 'Admin verification is not configured.');
  return { clientId, secret };
}
function mac(secret, ctx, stamp, random) {
  return createHmac('sha256', secret).update(`${ctx.userId}\n${ctx.sessionId}\n${stamp}\n${random}`).digest('base64url');
}
function challenge(ctx, deps) {
  const { clientId, secret } = settings(deps);
  if (!uuid(ctx.sessionId)) fail(401, 'unauthenticated', 'A valid session is required.');
  const stamp = Math.floor(Date.now() / 1000).toString(), random = randomBytes(24).toString('base64url');
  return { clientId, nonce: `${stamp}.${random}.${mac(secret, ctx, stamp, random)}`, expiresIn: 300 };
}
async function requireAdmin(req, ctx, deps, { bootstrap = false } = {}) {
  const { clientId, secret } = settings(deps);
  const nonce = req.headers['x-admin-challenge'], token = req.headers['x-google-id-token'];
  if (!uuid(ctx.sessionId) || typeof nonce !== 'string' || typeof token !== 'string' || token.length > 16384) fail(403, 'admin_verification_required', 'Google verification is required.');
  const match = /^(\d{10})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(nonce);
  const now = Math.floor(Date.now() / 1000);
  if (!match || Number(match[1]) > now + 30 || Number(match[1]) < now - 300) fail(403, 'admin_verification_required', 'Google verification is required.');
  const expected = Buffer.from(mac(secret, ctx, match[1], match[2])), got = Buffer.from(match[3]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) fail(403, 'admin_verification_required', 'Google verification is required.');
  let claims;
  try {
    if (deps?.verifyGoogleToken) claims = await deps.verifyGoogleToken(token, clientId);
    else {
      const { OAuth2Client } = require('google-auth-library');
      claims = (await new OAuth2Client().verifyIdToken({ idToken: token, audience: clientId })).getPayload();
    }
  } catch { fail(403, 'admin_verification_required', 'Google verification is required.'); }
  if (!claims || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== clientId ||
      typeof claims.email !== 'string' || claims.email.toLowerCase() !== EMAIL || claims.email_verified !== true || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) || claims.nonce !== nonce ||
      !Number.isInteger(claims.iat) || claims.iat < Number(match[1]) - 30 || claims.iat > now + 30 ||
      !Number.isInteger(claims.exp) || claims.exp <= now || !Number.isInteger(claims.auth_time) || claims.auth_time < now - 600 || claims.auth_time > now + 30) {
    fail(403, 'admin_verification_required', 'Google verification is required.');
  }
  const subjects = await googleSubjects(ctx, deps);
  if (!Array.isArray(subjects) || !subjects.includes(claims.sub)) fail(403, 'forbidden', 'Admin access is unavailable.');
  let binding = await ctx.backend.rpc('hp_admin_binding', {});
  if (!binding && bootstrap) binding = await ctx.backend.rpc('hp_admin_bootstrap', { p_user_id: ctx.userId, p_google_subject: claims.sub });
  if (!binding || binding.userId !== ctx.userId || binding.googleSubject !== claims.sub) fail(403, 'forbidden', 'Admin access is unavailable.');
  return claims.sub;
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
module.exports = { challenge, requireAdmin, getConfig, updateConfig, updateBudget };
