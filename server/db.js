'use strict';
const { uuid, fail } = require('./errors');
const RPC = Object.freeze({
  hp_google_subjects: [], hp_access_is_owner: [],
  hp_admin_challenge_issue: ['p_nonce_hash','p_google_subject'],
  hp_admin_verify: ['p_nonce_hash','p_google_subject','p_grant_hash'],
  hp_admin_grant: ['p_grant_hash'],
  hp_model_config_get: [], hp_model_config_update: ['p_actor','p_google_subject','p_revision','p_config'],
  hp_create_design: ['p_user_id','p_key','p_body_hash','p_body'],
  hp_update_design: ['p_user_id','p_id','p_revision','p_body'], hp_delete_design: ['p_user_id','p_id','p_revision'],
  hp_reserve_photo: ['p_user_id','p_design_id','p_mime','p_bytes','p_checksum'],
  hp_begin_photo_completion: ['p_user_id','p_design_id','p_photo_id','p_token'],
  hp_claim_photo_cleanup: ['p_user_id','p_token'],
  hp_usage_replay: ['p_user_id','p_request_id','p_body_hash'],
  hp_reserve_usage: ['p_user_id','p_request_id','p_body_hash','p_config_revision','p_max_cost_micros'],
  hp_finalize_usage: ['p_user_id','p_reservation_id','p_status','p_actual_micros','p_result']
});
function mapDatabaseError(error) {
  const code = String(error?.message || '');
  if (code.includes('HP_ACCESS_SESSION')) fail(401, 'unauthenticated', 'A valid session is required.');
  if (code.includes('HP_ACCESS_PENDING')) fail(403, 'access_pending', 'Access approval is required.');
  if (code.includes('HP_ACCESS_DENIED')) fail(403, 'access_denied', 'Access was not approved.');
  if (code.includes('HP_ACCESS_REVOKED')) fail(403, 'access_revoked', 'Access was revoked.');
  if (code.includes('HP_NOT_FOUND')) fail(404, 'not_found', 'Resource not found.');
  if (code.includes('HP_CONFLICT')) fail(409, 'conflict', 'The design or request has changed.');
  if (code.includes('HP_QUOTA')) fail(429, 'quota', 'The account limit has been reached.', { 'Retry-After': '60' });
  if (code.includes('HP_INVALID')) fail(422, 'invalid_data', 'The request cannot be accepted.');
  fail(503, 'unavailable', 'Service is temporarily unavailable.');
}
function createBackend({ appPool, photoRecovery } = {}) {
  if (!appPool || typeof appPool.connect !== 'function') throw TypeError('A database pool is required');
  function forSession(session) {
    if (!uuid(session?.userId) || !uuid(session?.sessionId) || session.userId !== session.userId.toLowerCase() || session.sessionId !== session.sessionId.toLowerCase()) throw TypeError('Invalid session');
    let grantHash = '';
    async function transaction(action, sessionOnly = false) {
      const client = await appPool.connect();
      let destroy = false;
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_catalog.set_config('hp.user_id',$1,true), pg_catalog.set_config('hp.session_id',$2,true), pg_catalog.set_config('hp.admin_grant_hash',$3,true)", [session.userId, session.sessionId, grantHash]);
        // Takes a row lock through the transaction, fencing concurrent revocation.
        await client.query(sessionOnly ? 'SELECT hp_app.hp_access_assert_session()' : 'SELECT hp_app.hp_access_assert_approved()');
        const result = await action(client);
        await client.query('COMMIT'); return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
        if (error?.status) throw error;
        mapDatabaseError(error);
      } finally { client.release(destroy); }
    }
    function rpcSql(name,args) {
      const fields = RPC[name];
      if (!fields || Object.keys(args).length !== fields.length || fields.some(k => !Object.hasOwn(args,k))) throw TypeError('Unsupported operation');
      for (const key of ['p_user_id','p_actor']) if (Object.hasOwn(args,key) && args[key] !== session.userId) fail(404, 'not_found', 'Resource not found.');
      return { sql: `SELECT hp_app.${name}(${fields.map((_,i)=>'$'+(i+1)).join(',')}) AS result`, values: fields.map(k=>args[k]) };
    }
    async function getIn(client,id) {
      const row=(await client.query('SELECT id,kind,title,schema_version,payload,photo_ids,revision,created_at,updated_at FROM hp_app.designs WHERE id=$1', [id])).rows[0];
      if (!row) return null;
      const photos=(await client.query("SELECT id,mime,bytes,checksum FROM hp_app.design_photos WHERE design_id=$1 AND status='ready' AND tombstoned_at IS NULL AND id=ANY($2::uuid[])",[id,row.photo_ids])).rows;
      if (photos.length !== row.photo_ids.length) fail(503, 'unavailable', 'Design photos are temporarily unavailable.');
      const byId=new Map(photos.map(p=>[p.id,{photoId:p.id,mime:p.mime,bytes:Number(p.bytes),checksum:p.checksum}]));
      return {id:row.id,kind:row.kind,title:row.title,schemaVersion:row.schema_version,payload:row.payload,photoManifest:row.photo_ids.map(id=>byId.get(id)),revision:Number(row.revision),createdAt:row.created_at,updatedAt:row.updated_at};
    }
    const scoped = {
      storageRecoveryAvailable: false,
      async rpc(name,args = {}) {
        const {sql,values} = rpcSql(name,args);
        const sessionOnly = ['hp_google_subjects','hp_admin_challenge_issue','hp_admin_verify','hp_admin_grant'].includes(name);
        const result = await transaction(async client => (await client.query(sql, values)).rows[0]?.result ?? null, sessionOnly);
        if (name === 'hp_admin_grant') grantHash = typeof result === 'string' ? args.p_grant_hash : '';
        return result;
      },
      // C performs bounded local filesystem work inside this callback only.
      // No client or arbitrary SQL is exposed. Publication/removal receipts
      // commit with the same design/photo row locks or roll back together.
      async withPhotoLock(designId, photoId, operation, token, work) {
        if (!uuid(designId) || !uuid(photoId) || !['raw','ready','cleanup'].includes(operation) || (token !== null && !uuid(token)) || typeof work !== 'function') throw TypeError('Invalid photo lock');
        return transaction(async client => {
          const snapshot = (await client.query('SELECT hp_app.hp_photo_lock($1,$2,$3,$4) AS result', [designId,photoId,operation,token])).rows[0].result;
          let active = true;
          const check = expected => { if (!active || operation !== expected) throw Error('Invalid photo operation'); };
          const locked = Object.freeze({
            snapshot,
            async recordPublication(bytes, checksum) {
              if (!active || !['raw','ready'].includes(operation)) throw Error('Invalid photo operation');
              return (await client.query('SELECT hp_app.hp_photo_record_publication($1,$2,$3,$4,$5,$6) AS result',[designId,photoId,operation,token,bytes,checksum])).rows[0].result;
            },
            async finishReady(bytes, checksum) {
              check('ready'); return (await client.query('SELECT hp_app.hp_finish_photo_completion($1,$2,$3,$4,$5,$6,$7) AS result',[session.userId,designId,photoId,token,snapshot.readyKey,bytes,checksum])).rows[0].result;
            },
            async recordRemoval(part) {
              check('cleanup'); if (!['raw','ready'].includes(part)) throw TypeError('Invalid part');
              return (await client.query('SELECT hp_app.hp_record_photo_removal($1,$2,$3,$4) AS result',[session.userId,photoId,token,part])).rows[0].result;
            },
            async finishCleanup() {
              check('cleanup'); return (await client.query('SELECT hp_app.hp_finish_photo_cleanup($1,$2,$3) AS result',[session.userId,photoId,token])).rows[0].result;
            }
          });
          try { return await work(locked); } finally { active = false; }
        });
      },
      async googleSubjects() { return this.rpc('hp_google_subjects', {}); },
      async withApproved(work) {
        if (typeof work !== 'function') throw TypeError('Invalid protected operation');
        return transaction(async client => {
          let active = true;
          const locked = Object.freeze({
            async rpc(name,args={}) { if (!active) throw Error('Inactive protected operation'); const {sql,values}=rpcSql(name,args); return (await client.query(sql,values)).rows[0]?.result ?? null; },
            async get(_ctx,id) { if (!active) throw Error('Inactive protected operation'); return getIn(client,id); }
          });
          try { return await work(locked); } finally { active = false; }
        });
      },
      async withPhotoRead(designId,photoId,work) {
        if (!uuid(designId) || !uuid(photoId) || typeof work !== 'function') throw TypeError('Invalid photo read');
        return transaction(async client => {
          const photo=(await client.query('SELECT * FROM hp_app.design_photos WHERE design_id=$1 AND id=$2 AND tombstoned_at IS NULL',[designId,photoId])).rows[0] || null;
          return work(photo);
        });
      },
      async list(_ctx, cursor, limit) {
        return transaction(async client => {
          const r = await client.query('SELECT id,kind,title,revision,updated_at FROM hp_app.designs WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2', [cursor,limit+1]);
          const rows=r.rows; return { items: rows.slice(0,limit).map(x=>({ id:x.id,kind:x.kind,title:x.title,revision:Number(x.revision),updatedAt:x.updated_at })),nextCursor: rows.length>limit ? rows[limit-1].id : null };
        });
      },
      async get(_ctx, id) {
        return transaction(client => getIn(client,id));
      },
      async photo(_ctx, designId, photoId) {
        return transaction(async client => (await client.query('SELECT * FROM hp_app.design_photos WHERE design_id=$1 AND id=$2 AND tombstoned_at IS NULL', [designId,photoId])).rows[0] || null);
      }
    };
    scoped.recoverStorage = () => {
      if (typeof photoRecovery !== 'function') fail(503, 'unavailable', 'Photo recovery is unavailable.');
      return photoRecovery({ session: { ...session }, backend: scoped });
    };
    return scoped;
  }
  return { forSession };
}
// This pool is a separate login with only hp_photo_maintenance membership.
// It deliberately exposes no client, generic RPC, user data, or actor setting.
function createPhotoMaintenanceBackend({ maintenancePool } = {}) {
  if (!maintenancePool || typeof maintenancePool.connect !== 'function') throw TypeError('A maintenance pool is required');
  const valid = value => uuid(value) && value === value.toLowerCase();
  async function transaction(work) {
    const client=await maintenancePool.connect(); let destroy=false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result=await work(client); await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { destroy=true; }
      throw error;
    } finally { client.release(destroy); }
  }
  return Object.freeze({
    async verifyRole() {
      return transaction(async client => {
        const r=await client.query(`SELECT NOT r.rolsuper AND NOT r.rolbypassrls
          AND pg_catalog.pg_has_role(current_user,'hp_photo_maintenance','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_app_runtime','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_runtime','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_app_owner','MEMBER')
          AND NOT pg_catalog.pg_has_role(current_user,'hp_auth_owner','MEMBER')
          AND NOT pg_catalog.has_table_privilege(current_user,'hp_app.design_photos','SELECT,INSERT,UPDATE,DELETE')
          AND NOT pg_catalog.has_table_privilege(current_user,'hp_app.designs','SELECT,INSERT,UPDATE,DELETE') AS ok
          FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`);
        if (r.rows[0]?.ok !== true) throw Error('Invalid maintenance database role');
      });
    },
    async owners(after, limit) {
      if ((after !== null && !valid(after)) || !Number.isInteger(limit) || limit<1 || limit>32) throw TypeError('Invalid owner page');
      return transaction(async c => (await c.query('SELECT owner_id FROM hp_app.hp_maintenance_owners($1,$2)',[after,limit])).rows.map(r=>r.owner_id));
    },
    async claim(owner, token) {
      if (![owner,token].every(valid)) throw TypeError('Invalid cleanup claim');
      return transaction(async c => (await c.query('SELECT hp_app.hp_maintenance_claim($1,$2) AS result',[owner,token])).rows[0].result);
    },
    async withCleanup(owner,design,photo,token,work) {
      if (![owner,design,photo,token].every(valid) || typeof work !== 'function') throw TypeError('Invalid cleanup lock');
      return transaction(async c => {
        const snapshot=(await c.query('SELECT hp_app.hp_maintenance_lock($1,$2,$3,$4) AS result',[owner,design,token,photo])).rows[0].result;
        let active=true;
        const locked=Object.freeze({ snapshot,
          async recordRemoval(part) {
            if (!active || !['raw','ready'].includes(part)) throw TypeError('Invalid cleanup receipt');
            return (await c.query('SELECT hp_app.hp_maintenance_record_removal($1,$2,$3,$4) AS result',[owner,photo,token,part])).rows[0].result;
          },
          async finishCleanup() {
            if (!active) throw Error('Inactive cleanup lock');
            return (await c.query('SELECT hp_app.hp_maintenance_finish_cleanup($1,$2,$3) AS result',[owner,photo,token])).rows[0].result;
          }
        });
        try { return await work(locked); } finally { active=false; }
      });
    },
    async withClassification(candidate,work) {
      const {owner,design,photo,area}=candidate || {};
      if (![owner,design,photo].every(valid) || !['objects','staging'].includes(area) || typeof work!=='function') throw TypeError('Invalid classification');
      return transaction(async c => {
        const allowed=(await c.query('SELECT hp_app.hp_maintenance_classify($1,$2,$3,$4) AS allowed',[owner,design,photo,area])).rows[0].allowed;
        return allowed === true ? work() : false;
      });
    }
  });
}
// Compatibility helper for the pre-migration injected storage fixtures. The
// self-hosted backend never supplies a bucket and does not call this helper.
async function removeVerified(bucket, key) {
  const missing = error => Number(error?.statusCode ?? error?.status) === 404 && (error?.code === undefined || ['NoSuchKey','not_found','ObjectNotFound'].includes(error?.code));
  const removed = await bucket.remove([key]);
  if (removed.error && !missing(removed.error)) throw new Error('Storage removal failed');
  const present = await bucket.exists(key);
  if (present.error ? !missing(present.error) : present.data !== false) throw new Error('Storage absence not confirmed');
}
module.exports = { createBackend, createPhotoMaintenanceBackend, mapDatabaseError, removeVerified };
