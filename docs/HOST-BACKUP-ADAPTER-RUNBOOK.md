# Stage 1 host backup adapter: review and recovery

This candidate binds the existing cold-capture producer to the observed Stage 1 host. It does not authorize installation, scheduling, backup, recovery or a Stage 2 rollout. The fixed image and Compose hashes deliberately reject a changed deployment. Rebind and re-review after any deployment or configuration change, including migration 006. The hosting owner retains the existing shared runner, its final component receipt and monitoring of the actual systemd result and freshness. Nothing here creates a second runner or timer.

## Binding and delivery gate

The future hosting runner would invoke exactly the following as UID 1000, with one freshly generated lowercase 32-hex nonce and while **it** retains its existing shared `run.lock`:

```text
/usr/bin/python3 -I -B /srv/homeplanner/backup-adapter/host-backup-adapter.py <nonce>
```

The fixed child is `/usr/bin/bash --noprofile --norc /srv/homeplanner/backup-adapter/backup.sh`. The producer's sole special host mode selects project `homeplanner`, `--env-file /dev/null`, and the three absolute Compose files pinned in the adapter. It calls `stop` and `start` on the existing web service, never `up` or `recreate`. The ingress network observed on web was attached separately, not through those three files; the adapter checks that the existing container has the three expected networks. The existing provider overlay and private overlay remain in every Compose call. The producer takes the distinct operations and photo locks; it never takes the shared `run.lock`.

Before proposing activation, the owner must independently review and deliver these concrete inputs and compare the merged real configuration, without exposing environment or credential values:

1. Install the five pinned source files in `/srv/homeplanner/backup-adapter/` with protected, non-symlink ancestors and root/UID 1000 ownership, no group/other write, and verify their exact bytes and hashes in `host-backup-adapter.py`. Include the validator and publication module in the same directory. Pin the adapter itself and the health adapter in the hosting change as well. An installation is a separate host change, not performed here.
2. Supply `/srv/homeplanner/config/backup-adapter.json`, UID 1000, regular single-link mode `0600`, containing only the following **non-secret** data. The provider registry is a JSON list encoded as a JSON string, copied from the approved non-secret active configuration. The recipient is the reviewed full uppercase encryption public-key fingerprint, not a password or private key. Do not put key material, database URLs, tokens or passwords here.

   ```json
   {
     "google_client_id": "REPLACE.apps.googleusercontent.com",
     "provider_connection_version": "REPLACE",
     "provider_validated_connections": "[]",
     "backup_recipient_fingerprint": "REPLACE_WITH_FULL_UPPERCASE_FINGERPRINT"
   }
   ```

   The example intentionally fails validation until replaced. Confirm the registry and connection version match the deployed configuration; `[]` is illustrative, not permission to discard existing validations. The adapter constructs an allowlisted environment and fixed secret **paths**, never reads secret contents, and does not source this file as shell code. `HOMEPLANNER_ENABLE_RUNTIME` is fixed to `1`; image selection remains in the pinned Compose files. It discards inherited `DOCKER_HOST`, `COMPOSE_FILE`, `BASH_ENV` and other ambient variables.
3. Provide the existing private `/srv/homeplanner/config/backup-gnupg` and `/srv/homeplanner/config/backup-docker-config` directories, each UID 1000 mode `0700`, with protected ancestors. The former must contain the approved public encryption recipient and the latter must be reviewed so the Docker CLI uses the local daemon and approved system Compose plugin; avoid inherited credential helpers, custom endpoints or plugins. Independent recovery key/configuration escrow is a separate workstream; do not place a private decryption key here merely to make capture work.
4. Provide `/srv/backups/consistent-data/homeplanner`, UID 1000 mode `0700`, on the intended filesystem with root- or UID-1000-owned, non-symlink ancestors and no group/other write. Both `HOMEPLANNER_BACKUP_ROOT` and `HOMEPLANNER_PUBLISH_ROOT` are fixed to that directory. Verify real filesystem rename/fsync behavior, free capacity above the existing 20 GiB floor plus expected capture needs, role and lock access, and GPG encryption under UID 1000. This directory was absent at observation time; no directory was created by this work.
5. Privately render and review the real merged configuration with `--env-file /dev/null` and all three pinned files. Compare all services, image IDs, provider mounts and registry, database/photo mounts, network membership, ingress alias, resource limits and secret *paths* against the running containers. Resolve any private input without showing its value. Placeholder-only rendering proved the four service names, not equivalence to the deployed effective configuration. Verify the existing web container really retains the dedicated ingress and alias through stop/start. Confirm photo-read can run with the exact deployed mounts and the operations lock is the same inode used by other maintenance. Do not replace the active configuration with the repository example.
6. Review the 001–005 ledger **hashes**, login flags, quiescence/fence contract, all privileged writers and lock order immediately before a separately authorized run. `backup.sh` checks ledger names, not migration bytes. A 006 rollout needs a new binding, appropriate new roles and mounts, and its own independently reviewed recovery plan. Never provision missing Stage 2 roles merely to make this Stage 1 capture work.

The capture preflight refuses missing or changed pinned files, missing parent/config directories, unsafe path modes, missing expected Compose services, or failed pre-capture health. It does not prove real configuration equivalence, exclusive access by uncooperative privileged writers, future host durability, an offsite backup, or restore success.

## Runner interface and limits

Record invocation start before launching. Capture the producer's **complete stdout** in a private owner-only regular single-link log and retain the actual exit status. Validate only after the child exits under UID 1000 and while the outer shared lock remains held:

```text
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/jacob LC_ALL=C /usr/bin/python3 -B /srv/homeplanner/backup-adapter/validate-backup.py --parent /srv/backups/consistent-data/homeplanner --nonce <same-nonce> --not-before <invocation-start-epoch> --max-age <reviewed-seconds> --process-status <actual-exit> --receipt-log <private-log-path>
```

The validator imports its pinned sibling module, so its clean-environment command intentionally does not use Python `-I`, which removes the script directory from the import path. The validator emits exactly five absolute file paths on success and no paths on failure. The runner must pass those five individual paths to its reviewed HomePlanner restic operation, preserve all Energy sources/exclusions, independently attempt the existing Energy backup/check on HomePlanner failure, and record component results separately. No old capture or synthesized receipt can satisfy this run. Validate and monitor the component receipt **and** actual systemd exit/freshness; a late signal, lock contention, stale result or an old success is not green. Snapshot inclusion, offsite verification and isolated restore remain independent gates.

Capture has a provisional 120-second deadline plus 30-second TERM grace; these are not measured service objectives. On timeout, the adapter sends TERM to its child process group, then KILL at grace expiry; it returns `124` even if a receipt appeared. TERM, INT or HUP returns `128 + signal` even if the child exited zero. Unexpected surviving same-group descendants are terminated and make the result fail. These limits cover the local process group only: a process that escapes the group, a Docker daemon-managed `exec`/`run`, a database operation, uninterruptible kernel I/O, power loss or systemd cgroup termination cannot be proved stopped by this adapter. The hosting runner must retain control until the unit/cgroup and applicable Docker work have actually settled before releasing the shared lock or allowing another run. Establish practical timings and test this with isolated nonempty fixtures before activation. No timeout or signal triggers an automatic unfence, restart, mail delivery or model enablement. Fences may remain, or logins may already be restored while web remains stopped.

After the capture child has exited, hosting separately invokes the fixed health command and uses its exit status and fresh timestamp:

```text
/usr/bin/python3 -I -B /srv/homeplanner/backup-adapter/host-health-adapter.py
```

Within a 15-second total deadline it checks exact Stage 1 web image, running and Docker health, exact database image/running/health, the three web networks and ingress alias, a fresh HTTP 200 from `/health/ready` inside the web container, and unchanged identities/start/restart state across the probe. It emits `HOMEPLANNER_HEALTH_V1 <epoch> OK` only for success, or `FAIL` and nonzero for a checked failure. The response body is consumed without logging. This Stage 1 endpoint checks configured session/auth and route handlers, database role and migration verification, initialized photo storage, writer lock, recent successful maintenance and free-space reserve. It does not independently prove public TLS, provider generation, access-request or mail delivery, business acceptance, or all future writes. Startup/running and external TLS alone are not readiness.

## Failure and manual recovery

Keep the outer run result failed and alert the operator. Do not retry capture blindly, alter queues, remove captures, change the reserve, or automatically enable any role, mail or model function. Record timestamps and preserve the private stdout/stderr, actual child status, runner component receipt and systemd result. The operator should:

1. Confirm whether the shared job and its systemd cgroup are still active, and whether any producer, Compose client, photo-read container or database operation from the run is still executing. Check `systemctl --user show personal-backup.service` for actual result/exit properties and inspect the relevant private journal/logs; redact values before sharing. Do not treat an old `last-success` or a `COMPLETE` line as this run's success.
2. Inspect the actual `homeplanner-web-1` and `homeplanner-db-1` image IDs, running/health state and web network membership with targeted `docker inspect` fields; do not dump `.Config.Env`. Use the bounded health adapter once processes have settled. Check the operations and writer locks as the responsible owner without truncating, replacing or deleting lock files. Confirm the outer shared lock is released only after the runner and all its work have settled. Avoid acquiring locks in the reverse order.
3. Using authorized read-only database access, inspect only the ordered `hp_migration.applied` names and SHA-256 values, and `pg_roles.rolcanlogin` for `hp_auth_login`, `hp_app_login`, `hp_photo_maintenance_login`, `hp_access_public_login`, and `hp_mail_worker_login`. Check client-session counts by role/database without inspecting application rows. Compare with the pre-run ledger and role inventory; Stage 1 normally has only the original three. Inspect the recorded phase, because a failed run can leave all logins fenced, some other abnormal state, or normal logins with web stopped.
4. Inspect only metadata and inventory of the nonce-specific `.incomplete-<nonce>` and any same-nonce visible final. Keep both and all earlier complete captures. A visible final or READY manifest without the matching successful receipt, actual zero exit and validator pass is indeterminate. Do not send it to restic as current; do not delete, overwrite, rename or repair it automatically. Verify whether offsite publication was attempted and its actual result separately.
5. If Stage 2 has been deployed, inspect outbox status **counts and uncertain/retrying state** through an authorized minimal query before any mail worker or login is enabled. Preserve reservations/liabilities and uncertain deliveries. There is no automatic mail retry or model activation in this procedure.
6. Only after an explicit recovery decision, select the compatible image and exact role changes based on the recorded pre-run state, ledger and lock/session findings; reconcile any accepted writes or queue effects. The authorized operator may restore only the previously enabled logins and start the same existing compatible web container after all fences are understood and no capture writer remains. Independently verify the fixed health check, ingress and any separately required public checks. If the state is ambiguous, keep traffic closed and escalate; never execute a blanket unfence or image-only rollback across migration 006.

Escrow, offsite access, activation, production restores, and retention changes each require their own authorization and evidence.
