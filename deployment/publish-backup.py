#!/usr/bin/env python3
"""Prepare and atomically publish an encrypted cold backup on Linux."""
import sys
import backup_publication as bp


def main(args):
    if len(args) == 3 and args[0] == 'preflight':
        bp.preflight(args[1], args[2])
    elif len(args) == 7 and args[0] == 'prepare':
        print(bp.prepare(args[1], args[2], args[3], int(args[4]), int(args[5]), args[6].split(',')))
    elif len(args) == 4 and args[0] == 'publish':
        print(bp.publish(args[1], args[2], args[3]))
    else:
        raise ValueError('invalid publication arguments')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, AttributeError, OverflowError, TypeError) as error:
        print('Backup publication failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
