-- Run in the Supabase project that already has the NMRBC Scheduler schema.
BEGIN;

CREATE TABLE IF NOT EXISTS public.nvbsp_print_allocations (
  first_serial bigint PRIMARY KEY,
  last_serial bigint NOT NULL,
  CHECK (first_serial BETWEEN 10000000000 AND 99999999999),
  CHECK (last_serial BETWEEN first_serial AND 99999999999),
  UNIQUE (first_serial, last_serial),
  EXCLUDE USING gist (int8range(first_serial, last_serial, '[]') WITH &&)
);

CREATE TABLE IF NOT EXISTS public.nvbsp_print_records (
  first_serial bigint PRIMARY KEY,
  last_serial bigint NOT NULL,
  allocation_first bigint NOT NULL,
  allocation_last bigint NOT NULL,
  printed_on date,
  remarks text NOT NULL DEFAULT '' CHECK (char_length(remarks) <= 300),
  recorded_by uuid DEFAULT auth.uid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (allocation_first, allocation_last)
    REFERENCES public.nvbsp_print_allocations (first_serial, last_serial),
  CHECK (first_serial BETWEEN allocation_first AND allocation_last),
  CHECK (last_serial BETWEEN first_serial AND allocation_last),
  EXCLUDE USING gist (int8range(first_serial, last_serial, '[]') WITH &&)
);

CREATE INDEX IF NOT EXISTS nvbsp_print_records_allocation_idx
  ON public.nvbsp_print_records (allocation_first, first_serial DESC);

ALTER TABLE public.nvbsp_print_records
  ADD COLUMN IF NOT EXISTS printed_by text CHECK (char_length(btrim(printed_by)) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS received_by text CHECK (char_length(btrim(received_by)) BETWEEN 1 AND 120);

ALTER TABLE public.nvbsp_print_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nvbsp_print_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nvbsp_print_allocations, public.nvbsp_print_records
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nvbsp_print_allocations, public.nvbsp_print_records TO authenticated;
GRANT INSERT (first_serial, last_serial, allocation_first, allocation_last, printed_on, printed_by, received_by, remarks)
  ON public.nvbsp_print_records TO authenticated;
GRANT UPDATE (received_by) ON public.nvbsp_print_records TO authenticated;

DROP POLICY IF EXISTS nvbsp_read_allocations ON public.nvbsp_print_allocations;
CREATE POLICY nvbsp_read_allocations ON public.nvbsp_print_allocations FOR SELECT
  TO authenticated USING ((SELECT public.scheduler_is_admin()));
DROP POLICY IF EXISTS nvbsp_read_records ON public.nvbsp_print_records;
CREATE POLICY nvbsp_read_records ON public.nvbsp_print_records FOR SELECT
  TO authenticated USING ((SELECT public.scheduler_is_admin()));
DROP POLICY IF EXISTS nvbsp_add_records ON public.nvbsp_print_records;
CREATE POLICY nvbsp_add_records ON public.nvbsp_print_records FOR INSERT
  TO authenticated WITH CHECK (
    (SELECT public.scheduler_is_admin())
    AND recorded_by = (SELECT auth.uid())
    AND printed_on IS NOT NULL
    AND printed_by IS NOT NULL
    AND printed_on <= (now() AT TIME ZONE 'Asia/Manila')::date
  );
DROP POLICY IF EXISTS nvbsp_add_recipient ON public.nvbsp_print_records;
CREATE POLICY nvbsp_add_recipient ON public.nvbsp_print_records FOR UPDATE
  TO authenticated
  USING ((SELECT public.scheduler_is_admin()) AND printed_by IS NOT NULL AND received_by IS NULL)
  WITH CHECK ((SELECT public.scheduler_is_admin()) AND received_by IS NOT NULL);

-- September 28 QA report. Earlier batch dates were not individually listed.
INSERT INTO public.nvbsp_print_allocations (first_serial, last_serial)
VALUES (20269249951, 20269252950)
ON CONFLICT (first_serial) DO NOTHING;

INSERT INTO public.nvbsp_print_records
  (first_serial, last_serial, allocation_first, allocation_last, printed_on, remarks, recorded_by)
VALUES
  (20269249951, 20269250050, 20269249951, 20269252950, NULL, 'QA report · Batch 1 · Roeben Dem Perez', NULL),
  (20269250051, 20269250510, 20269249951, 20269252950, NULL, 'QA report · Batch 2 · Joben Irvin Sanchez', NULL),
  (20269250511, 20269251010, 20269249951, 20269252950, NULL, 'QA report · Batch 3 · Roeben Dem P. Perez, RMT', NULL),
  (20269251011, 20269251510, 20269249951, 20269252950, NULL, 'QA report · Batch 4 · Roeben Dem P. Perez, RMT', NULL),
  (20269251511, 20269251910, 20269249951, 20269252950, DATE '2026-09-28', 'QA report · Batch 5 · Roeben Dem P. Perez, RMT', NULL)
ON CONFLICT (first_serial) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nvbsp_print_snapshot(
  p_allocation bigint, p_before bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH allocation AS (
    SELECT first_serial, last_serial
    FROM public.nvbsp_print_allocations
    WHERE first_serial = p_allocation
  ), records AS (
    SELECT r.first_serial, r.last_serial, r.printed_on, r.printed_by, r.received_by, r.remarks,
      lag(r.last_serial, 1, a.first_serial - 1) OVER (ORDER BY r.first_serial) AS previous_end
    FROM public.nvbsp_print_records r
    JOIN allocation a ON a.first_serial = r.allocation_first
  ), totals AS (
    SELECT max(last_serial) AS highest,
      min(previous_end + 1) FILTER (WHERE first_serial > previous_end + 1) AS first_gap,
      coalesce(sum(last_serial - first_serial + 1), 0) AS printed
    FROM records
  ), page AS (
    SELECT first_serial, last_serial, printed_on, printed_by, received_by, remarks
    FROM records
    WHERE p_before IS NULL OR first_serial < p_before
    ORDER BY first_serial DESC
    LIMIT 16
  )
  SELECT jsonb_build_object(
    'highest', t.highest,
    'next', CASE
      WHEN t.first_gap IS NOT NULL THEN t.first_gap
      WHEN coalesce(t.highest, a.first_serial - 1) < a.last_serial
        THEN coalesce(t.highest + 1, a.first_serial)
    END,
    'printed', t.printed,
    'remaining', a.last_serial - a.first_serial + 1 - t.printed,
    'records', coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY first_serial DESC) FROM page), '[]'::jsonb)
  )
  FROM allocation a CROSS JOIN totals t;
$$;

REVOKE ALL ON FUNCTION public.nvbsp_print_snapshot(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvbsp_print_snapshot(bigint, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
