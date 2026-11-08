'use strict';
const { validate } = require('../shared/contracts');
const { fail } = require('./errors');

// Verified 2026-11-07. Standard direct API text prices, USD per 1M tokens:
// https://developers.openai.com/api/docs/models/gpt-6-luna
// Cache writes, long-context and the documented 10% regional premium are
// included and rounded upward in the bound below.
// Review and update before the expiration; stale prices disable all calls.
const CATALOG = Object.freeze({
  'gpt-6-luna': Object.freeze({ id: 'gpt-6-luna', label: 'GPT-6 Luna — $0.10 input / $0.50 output per million tokens', contextTokens: 1050000,
    inputHundredthMicros: 28, outputHundredthMicros: 83, validUntil: '2026-12-07T00:00:00Z' }),
  // https://developers.openai.com/api/docs/models/gpt-6-sol: $2 input,
  // $10 output per million; includes 2x long input, 1.25x cache writes,
  // 1.5x long output and 10% regional premium in the upper bound.
  'gpt-6-sol': Object.freeze({ id: 'gpt-6-sol', label: 'GPT-6 Sol — $2.00 input / $10.00 output per million tokens', contextTokens: 1050000,
    inputHundredthMicros: 550, outputHundredthMicros: 1650, validUntil: '2026-12-07T00:00:00Z' })
});
const ADAPTER = 'openai';
const CONNECTION = 'primary';
const MAX_BUDGET_MICROS = 10000000000; // USD 10,000 lifetime maximum
function connectionAvailable(deps) {
  return deps?.connectionAvailable !== undefined ? deps.connectionAvailable : Boolean(process.env.OPENAI_API_KEY);
}
// Set only after a reviewed real-provider validation of this exact model and
// connection. Clear before rotating the connection or changing its scope.
// Explicit injected dependencies are used only by offline tests.
function connectionValidated(modelId, deps) {
  if (deps?.connectionValidated !== undefined) return deps.connectionValidated === true || deps.connectionValidated === modelId;
  if (deps?.connectionAvailable !== undefined) return deps.connectionAvailable === true;
  // Attestations are scoped to a connection version; rotation invalidates all.
  const version = process.env.OPENAI_CONNECTION_VERSION;
  if (!version) return false;
  try {
    const entries = JSON.parse(process.env.OPENAI_VALIDATED_CONNECTIONS || '[]');
    return Array.isArray(entries) && entries.some(e => e.connectionId === CONNECTION && e.version === version && e.modelId === modelId);
  } catch { return false; }
}
function selected(config, deps, now = Date.now()) {
  if (!config || config.enabled !== true || config.adapterId !== ADAPTER || config.connectionRef !== CONNECTION ||
      !Number.isSafeInteger(config.revision) || !Number.isSafeInteger(config.globalBudgetMicros) || config.globalBudgetMicros < 1 || config.globalBudgetMicros > MAX_BUDGET_MICROS ||
      !validate('modelConfig', { enabled: config.enabled, adapterId: config.adapterId, modelId: config.modelId, connectionId: config.connectionRef, limits: config.limits }).valid) return null;
  const model = CATALOG[config.modelId];
  if (!model || now >= Date.parse(model.validUntil) || !connectionAvailable(deps) || !connectionValidated(model.id, deps)) return null;
  return model;
}
function validateUpdate(body, deps) {
  if (!validate('modelConfig', body).valid || body.adapterId !== ADAPTER || !CATALOG[body.modelId] || body.connectionId !== CONNECTION) fail(422, 'invalid_data', 'Unsupported model configuration.');
  if (Date.now() >= Date.parse(CATALOG[body.modelId].validUntil)) fail(503, 'unavailable', 'Model pricing requires review.');
  if (body.enabled && !connectionAvailable(deps)) fail(503, 'unavailable', 'The selected connection is not configured.');
  if (body.enabled && !connectionValidated(body.modelId, deps)) fail(503, 'unavailable', 'The selected model and connection require live validation.');
}
function safeConfig(config, deps) {
  return {
    revision: config.revision,
    config: { enabled: config.enabled, adapterId: config.adapterId || '', modelId: config.modelId || '', connectionId: config.connectionRef === CONNECTION ? CONNECTION : '', limits: config.limits },
    globalBudgetMicros: config.globalBudgetMicros,
    adapters: [{ id: ADAPTER, label: 'OpenAI' }],
    models: Object.values(CATALOG).filter(m => Date.now() < Date.parse(m.validUntil)).map(m => ({ id: m.id, label: m.label, validated: connectionValidated(m.id, deps) })),
    connections: [{ id: CONNECTION, label: 'Primary', configured: connectionAvailable(deps) }],
    validatedModelIds: Object.keys(CATALOG).filter(id => connectionValidated(id, deps)),
    budgetAccounting: 'Conservative token allowance; charges may exceed the provider invoice.'
  };
}
module.exports = { CATALOG, ADAPTER, CONNECTION, MAX_BUDGET_MICROS, connectionAvailable, connectionValidated, selected, validateUpdate, safeConfig };
