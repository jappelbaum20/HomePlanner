'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const canonical = require('../shared/canonical');

test('RFC 8785 examples match in browser and CommonJS', () => {
  const sandbox = { window: {} }; vm.runInNewContext(fs.readFileSync(require.resolve('../shared/canonical'), 'utf8'), sandbox);
  const sample = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000f\\nA\'B\\\"\\\\\\\"/","literals":[null,true,false]}');
  const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}';
  assert.equal(canonical(sample), expected);
  sandbox.json = JSON.stringify(sample);
  assert.equal(vm.runInNewContext('window.HomePlannerCanonicalize(JSON.parse(json))', sandbox), expected);
  const order = { '\u20ac': 1, '\r': 2, '\ufb33': 3, '1': 4, '😀': 5, '\u0080': 6, 'ö': 7 };
  assert.equal(canonical(order), '{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"😀":5,"דּ":3}');
  for (const invalid of [NaN, Infinity, undefined, '\ud800', { '\udc00': 1 }, [undefined], Array(1)]) assert.throws(() => canonical(invalid));
});
