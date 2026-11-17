# NVBSP Barcode Print Tracker

Open `/nvbsp-print-tracker/` from the same site as the dashboard, or select **Open Barcode Print Tracker** on the September 2026 QA report.

## Install on NMRBC

1. In the Supabase project configured by `scheduler/public/config.js`, confirm that the scheduler schema is installed. As the project owner, run `scheduler/supabase/nvbsp-print-tracker.sql` in the SQL Editor.
2. Deploy the tracker directory and the updated QA report with the existing NMRBC site. The tracker uses the scheduler's Supabase URL, browser publishable key and bundled client.
3. Sign in with a scheduler administrator account. With the report history alone, the tracker shows **1,960 recorded**, **1,040 remaining**, and **NVBSP20269251911** as the next ID in the allocated range. Reconcile any labels printed after the September 28, 2026 QA report before using the next ID shown.

## Record a print

- For one printed barcode, scan or type it in **First barcode ID** and leave the last ID blank. For a continuous print run, enter both endpoints. A scanner's Enter suffix advances focus without saving.
- Enter the actual print date and select **Record as printed**. Both endpoints are included. If a print run skipped IDs, enter each continuous span separately.
- The next ID is the first unrecorded ID in the selected allocation. The highest printed ID may be greater if the records have a gap. Supabase rejects overlapping entries, including duplicates submitted by another workstation.
- Refresh before printing if others have used the printer. The displayed next ID is based on the saved ledger. Coordinate the print run with other staff using the same allocation, then record the successful print.

## Add an assigned allocation

Only enter ranges officially assigned to NMRBC. In the Supabase SQL Editor, the project owner can register another allocation using its 11-digit numeric endpoints. Replace the placeholders before running this statement.

```sql
INSERT INTO public.nvbsp_print_allocations (first_serial, last_serial)
VALUES (<first assigned serial>, <last assigned serial>);
```

Refresh the tracker and select the new allocation. Existing allocations and print history stay in the ledger. For a recording mistake, have the project owner reconcile the entry against the actual print record.
