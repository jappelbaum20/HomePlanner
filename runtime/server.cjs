'use strict';
const { createRuntime } = require('./router.cjs');
const { createComposition } = require('./composition.cjs');
const { createStorageSafety } = require('./storage-safety.cjs');

async function main() {
  const port = Number(process.env.PORT || 3107);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  const enabled = process.env.HOMEPLANNER_ENABLE_RUNTIME || '0';
  if (!['0', '1'].includes(enabled)) throw Error('Invalid runtime mode');
  const integrations = enabled === '1' ? await createComposition({ safety: createStorageSafety() }) : {};
  const runtime = createRuntime({ integrations, dist: process.env.HOMEPLANNER_DIST || 'dist-vps' });
  runtime.server.listen(port, '0.0.0.0', () => console.log('HomePlanner listening.'));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (stopping) return; stopping = true;
    runtime.stop().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
}
if (require.main === module) main().catch(() => { console.error('HomePlanner startup unavailable.'); process.exitCode = 1; });
module.exports = { main };
