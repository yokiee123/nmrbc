#!/usr/bin/env python3
"""Refine NMRBC Scheduler MBD Send View for mobile screenshots.

Run from /workspaces/nmrbc/scheduler/public:
    python3 fix_send_view_layout.py

Only changes views.css. No changes to JS, Supabase, or schedule records.
"""

from pathlib import Path
import shutil
import sys


# Exact selectors from the production Send View stylesheet (October 25, 2026).
# Exact-match changes prevent accidental modification of unrelated styling.
CHANGES = [
    (
        '.send-card-title-row h2 { margin: 0; font-size: 17px; font-weight: 800; line-height: 1.15; }',
        '.send-card-title-row h2 { margin: 0; font-size: 14px; font-weight: 750; line-height: 1.2; }',
    ),
    (
        '.send-card-location { margin: 4px 0 0; color: #4a586b; font-size: 12px; font-weight: 600; line-height: 1.25; white-space: pre-wrap; }',
        '.send-card-location { margin: 6px 0 2px; color: #81243a; font-size: 21px; font-weight: 850; line-height: 1.14; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; }',
    ),
    (
        '.send-card-team li { display: flex; gap: 5px; min-width: 0; align-items: baseline; border-bottom: 1px dotted #e3e8ed; padding: 2px 0 3px; }',
        '.send-card-team li { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; border-bottom: 1px dotted #e3e8ed; padding: 3px 0 4px; }',
    ),
    (
        '.send-card-team li span { flex: 1; min-width: 0; font-size: 10px; line-height: 1.2; font-weight: 650; }',
        '.send-card-team li span { display: block; width: 100%; min-width: 0; flex: none; font-size: 10px; line-height: 1.2; font-weight: 750; white-space: normal; word-break: normal; overflow-wrap: normal; }',
    ),
    (
        '.send-card-team li small { font-size: 9px; color: #657488; flex-shrink: 0; }',
        '.send-card-team li small { display: block; width: 100%; min-width: 0; font-size: 8px; line-height: 1.15; color: #657488; flex: none; white-space: normal; word-break: normal; overflow-wrap: break-word; }',
    ),
    (
        '  .send-card-title-row h2 { font-size: 15px; }',
        '  .send-card-title-row h2 { font-size: 13px; }\n  .send-card-location { font-size: 19px; }',
    ),
]


def main():
    css = Path(__file__).resolve().parent / 'views.css'
    if not css.is_file():
        # Also work if the script is elsewhere but the current directory is scheduler/public.
        css = Path.cwd() / 'views.css'
    if not css.is_file():
        sys.exit('ERROR: views.css not found. Place this script in scheduler/public or run it from that directory. No files changed.')

    try:
        original = css.read_text(encoding='utf-8')
    except UnicodeError:
        sys.exit('ERROR: Could not read views.css as UTF-8. No files changed.')

    # All original selectors must be present before any modification, so the
    # patch is atomic and never half-applies to an unknown stylesheet version.
    missing = [old for old, _ in CHANGES if original.count(old) != 1]
    if missing:
        if all(new in original for _, new in CHANGES):
            print('ALREADY INSTALLED: Mobile name and venue fixes are present. Nothing changed.')
            return
        sys.exit('ERROR: The live stylesheet differs from the expected Send View version.\n'
                 'No files changed. Please share the output of git diff -- views.css before proceeding.')

    updated = original
    for before, after in CHANGES:
        updated = updated.replace(before, after, 1)

    # Remove the pre-existing extra blank line at EOF, if any, to make
    # git diff --check clean. Keep exactly one final newline.
    updated = updated.rstrip('\n') + '\n'

    backup = css.with_name('views.css.before-mobile-layout-fix.bak')
    if backup.exists():
        sys.exit(f'ERROR: Backup already exists: {backup.name}. No changes made.')
    shutil.copy2(css, backup)
    css.write_text(updated, encoding='utf-8', newline='\n')
    print('SUCCESS: Send View mobile layout improved.')
    print('✓ Venue is larger, bold, and visually dominant over the activity title.')
    print('✓ Names and roles are stacked, preventing long role names from squeezing a name vertically.')
    print('✓ Two-column companions layout retained for compact mobile screenshots.')
    print('✓ No JavaScript or Supabase changes.')
    print(f'Updated: {css.name}')
    print(f'Backup: {backup.name}')
    print('Next: git diff --check && git diff -- views.css')


if __name__ == '__main__':
    main()
