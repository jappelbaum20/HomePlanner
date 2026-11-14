// Recorded migrations must never change: the live ledger stores the hash of each applied file and both the
// maintenance job and the readiness check compare against it. 001-003 are recorded by their exact bytes (they
// contain a few CRLF line ends and are marked -text in .gitattributes). 004-008 are LF in the repository; a
// CRLF checkout of them is tolerated here because the image is always built from a Linux checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const { FILES, ADDITIVE } = createRequire(import.meta.url)('../db/migrate.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const RECORDED = {
  '001_auth.sql': '2b5b9ab15545961c42938962b3f6ddc5980b411e298e44ebcb7dedef82c0f6c4',
  '002_business.sql': 'f6417711e9ee60b5a8574daf4de422a6168d377be1f70e2a2b21e5b08adb3aa1',
  '003_photos.sql': '3d027436c014e479b8d7de686bedf6a46fb4cee0e1137f28c7ffea2c1d589da1',
  '004_photo_maintenance.sql': '85bc15279646e2e49007e71ef43776086f0d00d1db056bf50393a0f2b7081ed4',
  '005_shelf_documents.sql': '8c76b15aeb6a646e1bc2efb26652078292e5f05d764d46ac7fdfb799c08dd148',
  '006_access_requests.sql': '06466a7b425465ac733dc3cec6bfb134a5bf348dc005d745e72efddcdeb93bb0',
  '007_verified_signin.sql': '232db980ccaf852a535a6a8ed4af76f95b48f1db324f1858057a521ef5d161c3',
  '008_add_person.sql': '00b3944d3d548f3095c38f42f65bc547a0e048f92b341ff2c6265169922bd47f'
};
const EXACT = new Set(['001_auth.sql', '002_business.sql', '003_photos.sql']);

test('every migration the runtime knows has a recorded hash, and nothing else is recorded', () => {
  assert.deepEqual([...FILES, ...ADDITIVE].sort(), Object.keys(RECORDED).sort());
});

for (const [name, want] of Object.entries(RECORDED)) {
  test(`${name} still has its recorded bytes`, () => {
    const bytes = readFileSync(path.join(dir, name));
    const got = EXACT.has(name) ? sha(bytes) : sha(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
    assert.equal(got, want, `${name} changed; a recorded migration must not be edited, add a new one instead`);
  });
}

test('001-003 are protected from line-end conversion', () => {
  const attrs = readFileSync(path.join(dir, '..', '..', '.gitattributes'), 'utf8');
  for (const name of EXACT) assert.match(attrs, new RegExp(`^db/migrations/${name.replace('.', '\.')} -text$`, 'm'));
});
