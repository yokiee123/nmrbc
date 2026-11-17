# NVBSP Barcode Print Tracker

Open `/nvbsp-print-tracker/` from the same site as the dashboard, or select **Open Barcode Print Tracker** on the September 2026 QA report.

## Install on NMRBC

1. In the Supabase project configured by `scheduler/public/config.js`, confirm that the scheduler schema is installed. As the project owner, run `scheduler/supabase/nvbsp-print-tracker.sql` and then `scheduler/supabase/nvbsp-series-inventory.sql` in the SQL Editor.
2. Deploy the tracker directory and the updated QA report with the existing NMRBC site. The tracker uses the scheduler's Supabase URL, browser publishable key and bundled client.
3. Sign in with a scheduler administrator account. With the report history alone, the tracker shows **1,960 recorded**, **1,040 remaining**, and **NVBSP20269251911** as the next ID in the allocated range. Reconcile any labels printed after the September 28, 2026 QA report before using the next ID shown.

For an existing tracker with printer and recipient fields, run only `scheduler/supabase/nvbsp-series-inventory.sql` before deploying the updated page.

## Record a print

- For one printed barcode, scan or type it in **First barcode ID** and leave the last ID blank. For a continuous print run, enter both endpoints. A scanner's Enter suffix advances focus without saving.
- Enter the actual print date and the name of the person who printed the labels. If someone already received them, enter that person's name too, then select **Record as printed**. Both endpoints are included. If a print run skipped IDs, enter each continuous span separately.
- If the handover takes place later, select **Record recipient** on that row in **Print history**. A saved recipient can only be corrected by the project owner.
- The next ID is the first unrecorded ID in the selected allocation. The highest printed ID may be greater if the records have a gap. Supabase rejects overlapping entries, including duplicates submitted by another workstation.
- Refresh before printing if others have used the printer. The displayed next ID is based on the saved ledger. Coordinate the print run with other staff using the same allocation, then record the successful print.

## Add an incoming barcode series

1. Open **Add incoming series** under **Barcode series inventory**.
2. Scan or type the first and last barcode IDs of the range assigned to NMRBC. Both IDs are included. If the series contains one barcode, enter the same ID twice.
3. Select **Save to inventory**. The new series appears in the inventory and becomes the selected series for printing. Use **Allocated barcode series** to switch between saved ranges and see the next ID, remaining count, and print history for each.

The tracker accepts separate ranges and rejects any range that overlaps an existing series.
