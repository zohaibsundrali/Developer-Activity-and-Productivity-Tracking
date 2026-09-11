#!/usr/bin/env python3
"""Expand repository-local psql \\ir includes before streaming into test Docker."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def expand(path, ancestors=()):
    path = path.resolve()
    if not path.is_relative_to(ROOT) or path in ancestors:
        raise ValueError(f"Invalid or cyclic SQL fixture include: {path}")
    for line in path.read_text().splitlines(keepends=True):
        if line.strip().startswith('\\ir '):
            target = line.strip()[4:].strip().strip("'\"")
            yield from expand(path.parent / target, (*ancestors, path))
        else:
            yield line

if __name__ == '__main__':
    sys.stdout.writelines(expand(Path(sys.argv[1])))
