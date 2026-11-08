#!/usr/bin/env python3
"""Synthetic exact-path selection and restic check in a private mount namespace."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

repo = Path(sys.argv[1])
restic = sys.argv[2]
work = Path(sys.argv[3])
sys.path.insert(0, str(repo / "deployment"))
import backup_publication as bp

assert hashlib.sha256(Path(restic).read_bytes()).hexdigest() == "20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639"
root = Path("/srv/backups/consistent-data")
parent = root / "homeplanner"
parent.mkdir(mode=0o700)
energy = root / "Energyfixture"
energy.mkdir(mode=0o700)
(energy / "energy.txt").write_text("synthetic energy\n")
now = int(time.time())
validator = repo / "deployment/validate-backup.py"


def build(label, offset=0, publish=True):
    nonce = os.urandom(16).hex()
    start = now + offset
    name = datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + nonce
    stage = parent / (".incomplete-" + nonce)
    stage.mkdir(mode=0o700)
    rows = []
    for filename in bp.ARTIFACTS:
        content = (label + ":" + filename).encode()
        (stage / filename).write_bytes(content)
        rows.append(hashlib.sha256(content).hexdigest() + "  " + filename + "\n")
    (stage / "SHA256SUMS").write_text("".join(rows))
    digest = bp.prepare(str(parent), nonce, name, start, start, bp.LEDGER6)
    if publish:
        assert bp.publish(str(parent), nonce, name) == digest
    log = work / (label + ".log")
    receipt = f"HOMEPLANNER_BACKUP_RECEIPT_V2 {nonce} {name} {start} {start} {digest} COMPLETE\n"
    log.write_text(receipt if publish else "")
    log.chmod(0o600)
    return dict(nonce=nonce, start=start, name=name, stage=stage, log=log, digest=digest, receipt=receipt)


def select(item, *, expected, status=0, nonce=None, age=120):
    command = [sys.executable, "-B", str(validator), "--parent", str(parent),
               "--nonce", nonce or item["nonce"], "--not-before", str(item["start"]),
               "--max-age", str(age), "--process-status", str(status),
               "--receipt-log", str(item["log"])]
    result = subprocess.run(command, capture_output=True, text=True)
    if expected:
        assert result.returncode == 0, result.stderr
        paths = result.stdout.splitlines()
        assert paths == [str(parent / item["name"] / n) for n in bp.FILES]
        print("validator accepted exact five paths: " + item["name"], flush=True)
        return paths
    assert result.returncode != 0 and result.stdout == "", (result.stdout, result.stderr)
    print("validator rejected: " + result.stderr.strip(), flush=True)
    return []


good = build("good")
approved = select(good, expected=True)
stale = build("stale", offset=-1000)
select(stale, expected=False)
unsealed = build("unsealed", publish=False)
os.rename(unsealed["stage"], parent / unsealed["name"])
unsealed["log"].write_text(unsealed["receipt"])  # Synthetic receipt exercises mode rejection.
select(unsealed, expected=False)
select(good, expected=False, nonce="0" * 32)
select(good, expected=False, status=143)
corrupt = build("checksum")
f = parent / corrupt["name"] / bp.ARTIFACTS[0]
f.chmod(0o600); f.write_bytes(b"tampered"); f.chmod(0o400)
select(corrupt, expected=False)
linked = build("symlink")
d = parent / linked["name"]; f = d / bp.ARTIFACTS[0]
d.chmod(0o700); f.rename(parent / "retained-target"); f.symlink_to(parent / "retained-target"); d.chmod(0o500)
select(linked, expected=False)
crash = build("crash", publish=False)
child = """
import os, sys
sys.path.insert(0, sys.argv[1])
import backup_publication as bp
parent, nonce, name = sys.argv[2:]
target = os.stat(parent)
fsync = os.fsync
def exit_at_parent(fd):
    st = os.fstat(fd)
    if (st.st_dev, st.st_ino) == (target.st_dev, target.st_ino):
        os._exit(73)
    fsync(fd)
bp.os.fsync = exit_at_parent
bp.publish(parent, nonce, name)
"""
result = subprocess.run([sys.executable, "-B", "-c", child, str(repo / "deployment"),
                         str(parent), crash["nonce"], crash["name"]])
assert result.returncode == 73
assert (parent / crash["name"]).is_dir() and not crash["stage"].exists()
select(crash, expected=False, status=73)
select(crash, expected=False, status=0)

env = os.environ.copy()
env["RESTIC_PASSWORD"] = os.urandom(32).hex()  # synthetic, process-only
restic_repo = str(work / "restic-repository")
base = [restic, "--no-cache", "--repo", restic_repo]
def run(args):
    print("restic " + " ".join(args), flush=True)
    return subprocess.run(base + args, env=env, check=True, capture_output=True, text=True).stdout

run(["init"])
exclude = "/srv/backups/consistent-data/**/.*"
backup = run(["backup", str(energy / "energy.txt"), *approved, "--exclude", exclude, "--json"])
records = [json.loads(line) for line in backup.splitlines()]
snapshot = next(r["snapshot_id"] for r in records if r.get("message_type") == "summary")
listing = run(["ls", snapshot, "--json"])
nodes = [json.loads(line) for line in listing.splitlines()]
files = {n["path"] for n in nodes if n.get("type") == "file"}
assert files == {str(energy / "energy.txt"), *approved}, files
restore = work / "restore"
run(["restore", snapshot, "--target", str(restore), "--verify"])
for path in files:
    assert (restore / path.lstrip("/")).read_bytes() == Path(path).read_bytes()
print("PASS snapshot " + snapshot + ": Energy file and five approved files only; restore verified", flush=True)
