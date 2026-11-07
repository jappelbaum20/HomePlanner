// Shared versioned contracts. Validation is non-mutating and never normalizes input.
(function (root, make) {
  if (typeof module === 'object' && module.exports) {
    const Ajv = require('ajv');
    const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, strictTypes: false, strictNumbers: true });
    for (const schema of [require('./schema/shelf-v1.json'), require('./schema/home-v2.json'), require('./schema/api-v3.json')]) ajv.addSchema(schema);
    const base = 'https://schemas.homeplanner.invalid/';
    const validators = {};
    for (const [name, schema] of Object.entries({
      shelf: 'shelf-v1', home: 'home-v2', writeDesign: 'api-v3#/definitions/writeDesign',
      local: 'api-v3#/definitions/local', proposalRequest: 'api-v3#/definitions/proposalRequest',
      proposal: 'api-v3#/definitions/proposal', photoRequest: 'api-v3#/definitions/photoRequest',
      modelConfig: 'api-v3#/definitions/modelConfig', error: 'api-v3#/definitions/error'
    })) validators[name] = ajv.getSchema(base + schema);
    module.exports = make(validators, require('../bookshelf.js'));
  } else {
    root.HomePlannerContracts = make(root.HomePlannerSchemaValidators, root.Bookshelf);
  }
})(typeof window === 'undefined' ? globalThis : window, function (validators, geometry) {
  'use strict';
  if (!validators || !geometry) throw new Error('Load schema validators and bookshelf geometry first');
  const LIMITS = Object.freeze({ payloadBytes: 1048576, proposalBytes: 65536, maxBoards: 800, maxPhotos: 100,
    photoBytes: 10485760, promptCharacters: 2000, proposalTimeoutMs: 25000, maxOutputTokens: 4000 });
  const legacyBounds = 'Use width 20–1000 cm, height 20–800 cm, depth 10–100 cm and board thickness 0.9–6 cm.';
  function bytes(value) {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new Error('Not JSON');
    return new TextEncoder().encode(json).byteLength;
  }
  function shelfErrors(shelf) {
    const errors = geometry.validate(shelf).errors.filter(message => message !== legacyBounds);
    if (shelf.levels.at(-1).dividers.length) errors.push('The top shelf cannot have dividers above it.');
    if (shelf.levels.some(level => level.right <= level.left)) errors.push('Shelf spans must be positive.');
    if (geometry.boards(shelf).length > LIMITS.maxBoards) errors.push('Too many boards.');
    return errors;
  }
  function homeShelfErrors(home) {
    const found = [];
    for (const piece of home.catalog) if (piece.shelfDesign) found.push(piece.shelfDesign);
    for (const room of home.rooms) for (const item of room.items) if (item.shelfDesign) found.push(item.shelfDesign);
    if (home.bookshelfDraft) {
      found.push(home.bookshelfDraft.design);
      if (home.bookshelfDraft.alternate) found.push(home.bookshelfDraft.alternate.design);
    }
    return found.flatMap(shelfErrors);
  }
  function validate(name, value) {
    const fn = validators[name];
    if (!fn) throw new Error('Unknown contract: ' + name);
    let size;
    try { size = bytes(value); } catch (_) { return { valid: false, errors: ['Input must be JSON serializable.'] }; }
    const errors = [];
    if (['proposalRequest', 'proposal'].includes(name) && size > LIMITS.proposalBytes) errors.push('Proposal body exceeds 64 KiB.');
    if (!fn(value)) {
      for (const error of fn.errors || []) errors.push((error.instancePath || '/') + ': ' + error.keyword);
      return { valid: false, errors };
    }
    if (['home', 'shelf'].includes(name) && size > LIMITS.payloadBytes) errors.push('Design payload exceeds 1 MiB.');
    if (name === 'shelf') errors.push(...shelfErrors(value));
    if (name === 'home') errors.push(...homeShelfErrors(value));
    if (['local', 'writeDesign'].includes(name)) {
      if (bytes(value.payload) > LIMITS.payloadBytes) errors.push('Design payload exceeds 1 MiB.');
      errors.push(...(value.kind === 'shelf' ? shelfErrors(value.payload) : homeShelfErrors(value.payload)));
      const ids = (name === 'local' ? value.photoManifest.map(p => p.photoId) : value.photoIds).map(id => id.toLowerCase());
      const allowed = new Set(ids), referenced = new Set();
      if (allowed.size !== ids.length) errors.push('Duplicate photo IDs are not allowed.');
      if (value.kind === 'home') {
        for (const holder of [...value.payload.rooms, ...value.payload.catalog]) {
          holder.photos.forEach(id => referenced.add(id.toLowerCase()));
          if (holder.photos.some(id => !allowed.has(id.toLowerCase()))) errors.push('A photo reference is missing from the manifest.');
        }
        for (const room of value.payload.rooms) {
          const photos = new Set(room.photos.map(id => id.toLowerCase()));
          if (Object.keys(room.photoLabels).some(id => !photos.has(id.toLowerCase()))) errors.push('A photo label has no room photo.');
        }
        const objects = [...value.payload.catalog, ...value.payload.rooms.flatMap(room => room.items)];
        objects.forEach(item => { if (item.image) referenced.add(item.image.toLowerCase()); });
        if (objects.some(item => item.image && !allowed.has(item.image.toLowerCase()))) errors.push('An image reference is missing from the manifest.');
      }
      if (ids.some(id => !referenced.has(id))) errors.push('Unreferenced photo IDs are not allowed.');
    }
    if (['proposalRequest', 'proposal'].includes(name)) errors.push(...shelfErrors(value.shelf));
    return { valid: errors.length === 0, errors: [...new Set(errors)] };
  }
  return Object.freeze({ SCHEMA_VERSION: 3, LIMITS, validate });
});
