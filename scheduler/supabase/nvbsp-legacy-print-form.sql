-- Keep older deployed tracker pages usable while they still lack a Printed by field.
BEGIN;

CREATE OR REPLACE FUNCTION scheduler_private.nvbsp_read_legacy_printer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.printed_by IS NOT NULL OR current_user <> 'authenticated'
     OR NOT public.scheduler_is_admin() THEN
    RETURN NEW;
  END IF;

  NEW.printed_by := nullif(btrim(substring(NEW.remarks FROM '(?i)^[[:blank:]]*printed by:[[:blank:]]*([^[:cntrl:]]+)$')), '');
  IF NEW.printed_by IS NULL OR char_length(NEW.printed_by) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'In Remarks, enter Printed by: followed by the printer’s name (1–120 characters).';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_private.nvbsp_read_legacy_printer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nvbsp_read_legacy_printer ON public.nvbsp_print_records;
CREATE TRIGGER nvbsp_read_legacy_printer
  BEFORE INSERT ON public.nvbsp_print_records
  FOR EACH ROW EXECUTE FUNCTION scheduler_private.nvbsp_read_legacy_printer();

COMMIT;
