'use strict';
const { fail } = require('./errors');
function maxCost(model, maxOutputTokens, inputTokens) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 1 || inputTokens > 69632 || !model || !Number.isSafeInteger(model.contextTokens) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) fail(503, 'unavailable', 'Budget estimate is unavailable.');
  return Math.ceil((inputTokens * model.inputHundredthMicros + maxOutputTokens * model.outputHundredthMicros) / 100);
}
function actualCost(model, usage, maxOutputTokens) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 1 || usage.input_tokens > model.contextTokens ||
      !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0 || usage.output_tokens > maxOutputTokens ||
      usage.input_tokens + usage.output_tokens > model.contextTokens) return null;
  return Math.ceil((usage.input_tokens * model.inputHundredthMicros + usage.output_tokens * model.outputHundredthMicros) / 100);
}
module.exports = { maxCost, actualCost };
