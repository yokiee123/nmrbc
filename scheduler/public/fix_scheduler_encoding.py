#!/usr/bin/env python3
"""Repair known mojibake sequences in the NMRBC Scheduler app.js.

Usage:
    python fix_scheduler_encoding.py app.js
    python fix_scheduler_encoding.py scheduler/public/app.js

The script creates a .before-encoding-fix.bak backup and does not touch databases.
"""
import argparse
from pathlib import Path
import shutil
import sys

REPLACEMENTS = {
    "â€“": "–",
    "â€”": "—",
    "Â·": "·",
    "â€¹": "‹",
    "â€º": "›",
    "â†’": "→",
    "â†—": "↗",
    "â€¦": "…",
    "â€™": "’",
    "â€˜": "‘",
    "â€œ": "“",
    "â€\x9d": "”",
    "âš": "⚠",
    "Â©": "©",
    "Â®": "®",
    "Â°": "°",
    "Â ": " ",
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default="app.js",
                        help="Path to app.js (default: ./app.js)")
    args = parser.parse_args()
    path = Path(args.path)
    if not path.is_file():
        print(f"ERROR: File not found: {path}")
        sys.exit(1)

    raw = path.read_bytes()
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        print("ERROR: This file is not UTF-8. No changes made.")
        sys.exit(1)

    fixed = source
    applied = {}
    for old, new in REPLACEMENTS.items():
        hits = fixed.count(old)
        if hits:
            applied[repr(old)] = hits
            fixed = fixed.replace(old, new)

    if fixed == source:
        print("No known corrupted sequences detected; file left unchanged.")
        return

    backup = path.with_name(path.name + ".before-encoding-fix.bak")
    if backup.exists():
        print(f"ERROR: Backup already exists: {backup}")
        print("No changes made. Preserve or move that backup before retrying.")
        sys.exit(1)

    shutil.copy2(path, backup)
    path.write_bytes(fixed.encode("utf-8"))
    print(f"Fixed: {path}")
    print(f"Backup: {backup}")
    for sequence, number in applied.items():
        print(f"  {sequence}: {number} replacement(s)")
    suspicious = [s for s in ("â", "Â", "Ã") if s in fixed]
    if suspicious:
        print("NOTE: Some possibly corrupted text remains. Search for:", ", ".join(suspicious))
    else:
        print("No remaining common mojibake prefixes detected.")
    print("Review the changes before uploading or committing.")

if __name__ == "__main__":
    main()
