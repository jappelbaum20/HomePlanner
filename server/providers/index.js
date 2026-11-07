'use strict';
const openai = require('./openai');
function resolveProvider(config, deps) {
  if (config.adapterId !== 'openai' || config.connectionRef !== 'primary') return null;
  if (deps?.provider) return deps.provider;
  if (!process.env.OPENAI_API_KEY) return null;
  return { generateShelfProposal: args => openai.generateShelfProposal({ ...args, apiKey: process.env.OPENAI_API_KEY }) };
}
module.exports = { resolveProvider };
