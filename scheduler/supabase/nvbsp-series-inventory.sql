-- Run after nvbsp-print-tracker.sql so the tracker tables and policies exist.
BEGIN;

GRANT INSERT (first_serial, last_serial) ON public.nvbsp_print_allocations TO authenticated;

DROP POLICY IF EXISTS nvbsp_add_allocations ON public.nvbsp_print_allocations;
CREATE POLICY nvbsp_add_allocations ON public.nvbsp_print_allocations FOR INSERT
  TO authenticated WITH CHECK ((SELECT public.scheduler_is_admin()));

NOTIFY pgrst, 'reload schema';
COMMIT;
