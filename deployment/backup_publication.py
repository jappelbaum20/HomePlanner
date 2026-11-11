#!/usr/bin/env python3
"""Local, cooperative-owner backup publication primitives (Linux only)."""
import ctypes
import datetime
import hashlib
import json
import os
import re
import stat

ARTIFACTS = ("database.dump.gpg", "photos.tar.gpg", "photos.sha256z.gpg")
FILES = (*ARTIFACTS, "SHA256SUMS", "capture-manifest.json")
LEDGER5 = ["001_auth.sql", "002_business.sql", "003_photos.sql",
           "004_photo_maintenance.sql", "005_shelf_documents.sql"]
LEDGER6 = [*LEDGER5, "006_access_requests.sql"]
NONCE = re.compile(r"[0-9a-f]{32}\Z")
FINAL = re.compile(r"([0-9]{8}T[0-9]{6}Z)-([0-9a-f]{32})\Z")
DIRFLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILEFLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


def check_nonce(nonce):
    if not NONCE.fullmatch(nonce):
        raise ValueError("nonce must be 32 lowercase hexadecimal characters")


def open_parent(path):
    """Open each canonical ancestor without following links, requiring trusted owners."""
    if (not os.path.isabs(path) or os.path.normpath(path) != path
            or any(c.startswith(".") for c in path.split("/") if c)
            or any(ord(c) < 32 or ord(c) == 127 for c in path)):
        raise ValueError("canonical absolute publication parent required")
    fd = os.open("/", DIRFLAGS)
    try:
        components = [c for c in path.split("/") if c]
        for component in [""] + components:
            if component:
                nxt = os.open(component, DIRFLAGS, dir_fd=fd)
                os.close(fd)
                fd = nxt
            s = os.fstat(fd)
            if s.st_uid not in (0, os.geteuid()) or stat.S_IMODE(s.st_mode) & 0o022:
                raise ValueError("untrusted publication ancestor")
        s = os.fstat(fd)
        if s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) != 0o700:
            raise ValueError("publication parent must be owned by caller and mode 0700")
        return fd
    except BaseException:
        os.close(fd)
        raise


def same_parent(path, parent_fd):
    check = open_parent(path)
    try:
        a, b = os.fstat(check), os.fstat(parent_fd)
        if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
            raise ValueError("publication parent changed")
    finally:
        os.close(check)


def preflight(parent, nonce):
    check_nonce(nonce)
    fd = open_parent(parent)
    try:
        try:
            os.stat(".incomplete-" + nonce, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ValueError("staging nonce already exists")
        same_parent(parent, fd)
    finally:
        os.close(fd)


def read_fd(fd, maximum):
    os.lseek(fd, 0, os.SEEK_SET)
    result = b""
    while len(result) <= maximum:
        block = os.read(fd, min(65536, maximum + 1 - len(result)))
        if not block:
            break
        result += block
    if len(result) > maximum:
        raise ValueError("metadata too large")
    return result


def digest_fd(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    h = hashlib.sha256()
    while True:
        block = os.read(fd, 1024 * 1024)
        if not block:
            return h.hexdigest()
        h.update(block)


def file_fds(directory, names, mode=None):
    result = {}
    try:
        ds = os.fstat(directory)
        for name in names:
            fd = os.open(name, FILEFLAGS, dir_fd=directory)
            result[name] = fd
            s = os.fstat(fd)
            if (not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size == 0
                    or s.st_uid != os.geteuid() or s.st_dev != ds.st_dev
                    or (mode is not None and stat.S_IMODE(s.st_mode) != mode)):
                raise ValueError("unsafe file: " + name)
        return result
    except BaseException:
        for fd in result.values():
            os.close(fd)
        raise


def close_files(files):
    for fd in files.values():
        os.close(fd)


def checksums(files):
    data = read_fd(files["SHA256SUMS"], 1024)
    actual = {name: digest_fd(files[name]) for name in ARTIFACTS}
    expected = "".join(actual[n] + "  " + n + "\n" for n in ARTIFACTS).encode("ascii")
    if data != expected:
        raise ValueError("checksum file or artifact mismatch")
    return {**actual, "SHA256SUMS": hashlib.sha256(data).hexdigest()}


def parse_json(data):
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ValueError("duplicate manifest key")
            result[k] = v
        return result
    return json.loads(data, object_pairs_hook=unique)


def validate_manifest(manifest, final_name, hashes):
    m = FINAL.fullmatch(final_name)
    if not m or not isinstance(manifest, dict) or set(manifest) != {
            "schema", "state", "nonce", "directory", "capture_started",
            "capture_ended", "ledger", "artifacts"}:
        raise ValueError("invalid manifest structure")
    if (type(manifest["schema"]) is not int or manifest["schema"] != 1 or manifest["state"] != "READY"
            or manifest["nonce"] != m.group(2) or manifest["directory"] != final_name
            or manifest["ledger"] not in (LEDGER5, LEDGER6)
            or manifest["artifacts"] != hashes):
        raise ValueError("manifest binding mismatch")
    start, end = manifest["capture_started"], manifest["capture_ended"]
    if (type(start) is not int or type(end) is not int or start < 0 or end < start
            or datetime.datetime.fromtimestamp(start, datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") != m.group(1)):
        raise ValueError("invalid capture times")


def prepare(parent, nonce, final_name, start, end, ledger):
    check_nonce(nonce)
    stage = ".incomplete-" + nonce
    parent_fd = open_parent(parent)
    directory = None
    files = {}
    try:
        directory = os.open(stage, DIRFLAGS, dir_fd=parent_fd)
        s = os.fstat(directory)
        if s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) != 0o700 or s.st_dev != os.fstat(parent_fd).st_dev:
            raise ValueError("unsafe staging directory")
        if set(os.listdir(directory)) != {*ARTIFACTS, "SHA256SUMS"}:
            raise ValueError("unexpected staging contents")
        files = file_fds(directory, (*ARTIFACTS, "SHA256SUMS"))
        hashes = checksums(files)
        manifest = {"schema": 1, "state": "READY", "nonce": nonce,
                    "directory": final_name, "capture_started": start, "capture_ended": end,
                    "ledger": ledger, "artifacts": hashes}
        validate_manifest(manifest, final_name, hashes)
        data = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        fd = os.open("capture-manifest.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
        except BaseException:
            raise
        same_parent(parent, parent_fd)
        return hashlib.sha256(data).hexdigest()
    finally:
        close_files(files)
        if directory is not None:
            os.close(directory)
        os.close(parent_fd)


def inspect(directory, final_name, sealed):
    s = os.fstat(directory)
    expected_mode = 0o500 if sealed else 0o700
    if s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) != expected_mode:
        raise ValueError("unsafe capture directory")
    if set(os.listdir(directory)) != set(FILES):
        raise ValueError("unexpected capture inventory")
    files = file_fds(directory, FILES, 0o400 if sealed else None)
    try:
        hashes = checksums(files)
        raw = read_fd(files["capture-manifest.json"], 16384)
        manifest = parse_json(raw)
        validate_manifest(manifest, final_name, hashes)
        return manifest, hashlib.sha256(raw).hexdigest(), files
    except BaseException:
        close_files(files)
        raise


def publish(parent, nonce, final_name):
    check_nonce(nonce)
    if not FINAL.fullmatch(final_name) or not final_name.endswith("-" + nonce):
        raise ValueError("invalid final name")
    parent_fd = open_parent(parent)
    directory = None
    files = {}
    try:
        stage = ".incomplete-" + nonce
        directory = os.open(stage, DIRFLAGS, dir_fd=parent_fd)
        original = os.fstat(directory)
        if original.st_dev != os.fstat(parent_fd).st_dev:
            raise ValueError("capture must share parent filesystem")
        _, manifest_hash, files = inspect(directory, final_name, False)
        for fd in files.values():
            os.fchmod(fd, 0o400)
            if stat.S_IMODE(os.fstat(fd).st_mode) != 0o400:
                raise ValueError("file mode not enforced")
            os.fsync(fd)
        os.fchmod(directory, 0o500)
        if stat.S_IMODE(os.fstat(directory).st_mode) != 0o500:
            raise ValueError("directory mode not enforced")
        os.fsync(directory)
        # Recheck sealed content and parent/source identity immediately before rename.
        _, digest, check_files = inspect(directory, final_name, True)
        close_files(check_files)
        if digest != manifest_hash:
            raise ValueError("manifest changed during sealing")
        same_parent(parent, parent_fd)
        current = os.stat(stage, dir_fd=parent_fd, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
            raise ValueError("staging directory changed")
        libc = ctypes.CDLL(None, use_errno=True)
        rename = libc.renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(parent_fd, os.fsencode(stage), parent_fd, os.fsencode(final_name), 1):
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        os.fsync(parent_fd)
        return manifest_hash
    finally:
        close_files(files)
        if directory is not None:
            os.close(directory)
        os.close(parent_fd)
