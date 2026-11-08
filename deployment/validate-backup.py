#!/usr/bin/env python3
"""Validate one invocation and print the exact files a caller may back up."""
import argparse
import os
import re
import stat
import sys
import time
import backup_publication as bp


def receipt_bytes(path):
    if not os.path.isabs(path):
        raise ValueError("receipt log must have an absolute path")
    fd = os.open(path, bp.FILEFLAGS)
    try:
        s = os.fstat(fd)
        if (not stat.S_ISREG(s.st_mode) or s.st_nlink != 1
                or s.st_uid != os.geteuid() or stat.S_IMODE(s.st_mode) & 0o077):
            raise ValueError("unsafe receipt log")
        return bp.read_fd(fd, 1048576).decode("utf-8")
    finally:
        os.close(fd)


def validate(parent, nonce, not_before, max_age, status, receipt_path):
    bp.check_nonce(nonce)
    now = int(time.time())
    if status != 0 or not_before < 0 or not_before > now or max_age <= 0:
        raise ValueError("unsuccessful process or invalid invocation window")
    lines = [line for line in receipt_bytes(receipt_path).splitlines()
             if line.startswith("HOMEPLANNER_BACKUP_RECEIPT_V2 ")]
    if len(lines) != 1:
        raise ValueError("missing or ambiguous receipt")
    match = re.fullmatch(r"HOMEPLANNER_BACKUP_RECEIPT_V2 ([0-9a-f]{32}) "
                         r"([0-9]{8}T[0-9]{6}Z-[0-9a-f]{32}) "
                         r"([0-9]+) ([0-9]+) ([0-9a-f]{64}) COMPLETE", lines[0])
    if not match:
        raise ValueError("invalid receipt")
    receipt_nonce, name, start, end, manifest_hash = match.groups()
    start, end = int(start), int(end)
    if (receipt_nonce != nonce or not name.endswith("-" + nonce)
            or start < not_before or end < start or end > now or now - end > max_age):
        raise ValueError("receipt nonce or freshness mismatch")
    parent_fd = bp.open_parent(parent)
    directory = None
    files = {}
    try:
        directory = os.open(name, bp.DIRFLAGS, dir_fd=parent_fd)
        ds = os.fstat(directory)
        if ds.st_dev != os.fstat(parent_fd).st_dev:
            raise ValueError("capture filesystem mismatch")
        manifest, digest, files = bp.inspect(directory, name, True)
        if (digest != manifest_hash or manifest["nonce"] != nonce
                or manifest["capture_started"] != start or manifest["capture_ended"] != end):
            raise ValueError("receipt and manifest mismatch")
        bp.same_parent(parent, parent_fd)
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (ds.st_dev, ds.st_ino):
            raise ValueError("capture changed")
        return [os.path.join(parent, name, filename) for filename in bp.FILES]
    finally:
        bp.close_files(files)
        if directory is not None:
            os.close(directory)
        os.close(parent_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", required=True)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--not-before", type=int, required=True)
    parser.add_argument("--max-age", type=int, required=True)
    parser.add_argument("--process-status", type=int, required=True)
    parser.add_argument("--receipt-log", required=True)
    args = parser.parse_args()
    try:
        paths = validate(args.parent, args.nonce, args.not_before, args.max_age,
                         args.process_status, args.receipt_log)
        sys.stdout.write("".join(path + "\n" for path in paths))
    except (ValueError, OSError, UnicodeError, OverflowError, TypeError) as error:
        print("HomePlanner selection rejected: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
