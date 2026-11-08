'use strict';
const { createPhotoMaintenance } = require('../server/photo-maintenance.cjs');

function createStorageSafety(makeMaintenance = createPhotoMaintenance) {
  return {
    async start({ maintenancePool, store, exclusiveWriter }) {
      const maintenance = makeMaintenance({ maintenancePool, store, exclusiveWriter });
      try { await maintenance.start(); }
      catch (error) { await maintenance.stop(); throw error; }
      return { maintenanceReady: () => maintenance.ready(), close: () => maintenance.stop() };
    }
  };
}
module.exports = { createStorageSafety };
