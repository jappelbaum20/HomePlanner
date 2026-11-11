'use strict';
const { createHash, randomUUID } = require('node:crypto');
const canonical = require('../shared/canonical');
const { validate } = require('../shared/contracts');
const { authenticate } = require('./auth');
const { fail, jsonBody, wrap, method } = require('./errors');
const { selected } = require('./model-config');
const { inputTokenBound } = require('./providers/openai');
const { maxCost, actualCost } = require('./limits');
const { resolveProvider } = require('./providers');
const hash = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');

function matchingShelf(design, body) {
  if (!design || design.revision !== body.baseRevision) return false;
  if (design.kind === 'shelf') return body.shelfId === undefined && hash(design.payload.version === 2 ? design.payload.shelf : design.payload) === body.baseHash;
  if (design.kind !== 'home' || !Array.isArray(design.payload?.catalog)) return false;
  const candidates = design.payload.catalog.filter(p => p.shelfDesign && (body.shelfId === undefined || p.id === body.shelfId));
  // An omitted id is accepted only when the hash uniquely identifies a shelf.
  return candidates.filter(p => hash(p.shelfDesign) === body.baseHash).length === 1;
}
function safeCandidate(candidate, original) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || Object.keys(candidate).sort().join(',') !== 'shelf,summary' ||
      typeof candidate.summary !== 'string' || candidate.summary.length > 4000 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:\/\/|www\.|javascript:|```/i.test(candidate.summary) ||
      candidate.shelf?.template !== original.template) return false;
  return validate('shelf', candidate.shelf).valid;
}
function sendOutcome(outcome) {
  if (outcome?.kind === 'ok' && validate('proposal', outcome.proposal).valid) return { body: outcome.proposal };
  if (outcome?.kind === 'stale') fail(409, 'stale_design', 'The design changed while the proposal was generated.');
  fail(502, 'invalid_proposal', 'A valid proposal could not be generated.');
}
function createHandler(deps) { return wrap(async req => {
  method(req, ['POST']); const ctx = await authenticate(req, deps);
  const body = jsonBody(req, 65536);
  if (!validate('proposalRequest', body).valid) fail(422, 'invalid_data', 'Invalid proposal request.');
  if (req.headers['idempotency-key'] && req.headers['idempotency-key'].toLowerCase() !== body.requestId.toLowerCase()) fail(409, 'conflict', 'The request identifier does not match.');
  let bodyHash;
  try { if (hash(body.shelf) !== body.baseHash) fail(409, 'stale_shelf', 'The shelf has changed.'); bodyHash = hash(body); }
  catch (err) { if (err.status) throw err; fail(422, 'invalid_data', 'Invalid proposal request.'); }
  const replay = await ctx.backend.rpc('hp_usage_replay', { p_user_id: ctx.userId, p_request_id: body.requestId.toLowerCase(), p_body_hash: bodyHash });
  if (replay) {
    if (replay.status === 'succeeded') return sendOutcome(replay.result);
    fail(409, 'request_pending', 'This request cannot be retried automatically.');
  }
  const design = await ctx.backend.get(ctx, body.designId);
  if (!design) fail(404, 'not_found', 'Resource not found.');
  if (!matchingShelf(design, body)) fail(409, 'stale_design', 'Save the current shelf before requesting a proposal.');
  const config = await ctx.backend.rpc('hp_model_config_get', {}), model = selected(config, deps);
  const provider = config && resolveProvider(config, deps);
  if (!model || !provider) fail(503, 'unavailable', 'Proposals are not configured.');
  let inputBound;
  try { inputBound = inputTokenBound({ model: model.id, shelf: body.shelf, prompt: body.prompt, maxOutputTokens: config.limits.maxOutputTokens }); }
  catch { fail(413, 'too_large', 'The provider request is too large.'); }
  const reserved = maxCost(model, config.limits.maxOutputTokens, inputBound);
  // Commit the reservation before dispatch so an interrupted provider call can
  // never lose its durable accounting record or be retried automatically.
  const reservation = await ctx.backend.rpc('hp_reserve_usage', { p_user_id: ctx.userId, p_request_id: body.requestId.toLowerCase(), p_body_hash: bodyHash, p_config_revision: config.revision, p_max_cost_micros: reserved });
  if (!reservation || !reservation.reservationId) fail(503, 'unavailable', 'Proposals are temporarily unavailable.');
  if (reservation.replay) {
    if (reservation.status === 'succeeded') return sendOutcome(reservation.result);
    fail(409, 'request_pending', 'This request cannot be retried automatically.');
  }
  // The reservation above is already durable. The provider call (up to 25 s) runs OUTSIDE any
  // database transaction: approval is re-checked in one short transaction before dispatch and the
  // outcome is settled in a second short transaction afterwards, so no pooled connection or
  // session/entitlement row lock is held while waiting for the provider.
  const protectedRun = work => typeof ctx.backend.withApproved === 'function' ? ctx.backend.withApproved(work) : work(ctx.backend);
  const finishWith = (backend, status, cost, result) => backend.rpc('hp_finalize_usage', { p_user_id: ctx.userId, p_reservation_id: reservation.reservationId, p_status: status, p_actual_micros: cost, p_result: result });
  // Settle in one short protected transaction. If it cannot commit (for example access was revoked
  // meanwhile, so the actor check rejects finalization too), try once to record the call as
  // ambiguous and rethrow; an unsettled reservation stays 'reserved' and is never retried.
  async function settle(status, cost, buildResult) {
    try { return await protectedRun(async backend => finishWith(backend, status, cost, buildResult ? await buildResult(backend) : null)); }
    catch (error) {
      if (status === 'succeeded') await finishWith(ctx.backend, 'ambiguous', null, null).catch(() => {});
      throw error;
    }
  }
  await protectedRun(async () => true); // Denial here means dispatch never starts.
  let answer;
  try { answer = await provider.generateShelfProposal({ model: model.id, shelf: body.shelf, prompt: body.prompt, maxOutputTokens: config.limits.maxOutputTokens }); }
  catch { await settle('ambiguous', null, null); return fail(503, 'provider_unavailable', 'The proposal request could not be completed.'); }
  const cost = actualCost(model, answer?.usage, config.limits.maxOutputTokens);
  if (cost === null || cost > reserved) { await settle('ambiguous', null, null); fail(503, 'provider_unavailable', 'The proposal request could not be completed.'); }
  const finalized = await settle('succeeded', cost, async backend => {
    let outcome = { kind: 'invalid' };
    const latest = await backend.get(ctx, body.designId);
    if (!matchingShelf(latest, body)) outcome = { kind: 'stale' };
    else if (safeCandidate(answer.candidate, body.shelf)) {
      const proposal = { proposalId: randomUUID(), baseRevision: body.baseRevision, baseHash: body.baseHash, shelf: answer.candidate.shelf,
        summary: answer.candidate.summary, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
      if (validate('proposal', proposal).valid && Buffer.byteLength(JSON.stringify({ kind: 'ok', proposal })) < 64000) outcome = { kind: 'ok', proposal };
    }
    return outcome;
  });
  return sendOutcome(finalized?.result);
}, deps); }
module.exports = { createHandler, hash, matchingShelf, safeCandidate };
