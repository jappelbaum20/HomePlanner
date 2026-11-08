// RFC 8785 JSON Canonicalization Scheme, shared between browser and Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomePlannerCanonicalize = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function string(value) {
    // I-JSON forbids unpaired UTF-16 surrogates, including in property names.
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Invalid Unicode');
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new TypeError('Invalid Unicode');
    }
    return JSON.stringify(value);
  }
  function canonicalize(value) {
    const seen = new Set();
    function encode(v) {
      if (v === null) return 'null';
      if (typeof v === 'string') return string(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw new TypeError('Invalid number');
        return JSON.stringify(v);
      }
      if (typeof v !== 'object' || seen.has(v)) throw new TypeError('Invalid JSON value');
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new TypeError('Invalid JSON object');
      seen.add(v);
      let result;
      if (Array.isArray(v)) {
        result = '[' + Array.from({ length: v.length }, (_, i) => {
          if (!Object.hasOwn(v, i)) throw new TypeError('Sparse array');
          return encode(v[i]);
        }).join(',') + ']';
      } else {
        result = '{' + Object.keys(v).sort().map(k => string(k) + ':' + encode(v[k])).join(',') + '}';
      }
      seen.delete(v);
      return result;
    }
    return encode(value);
  }
  return canonicalize;
});
